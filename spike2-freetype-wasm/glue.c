/* spike#2 最小 FreeType→WASM 胶水（非生产）。
 * 目标：暴露刚好够"测量 + MONO 光栅"的面，直接给 1-bit 位图 buffer，
 * 不走 RGBA ImageData（消除 spike#1 的 alpha 通道 + 堆视图失效两个坑）。
 * 单 face 全局态足够 spike；生产化再做多 face/句柄。 */
#include <ft2build.h>
#include FT_FREETYPE_H
#include <emscripten.h>

static FT_Library g_lib = 0;
static FT_Face g_face = 0;

EMSCRIPTEN_KEEPALIVE int ft_init(void) {
  if (g_lib) return 0;
  return FT_Init_FreeType(&g_lib);
}

/* bytes 由 JS 用 _malloc 拷进 wasm 堆后传入；len=字体字节数 */
EMSCRIPTEN_KEEPALIVE int ft_load_face(const unsigned char *bytes, int len) {
  if (g_face) { FT_Done_Face(g_face); g_face = 0; }
  return FT_New_Memory_Face(g_lib, bytes, (FT_Long)len, 0, &g_face);
}

EMSCRIPTEN_KEEPALIVE int ft_set_px(int px) {
  if (!g_face) return -1;
  return FT_Set_Pixel_Sizes(g_face, 0, (FT_UInt)px);
}

/* 渲染一个 unicode 码点，强制 hinted MONO。0=成功 */
EMSCRIPTEN_KEEPALIVE int ft_render(int codepoint) {
  if (!g_face) return -1;
  FT_UInt gi = FT_Get_Char_Index(g_face, (FT_ULong)codepoint);
  return FT_Load_Glyph(g_face, gi, FT_LOAD_RENDER | FT_LOAD_TARGET_MONO);
}

/* 当前 glyph 的 1-bit 位图属性。pitch=每行字节数，MSB-first，
 * buffer 指针在 wasm 堆里，JS 直接按 HEAPU8 读 pitch*rows 字节。 */
EMSCRIPTEN_KEEPALIVE int ft_bm_width(void)  { return g_face ? (int)g_face->glyph->bitmap.width : 0; }
EMSCRIPTEN_KEEPALIVE int ft_bm_rows(void)   { return g_face ? (int)g_face->glyph->bitmap.rows  : 0; }
EMSCRIPTEN_KEEPALIVE int ft_bm_pitch(void)  { return g_face ? (int)g_face->glyph->bitmap.pitch : 0; }
EMSCRIPTEN_KEEPALIVE int ft_bm_pixmode(void){ return g_face ? (int)g_face->glyph->bitmap.pixel_mode : -1; }
EMSCRIPTEN_KEEPALIVE unsigned char *ft_bm_buffer(void) {
  return g_face ? g_face->glyph->bitmap.buffer : 0;
}
EMSCRIPTEN_KEEPALIVE int ft_bm_left(void) { return g_face ? g_face->glyph->bitmap_left : 0; }
EMSCRIPTEN_KEEPALIVE int ft_bm_top(void)  { return g_face ? g_face->glyph->bitmap_top  : 0; }

/* 26.6 定点：JS 端 >>6 取整像素。advance 即字宽（测量同源关键）。 */
EMSCRIPTEN_KEEPALIVE int ft_adv_x(void)        { return g_face ? (int)g_face->glyph->advance.x : 0; }
EMSCRIPTEN_KEEPALIVE int ft_size_ascender(void){ return g_face ? (int)g_face->size->metrics.ascender : 0; }
EMSCRIPTEN_KEEPALIVE int ft_size_descender(void){return g_face ? (int)g_face->size->metrics.descender: 0; }
EMSCRIPTEN_KEEPALIVE int ft_size_height(void)  { return g_face ? (int)g_face->size->metrics.height : 0; }
