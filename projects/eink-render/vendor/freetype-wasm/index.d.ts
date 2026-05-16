// freetype-wasm 类型声明（薄包装层；原生层走 module 任意调用）

export interface FTConstants {
  LOAD_DEFAULT: number; LOAD_NO_SCALE: number; LOAD_NO_HINTING: number;
  LOAD_RENDER: number; LOAD_NO_BITMAP: number; LOAD_FORCE_AUTOHINT: number;
  LOAD_MONOCHROME: number; LOAD_TARGET_NORMAL: number; LOAD_TARGET_LIGHT: number;
  LOAD_TARGET_MONO: number;
  RENDER_MODE_NORMAL: number; RENDER_MODE_LIGHT: number; RENDER_MODE_MONO: number;
  RENDER_MODE_LCD: number; RENDER_MODE_LCD_V: number;
  PIXEL_MODE_NONE: number; PIXEL_MODE_MONO: number; PIXEL_MODE_GRAY: number;
  PIXEL_MODE_GRAY2: number; PIXEL_MODE_GRAY4: number; PIXEL_MODE_LCD: number;
  PIXEL_MODE_LCD_V: number; PIXEL_MODE_BGRA: number;
  KERNING_DEFAULT: number; KERNING_UNFITTED: number; KERNING_UNSCALED: number;
  ENCODING_NONE: number; ENCODING_UNICODE: number; ENCODING_MS_SYMBOL: number;
  ENCODING_SJIS: number; ENCODING_PRC: number; ENCODING_BIG5: number;
  ENCODING_WANSUNG: number; ENCODING_JOHAB: number; ENCODING_ADOBE_LATIN_1: number;
  ENCODING_APPLE_ROMAN: number;
}
export const FT: FTConstants;

export interface GlyphMetrics {
  width: number; height: number;
  horiBearingX: number; horiBearingY: number; horiAdvance: number;
  vertBearingX: number; vertBearingY: number; vertAdvance: number;
}
export interface LoadedGlyph {
  width: number; rows: number; pitch: number;
  pixelMode: number; numGrays: number;
  bitmapLeft: number; bitmapTop: number;
  advance: { x: number; y: number };
  metrics: GlyphMetrics;
  /** MONO: 1bpp 按 |pitch| 行 MSB 先；GRAY: 8bpp。已从 wasm 堆拷出。 */
  buffer: Uint8Array;
}
export interface FaceInfo {
  numFaces: number; numGlyphs: number;
  familyName: string; styleName: string;
  numCharmaps: number; unitsPerEM: number;
  ascender: number; descender: number; height: number;
}

export class Face {
  readonly ptr: number;
  /** 完整 Emscripten 模块（原生逃生口） */
  readonly module: any;
  info(): FaceInfo;
  setPixelSize(px: number, pyOrZero?: number): this;
  setCharSize(charW26_6: number, charH26_6: number, hdpi: number, vdpi: number): this;
  charIndex(codepoint: number): number;
  selectCharmap(encoding: number): this;
  loadGlyph(o?: {
    char?: number; index?: number; flags?: number;
    render?: boolean; renderMode?: number;
  }): LoadedGlyph;
  kerning(leftIndex: number, rightIndex: number, mode?: number): { x: number; y: number };
  destroy(): void;
}

export class FreeType {
  /** 完整 Emscripten 模块：ccall/cwrap/getValue/setValue/HEAPU8/_malloc/_free/addFunction… */
  readonly module: any;
  /** wasm32 结构体字段偏移（读 module 内存用） */
  readonly offsets: Record<string, any>;
  readonly library: number;
  version(): [number, number, number];
  newFace(bytes: Uint8Array | ArrayBuffer, faceIndex?: number): Face;
  destroy(): void;
}

export default function initFreeType(opts?: {
  wasmBinary?: Uint8Array;
  locateFile?: (path: string) => string;
}): Promise<FreeType>;
