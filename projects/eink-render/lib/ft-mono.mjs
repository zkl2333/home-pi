/**
 * FreeType-MONO 字体引擎（替代 Python PIL 端）。
 *
 * 自编 freetype-mono.wasm（vendor/，-sENVIRONMENT=node -sEXPORT_ES6=1
 * -sALLOW_MEMORY_GROWTH=1，glue.c 直接导出 1-bit buffer）。
 * 测量(advance)与光栅(MONO bitmap)同源同字体 —— 单一真相源。
 *
 * glue.c 单 g_face 全局态：切字体须 ft_load_face 重载，故按 family 分批用。
 * glyph 缓存 key=family|px|codepoint，时钟大字首绘后即零重栅。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WASM_MJS = path.join(HERE, "..", "vendor", "freetype-mono.mjs");
const FONT_DIR = path.join(HERE, "..", "fonts");

// 与 renderer.jsx FONTS 对应（family → 文件）
const FONT_FILES = {
  regular: "wqy-microhei.ttf",
  clock: "archivo-black.ttf",
  phosphor: "Phosphor.ttf",
  "phosphor-fill": "Phosphor-Fill.ttf",
};

let m = null; // wasm module
let api = null; // cwrap 句柄
const fontPtr = {}; // family → { ptr, len }（字节常驻 wasm 堆，FT_New_Memory_Face 不拷贝）
let curFamily = null;
let curPx = -1;
const glyphCache = new Map(); // "family|px|cp" → {w,h,left,top,adv,mono}

export async function initFt() {
  if (m) return;
  const Factory = (await import(pathToFileURL(WASM_MJS).href)).default;
  m = await Factory();
  api = {
    init: m.cwrap("ft_init", "number", []),
    loadFace: m.cwrap("ft_load_face", "number", ["number", "number"]),
    setPx: m.cwrap("ft_set_px", "number", ["number"]),
    render: m.cwrap("ft_render", "number", ["number"]),
    w: m.cwrap("ft_bm_width", "number", []),
    rows: m.cwrap("ft_bm_rows", "number", []),
    pitch: m.cwrap("ft_bm_pitch", "number", []),
    pixmode: m.cwrap("ft_bm_pixmode", "number", []),
    buf: m.cwrap("ft_bm_buffer", "number", []),
    left: m.cwrap("ft_bm_left", "number", []),
    top: m.cwrap("ft_bm_top", "number", []),
    advx: m.cwrap("ft_adv_x", "number", []),
    asc: m.cwrap("ft_size_ascender", "number", []),
    desc: m.cwrap("ft_size_descender", "number", []),
    height: m.cwrap("ft_size_height", "number", []),
  };
  if (api.init() !== 0) throw new Error("ft_init 失败");
  // 字体字节一次性常驻 wasm 堆（FT 持有指针、不复制 → 不能释放）
  for (const [fam, file] of Object.entries(FONT_FILES)) {
    const fp = path.join(FONT_DIR, file);
    if (!fs.existsSync(fp)) continue; // wqy 在 Pi/CI 由 setup-font 保证；缺则跳过
    const bytes = fs.readFileSync(fp);
    const ptr = m._malloc(bytes.length);
    m.HEAPU8.set(bytes, ptr);
    fontPtr[fam] = { ptr, len: bytes.length };
  }
}

function use(family, px) {
  const f = fontPtr[family] || fontPtr.regular;
  if (curFamily !== family) {
    if (api.loadFace(f.ptr, f.len) !== 0) throw new Error(`load face 失败: ${family}`);
    curFamily = family;
    curPx = -1;
  }
  if (curPx !== px) {
    api.setPx(px);
    curPx = px;
  }
}

/** 取 glyph（带缓存）。返回 {w,h,left,top,adv(px), mono:Uint8Array(0/1)} */
export function glyph(family, px, codepoint) {
  const key = `${family}|${px}|${codepoint}`;
  const hit = glyphCache.get(key);
  if (hit) return hit;
  use(family, px);
  if (api.render(codepoint) !== 0) {
    const empty = { w: 0, h: 0, left: 0, top: 0, adv: 0, mono: new Uint8Array(0) };
    glyphCache.set(key, empty);
    return empty;
  }
  const w = api.w(),
    h = api.rows(),
    pitch = api.pitch(),
    bp = api.buf();
  const mono = new Uint8Array(w * h);
  const H = m.HEAPU8;
  for (let y = 0; y < h; y++) {
    const row = bp + y * pitch;
    for (let x = 0; x < w; x++) {
      mono[y * w + x] = (H[row + (x >> 3)] >> (7 - (x & 7))) & 1;
    }
  }
  const ax = api.advx();
  const g = {
    w,
    h,
    left: api.left(),
    top: api.top(),
    adv: ax >> 6, // 26.6 → 整数 px（measure / spec 侧用）
    advf: ax / 64, // 小数 advance（光栅 penX 累积用，避免逐字截断漂移）
    mono,
  };
  glyphCache.set(key, g);
  return g;
}

/** 文本宽度（advance 累加，单一真相源——与光栅同字体度量） */
export function measure(family, px, text) {
  let wsum = 0;
  for (const ch of String(text)) wsum += glyph(family, px, ch.codePointAt(0)).adv;
  return wsum;
}

/** 该字号字体竖直度量（26.6 → px） */
export function vmetrics(family, px) {
  use(family, px);
  return { ascender: api.asc() >> 6, descender: api.desc() >> 6, height: api.height() >> 6 };
}
