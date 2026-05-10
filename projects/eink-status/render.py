"""屏幕渲染：icon / 状态栏 / 页标题 / tap badge / 各页 / PAGES 注册表。

布局参数（所有页面共享）：
- 0..SB_H              顶部状态栏（时钟/WiFi/电量）
- SB_H..SB_H+PAGE_TITLE_H  页标题条（●○○ + 页名 + 日期）
- CONTENT_Y0..        各页内容区
"""
from __future__ import annotations

import calendar
from datetime import date, datetime

from PIL import Image, ImageDraw, ImageFont

import fetchers
from data import Snapshot

FONT_DEJAVU = '/usr/share/fonts/truetype/dejavu'
FONT_CJK = '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc'

SB_H = 22                    # 合并后的状态栏（含页指示 + 时间 + 信号电量）
CONTENT_Y0 = SB_H + 2        # = 24，比之前再上移 8px


# ─── Icon ──────────────────────────────────────────

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


def _draw_zbolt(d, x: int, y: int, fill: int = 0) -> None:
    """5×8 经典 Z 字闪电。逐行像素绘制（避开 polygon 自交叉的不确定性）。

    关键：中段两行错位 1px 形成"折角"，不是两个三角形对接（那是平行四边形）。

        ...█.    y=0
        ..██.    y=1
        .██..    y=2   ← 上半往左下走
        ████.    y=3   ← 中段左凸 (x=0..3)
        .████    y=4   ← 中段右凸 (x=1..4) ← Z 折
        ..██.    y=5
        .██..    y=6   ← 下半往左下走（同方向）
        ██...    y=7
    """
    rows = [
        (3, 3), (2, 3), (1, 2),
        (0, 3),
        (1, 4),
        (2, 3), (1, 2), (0, 1),
    ]
    for dy, (x1, x2) in enumerate(rows):
        d.rectangle((x + x1, y + dy, x + x2, y + dy), fill=fill)


def icon_bolt(d, x, y):
    """8×11 大号 Z 字闪电（概览/电源页电源行前缀）。逐行像素图。"""
    rows = [
        (5, 5),                 # y=0
        (4, 5),                 # y=1
        (3, 4),                 # y=2
        (2, 3),                 # y=3
        (1, 5),                 # y=4  中段左凸
        (2, 6),                 # y=5  中段右凸（Z 折）
        (3, 4),                 # y=6
        (2, 3),                 # y=7
        (1, 2),                 # y=8
        (0, 1),                 # y=9
        (0, 0),                 # y=10
    ]
    for dy, (x1, x2) in enumerate(rows):
        d.rectangle((x + x1, y + dy, x + x2, y + dy), fill=0)


def draw_battery_icon(d, x, y, w, h, level, charging=False):
    """iPhone 风格电池胶囊。
    - 不充电：电量条按 level 比例
    - 充电：电量条画满 + 中央凿空 Z 字闪电（实际 % 见状态栏文字）
    """
    r = max(1, h // 2 - 1)
    try:
        d.rounded_rectangle((x, y, x + w, y + h), radius=r, outline=0, width=1)
    except (AttributeError, TypeError):
        d.rectangle((x, y, x + w, y + h), outline=0, width=1)
    # 右凸（电池正极）
    nub_h = max(3, h - 6)
    nub_y = y + (h - nub_h) // 2
    d.rectangle((x + w + 1, nub_y, x + w + 2, nub_y + nub_h), fill=0)

    pad = 2
    inner_w = w - 2 * pad
    if charging:
        fw = inner_w
    elif level is not None and level > 0:
        fw = max(1, int(inner_w * (level / 100)))
    else:
        fw = 0

    if fw > 0:
        try:
            inner_r = max(1, r - pad)
            d.rounded_rectangle(
                (x + pad, y + pad, x + pad + fw, y + h - pad),
                radius=inner_r, fill=0,
            )
        except (AttributeError, TypeError):
            d.rectangle((x + pad, y + pad, x + pad + fw, y + h - pad), fill=0)

    if charging:
        # 黑色电量条上凿空 Z 字闪电（5×8 居中）
        bx = x + w // 2 - 2
        by = y + (h - 8) // 2
        _draw_zbolt(d, bx, by, fill=255)


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


# ─── 状态栏 / 页标题 ───────────────────────────────

def render_status_bar(d, W: int, s: Snapshot, page_idx: int = 0,
                      page_total: int = 1, page_name: str = '') -> None:
    """合并后的单行状态栏（22 px 高）：
        [ 时间 ]  [ ●○○○○○ + 页名 ]              [ WiFi ] [ 电量% ] [ 电池 ]
    所有元素严格按 22 px 行高居中，底部一根细分隔线。
    """
    f_time = ImageFont.truetype(f'{FONT_DEJAVU}/DejaVuSansMono-Bold.ttf', 14)
    f_pct = ImageFont.truetype(f'{FONT_DEJAVU}/DejaVuSansMono-Bold.ttf', 12)
    f_name = ImageFont.truetype(FONT_CJK, 12)

    # ── 左：时间
    time_str = s.minute_str
    d.text((6, 4), time_str, font=f_time, fill=0)
    time_w = int(d.textlength(time_str, font=f_time))

    # ── 右：电池胶囊 + 百分比（充电时百分比不再加 +，由电池里的闪电表达）
    bat_lbl = f'{s.battery_pct}%' if s.battery_pct is not None else '?'
    pct_w = int(d.textlength(bat_lbl, font=f_pct))
    icon_w, icon_h = 26, 12
    icon_x = W - 6 - icon_w
    icon_y = (SB_H - icon_h) // 2          # = 5
    pct_x = icon_x - 3 - pct_w
    d.text((pct_x, 5), bat_lbl, font=f_pct, fill=0)
    draw_battery_icon(d, icon_x, icon_y, icon_w, icon_h,
                      s.battery_raw, charging=s.charging)

    # ── 右中：WiFi 4 格
    wifi_w = 4 * 3
    wifi_x = pct_x - 6 - wifi_w
    draw_wifi_icon(d, wifi_x, 6, s.rssi_bars)

    # ── 中：●○○ 页指示 + 页名（在时间右侧、WiFi 左侧的留白里）
    r = 3
    gap = 5
    dx = 6 + time_w + 14
    dy = (SB_H - r * 2) // 2               # = 8
    for i in range(page_total):
        if i == page_idx:
            d.ellipse((dx, dy, dx + r * 2, dy + r * 2), fill=0)
        else:
            d.ellipse((dx, dy, dx + r * 2, dy + r * 2), outline=0, width=1)
        dx += r * 2 + gap
    if page_name:
        d.text((dx + 2, 5), page_name, font=f_name, fill=0)

    # 底部分隔
    d.line((0, SB_H, W, SB_H), fill=0, width=1)


# ─── 各页 ──────────────────────────────────────────

def render_overview(d, image: Image.Image, s: Snapshot) -> None:
    """概览页：健康仪表盘 — IP / 主机名+uptime / 电源单行 / 4 列系统 mini stats。

    布局（122 px 屏 - 22 px 状态栏 = 98 px 内容区）：
      y=25..47  IP (20pt 左) + hostname / uptime (10-11pt 右上双行)
      y=49      分隔线
      y=53..67  电源单行：⚡ V + mA + % + 状态
      y=70      分隔线
      y=74..    4 列 mini stats：温度 / 负载 / 内存 / 磁盘
    """
    W, H = image.size
    f_ip = ImageFont.truetype(f'{FONT_DEJAVU}/DejaVuSansMono-Bold.ttf', 20)
    f_meta = ImageFont.truetype(FONT_CJK, 11)
    f_meta_sm = ImageFont.truetype(FONT_CJK, 10)  # uptime 含中文（天/时/分），必须用 CJK 字体
    f_pwr = ImageFont.truetype(f'{FONT_DEJAVU}/DejaVuSansMono-Bold.ttf', 12)
    f_pwr_state = ImageFont.truetype(FONT_CJK, 11)
    f_lab = ImageFont.truetype(FONT_CJK, 10)
    f_val = ImageFont.truetype(f'{FONT_DEJAVU}/DejaVuSansMono-Bold.ttf', 14)

    # ─── 顶部：IP（左大字）+ 主机名/uptime（右上双行）
    y = CONTENT_Y0 + 1
    d.text((6, y), s.ip, font=f_ip, fill=0)

    hn_w = int(d.textlength(s.hostname, font=f_meta))
    d.text((W - 6 - hn_w, y), s.hostname, font=f_meta, fill=0)
    up_w = int(d.textlength(s.uptime_str, font=f_meta_sm))
    d.text((W - 6 - up_w, y + 12), s.uptime_str, font=f_meta_sm, fill=0)

    y += 25
    d.line((6, y, W - 6, y), fill=0, width=1)

    # ─── 中部：电源单行（icon + V + mA + % + 状态）
    y += 4
    icon_bolt(d, 6, y)

    parts = []
    if s.bat_v is not None:
        parts.append(f'{s.bat_v:.2f}V')
    if s.bat_i is not None and abs(s.bat_i) > 0.001:
        ma = s.bat_i * 1000 if abs(s.bat_i) < 10 else s.bat_i
        parts.append(f'{ma:+.0f}mA')
    if s.battery_pct is not None:
        parts.append(f'{s.battery_pct}%')
    if parts:
        d.text((20, y), '  '.join(parts), font=f_pwr, fill=0)

    if s.charging:
        state = '充电中'
    elif s.plugged:
        state = '接电'
    else:
        state = '放电'
    sw = int(d.textlength(state, font=f_pwr_state))
    d.text((W - 6 - sw, y + 1), state, font=f_pwr_state, fill=0)

    y += 17
    d.line((6, y, W - 6, y), fill=0, width=1)

    # ─── 底部：4 列 mini stats（temp / load / mem / disk）
    y += 4
    col_w = (W - 12) / 4

    mem_pct = int(s.used_mb * 100 / s.total_mb) if s.total_mb else None
    disk_pct = int(s.used_gb * 100 / s.total_gb) if s.total_gb else None

    cells = [
        (icon_thermo, '温度',
         f'{s.cpu_temp}°' if s.cpu_temp is not None else '-',
         'CPU'),
        (icon_cpu, '负载', f'{s.load1:.2f}', '1m'),
        (icon_ram, '内存',
         f'{mem_pct}%' if mem_pct is not None else '-',
         f'{s.used_mb}/{s.total_mb}M' if s.total_mb else ''),
        (icon_disk, '磁盘',
         f'{disk_pct}%' if disk_pct is not None else '-',
         f'{s.used_gb:.1f}/{s.total_gb:.0f}G' if s.total_gb else ''),
    ]
    f_sub = ImageFont.truetype(f'{FONT_DEJAVU}/DejaVuSansMono.ttf', 9)
    for i, (icon_fn, label, val, sub) in enumerate(cells):
        cx = 6 + int(col_w * i)
        icon_fn(d, cx, y)
        d.text((cx + 14, y - 1), label, font=f_lab, fill=0)
        d.text((cx, y + 14), val, font=f_val, fill=0)
        if sub:
            d.text((cx, y + 30), sub, font=f_sub, fill=0)


def render_system(d, image: Image.Image, s: Snapshot) -> None:
    """系统页：2x2 网格 — 温度 / 负载 / 内存 / 磁盘。"""
    W, H = image.size
    f_label = ImageFont.truetype(FONT_CJK, 11)
    f_val = ImageFont.truetype(f'{FONT_DEJAVU}/DejaVuSansMono-Bold.ttf', 17)
    f_unit = ImageFont.truetype(FONT_CJK, 11)
    f_sub = ImageFont.truetype(f'{FONT_DEJAVU}/DejaVuSansMono.ttf', 9)

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
            d.text((x, y + 30), sub, font=f_sub, fill=0)

    d.line((mid_x, CONTENT_Y0, mid_x, H - 14), fill=0, width=1)
    d.line((0, row_top[1] - 2, W, row_top[1] - 2), fill=0, width=1)

    # ─── 底部一行：已运行 · WiFi 信号 · IP（次要信息，10px 高）
    d.line((0, H - 14, W, H - 14), fill=0, width=1)
    f_bot = ImageFont.truetype(FONT_CJK, 9)
    parts = [s.uptime_str]
    if s.rssi is not None:
        parts.append(f'WiFi {s.rssi}dBm')
    parts.append(s.ip)
    d.text((6, H - 12), '  ·  '.join(parts), font=f_bot, fill=0)


def render_power(d, image: Image.Image, s: Snapshot) -> None:
    """电源页：大字电量 + 状态 / 电池条 / 电压电流 / 估算（来自 data._estimate_battery_eta）。"""
    W, H = image.size
    f_xxl = ImageFont.truetype(f'{FONT_DEJAVU}/DejaVuSansMono-Bold.ttf', 28)
    f_cn = ImageFont.truetype(FONT_CJK, 13)
    f_label = ImageFont.truetype(FONT_CJK, 11)
    f_val = ImageFont.truetype(f'{FONT_DEJAVU}/DejaVuSansMono-Bold.ttf', 16)
    f_eta_lbl = ImageFont.truetype(FONT_CJK, 11)
    # bat_eta_val 含中文（X时YY分/还需X分），不能用 DejaVu Mono
    f_eta_val = ImageFont.truetype(FONT_CJK, 13)

    # ─ 大字电量 + 状态
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

    # ─ 电池条（10 px 粗）
    bar_y = y + 34
    bar_x1, bar_x2 = 6, W - 6
    bar_h = 10
    d.rectangle((bar_x1, bar_y, bar_x2, bar_y + bar_h), outline=0, width=1)
    if s.battery_raw is not None and s.battery_raw > 0:
        fill_w = int((bar_x2 - bar_x1 - 2) * (s.battery_raw / 100))
        if fill_w > 0:
            d.rectangle((bar_x1 + 1, bar_y + 1,
                         bar_x1 + 1 + fill_w, bar_y + bar_h - 1), fill=0)

    # ─ 电压 / 电流（PiSugar bat_i 实测大多 0，仍展示给用户判断）
    y = bar_y + 16
    col2_x = W // 2 + 6
    if s.bat_v is not None:
        d.text((6, y + 2), '电压', font=f_label, fill=0)
        d.text((36, y), f'{s.bat_v:.3f}V', font=f_val, fill=0)
    if s.bat_i is not None:
        ma = s.bat_i * 1000 if abs(s.bat_i) < 10 else s.bat_i
        d.text((col2_x, y + 2), '电流', font=f_label, fill=0)
        d.text((col2_x + 30, y), f'{ma:+.0f}mA', font=f_val, fill=0)

    # ─ 估算行（充满还要/续航约 — 基于 30 分钟历史电量变化率，不依赖 bat_i）
    y_eta = y + 22
    d.line((6, y_eta, W - 6, y_eta), fill=0, width=1)
    y_eta += 5
    if s.bat_eta_label:
        d.text((6, y_eta + 2), s.bat_eta_label, font=f_eta_lbl, fill=0)
    if s.bat_eta_val:
        vw = int(d.textlength(s.bat_eta_val, font=f_eta_val))
        d.text((W - 6 - vw, y_eta), s.bat_eta_val, font=f_eta_val, fill=0)


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

    # 按实际像素宽度截断（CJK 中文/数字/英文混合时字宽不一）
    max_w = W - 12
    items = data.get('news', [])[:6]
    for i, item in enumerate(items, 1):
        text = f"{i}. {item.strip().replace(chr(10), ' ')}"
        if int(d.textlength(text, font=f_news)) > max_w:
            # 二分截断到合适长度
            lo, hi = 1, len(text)
            while lo < hi:
                mid = (lo + hi + 1) // 2
                if int(d.textlength(text[:mid] + '…', font=f_news)) <= max_w:
                    lo = mid
                else:
                    hi = mid - 1
            text = text[:lo] + '…'
        d.text((6, y), text, font=f_news, fill=0)
        y += 14
        if y > H - 12:
            break


def render_calendar(d, image: Image.Image, s: Snapshot) -> None:
    """日历页：年月头 + 当月迷你网格，今天反白高亮。

    周一为周首（中文习惯）；6 周月份末行可能轻微贴底，可接受。
    """
    W, H = image.size
    today = date.fromtimestamp(s.ts)
    cal = calendar.monthcalendar(today.year, today.month)

    f_h = ImageFont.truetype(FONT_CJK, 12)
    f_wd = ImageFont.truetype(FONT_CJK, 10)
    f_d = ImageFont.truetype(f'{FONT_DEJAVU}/DejaVuSansMono.ttf', 10)
    f_d_b = ImageFont.truetype(f'{FONT_DEJAVU}/DejaVuSansMono-Bold.ttf', 10)

    # 头部：年月（左）+ 今天（右）
    y = CONTENT_Y0
    d.text((6, y), f'{today.year}年 {today.month}月', font=f_h, fill=0)
    weekday_cn = '一二三四五六日'[today.weekday()]
    today_str = f'今 {today.day}日 周{weekday_cn}'
    tw = int(d.textlength(today_str, font=f_h))
    d.text((W - 6 - tw, y), today_str, font=f_h, fill=0)
    y += 14

    # 星期表头
    margin = 4
    cell_w = (W - 2 * margin) / 7
    for i, lb in enumerate('一二三四五六日'):
        cx = int(margin + i * cell_w + cell_w / 2)
        lw = int(d.textlength(lb, font=f_wd))
        d.text((cx - lw // 2, y), lb, font=f_wd, fill=0)
    y += 11

    # 日历网格
    cell_h = 10
    for row_idx, week in enumerate(cal):
        cy = y + row_idx * cell_h
        for col_idx, day in enumerate(week):
            if day == 0:
                continue
            cx = int(margin + col_idx * cell_w + cell_w / 2)
            day_str = str(day)
            is_today = (day == today.day)
            font_use = f_d_b if is_today else f_d
            dw = int(d.textlength(day_str, font=font_use))

            if is_today:
                rx1 = int(margin + col_idx * cell_w + 2)
                rx2 = int(margin + (col_idx + 1) * cell_w - 2)
                d.rectangle((rx1, cy - 1, rx2, cy + cell_h - 1), fill=0)
                d.text((cx - dw // 2, cy - 1), day_str, font=font_use, fill=255)
            else:
                d.text((cx - dw // 2, cy - 1), day_str, font=f_d, fill=0)


# ─── 页面注册表 + 主 render ─────────────────────────

PAGES: list[tuple[str, callable]] = [
    ('概览', render_overview),
    ('系统', render_system),
    ('电源', render_power),
    ('日历', render_calendar),
    ('天气', render_weather),
    ('新闻', render_news),
]


def render(image: Image.Image, s: Snapshot, page_idx: int) -> None:
    d = ImageDraw.Draw(image)
    name, page_fn = PAGES[page_idx]
    render_status_bar(d, image.size[0], s, page_idx, len(PAGES), name)
    page_fn(d, image, s)
