"""周期性外部数据获取（天气 / 新闻），后台线程 + 缓存最近成功结果。

URL 和刷新间隔可被环境变量覆写（systemd unit 里 Environment= 即可）。
渲染端通过 fetchers.weather / fetchers.news 直接拿模块属性，
main() 启动时调用 start_all() 初始化两个线程。
"""
from __future__ import annotations

import json
import os
import threading
import time
import urllib.request

WEATHER_URL = os.environ.get(
    'EINK_WEATHER_URL', 'https://wttr.in/?format=j1&lang=zh')
WEATHER_INTERVAL = int(os.environ.get('EINK_WEATHER_INTERVAL', '1800'))    # 30 min
NEWS_URL = os.environ.get(
    'EINK_NEWS_URL', 'https://60s-api.viki.moe/v2/60s')
NEWS_INTERVAL = int(os.environ.get('EINK_NEWS_INTERVAL', '3600'))          # 1 h
FETCH_TIMEOUT = 10.0


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


# 模块级句柄，渲染端读取；main 启动时 start_all() 初始化
weather: 'Fetcher | None' = None
news: 'Fetcher | None' = None


def start_all() -> None:
    """初始化并启动天气/新闻 fetcher 线程。"""
    global weather, news
    weather = Fetcher('weather', WEATHER_URL, WEATHER_INTERVAL, parse_wttr)
    weather.start()
    news = Fetcher('news', NEWS_URL, NEWS_INTERVAL, parse_60s)
    news.start()
