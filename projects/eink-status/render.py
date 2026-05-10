"""屏幕渲染：icon / 状态栏 / 页标题 / tap badge / 各页 / PAGES 注册表。

布局参数（所有页面共享）：
- 0..SB_H              顶部状态栏（时钟/WiFi/电量）
- SB_H..SB_H+PAGE_TITLE_H  页标题条（●○○ + 页名 + 日期）
- CONTENT_Y0..        各页内容区
"""
from __future__ import annotations

from datetime import datetime

from PIL import Image, ImageDraw, ImageFont

import fetchers
from data import Snapshot

FONT_DEJAVU = '/usr/share/fonts/truetype/dejavu'
FONT_CJK = '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc'

SB_H = 22                    # 顶部状态栏高度
PAGE_TITLE_H = 14            # 页标题条高度
CONTENT_Y0 = SB_H + PAGE_TITLE_H + 2

TAP_LABELS = {'single': '单击', 'double': '双击', 'long': '长按'}


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


# ─── 状态栏 / 页标题 ───────────────────────────────

def render_status_bar(d, W: int, s: Snapshot) -> None:
    """顶部状态栏：左 时钟+时间 / 中 WiFi格 / 右 电池+%。dBm 移除给视觉减负。"""
    f_time = ImageFont.truetype(f'{FONT_DEJAVU}/DejaVuSansMono-Bold.ttf', 14)
    f_pct = ImageFont.truetype(f'{FONT_DEJAVU}/DejaVuSansMono-Bold.ttf', 13)

    # 左：时钟 + 时间
    icon_clock(d, 4, 6)
    d.text((18, 1), s.minute_str, font=f_time, fill=0)

    # 右：电量百分比 + 电池图标
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


# ─── 各页 ──────────────────────────────────────────

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
    if fetchers.weather is None:
        _draw_fetch_placeholder(d, W, H, '天气')
        return
    data, last_ok, err = fetchers.weather.get()
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

    if last_ok:
        fresh = datetime.fromtimestamp(last_ok).strftime('%H:%M')
        fw = int(d.textlength(fresh, font=f_mono))
        d.text((W - fw - 6, H - 12), fresh, font=f_mono, fill=0)


def render_news(d, image: Image.Image, s: Snapshot) -> None:
    """新闻页：60 秒看世界，5 条头条（按字符截断）。"""
    W, H = image.size
    if fetchers.news is None:
        _draw_fetch_placeholder(d, W, H, '新闻')
        return
    data, last_ok, err = fetchers.news.get()
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


# ─── 页面注册表 + 主 render ─────────────────────────

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
