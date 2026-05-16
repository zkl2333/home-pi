"""调 eink-render HTTP 服务（127.0.0.1:8787）拿 1-bit PNG。

替换原来的 `from render import render` 本地 imperative 绘制路径。Snapshot 字段
按 eink-render 模板的 params 形状重新打包，外加天气/新闻从 fetchers 模块属性读取。

eink-render 输出 250×122 mode='1' 真黑白 palette PNG，PIL 直接 .convert('1')
拿到二值图，跟原来 PIL imperative 路径产物形状一致，喂给 epd.getbuffer 即可。
"""
from __future__ import annotations

import json
import logging
import time
from datetime import date, datetime
from io import BytesIO
from urllib import request
from urllib.error import URLError

from PIL import Image

from data import Snapshot
import fetchers

log = logging.getLogger(__name__)

EINK_RENDER_URL = 'http://127.0.0.1:8787/api/render'
TIMEOUT_SEC = 5.0
MAX_RETRIES = 3
BLANK_SIZE = (250, 122)

# 与 eink-render lib/renderer.jsx 的 PAGES 顺序严格对齐
PAGE_IDS = ['overview', 'system', 'power', 'calendar', 'weather', 'news']


def _state(s: Snapshot) -> str:
    if s.charging:
        return '充电中'
    if s.plugged:
        return '接电'
    return '放电'


def snapshot_to_params(s: Snapshot) -> dict:
    """Snapshot → eink-render params dict。"""
    mem_pct = int(s.used_mb * 100 / s.total_mb) if s.total_mb else 0
    disk_pct = int(s.used_gb * 100 / s.total_gb) if s.total_gb else 0
    today = date.fromtimestamp(s.ts)

    params: dict = {
        # 状态栏 / 共用
        'time': s.minute_str,
        'ip': s.ip,
        'hostname': s.hostname,
        'uptime': s.uptime_str,
        # 电源 / PiSugar
        'battery': s.battery_pct if s.battery_pct is not None else 0,
        'state': _state(s),
        'bat_v': s.bat_v,
        'bat_eta_label': s.bat_eta_label,
        'bat_eta_val': s.bat_eta_val,
        # 网络
        'rssi': s.rssi if s.rssi is not None else 0,
        'rssi_bars': s.rssi_bars,
        # 系统 metric
        'temp': s.cpu_temp,
        'load': s.load1,
        'memUsed': s.used_mb,
        'memTotal': s.total_mb,
        'memPercent': mem_pct,
        'diskUsed': round(s.used_gb, 1),
        'diskTotal': round(s.total_gb),
        'diskPercent': disk_pct,
        # 日历（仅传日期数字，月份网格由 renderer 自己算）
        'cal_year': today.year,
        'cal_month': today.month,
        'cal_today': today.day,
    }

    # 天气：fetcher 还没采到数据时不传，让 renderer 用默认 mock（也可改成传 None
    # 让 renderer 显占位，未来再加 placeholder 支持）。
    if fetchers.weather is not None:
        w_data, w_last_ok, _ = fetchers.weather.get()
        if w_data:
            params.update({
                'city': w_data.get('city', '?'),
                'cond': w_data.get('cond', '?'),
                'temp_c': w_data.get('temp_c', '?'),
                'high_c': w_data.get('high_c', '?'),
                'low_c': w_data.get('low_c', '?'),
                'feels_c': w_data.get('feels_c', '?'),
                'humidity': w_data.get('humidity', '?'),
            })
            if w_last_ok:
                params['weather_fresh'] = datetime.fromtimestamp(w_last_ok).strftime('%H:%M')

    # 新闻
    if fetchers.news is not None:
        n_data, _, _ = fetchers.news.get()
        if n_data:
            params['news_date'] = n_data.get('date', '')
            params['news'] = n_data.get('news', [])

    return params


def render_remote(page_idx: int, s: Snapshot) -> Image.Image:
    """POST 到 eink-render，拿到 PNG 字节解成 PIL mode='1' Image。

    重试 MAX_RETRIES 次（指数退避 1s/2s/4s）。
    全部失败返回白屏，不 crash daemon。
    """
    body = json.dumps({
        'pageId': PAGE_IDS[page_idx],
        'params': snapshot_to_params(s),
    }).encode('utf-8')

    last_err = None
    for attempt in range(MAX_RETRIES):
        try:
            req = request.Request(
                EINK_RENDER_URL,
                data=body,
                headers={'Content-Type': 'application/json'},
                method='POST',
            )
            with request.urlopen(req, timeout=TIMEOUT_SEC) as resp:
                png_bytes = resp.read()
            return Image.open(BytesIO(png_bytes)).convert('1')
        except (URLError, OSError, Exception) as e:
            last_err = e
            wait = 2 ** attempt
            log.warning('eink-render 请求失败 (第%d次): %s，%ds 后重试', attempt + 1, e, wait)
            time.sleep(wait)

    log.error('eink-render %d次重试全部失败，返回白屏: %s', MAX_RETRIES, last_err)
    return Image.new('1', BLANK_SIZE, 1)
