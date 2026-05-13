#!/usr/bin/env python3
"""把一张 PNG 在墨水屏上全刷一次（一次性测试用）。

用法:
  python3 show-png.py <path-to-png>

约束:
  - 图片建议 250×122（屏物理尺寸）；非该尺寸会先 .convert('1') 后 resize。
  - eink-status.service 占着 SPI / GPIO，先 stop 再跑本脚本。
"""
import sys
from pathlib import Path

EPAPER_LIB = Path('/home/pi/e-Paper/RaspberryPi_JetsonNano/python/lib')
sys.path.insert(0, str(EPAPER_LIB))

from waveshare_epd import epd2in13_V3  # noqa: E402
from PIL import Image  # noqa: E402

ROTATE_180 = True  # 与 eink-status 一致


def main(path: str) -> None:
    raw = Image.open(path)
    print(f'src mode={raw.mode} size={raw.size}')
    # 关键：dither=Image.NONE 防 PIL 默认 Floyd-Steinberg 把 AA 灰边搞成毛刺
    img = raw.convert('1', dither=Image.NONE)
    epd = epd2in13_V3.EPD()
    target = (epd.height, epd.width)  # 250 × 122 (landscape)
    if img.size != target:
        print(f'resize {img.size} -> {target}')
        img = img.resize(target)
    if ROTATE_180:
        img = img.rotate(180)

    epd.init()
    epd.Clear(0xFF)
    epd.display(epd.getbuffer(img))
    epd.sleep()
    print(f'✓ displayed {path}')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        print('usage: show-png.py <png>')
        sys.exit(1)
    main(sys.argv[1])
