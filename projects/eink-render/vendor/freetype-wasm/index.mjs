/**
 * freetype-wasm —— 通用 FreeType 的薄 JS 包装。
 *
 * 两层用法：
 *  1) 便捷层：FreeType / Face 类，覆盖 90% 场景（开字体 → 设字号 → 渲字 → 取位图/度量）。
 *     MONO 还是灰度 AA 由调用方传 load flags 决定，本库不替你选。
 *  2) 原生层：`ft.module` 是完整 Emscripten 模块——`ccall/cwrap/getValue/setValue/
 *     HEAPU8/_malloc/_free/addFunction` 直达 *任意* FreeType 公共 C 函数。便捷层没包到的
 *     高级用法（outline 抽取、size 管理、模块属性…）走这里，配 `ft.offsets` 读结构体。
 *
 * 产物同目录需有：freetype.mjs / freetype.wasm / offsets.mjs（build.sh 产出）。
 */
import OFFSETS from "./offsets.mjs";

// 常用常量（FreeType 公开头里的值，稳定不变；要别的自己加）
export const FT = {
  // FT_LOAD_*
  LOAD_DEFAULT: 0x0,
  LOAD_NO_SCALE: 0x1,
  LOAD_NO_HINTING: 0x2,
  LOAD_RENDER: 0x4,
  LOAD_NO_BITMAP: 0x8,
  LOAD_FORCE_AUTOHINT: 0x20,
  LOAD_MONOCHROME: 0x1000,
  LOAD_TARGET_NORMAL: 0x0, // (FT_RENDER_MODE_NORMAL << 16)
  LOAD_TARGET_LIGHT: 0x10000, // (1<<16)
  LOAD_TARGET_MONO: 0x20000, // (2<<16)
  // FT_RENDER_MODE_*
  RENDER_MODE_NORMAL: 0,
  RENDER_MODE_LIGHT: 1,
  RENDER_MODE_MONO: 2,
  RENDER_MODE_LCD: 3,
  RENDER_MODE_LCD_V: 4,
  // FT_PIXEL_MODE_*
  PIXEL_MODE_NONE: 0,
  PIXEL_MODE_MONO: 1,
  PIXEL_MODE_GRAY: 2,
  PIXEL_MODE_GRAY2: 3,
  PIXEL_MODE_GRAY4: 4,
  PIXEL_MODE_LCD: 5,
  PIXEL_MODE_LCD_V: 6,
  PIXEL_MODE_BGRA: 7,
  // FT_KERNING_*
  KERNING_DEFAULT: 0,
  KERNING_UNFITTED: 1,
  KERNING_UNSCALED: 2,
  // FT_ENCODING_*（4 字节 tag）
  ENCODING_NONE: 0,
  ENCODING_UNICODE: tag("unic"),
  ENCODING_MS_SYMBOL: tag("symb"),
  ENCODING_SJIS: tag("sjis"),
  ENCODING_PRC: tag("gb  "),
  ENCODING_BIG5: tag("big5"),
  ENCODING_WANSUNG: tag("wans"),
  ENCODING_JOHAB: tag("joha"),
  ENCODING_ADOBE_LATIN_1: tag("lat1"),
  ENCODING_APPLE_ROMAN: tag("armn"),
};
function tag(s) {
  return (
    ((s.charCodeAt(0) & 0xff) << 24) |
    ((s.charCodeAt(1) & 0xff) << 16) |
    ((s.charCodeAt(2) & 0xff) << 8) |
    (s.charCodeAt(3) & 0xff)
  ) >>> 0;
}

// wasm32：long / FT_Pos / FT_Fixed / int / 指针都是 4 字节
const I32 = "i32";

let _factory; // 缓存动态 import

/**
 * @param {{wasmBinary?:Uint8Array, locateFile?:(p:string)=>string}} [opts]
 * @returns {Promise<FreeType>}
 */
export default async function initFreeType(opts = {}) {
  if (!_factory) _factory = (await import("./freetype.mjs")).default;
  const mod = await _factory({
    ...(opts.wasmBinary ? { wasmBinary: opts.wasmBinary } : {}),
    ...(opts.locateFile ? { locateFile: opts.locateFile } : {}),
  });
  return new FreeType(mod);
}

export class FreeType {
  constructor(mod) {
    this.module = mod; // 原生逃生口：完整 Emscripten 模块
    this.offsets = OFFSETS;
    const c = (n, ret, a) => mod.cwrap(n, ret, a);
    this._fn = {
      InitFreeType: c("FT_Init_FreeType", "number", ["number"]),
      DoneFreeType: c("FT_Done_FreeType", "number", ["number"]),
      LibraryVersion: c("FT_Library_Version", null, ["number", "number", "number", "number"]),
      NewMemoryFace: c("FT_New_Memory_Face", "number", ["number", "number", "number", "number", "number"]),
      DoneFace: c("FT_Done_Face", "number", ["number"]),
      SetPixelSizes: c("FT_Set_Pixel_Sizes", "number", ["number", "number", "number"]),
      SetCharSize: c("FT_Set_Char_Size", "number", ["number", "number", "number", "number", "number"]),
      GetCharIndex: c("FT_Get_Char_Index", "number", ["number", "number"]),
      LoadGlyph: c("FT_Load_Glyph", "number", ["number", "number", "number"]),
      LoadChar: c("FT_Load_Char", "number", ["number", "number", "number"]),
      RenderGlyph: c("FT_Render_Glyph", "number", ["number", "number"]),
      GetKerning: c("FT_Get_Kerning", "number", ["number", "number", "number", "number", "number"]),
      SelectCharmap: c("FT_Select_Charmap", "number", ["number", "number"]),
    };
    const libPP = mod._malloc(4);
    const err = this._fn.InitFreeType(libPP);
    if (err) {
      mod._free(libPP);
      throw new Error(`FT_Init_FreeType 失败: ${err}`);
    }
    this.library = mod.getValue(libPP, I32);
    mod._free(libPP);
  }

  /** FreeType 版本 [major,minor,patch] */
  version() {
    const m = this.module;
    const p = m._malloc(12);
    this._fn.LibraryVersion(this.library, p, p + 4, p + 8);
    const v = [m.getValue(p, I32), m.getValue(p + 4, I32), m.getValue(p + 8, I32)];
    m._free(p);
    return v;
  }

  /** 从字体字节建 Face（TTF/OTF/TTC/Type1/CFF；本构建不支持 WOFF2） */
  newFace(bytes, faceIndex = 0) {
    const m = this.module;
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const dataPtr = m._malloc(u8.length);
    m.HEAPU8.set(u8, dataPtr);
    const facePP = m._malloc(4);
    const err = this._fn.NewMemoryFace(this.library, dataPtr, u8.length, faceIndex, facePP);
    const facePtr = m.getValue(facePP, I32);
    m._free(facePP);
    if (err) {
      m._free(dataPtr);
      throw new Error(`FT_New_Memory_Face 失败: ${err}`);
    }
    return new Face(this, facePtr, dataPtr); // FT 不复制字体字节，dataPtr 须随 Face 存活
  }

  destroy() {
    this._fn.DoneFreeType(this.library);
  }
}

export class Face {
  constructor(ft, facePtr, dataPtr) {
    this.ft = ft;
    this.module = ft.module;
    this.ptr = facePtr;
    this._dataPtr = dataPtr;
    this._O = ft.offsets;
  }

  _faceField(name, type = I32) {
    return this.module.getValue(this.ptr + this._O.FT_FaceRec[name], type);
  }
  _str(name) {
    const p = this._faceField(name);
    return p ? this.module.UTF8ToString(p) : "";
  }

  info() {
    return {
      numFaces: this._faceField("num_faces"),
      numGlyphs: this._faceField("num_glyphs"),
      familyName: this._str("family_name"),
      styleName: this._str("style_name"),
      numCharmaps: this._faceField("num_charmaps"),
      unitsPerEM: this.module.getValue(this.ptr + this._O.FT_FaceRec.units_per_EM, "i16") & 0xffff,
      ascender: this.module.getValue(this.ptr + this._O.FT_FaceRec.ascender, "i16"),
      descender: this.module.getValue(this.ptr + this._O.FT_FaceRec.descender, "i16"),
      height: this.module.getValue(this.ptr + this._O.FT_FaceRec.height, "i16"),
    };
  }

  setPixelSize(px, pyOrZero = 0) {
    const e = this.ft._fn.SetPixelSizes(this.ptr, pyOrZero, px);
    if (e) throw new Error(`FT_Set_Pixel_Sizes 失败: ${e}`);
    return this;
  }
  setCharSize(charW26_6, charH26_6, hdpi, vdpi) {
    const e = this.ft._fn.SetCharSize(this.ptr, charW26_6, charH26_6, hdpi, vdpi);
    if (e) throw new Error(`FT_Set_Char_Size 失败: ${e}`);
    return this;
  }
  charIndex(codepoint) {
    return this.ft._fn.GetCharIndex(this.ptr, codepoint >>> 0);
  }
  selectCharmap(encoding) {
    const e = this.ft._fn.SelectCharmap(this.ptr, encoding >>> 0);
    if (e) throw new Error(`FT_Select_Charmap 失败: ${e}`);
    return this;
  }

  /**
   * 渲一个字形。
   * @param {{char?:number, index?:number, flags?:number, render?:boolean, renderMode?:number}} o
   *   char: unicode 码点 | index: 直接给 glyph index；flags 默认 LOAD_DEFAULT；
   *   render 默认 true（用 renderMode，默认 NORMAL=灰度 AA；要 1-bit 传 FT.RENDER_MODE_MONO）
   * @returns {{width,rows,pitch,pixelMode,numGrays,bitmapLeft,bitmapTop,advance,
   *            metrics, buffer:Uint8Array}}  buffer 已从 wasm 堆拷出（安全持有）
   */
  loadGlyph(o = {}) {
    const m = this.module;
    const O = this._O;
    const flags = o.flags ?? FT.LOAD_DEFAULT;
    let e;
    if (o.index != null) e = this.ft._fn.LoadGlyph(this.ptr, o.index >>> 0, flags);
    else e = this.ft._fn.LoadChar(this.ptr, (o.char ?? 0) >>> 0, flags);
    if (e) throw new Error(`FT_Load_${o.index != null ? "Glyph" : "Char"} 失败: ${e}`);

    const slot = this._faceField("glyph"); // FT_GlyphSlotRec*
    if (o.render !== false && !(flags & FT.LOAD_RENDER)) {
      e = this.ft._fn.RenderGlyph(slot, o.renderMode ?? FT.RENDER_MODE_NORMAL);
      if (e) throw new Error(`FT_Render_Glyph 失败: ${e}`);
    }

    const bmp = slot + O.FT_GlyphSlotRec.bitmap;
    const B = O.FT_Bitmap;
    const rows = m.getValue(bmp + B.rows, I32) >>> 0;
    const width = m.getValue(bmp + B.width, I32) >>> 0;
    const pitch = m.getValue(bmp + B.pitch, I32); // 有符号，可能为负（自下而上）
    const bufPtr = m.getValue(bmp + B.buffer, I32);
    const pixelMode = m.getValue(bmp + B.pixel_mode, "i8") & 0xff;
    const numGrays = m.getValue(bmp + B.num_grays, "i16") & 0xffff;
    const nbytes = Math.abs(pitch) * rows;
    const buffer = nbytes > 0 ? m.HEAPU8.slice(bufPtr, bufPtr + nbytes) : new Uint8Array(0);

    const mp = slot + O.FT_GlyphSlotRec.metrics;
    const GM = O.FT_Glyph_Metrics;
    const g = (off) => m.getValue(mp + off, I32);
    const adv = slot + O.FT_GlyphSlotRec.advance;
    return {
      width,
      rows,
      pitch,
      pixelMode,
      numGrays,
      bitmapLeft: m.getValue(slot + O.FT_GlyphSlotRec.bitmap_left, I32),
      bitmapTop: m.getValue(slot + O.FT_GlyphSlotRec.bitmap_top, I32),
      advance: {
        x: m.getValue(adv + O.FT_Vector.x, I32), // 26.6 定点
        y: m.getValue(adv + O.FT_Vector.y, I32),
      },
      metrics: {
        width: g(GM.width),
        height: g(GM.height),
        horiBearingX: g(GM.horiBearingX),
        horiBearingY: g(GM.horiBearingY),
        horiAdvance: g(GM.horiAdvance), // 26.6
        vertBearingX: g(GM.vertBearingX),
        vertBearingY: g(GM.vertBearingY),
        vertAdvance: g(GM.vertAdvance),
      },
      buffer, // MONO: 1bpp，按 |pitch| 行、MSB 先；GRAY: 8bpp
    };
  }

  /** 两个 glyph index 间的 kerning（26.6），需字体含 kern 表 */
  kerning(leftIndex, rightIndex, mode = FT.KERNING_DEFAULT) {
    const m = this.module;
    const v = m._malloc(8);
    const e = this.ft._fn.GetKerning(this.ptr, leftIndex >>> 0, rightIndex >>> 0, mode, v);
    const O = this._O.FT_Vector;
    const r = e ? { x: 0, y: 0 } : { x: m.getValue(v + O.x, I32), y: m.getValue(v + O.y, I32) };
    m._free(v);
    return r;
  }

  destroy() {
    this.ft._fn.DoneFace(this.ptr);
    if (this._dataPtr) this.module._free(this._dataPtr);
    this._dataPtr = 0;
  }
}
