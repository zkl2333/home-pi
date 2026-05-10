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
import urllib.request
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

# 外部数据源（可被环境变量覆写）
WEATHER_URL = os.environ.get('EINK_WEATHER_URL', 'https://wttr.in/?format=j1&lang=zh')
WEATHER_INTERVAL = int(os.environ.get('EINK_WEATHER_INTERVAL', '1800'))   # 30 min
NEWS_URL = os.environ.get('EINK_NEWS_URL', 'https://60s-api.viki.moe/v2/60s')
NEWS_INTERVAL = int(os.environ.get('EINK_NEWS_INTERVAL', '3600'))         # 1 h
FETCH_TIMEOUT = 10.0


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
    date_str: str
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
        date_str=now.strftime('%m-%d'),
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
    return (s.minute_str, s.ip, bat_lvl, s.charging, s.plugged, s.rssi_bars)


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

SB_H = 22                    # 顶部状态栏高度
PAGE_TITLE_H = 14            # 页标题条高度
CONTENT_Y0 = SB_H + PAGE_TITLE_H + 2


def render_status_bar(d, W: int, s: Snapshot) -> None:
    """顶部状态栏：左 时钟+时间 / 中 WiFi格 / 右 电池+%。dBm 移除给视觉减负。"""
    f_time = ImageFont.truetype(f'{FONT_DEJAVU}/DejaVuSansMono-Bold.ttf', 14)
    f_pct = ImageFont.truetype(f'{FONT_DEJAVU}/DejaVuSansMono-Bold.ttf', 13)

    # 左：时钟 + 时间（垂直居中于 22px 状态栏）
    icon_clock(d, 4, 6)
    d.text((18, 1), s.minute_str, font=f_time, fill=0)

    # 右：电量百分比 + 电池图标（紧贴右边）
    bat_lbl = f'{s.battery_pct}%' if s.battery_pct is not None else '?'
    if s.charging:
        bat_lbl += '+'
    pct_w = int(d.textlength(bat_lbl, font=f_pct))
    icon_w, icon_h = 22, 10
    icon_x = W - 6 - icon_w
    icon_y = (SB_H - icon_h) // 2 - 1
    pct_x = icon_x - 4 - pct_w
    d.text((pct_x, 3), bat_lbl, font=f_pct, fill=0)
    draw_battery_icon(d, icon_x, icon_y, icon_w, icon_h, s.battery_raw)

    # 中右：WiFi 4 格（去掉 dBm 数字 — 信号强弱看格数足够）
    wifi_w = 4 * 3
    wifi_x = pct_x - 8 - wifi_w
    draw_wifi_icon(d, wifi_x, 6, s.rssi_bars)

    # 底部细分隔
    d.line((0, SB_H, W, SB_H), fill=0, width=1)


def render_page_title(d, W: int, idx: int, total: int, name: str,
                      date_str: str = '') -> None:
    """页指示条：左 ●○○ + 页名 / 右 日期，下方分隔线。"""
    f = ImageFont.truetype(FONT_CJK, 12)
    f_date = ImageFont.truetype(f'{FONT_DEJAVU}/DejaVuSansMono.ttf', 11)
    r = 3
    gap = 5
    dx = 4
    dy = SB_H + (PAGE_TITLE_H - r * 2) // 2
    for i in range(total):
        if i == idx:
            d.ellipse((dx, dy, dx + r * 2, dy + r * 2), fill=0)
        else:
            d.ellipse((dx, dy, dx + r * 2, dy + r * 2), outline=0, width=1)
        dx += r * 2 + gap
    d.text((dx + 4, SB_H), name, font=f, fill=0)

    if date_str:
        dw = int(d.textlength(date_str, font=f_date))
        d.text((W - 6 - dw, SB_H + 1), date_str, font=f_date, fill=0)

    y_div = SB_H + PAGE_TITLE_H
    d.line((0, y_div, W, y_div), fill=0, width=1)


def render_overview(d, image: Image.Image, s: Snapshot) -> None:
    """概览页：大字 IP + 主机名/运行时长 + 电源摘要。"""
    W, H = image.size
    f_xl = ImageFont.truetype(f'{FONT_DEJAVU}/DejaVuSansMono-Bold.ttf', 22)
    f_cn = ImageFont.truetype(FONT_CJK, 13)
    f_cn_sm = ImageFont.truetype(FONT_CJK, 11)
    f_mono = ImageFont.truetype(f'{FONT_DEJAVU}/DejaVuSansMono.ttf', 12)

    y = CONTENT_Y0 + 2
    d.text((6, y), s.ip, font=f_xl, fill=0)

    y += 28
    d.text((6, y), s.hostname, font=f_cn, fill=0)
    up_str = f'已运行 {s.uptime_str}'
    up_w = int(d.textlength(up_str, font=f_cn_sm))
    d.text((W - 6 - up_w, y + 2), up_str, font=f_cn_sm, fill=0)

    y += 20
    d.line((6, y, W - 6, y), fill=0, width=1)
    y += 5
    parts = []
    if s.bat_v is not None:
        parts.append(f'{s.bat_v:.2f}V')
    if s.bat_i is not None and abs(s.bat_i) > 0.001:
        ma = s.bat_i * 1000 if abs(s.bat_i) < 10 else s.bat_i
        parts.append(f'{ma:+.0f}mA')
    if s.battery_pct is not None:
        parts.append(f'电量 {s.battery_pct}%')
    if parts:
        icon_bolt(d, 6, y)
        d.text((20, y + 1), '   '.join(parts), font=f_mono, fill=0)


def render_system(d, image: Image.Image, s: Snapshot) -> None:
    """系统页：2x2 网格 — 温度 / 负载 / 内存 / 磁盘。"""
    W, H = image.size
    f_label = ImageFont.truetype(FONT_CJK, 11)
    f_val = ImageFont.truetype(f'{FONT_DEJAVU}/DejaVuSansMono-Bold.ttf', 17)
    f_unit = ImageFont.truetype(FONT_CJK, 11)
    f_sub = ImageFont.truetype(f'{FONT_DEJAVU}/DejaVuSansMono.ttf', 10)

    mid_x = W // 2
    row_top = (CONTENT_Y0 + 2, CONTENT_Y0 + 42)

    mem_pct = int(s.used_mb * 100 / s.total_mb) if s.total_mb else None
    disk_pct = int(s.used_gb * 100 / s.total_gb) if s.total_gb else None

    cells = [
        (0, 0, icon_thermo,
         '温度', f'{s.cpu_temp}' if s.cpu_temp is not None else '?', '°C', None),
        (1, 0, icon_cpu,
         '负载', f'{s.load1:.2f}', '', None),
        (0, 1, icon_ram,
         '内存', f'{mem_pct}' if mem_pct is not None else '?', '%',
         f'{s.used_mb}/{s.total_mb}M' if s.total_mb else None),
        (1, 1, icon_disk,
         '磁盘', f'{disk_pct}' if disk_pct is not None else '?', '%',
         f'{s.used_gb:.1f}/{s.total_gb:.0f}G' if s.total_gb else None),
    ]
    col_x = (6, mid_x + 6)

    for col, row, icon_fn, label, val, unit, sub in cells:
        x = col_x[col]
        y = row_top[row]
        icon_fn(d, x, y - 1)
        d.text((x + 14, y - 1), label, font=f_label, fill=0)
        d.text((x, y + 13), val, font=f_val, fill=0)
        if unit:
            vw = int(d.textlength(val, font=f_val))
            d.text((x + vw + 2, y + 19), unit, font=f_unit, fill=0)
        if sub:
            d.text((x, y + 32), sub, font=f_sub, fill=0)

    d.line((mid_x, CONTENT_Y0, mid_x, H - 2), fill=0, width=1)
    d.line((0, row_top[1] - 2, W, row_top[1] - 2), fill=0, width=1)


def render_power(d, image: Image.Image, s: Snapshot) -> None:
    """电源页：大字电量 + 状态 + 电池条 + 电压/电流。"""
    W, H = image.size
    f_xxl = ImageFont.truetype(f'{FONT_DEJAVU}/DejaVuSansMono-Bold.ttf', 28)
    f_cn = ImageFont.truetype(FONT_CJK, 13)
    f_label = ImageFont.truetype(FONT_CJK, 11)
    f_val = ImageFont.truetype(f'{FONT_DEJAVU}/DejaVuSansMono-Bold.ttf', 16)

    y = CONTENT_Y0
    bat_str = f'{s.battery_raw:.1f}%' if s.battery_raw is not None else '?'
    d.text((6, y), bat_str, font=f_xxl, fill=0)

    if s.charging:
        state = '充电中'
    elif s.plugged:
        state = '接电'
    else:
        state = '放电'
    state_w = int(d.textlength(state, font=f_cn))
    d.text((W - 6 - state_w, y + 10), state, font=f_cn, fill=0)

    bar_y = y + 34
    bar_x1, bar_x2 = 6, W - 6
    bar_h = 8
    d.rectangle((bar_x1, bar_y, bar_x2, bar_y + bar_h), outline=0, width=1)
    if s.battery_raw is not None and s.battery_raw > 0:
        fill_w = int((bar_x2 - bar_x1 - 2) * (s.battery_raw / 100))
        if fill_w > 0:
            d.rectangle((bar_x1 + 1, bar_y + 1,
                         bar_x1 + 1 + fill_w, bar_y + bar_h - 1), fill=0)

    y = bar_y + 16
    col2_x = W // 2 + 6
    if s.bat_v is not None:
        d.text((6, y + 2), '电压', font=f_label, fill=0)
        d.text((36, y), f'{s.bat_v:.3f}V', font=f_val, fill=0)
    if s.bat_i is not None:
        ma = s.bat_i * 1000 if abs(s.bat_i) < 10 else s.bat_i
        d.text((col2_x, y + 2), '电流', font=f_label, fill=0)
        d.text((col2_x + 30, y), f'{ma:+.0f}mA', font=f_val, fill=0)


# ─── 外部数据获取（天气 / 新闻） ──────────────────

class Fetcher:
    """通用周期性 GET 数据源：自动重试、缓存最近一次成功结果。"""

    def __init__(self, name: str, url: str, interval: int,
                 parser, timeout: float = FETCH_TIMEOUT):
        self.name = name
        self.url = url
        self.interval = interval
        self.parser = parser
        self.timeout = timeout
        self._lock = threading.Lock()
        self._data = None
        self._last_ok = 0.0
        self._last_err = ''

    def start(self) -> None:
        threading.Thread(target=self._loop, daemon=True).start()

    def _loop(self) -> None:
        while True:
            try:
                req = urllib.request.Request(
                    self.url,
                    headers={'User-Agent': 'eink-status/1.0'},
                )
                with urllib.request.urlopen(req, timeout=self.timeout) as r:
                    body = r.read()
                parsed = self.parser(body)
                with self._lock:
                    self._data = parsed
                    self._last_ok = time.time()
                    self._last_err = ''
                print(f'[fetch:{self.name}] ok', flush=True)
            except Exception as e:
                with self._lock:
                    self._last_err = str(e)[:80]
                print(f'[fetch:{self.name}] err: {e}', flush=True)
            time.sleep(self.interval)

    def get(self) -> tuple[object, float, str]:
        with self._lock:
            return self._data, self._last_ok, self._last_err


def parse_wttr(body: bytes) -> dict:
    j = json.loads(body)
    cur = j['current_condition'][0]
    today = j['weather'][0]
    area = ''
    try:
        area = j['nearest_area'][0]['areaName'][0]['value']
    except (KeyError, IndexError):
        pass
    desc = ''
    try:
        desc = cur['lang_zh'][0]['value']
    except (KeyError, IndexError):
        try:
            desc = cur['weatherDesc'][0]['value']
        except (KeyError, IndexError):
            desc = '?'
    return {
        'city': area or '?',
        'cond': desc,
        'temp_c': cur.get('temp_C', '?'),
        'feels_c': cur.get('FeelsLikeC', '?'),
        'humidity': cur.get('humidity', '?'),
        'high_c': today.get('maxtempC', '?'),
        'low_c': today.get('mintempC', '?'),
    }


def parse_60s(body: bytes) -> dict:
    j = json.loads(body)
    if j.get('code') not in (200, '200'):
        raise ValueError(f"60s api: {j.get('message', '?')}")
    data = j.get('data', {})
    return {
        'date': data.get('date', ''),
        'news': data.get('news', []) or [],
    }


# 全局 fetcher 句柄，main() 中初始化；render 函数读取
weather_fetcher: 'Fetcher | None' = None
news_fetcher: 'Fetcher | None' = None


def _draw_fetch_placeholder(d, W: int, H: int, label: str,
                            err: str = '') -> None:
    f = ImageFont.truetype(FONT_CJK, 13)
    f_sm = ImageFont.truetype(FONT_CJK, 11)
    d.text((6, CONTENT_Y0 + 14), f'正在获取{label}…', font=f, fill=0)
    if err:
        d.text((6, CONTENT_Y0 + 38), f'错误：{err[:32]}', font=f_sm, fill=0)


def render_weather(d, image: Image.Image, s: Snapshot) -> None:
    """天气页：城市/状况 + 大字温度 + 高低体感湿度。"""
    W, H = image.size
    if weather_fetcher is None:
        _draw_fetch_placeholder(d, W, H, '天气')
        return
    data, last_ok, err = weather_fetcher.get()
    if not data:
        _draw_fetch_placeholder(d, W, H, '天气', err)
        return

    f_cn = ImageFont.truetype(FONT_CJK, 14)
    f_cn_sm = ImageFont.truetype(FONT_CJK, 11)
    f_xxl = ImageFont.truetype(f'{FONT_DEJAVU}/DejaVuSansMono-Bold.ttf', 32)
    f_mono = ImageFont.truetype(f'{FONT_DEJAVU}/DejaVuSansMono.ttf', 10)

    # 大字温度（右）
    temp = f"{data['temp_c']}°"
    tw = int(d.textlength(temp, font=f_xxl))
    d.text((W - tw - 6, CONTENT_Y0), temp, font=f_xxl, fill=0)

    # 城市 + 状况（左）
    d.text((6, CONTENT_Y0 + 4), data['city'], font=f_cn, fill=0)
    d.text((6, CONTENT_Y0 + 26), data['cond'], font=f_cn, fill=0)

    # 底部细节条
    y2 = CONTENT_Y0 + 50
    d.line((6, y2, W - 6, y2), fill=0, width=1)
    detail = (f"高{data['high_c']}° 低{data['low_c']}°  "
              f"体感{data['feels_c']}°  湿{data['humidity']}%")
    d.text((6, y2 + 4), detail, font=f_cn_sm, fill=0)

    # 数据更新时间 (右下角)
    if last_ok:
        fresh = datetime.fromtimestamp(last_ok).strftime('%H:%M')
        fw = int(d.textlength(fresh, font=f_mono))
        d.text((W - fw - 6, H - 12), fresh, font=f_mono, fill=0)


def render_news(d, image: Image.Image, s: Snapshot) -> None:
    """新闻页：60 秒看世界，5 条头条（按字符截断）。"""
    W, H = image.size
    if news_fetcher is None:
        _draw_fetch_placeholder(d, W, H, '新闻')
        return
    data, last_ok, err = news_fetcher.get()
    if not data:
        _draw_fetch_placeholder(d, W, H, '新闻', err)
        return

    f_label = ImageFont.truetype(FONT_CJK, 11)
    f_news = ImageFont.truetype(FONT_CJK, 11)

    y = CONTENT_Y0
    header = '60秒看世界'
    if data.get('date'):
        header += f"  ·  {data['date']}"
    d.text((6, y), header, font=f_label, fill=0)
    y += 14

    items = data.get('news', [])[:5]
    for i, item in enumerate(items, 1):
        text = item.strip().replace('\n', ' ')
        truncated = text if len(text) <= 22 else text[:21] + '…'
        d.text((6, y), f'{i}. {truncated}', font=f_news, fill=0)
        y += 13
        if y > H - 12:
            break


# 页面注册表：按顺序循环，long-press 回到第 0 页
PAGES: list[tuple[str, callable]] = [
    ('概览', render_overview),
    ('系统', render_system),
    ('电源', render_power),
    ('天气', render_weather),
    ('新闻', render_news),
]


def render(image: Image.Image, s: Snapshot, page_idx: int) -> None:
    d = ImageDraw.Draw(image)
    W, H = image.size
    render_status_bar(d, W, s)
    name, page_fn = PAGES[page_idx]
    render_page_title(d, W, page_idx, len(PAGES), name, s.date_str)
    page_fn(d, image, s)
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
    global weather_fetcher, news_fetcher

    ctrl = ScreenController()
    events: queue.Queue = queue.Queue()

    # 提前启动外部数据获取，让初始 render 之前就开始 warm cache
    weather_fetcher = Fetcher('weather', WEATHER_URL, WEATHER_INTERVAL, parse_wttr)
    weather_fetcher.start()
    news_fetcher = Fetcher('news', NEWS_URL, NEWS_INTERVAL, parse_60s)
    news_fetcher.start()

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
                # 单击下一页、双击上一页、长按回首页
                if payload == 'single':
                    ctrl.current_page = (ctrl.current_page + 1) % len(PAGES)
                elif payload == 'double':
                    ctrl.current_page = (ctrl.current_page - 1) % len(PAGES)
                elif payload == 'long':
                    ctrl.current_page = 0
                last_tap = (payload, now + TAP_BADGE_LINGER_SEC)
                ns = take_snapshot(tap_trigger=payload)
                ctrl.refresh(ns, f'tap:{payload}:p{ctrl.current_page}')
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
