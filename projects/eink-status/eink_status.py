#!/usr/bin/env python3
"""墨水屏状态显示常驻 daemon。

事件驱动模型：
- 命令通道：每次查询用短连接，按行 key:value 解析、过滤掉混入的事件行
- 事件通道：单独长连接读 tap 事件
- 后台线程每 POLL_INTERVAL 秒采样一次状态，仅在关键字段变化时刷新

按按钮时，本次刷新会在右下角显示一个反馈 tag（单击/双击/长按），下次刷新自动消失。

注：曾尝试用 pisugar-server-py 0.1.1，命令解析对事件行 / 分包鲁棒性不足，已放弃。
"""
from __future__ import annotations

import json
import os
import queue
import socket
import subprocess
import sys
import threading
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

EPAPER_LIB = Path('/home/pi/e-Paper/RaspberryPi_JetsonNano/python/lib')
sys.path.insert(0, str(EPAPER_LIB))

from waveshare_epd import epd2in13_V3  # noqa: E402
from PIL import Image, ImageDraw, ImageFont  # noqa: E402

PISUGAR_HOST = ('127.0.0.1', 8423)
FONT_DEJAVU = '/usr/share/fonts/truetype/dejavu'
FONT_CJK = '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc'

ROTATE_180 = True
POLL_INTERVAL = 10.0
PARTIAL_REFRESH_LIMIT = 30
FULL_REFRESH_MAX_AGE_SEC = 3600
SAFETY_REFRESH_MAX_AGE_SEC = 600
TAP_RECONNECT_DELAY_SEC = 5
TAP_BADGE_LINGER_SEC = 5         # tap 反馈在屏幕上至少保留这么久

TAP_LABELS = {'single': '单击', 'double': '双击', 'long': '长按'}


# ─── PiSugar 命令通道 ──────────────────────────────

def query_pisugar(cmds: list[str], timeout: float = 2.0) -> dict[str, str]:
    """短连接发多条 get 命令，按 key:value 解析并过滤事件行。"""
    out: dict[str, str] = {}
    try:
        with socket.create_connection(PISUGAR_HOST, timeout=timeout) as s:
            s.sendall(('\n'.join(cmds) + '\n').encode())
            s.settimeout(timeout)
            buf = b''
            deadline = time.time() + timeout
            while len(out) < len(cmds) and time.time() < deadline:
                try:
                    chunk = s.recv(4096)
                except socket.timeout:
                    break
                if not chunk:
                    break
                buf += chunk
                # 解析尽可能多的完整行
                while b'\n' in buf:
                    line, buf = buf.split(b'\n', 1)
                    text = line.decode(errors='replace').strip()
                    if not text or text in ('single', 'double', 'long'):
                        continue
                    if ':' in text:
                        k, _, v = text.partition(':')
                        out[k.strip()] = v.strip()
    except Exception:
        pass
    return out


def _safe_float(s: str | None) -> float | None:
    if s is None:
        return None
    try:
        return float(s)
    except Exception:
        return None


# ─── 数据采集 ──────────────────────────────────────

@dataclass
class Snapshot:
    ts: float
    minute_str: str
    ip: str
    hostname: str
    battery_pct: int | None
    battery_raw: float | None
    charging: bool
    plugged: bool
    bat_v: float | None
    bat_i: float | None
    rssi: int | None
    rssi_bars: int
    cpu_temp: int | None
    load1: float
    used_mb: int
    total_mb: int
    used_gb: float
    total_gb: float
    uptime_str: str
    tap_trigger: str | None = None   # 本次刷新若由按键触发，记录类型


def get_ip() -> str:
    try:
        out = subprocess.check_output(['hostname', '-I'], timeout=2).decode().strip()
        return out.split()[0] if out else '-'
    except Exception:
        return '-'


def get_cpu_temp() -> int | None:
    try:
        with open('/sys/class/thermal/thermal_zone0/temp') as f:
            return int(int(f.read().strip()) / 1000)
    except Exception:
        return None


def get_mem() -> tuple[int, int]:
    info: dict[str, int] = {}
    with open('/proc/meminfo') as f:
        for line in f:
            k, _, rest = line.partition(':')
            info[k.strip()] = int(rest.strip().split()[0])
    total = info['MemTotal']
    avail = info.get('MemAvailable', info.get('MemFree', 0))
    return (total - avail) // 1024, total // 1024


def get_disk(path: str = '/') -> tuple[float, float]:
    s = os.statvfs(path)
    total = s.f_blocks * s.f_frsize
    free = s.f_bavail * s.f_frsize
    return (total - free) / 1024**3, total / 1024**3


def get_uptime_str() -> str:
    with open('/proc/uptime') as f:
        sec = int(float(f.read().split()[0]))
    d, sec = divmod(sec, 86400)
    h, sec = divmod(sec, 3600)
    m, _ = divmod(sec, 60)
    if d:
        return f'{d}天{h}时'
    if h:
        return f'{h}时{m:02d}分'
    return f'{m}分'


def get_wifi_rssi(iface: str = 'wlan0') -> int | None:
    try:
        with open('/proc/net/wireless') as f:
            for line in f.readlines()[2:]:
                parts = line.split()
                if parts and parts[0].rstrip(':') == iface:
                    return int(float(parts[3].rstrip('.')))
    except Exception:
        pass
    return None


def rssi_to_bars(rssi: int | None) -> int:
    if rssi is None:
        return 0
    if rssi >= -50:
        return 4
    if rssi >= -60:
        return 3
    if rssi >= -70:
        return 2
    if rssi >= -80:
        return 1
    return 0


def take_snapshot(tap_trigger: str | None = None) -> Snapshot:
    now = datetime.now()
    pi = query_pisugar([
        'get battery', 'get battery_v', 'get battery_i',
        'get battery_charging', 'get battery_power_plugged',
    ])
    battery_raw = _safe_float(pi.get('battery'))
    charging = pi.get('battery_charging', '').lower() == 'true'
    plugged = pi.get('battery_power_plugged', '').lower() == 'true'
    bat_v = _safe_float(pi.get('battery_v'))
    bat_i = _safe_float(pi.get('battery_i'))
    rssi = get_wifi_rssi()
    used_mb, total_mb = get_mem()
    used_gb, total_gb = get_disk('/')
    return Snapshot(
        ts=time.time(),
        minute_str=now.strftime('%H:%M'),
        ip=get_ip(),
        hostname=socket.gethostname(),
        battery_pct=int(battery_raw) if battery_raw is not None else None,
        battery_raw=battery_raw,
        charging=charging,
        plugged=plugged,
        bat_v=bat_v,
        bat_i=bat_i,
        rssi=rssi,
        rssi_bars=rssi_to_bars(rssi),
        cpu_temp=get_cpu_temp(),
        load1=os.getloadavg()[0],
        used_mb=used_mb,
        total_mb=total_mb,
        used_gb=used_gb,
        total_gb=total_gb,
        uptime_str=get_uptime_str(),
        tap_trigger=tap_trigger,
    )


def _key_tuple(s: Snapshot) -> tuple:
    bat_lvl = (s.battery_pct // 5) if s.battery_pct is not None else None
    return (s.minute_str, s.ip, bat_lvl, s.charging, s.plugged)


def changed_significantly(a: Snapshot | None, b: Snapshot) -> bool:
    if a is None:
        return True
    return _key_tuple(a) != _key_tuple(b)


# ─── Icon ──────────────────────────────────────────

def icon_clock(d, x, y):
    d.ellipse((x, y, x + 10, y + 10), outline=0, width=1)
    d.line((x + 5, y + 5, x + 5, y + 2), fill=0)
    d.line((x + 5, y + 5, x + 8, y + 5), fill=0)


def icon_thermo(d, x, y):
    d.ellipse((x + 1, y + 7, x + 6, y + 12), outline=0, width=1)
    d.ellipse((x + 2, y + 8, x + 5, y + 11), fill=0)
    d.rectangle((x + 3, y + 1, x + 5, y + 9), outline=0, width=1)
    d.line((x + 6, y + 3, x + 7, y + 3), fill=0)
    d.line((x + 6, y + 5, x + 7, y + 5), fill=0)


def icon_cpu(d, x, y):
    d.rectangle((x + 2, y + 2, x + 9, y + 9), outline=0, width=1)
    d.rectangle((x + 4, y + 4, x + 7, y + 7), fill=0)
    for i in (3, 6):
        d.line((x + i, y, x + i, y + 2), fill=0)
        d.line((x + i, y + 9, x + i, y + 11), fill=0)
        d.line((x, y + i, x + 2, y + i), fill=0)
        d.line((x + 9, y + i, x + 11, y + i), fill=0)


def icon_ram(d, x, y):
    for i, w in enumerate((10, 8, 6)):
        yy = y + 1 + i * 3
        d.rectangle((x, yy, x + w, yy + 2), outline=0, width=1)


def icon_disk(d, x, y):
    d.ellipse((x, y + 1, x + 10, y + 4), outline=0, width=1)
    d.line((x, y + 2, x, y + 9), fill=0)
    d.line((x + 10, y + 2, x + 10, y + 9), fill=0)
    d.arc((x, y + 7, x + 10, y + 11), 0, 180, fill=0)
    d.ellipse((x + 4, y + 2, x + 6, y + 4), fill=0)


def icon_bolt(d, x, y):
    pts = [(x + 5, y), (x + 1, y + 6), (x + 4, y + 6),
           (x + 2, y + 12), (x + 7, y + 5), (x + 4, y + 5)]
    d.polygon(pts, fill=0)


def draw_battery_icon(d, x, y, w, h, level):
    d.rectangle((x, y, x + w, y + h), outline=0, width=1)
    nub_y = (h - 4) // 2
    d.rectangle((x + w + 1, y + nub_y, x + w + 2, y + nub_y + 4), fill=0)
    if level is not None and level > 0:
        fw = max(1, int((w - 2) * (level / 100)))
        d.rectangle((x + 1, y + 1, x + 1 + fw, y + h - 1), fill=0)


def draw_wifi_icon(d, x, y, bars):
    bar_w, gap = 2, 1
    for i in range(4):
        bx = x + i * (bar_w + gap)
        bh = 2 + i * 2
        by_top = y + (10 - bh)
        if i < bars:
            d.rectangle((bx, by_top, bx + bar_w, y + 10), fill=0)
        else:
            d.rectangle((bx, by_top, bx + bar_w, y + 10), outline=0, width=1)
    return x + 4 * (bar_w + gap)


def draw_tap_badge(d, W, H, kind: str):
    """右下角反白圆角矩形显示按键反馈，下次刷新自然消失。"""
    label = TAP_LABELS.get(kind, kind)
    f = ImageFont.truetype(FONT_CJK, 11)
    pad_x, pad_y = 4, 1
    tw = int(d.textlength(label, font=f))
    bw = tw + pad_x * 2
    bh = 14
    bx2, by2 = W - 2, H - 2
    bx1, by1 = bx2 - bw, by2 - bh
    d.rectangle((bx1, by1, bx2, by2), fill=0)
    d.text((bx1 + pad_x, by1 + pad_y - 1), label, font=f, fill=255)


# ─── 渲染 ──────────────────────────────────────────

def render(image: Image.Image, s: Snapshot) -> None:
    d = ImageDraw.Draw(image)
    W, H = image.size

    f_sb = ImageFont.truetype(f'{FONT_DEJAVU}/DejaVuSansMono-Bold.ttf', 13)
    f_xl = ImageFont.truetype(f'{FONT_DEJAVU}/DejaVuSansMono-Bold.ttf', 20)
    f_cn = ImageFont.truetype(FONT_CJK, 12)
    f_mono = ImageFont.truetype(f'{FONT_DEJAVU}/DejaVuSansMono.ttf', 11)

    SB_H = 22
    icon_clock(d, 2, 6)
    d.text((16, 2), s.minute_str, font=f_sb, fill=0)

    bat_lbl = f'{s.battery_pct}%' if s.battery_pct is not None else '?'
    if s.charging:
        bat_lbl += '+'
    pct_w = int(d.textlength(bat_lbl, font=f_sb))
    icon_w, icon_h = 22, 10
    icon_x = W - 6 - icon_w
    d.text((icon_x - 4 - pct_w, 2), bat_lbl, font=f_sb, fill=0)
    draw_battery_icon(d, icon_x, (SB_H - icon_h) // 2 - 1, icon_w, icon_h,
                      s.battery_raw)

    wifi_x = 70
    wifi_x = draw_wifi_icon(d, wifi_x, 5, s.rssi_bars)
    rssi_lbl = f' {s.rssi}dBm' if s.rssi is not None else ' --'
    d.text((wifi_x, 2), rssi_lbl, font=f_sb, fill=0)

    d.line((0, SB_H, W, SB_H), fill=0, width=1)

    d.text((3, 26), s.ip, font=f_xl, fill=0)
    d.text((3, 51), f'{s.hostname}  ·  运行 {s.uptime_str}', font=f_cn, fill=0)

    volt_parts = []
    if s.bat_v is not None:
        volt_parts.append(f'{s.bat_v:.2f}V')
    if s.bat_i is not None and abs(s.bat_i) > 0.001:
        ma = s.bat_i * 1000 if abs(s.bat_i) < 10 else s.bat_i
        volt_parts.append(f'{ma:+.0f}mA')
    if volt_parts:
        right_text = '  '.join(volt_parts)
        rw = int(d.textlength(right_text, font=f_mono))
        rx = W - 3 - rw
        icon_bolt(d, rx - 11, 51)
        d.text((rx, 52), right_text, font=f_mono, fill=0)

    d.line((3, 67, W - 3, 67), fill=0, width=1)

    row_y = (71, 87, 103)
    icon_thermo(d, 3, row_y[0] - 1)
    cpu_str = f'{s.cpu_temp}°C' if s.cpu_temp is not None else '?'
    d.text((16, row_y[0]), f'温度 {cpu_str}', font=f_cn, fill=0)
    icon_cpu(d, 128, row_y[0])
    d.text((144, row_y[0]), f'负载 {s.load1:.2f}', font=f_cn, fill=0)

    icon_ram(d, 3, row_y[1])
    mem_pct = s.used_mb * 100.0 / s.total_mb if s.total_mb else 0
    d.text((16, row_y[1]), f'内存 {mem_pct:.0f}%  ({s.used_mb}/{s.total_mb}M)',
           font=f_cn, fill=0)

    icon_disk(d, 3, row_y[2])
    disk_pct = s.used_gb * 100.0 / s.total_gb if s.total_gb else 0
    d.text((16, row_y[2]),
           f'磁盘 {disk_pct:.0f}%  ({s.used_gb:.1f}/{s.total_gb:.0f}G)',
           font=f_cn, fill=0)

    if s.tap_trigger:
        draw_tap_badge(d, W, H, s.tap_trigger)


# ─── 屏幕控制器 ─────────────────────────────────────

class ScreenController:
    def __init__(self):
        self.epd = epd2in13_V3.EPD()
        self.epd.init()
        self._init_mode = 'full'
        self.last_full_at = 0.0
        self.partial_count = 0
        self.last_refresh_at = 0.0
        self.last_snapshot: Snapshot | None = None

    def _build_buffer(self, s: Snapshot):
        img = Image.new('1', (self.epd.height, self.epd.width), 255)
        render(img, s)
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


# ─── 后台线程 ──────────────────────────────────────

def tap_listener(events: queue.Queue) -> None:
    """单独的 PiSugar TCP 长连接，专门读 tap 事件（lib v0.1.1 的事件回调有 newline 比对 bug，自己实现更稳）。"""
    while True:
        try:
            s = socket.create_connection(PISUGAR_HOST, timeout=10)
            s.settimeout(None)
            try:
                f = s.makefile('rb')
                while True:
                    line = f.readline()
                    if not line:
                        break
                    msg = line.decode(errors='replace').strip()
                    if msg in ('single', 'double', 'long'):
                        events.put(('tap', msg))
            finally:
                s.close()
        except Exception as e:
            print(f'[tap_listener] reconnect after error: {e}', flush=True)
        time.sleep(TAP_RECONNECT_DELAY_SEC)


def poll_loop(events: queue.Queue, ctrl: ScreenController) -> None:
    while True:
        time.sleep(POLL_INTERVAL)
        try:
            ns = take_snapshot()
        except Exception as e:
            print(f'[poll] snapshot error: {e}', flush=True)
            continue
        if changed_significantly(ctrl.last_snapshot, ns):
            events.put(('poll', ns))
        elif ctrl.last_refresh_at and \
                (time.time() - ctrl.last_refresh_at) > SAFETY_REFRESH_MAX_AGE_SEC:
            events.put(('safety', ns))


# ─── 主循环 ────────────────────────────────────────

def main() -> int:
    ctrl = ScreenController()
    events: queue.Queue = queue.Queue()

    s0 = take_snapshot()
    ctrl.refresh(s0, 'startup')

    threading.Thread(target=tap_listener, args=(events,), daemon=True).start()
    threading.Thread(target=poll_loop, args=(events, ctrl), daemon=True).start()

    last_tap: tuple[str, float] | None = None  # (kind, expires_at)

    try:
        while True:
            kind, payload = events.get()
            while True:
                try:
                    events.get_nowait()
                except queue.Empty:
                    break

            now = time.time()

            if kind == 'tap':
                last_tap = (payload, now + TAP_BADGE_LINGER_SEC)
                ns = take_snapshot(tap_trigger=payload)
                ctrl.refresh(ns, f'tap:{payload}')
                continue

            # poll / safety：取快照，如果近期有 tap 仍在 linger 期内就保留 badge
            ns = payload if isinstance(payload, Snapshot) else take_snapshot()
            if last_tap and now < last_tap[1]:
                ns.tap_trigger = last_tap[0]
            else:
                last_tap = None
            ctrl.refresh(ns, kind)
    except KeyboardInterrupt:
        pass
    finally:
        ctrl.sleep()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
