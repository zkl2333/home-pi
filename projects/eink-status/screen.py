"""墨水屏控制器：管理 Waveshare EPD、判定全/局刷、构建图像缓冲。

局刷限制：
- 启动时强制 full
- 局刷累积 PARTIAL_REFRESH_LIMIT 次后强制 full
- 距上次 full 超过 FULL_REFRESH_MAX_AGE_SEC 强制 full

displayPartial() 内部会改 LUT，回到全刷需要重新 init()。
_init_mode 跟踪当前 LUT 模式以决定是否要 re-init。
"""
from __future__ import annotations

import sys
import time
from datetime import datetime
from pathlib import Path

EPAPER_LIB = Path('/home/pi/e-Paper/RaspberryPi_JetsonNano/python/lib')
sys.path.insert(0, str(EPAPER_LIB))

from waveshare_epd import epd2in13_V3  # noqa: E402
from PIL import Image  # noqa: E402

from data import Snapshot  # noqa: E402
from render import render  # noqa: E402

ROTATE_180 = True
PARTIAL_REFRESH_LIMIT = 30
FULL_REFRESH_MAX_AGE_SEC = 3600


class ScreenController:
    def __init__(self):
        self.epd = epd2in13_V3.EPD()
        self.epd.init()
        self._init_mode = 'full'
        self.last_full_at = 0.0
        self.partial_count = 0
        self.last_refresh_at = 0.0
        self.last_snapshot: Snapshot | None = None
        self.current_page = 0

    def _build_buffer(self, s: Snapshot):
        img = Image.new('1', (self.epd.height, self.epd.width), 255)
        render(img, s, self.current_page)
        if ROTATE_180:
            img = img.rotate(180)
        return self.epd.getbuffer(img)

    def refresh(self, s: Snapshot, reason: str) -> None:
        force_full = (
            self.last_full_at == 0
            or self.partial_count >= PARTIAL_REFRESH_LIMIT
            or (time.time() - self.last_full_at) > FULL_REFRESH_MAX_AGE_SEC
        )
        buf = self._build_buffer(s)
        t0 = time.time()
        if force_full:
            if self._init_mode != 'full':
                self.epd.init()
                self._init_mode = 'full'
            self.epd.display(buf)
            self.epd.displayPartBaseImage(buf)
            self.last_full_at = time.time()
            self.partial_count = 0
            mode = 'full'
        else:
            self.epd.displayPartial(buf)
            self.partial_count += 1
            self._init_mode = 'partial'
            mode = 'partial'
        elapsed = time.time() - t0
        self.last_refresh_at = time.time()
        self.last_snapshot = s
        print(f'[{datetime.now().strftime("%H:%M:%S")}] refresh {mode} '
              f'({elapsed:.1f}s) reason={reason}', flush=True)

    def sleep(self):
        try:
            self.epd.sleep()
        except Exception:
            pass
