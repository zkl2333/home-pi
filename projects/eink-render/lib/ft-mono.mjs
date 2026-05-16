/**
 * FreeType-MONO font engine (replaces the Python/PIL side).
 *
 * Backed by the general-purpose freetype-wasm library, vendored under
 * vendor/freetype-wasm/ (pinned to upstream tag v2.14.3 / FreeType 2.14.3 —
 * see SOURCE.txt). ALLOW_MEMORY_GROWTH=1, so multi-MB CJK fonts don't OOM.
 * Measurement (advance) and rasterization (MONO bitmap) come from the same
 * face/size — single source of truth.
 *
 * One Face per font family (no global-face reload churn). glyph cache key =
 * family|px|codepoint; the big clock digits rasterize once then cache.
 *
 * Exported contract (unchanged, raster.mjs / vdom-to-ops.js depend on it):
 *   initFt(): Promise<void>
 *   glyph(family, px, cp)   -> {w,h,left,top,adv,advf,mono:Uint8Array(0/1)}
 *   measure(family, px, str)-> integer width
 *   vmetrics(family, px)    -> {ascender, descender, height}  (px, FT signs)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FT_DIR = path.join(HERE, "..", "vendor", "freetype-wasm");
const FT_INDEX = path.join(FT_DIR, "index.mjs");
const FT_WASM = path.join(FT_DIR, "freetype.wasm");
const FONT_DIR = path.join(HERE, "..", "fonts");

// family -> file (mirrors renderer.jsx FONTS)
const FONT_FILES = {
  regular: "wqy-microhei.ttf",
  clock: "archivo-black.ttf",
  phosphor: "Phosphor.ttf",
  "phosphor-fill": "Phosphor-Fill.ttf",
};

let ft = null; // FreeType instance
let FT = null; // constants
let O = null; // struct offsets (raw layer, for scaled size metrics)
const faces = {}; // family -> { face, curPx }
const glyphCache = new Map(); // "family|px|cp" -> glyph

export async function initFt() {
  if (ft) return;
  const mod = await import(pathToFileURL(FT_INDEX).href);
  const initFreeType = mod.default;
  FT = mod.FT;
  ft = await initFreeType({ wasmBinary: new Uint8Array(fs.readFileSync(FT_WASM)) });
  O = ft.offsets;
  for (const [fam, file] of Object.entries(FONT_FILES)) {
    const fp = path.join(FONT_DIR, file);
    if (!fs.existsSync(fp)) continue; // wqy guaranteed on Pi/CI by setup-font; skip if absent
    faces[fam] = { face: ft.newFace(new Uint8Array(fs.readFileSync(fp))), curPx: -1 };
  }
}

function use(family, px) {
  const slot = faces[family] || faces.regular;
  if (slot.curPx !== px) {
    slot.face.setPixelSize(px);
    slot.curPx = px;
  }
  return slot.face;
}

const EMPTY = () => ({ w: 0, h: 0, left: 0, top: 0, adv: 0, advf: 0, mono: new Uint8Array(0) });

/** glyph with cache. {w,h,left,top,adv(px),advf(frac px),mono:Uint8Array(0/1)} */
export function glyph(family, px, codepoint) {
  const key = `${family}|${px}|${codepoint}`;
  const hit = glyphCache.get(key);
  if (hit) return hit;
  const face = use(family, px);

  // Unmapped codepoint -> empty (zero advance), matching the old engine's
  // render-failure path so layout/width stay identical.
  if (face.charIndex(codepoint) === 0) {
    const e = EMPTY();
    glyphCache.set(key, e);
    return e;
  }

  const lg = face.loadGlyph({
    char: codepoint,
    flags: FT.LOAD_TARGET_MONO,
    renderMode: FT.RENDER_MODE_MONO,
  });

  const w = lg.width,
    h = lg.rows,
    pitch = Math.abs(lg.pitch);
  // MONO: 1bpp, |pitch| bytes/row, MSB first; expand to w*h of 0/1
  const mono = new Uint8Array(w * h);
  const src = lg.buffer;
  for (let y = 0; y < h; y++) {
    const row = y * pitch;
    for (let x = 0; x < w; x++) {
      mono[y * w + x] = (src[row + (x >> 3)] >> (7 - (x & 7))) & 1;
    }
  }
  const ax = lg.advance.x; // 26.6 fixed
  const g = {
    w,
    h,
    left: lg.bitmapLeft,
    top: lg.bitmapTop,
    adv: ax >> 6, // integer px (measure / spec side)
    advf: ax / 64, // fractional advance (raster penX accumulation, anti-drift)
    mono,
  };
  glyphCache.set(key, g);
  return g;
}

/** Text width: sum fractional advances then ceil — same source of truth as
 *  the rasterizer, so Yoga centering/wrapping matches real ink. */
export function measure(family, px, text) {
  let wsum = 0;
  for (const ch of String(text)) wsum += glyph(family, px, ch.codePointAt(0)).advf;
  return Math.ceil(wsum);
}

/** Vertical metrics for this px size, read from the live FT_Size_Metrics
 *  (26.6, grid-fitted) — NOT face-level font-unit values — so the baseline
 *  is pixel-identical to the previous engine. descender keeps FT's sign (<0). */
export function vmetrics(family, px) {
  const face = use(family, px);
  const sizePtr = ft.module.getValue(face.ptr + O.FT_FaceRec.size, "*");
  const mp = sizePtr + O.FT_SizeRec.metrics;
  return {
    ascender: ft.module.getValue(mp + O.FT_Size_Metrics.ascender, "i32") >> 6,
    descender: ft.module.getValue(mp + O.FT_Size_Metrics.descender, "i32") >> 6,
    height: ft.module.getValue(mp + O.FT_Size_Metrics.height, "i32") >> 6,
  };
}
