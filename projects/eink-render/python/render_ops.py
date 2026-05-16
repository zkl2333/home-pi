#!/usr/bin/env python3
"""读 ops JSON 用 PIL ImageDraw 在 mode='1' 画布上画 → 输出真 1-bit PNG。

ops 格式 (JSON, stdin or arg)：
  {
    "size": [250, 122],
    "fonts": { "regular": "fonts/wqy-microhei.ttf", "mono": "..." },
    "ops": [
      {"op": "rect", "x": 0, "y": 0, "w": 250, "h": 22, "fill": "black"},
      {"op": "rect", "x": 0, "y": 0, "w": 250, "h": 22, "stroke": "black"},
      {"op": "line", "x1": 0, "y1": 22, "x2": 250, "y2": 22},
      {"op": "text", "x": 6, "y": 4, "text": "21:42", "font": "regular", "size": 14, "fill": "black"},
      {"op": "image", "x": 100, "y": 50, "src": "..."}
    ]
  }

PIL 在 mode='1' 上画 text() 会自动用 FreeType MONO（无 AA + hint），
跟 Pi 端 eink-status 完全一致。
"""
from __future__ import annotations

import io
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


def color_to_fill(color, default: int = 0) -> int:
    """1-bit 画布只接受 0(黑) / 255(白)。"""
    if color is None:
        return default
    if isinstance(color, int):
        return 0 if color == 0 else 255
    s = str(color).lower().strip()
    if s in ('black', '#000', '#000000', '0', 'k'):
        return 0
    if s in ('white', '#fff', '#ffffff', '255', 'w'):
        return 255
    return default


def load_font(spec: dict, cache: dict[tuple, ImageFont.FreeTypeFont],
              fonts_map: dict[str, str]) -> ImageFont.FreeTypeFont | None:
    name = spec.get('font', 'regular')
    size = int(spec.get('size', 11))
    path = fonts_map.get(name)
    if not path:
        return None
    # key 包含 path：相同 name 映射到不同字体也不会冲突（daemon 模式共享缓存）
    key = (path, size)
    if key in cache:
        return cache[key]
    p = Path(path)
    if not p.is_absolute():
        p = Path.cwd() / p
    if not p.exists():
        raise FileNotFoundError(f'font not found: {p}  (cwd={Path.cwd()})')
    f = ImageFont.truetype(str(p), size=size)
    cache[key] = f
    return f


# daemon 模式下跨请求保活的字体缓存（key 包含字体路径，避免不同 fonts_map 冲突）
_DAEMON_FONT_CACHE: dict[tuple, ImageFont.FreeTypeFont] = {}


def render(spec: dict, font_cache: dict[tuple, ImageFont.FreeTypeFont] | None = None) -> bytes:
    w, h = spec['size']
    fonts_map = spec.get('fonts', {})
    bg = color_to_fill(spec.get('bg', 'white'), 255)

    img = Image.new('1', (w, h), bg)
    d = ImageDraw.Draw(img)
    if font_cache is None:
        font_cache = {}

    for op in spec.get('ops', []):
        kind = op.get('op')
        if kind == 'rect':
            x = int(op['x']); y = int(op['y'])
            w2 = int(op['w']); h2 = int(op['h'])
            if w2 <= 0 or h2 <= 0:
                continue  # 零尺寸 box，跳过
            fill = op.get('fill')
            stroke = op.get('stroke')
            if fill is not None:
                d.rectangle((x, y, x + w2 - 1, y + h2 - 1),
                            fill=color_to_fill(fill, 0))
            if stroke is not None:
                d.rectangle((x, y, x + w2 - 1, y + h2 - 1),
                            outline=color_to_fill(stroke, 0),
                            width=int(op.get('strokeWidth', 1)))
        elif kind == 'line':
            d.line(
                (int(op['x1']), int(op['y1']), int(op['x2']), int(op['y2'])),
                fill=color_to_fill(op.get('color', 'black'), 0),
                width=int(op.get('width', 1)),
            )
        elif kind == 'text':
            text = op.get('text', '')
            if not text:
                continue
            font = load_font(op, font_cache, fonts_map)
            fill = color_to_fill(op.get('fill', 'black'), 0)
            tx = int(op['x'])
            ty = int(op['y'])
            h = op.get('h')
            w = op.get('w')
            if h is None:
                d.text((tx, ty), text, font=font, fill=fill)
            elif op.get('align') == 'center' and w is not None:
                # 盒心水平+垂直居中：盒心由 flex 居中保证 == 容器中心，
                # 与 JS 估宽误差无关，故水平真居中无需精确测宽。
                d.text((tx + int(w) / 2, ty + int(h) / 2), text,
                       font=font, fill=fill, anchor='mm')
            else:
                # 左对齐 + 盒内按字体真实 ascent/descent 垂直居中
                # （取代 PIL 默认 'la' 钉顶 → 大字号 ink 视觉偏上）
                d.text((tx, ty + int(h) / 2), text, font=font, fill=fill, anchor='lm')
        elif kind == 'pixels':
            # 直接绘制像素位图：rows = ["x1,x2", ...]
            for dy, row in enumerate(op.get('rows', [])):
                if not row:
                    continue
                x1, x2 = (int(v) for v in row.split(','))
                d.rectangle(
                    (int(op['x']) + x1, int(op['y']) + dy,
                     int(op['x']) + x2, int(op['y']) + dy),
                    fill=color_to_fill(op.get('fill', 'black'), 0),
                )
        elif kind == 'ellipse':
            x = int(op['x']); y = int(op['y'])
            w2 = int(op['w']); h2 = int(op['h'])
            if w2 <= 0 or h2 <= 0:
                continue
            fill = op.get('fill')
            stroke = op.get('stroke')
            d.ellipse(
                (x, y, x + w2 - 1, y + h2 - 1),
                fill=color_to_fill(fill, 0) if fill is not None else None,
                outline=color_to_fill(stroke, 0) if stroke is not None else None,
                width=int(op.get('strokeWidth', 1)),
            )
        else:
            raise ValueError(f'unknown op: {kind!r}')

    out = io.BytesIO()
    img.save(out, format='PNG', optimize=True)
    return out.getvalue()


def daemon_loop() -> None:
    """长期运行，按行读 JSON 请求，按 length-prefix 协议写 PNG 响应。

    协议（stdin → stdout）：
      请求 (每行一个 JSON)：
        {"size":[250,122],"fonts":{...},"ops":[...]}\n
      响应：
        成功：  "OK <len>\\n" + len 字节 PNG
        失败：  "ERR <一行错误信息>\\n"  （无 payload）
    """
    in_buf = sys.stdin.buffer
    out_buf = sys.stdout.buffer
    while True:
        line = in_buf.readline()
        if not line:
            break  # stdin 关了，干净退出
        line = line.strip()
        if not line:
            continue
        try:
            spec = json.loads(line)
            png = render(spec, font_cache=_DAEMON_FONT_CACHE)
            out_buf.write(f'OK {len(png)}\n'.encode('ascii'))
            out_buf.write(png)
            out_buf.flush()
        except Exception as e:  # noqa: BLE001 - daemon 不能让单次失败拖死循环
            msg = f'{type(e).__name__}: {e}'.replace('\n', ' ').replace('\r', ' ')
            out_buf.write(f'ERR {msg}\n'.encode('utf-8', errors='replace'))
            out_buf.flush()


def main() -> None:
    if '--daemon' in sys.argv[1:]:
        daemon_loop()
        return
    if len(sys.argv) > 1 and sys.argv[1] != '-':
        raw = Path(sys.argv[1]).read_bytes()
    else:
        raw = sys.stdin.buffer.read()
    spec = json.loads(raw)
    png = render(spec)
    sys.stdout.buffer.write(png)


if __name__ == '__main__':
    main()
