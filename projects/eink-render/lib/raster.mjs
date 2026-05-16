/**
 * 纯 Node 1-bit 光栅器（替代 python/render_ops.py）。
 *
 * 读 ops JSON（vdom-to-ops 产物）→ 在 1-bit 画布(0=黑 255=白)上画
 * → 输出灰度 PNG（仅 0/255，eink-status getbuffer 的 convert('1') 等价无损）。
 * 文字经 ft-mono（FreeType-WASM MONO）：测量与光栅同源。
 *
 * text 三模式精确复刻 PIL d.text(anchor=...)：
 *   h 缺省            → 'la'：x=左，y=ascender 顶
 *   align=center + w  → 'mm'：盒心水平+垂直居中
 *   否则              → 'lm'：x=左，盒内按字体 ascent/descent 垂直居中
 */
import zlib from "node:zlib";
import { initFt, glyph, measure, vmetrics } from "./ft-mono.mjs";

function colorToFill(c, dft) {
  if (c == null) return dft;
  if (typeof c === "number") return c === 0 ? 0 : 255;
  const s = String(c).toLowerCase().trim();
  if (s === "black" || s === "#000" || s === "#000000" || s === "0" || s === "k") return 0;
  if (s === "white" || s === "#fff" || s === "#ffffff" || s === "255" || s === "w") return 255;
  return dft;
}

function makeCanvas(w, h, bg) {
  const px = new Uint8Array(w * h).fill(bg);
  const set = (x, y, v) => {
    x |= 0;
    y |= 0;
    if (x >= 0 && x < w && y >= 0 && y < h) px[y * w + x] = v;
  };
  const fillRect = (x0, y0, x1, y1, v) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, v);
  };
  return { w, h, px, set, fillRect };
}

// PIL d.rectangle outline：宽 width 的矩形边框（内缩，与 PIL 一致）
function strokeRect(cv, x0, y0, x1, y1, v, width) {
  for (let i = 0; i < width; i++) {
    for (let x = x0; x <= x1; x++) { cv.set(x, y0 + i, v); cv.set(x, y1 - i, v); }
    for (let y = y0; y <= y1; y++) { cv.set(x0 + i, y, v); cv.set(x1 - i, y, v); }
  }
}

// PIL d.line：仅需水平/垂直/一般 Bresenham（本项目线基本是 1px 轴对齐分隔）
function drawLine(cv, x1, y1, x2, y2, v, width) {
  const half = (width - 1) >> 1;
  if (y1 === y2) {
    const a = Math.min(x1, x2), b = Math.max(x1, x2);
    for (let x = a; x <= b; x++) for (let k = -half; k <= width - 1 - half; k++) cv.set(x, y1 + k, v);
    return;
  }
  if (x1 === x2) {
    const a = Math.min(y1, y2), b = Math.max(y1, y2);
    for (let y = a; y <= b; y++) for (let k = -half; k <= width - 1 - half; k++) cv.set(x1 + k, y, v);
    return;
  }
  let dx = Math.abs(x2 - x1), dy = Math.abs(y2 - y1);
  let sx = x1 < x2 ? 1 : -1, sy = y1 < y2 ? 1 : -1, err = dx - dy, x = x1, y = y1;
  for (;;) {
    cv.set(x, y, v);
    if (x === x2 && y === y2) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
  }
}

// PIL d.ellipse 在 bbox [x0,y0,x1,y1]（含端点）填充/描边
function drawEllipse(cv, x0, y0, x1, y1, fill, stroke, width) {
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const rx = (x1 - x0) / 2, ry = (y1 - y0) / 2;
  if (rx <= 0 || ry <= 0) return;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const nx = (x + 0.5 - cx) / rx, ny = (y + 0.5 - cy) / ry;
      const d = nx * nx + ny * ny;
      if (d <= 1) {
        if (fill != null) cv.set(x, y, fill);
        else if (stroke != null) {
          // 近边缘当描边（薄环）
          const inx = (x + 0.5 - cx) / (rx - width), iny = (y + 0.5 - cy) / (ry - width);
          if (rx - width <= 0 || ry - width <= 0 || inx * inx + iny * iny > 1) cv.set(x, y, stroke);
        }
      }
    }
  }
}

function blitGlyph(cv, g, penX, baseline, fill) {
  const ox = Math.round(penX) + g.left;
  const oy = baseline - g.top;
  for (let y = 0; y < g.h; y++) {
    const r = y * g.w;
    for (let x = 0; x < g.w; x++) if (g.mono[r + x]) cv.set(ox + x, oy + y, fill);
  }
}

// 复刻 PIL anchor 文字定位
function drawText(cv, op) {
  const text = op.text == null ? "" : String(op.text);
  if (!text) return;
  const family = op.font || "regular";
  const px = Math.round(op.size ?? 11);
  const fill = colorToFill(op.fill, 0);
  const tx = Math.round(op.x);
  const ty = Math.round(op.y);
  const hasH = op.h != null;

  const cps = [...text].map((c) => c.codePointAt(0));
  const glyphs = cps.map((cp) => glyph(family, px, cp));
  // 小数 advance 累积（只在 blit 时取整），贴近 PIL 26.6 行为、减少漂移
  const W = glyphs.reduce((s, g) => s + g.advf, 0);
  const vm = vmetrics(family, px);
  const A = vm.ascender;
  const Dpos = -vm.descender; // FT descender 为负

  let penX, baseline;
  if (!hasH) {
    // 'la'：左 + ascender 顶
    penX = tx;
    baseline = ty + A;
  } else if (op.align === "center" && op.w != null) {
    // 'mm'：盒心水平+垂直居中
    penX = tx + op.w / 2 - W / 2;
    baseline = ty + op.h / 2 + (A - Dpos) / 2;
  } else {
    // 'lm'：左 + 盒内竖直居中
    penX = tx;
    baseline = ty + op.h / 2 + (A - Dpos) / 2;
  }
  baseline = Math.round(baseline);
  for (const g of glyphs) {
    blitGlyph(cv, g, penX, baseline, fill);
    penX += g.advf;
  }
}

// ── 零依赖灰度 PNG（仅 0/255；eink-status convert('1') 无损） ──
function pngGray(width, height, gray) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const tb = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; tb[n] = c >>> 0; }
  const crc = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = tb[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (ty, d) => { const t4 = Buffer.from(ty); const L = Buffer.alloc(4); L.writeUInt32BE(d.length); const C = Buffer.alloc(4); C.writeUInt32BE(crc(Buffer.concat([t4, d]))); return Buffer.concat([L, t4, d, C]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 0;
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) { raw[y * (width + 1)] = 0; for (let x = 0; x < width; x++) raw[y * (width + 1) + 1 + x] = gray[y * width + x]; }
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

let ftReady = false;

/** spec = {size:[w,h], ops:[...], bg?} → PNG Buffer */
export async function renderToPng(spec) {
  if (!ftReady) { await initFt(); ftReady = true; }
  const [w, h] = spec.size;
  const bg = colorToFill(spec.bg ?? "white", 255);
  const cv = makeCanvas(w, h, bg);

  for (const op of spec.ops || []) {
    const k = op.op;
    if (k === "rect") {
      const x = op.x | 0, y = op.y | 0, w2 = op.w | 0, h2 = op.h | 0;
      if (w2 <= 0 || h2 <= 0) continue;
      if (op.fill != null) cv.fillRect(x, y, x + w2 - 1, y + h2 - 1, colorToFill(op.fill, 0));
      if (op.stroke != null) strokeRect(cv, x, y, x + w2 - 1, y + h2 - 1, colorToFill(op.stroke, 0), (op.strokeWidth | 0) || 1);
    } else if (k === "line") {
      drawLine(cv, op.x1 | 0, op.y1 | 0, op.x2 | 0, op.y2 | 0, colorToFill(op.color, 0), (op.width | 0) || 1);
    } else if (k === "text") {
      drawText(cv, op);
    } else if (k === "pixels") {
      const fill = colorToFill(op.fill, 0);
      const bx = op.x | 0, by = op.y | 0;
      (op.rows || []).forEach((row, dy) => {
        if (!row) return;
        const [x1, x2] = row.split(",").map((v) => parseInt(v, 10));
        for (let x = x1; x <= x2; x++) cv.set(bx + x, by + dy, fill);
      });
    } else if (k === "ellipse") {
      const x = op.x | 0, y = op.y | 0, w2 = op.w | 0, h2 = op.h | 0;
      if (w2 <= 0 || h2 <= 0) continue;
      drawEllipse(cv, x, y, x + w2 - 1, y + h2 - 1,
        op.fill != null ? colorToFill(op.fill, 0) : null,
        op.stroke != null ? colorToFill(op.stroke, 0) : null,
        (op.strokeWidth | 0) || 1);
    } else {
      throw new Error(`unknown op: ${k}`);
    }
  }
  return pngGray(w, h, cv.px);
}
