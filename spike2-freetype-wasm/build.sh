#!/usr/bin/env bash
# spike#2：在 emscripten/emsdk 环境里把 FreeType + glue.c 编成
# 内存可增长的 ES6 WASM 模块。供 Dockerfile / GitHub CI 调用。
# 不在本机直接跑（本机无 emcc）。
set -euo pipefail

FT_VER="${FT_VER:-2.13.3}"
OUT_DIR="${OUT_DIR:-/out}"
WORK="${WORK:-/tmp/ftbuild}"
mkdir -p "$WORK" "$OUT_DIR"
cd "$WORK"

# FreeType 源：GNU Savannah（不依赖 github 直连）
if [ ! -d "freetype-${FT_VER}" ]; then
  echo ">>> 下载 FreeType ${FT_VER}"
  curl -fL "https://download.savannah.gnu.org/releases/freetype/freetype-${FT_VER}.tar.gz" -o ft.tar.gz
  tar xf ft.tar.gz
fi

# 用 FreeType 自带 CMake，emscripten 交叉编译成静态库。
# 砍掉用不到的外部依赖（zlib/png/harfbuzz/brotli）让产物最小、最可控。
cd "freetype-${FT_VER}"
emcmake cmake -B build -G "Unix Makefiles" \
  -DCMAKE_BUILD_TYPE=Release \
  -DBUILD_SHARED_LIBS=OFF \
  -DFT_DISABLE_ZLIB=ON \
  -DFT_DISABLE_BZIP2=ON \
  -DFT_DISABLE_PNG=ON \
  -DFT_DISABLE_HARFBUZZ=ON \
  -DFT_DISABLE_BROTLI=ON
emmake make -C build -j"$(nproc)" freetype
FT_LIB="$PWD/build/libfreetype.a"
FT_INC="$PWD/include"

cd "$WORK/.."
echo ">>> 链接 glue + libfreetype → freetype-mono.mjs/.wasm"
emcc "$(dirname "$0")/glue.c" "$FT_LIB" \
  -I"$FT_INC" \
  -O3 \
  -sMODULARIZE=1 \
  -sEXPORT_ES6=1 \
  -sALLOW_MEMORY_GROWTH=1 \
  -sINITIAL_MEMORY=16MB \
  -sENVIRONMENT=node \
  -sEXPORTED_FUNCTIONS=_ft_init,_ft_load_face,_ft_set_px,_ft_render,_ft_bm_width,_ft_bm_rows,_ft_bm_pitch,_ft_bm_pixmode,_ft_bm_buffer,_ft_bm_left,_ft_bm_top,_ft_adv_x,_ft_size_ascender,_ft_size_descender,_ft_size_height,_malloc,_free \
  -sEXPORTED_RUNTIME_METHODS=cwrap,HEAPU8 \
  -o "$OUT_DIR/freetype-mono.mjs"

ls -la "$OUT_DIR"
echo ">>> done. 关键验收点：ALLOW_MEMORY_GROWTH=1 → 4.4MB CJK 字体应不再 OOM"
