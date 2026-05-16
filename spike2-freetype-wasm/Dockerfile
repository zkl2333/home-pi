# spike#2 可复现构建：零本机工具链，docker build 即得 freetype-mono.wasm
# 与未来 GitHub CI 用同一个 emscripten/emsdk 镜像 → 产物可复现、跨平台一致。
#   docker build -t ft-mono-spike .
#   docker run --rm -v "$PWD/out:/out" ft-mono-spike
FROM emscripten/emsdk:3.1.74

RUN apt-get update && apt-get install -y --no-install-recommends cmake ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /spike
COPY glue.c build.sh ./
RUN chmod +x build.sh
ENV OUT_DIR=/out
CMD ["bash", "build.sh"]
