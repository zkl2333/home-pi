#!/usr/bin/env python3
"""墨水屏状态显示常驻 daemon — 入口与线程编排。

模块结构（同目录平铺，systemd WorkingDirectory 即 sys.path[0]）：
- data.py     — PiSugar 命令通道 + 系统 metric + Snapshot
- fetchers.py — 周期性外部数据获取（天气/新闻）
- render.py   — 屏幕渲染（icon、状态栏、各页、PAGES 注册表）
- screen.py   — ScreenController（EPD 设备、全/局刷判定）

事件驱动模型：
- tap_listener：PiSugar 8423 长连接读 single/double/long 事件
- poll_loop：每 POLL_INTERVAL 秒采样，仅在关键字段变化时入队 refresh
- 主循环消费事件：tap 切页 / poll 数据更新 / safety 兜底刷新

注：曾尝试用 pisugar-server-py 0.1.1，命令解析对事件行 / 分包鲁棒性不足，已放弃。
"""
from __future__ import annotations

import queue
import socket
import threading
import time

import fetchers
from data import (PISUGAR_HOST, Snapshot, changed_significantly, take_snapshot)
from render import PAGES
from screen import ScreenController

POLL_INTERVAL = 10.0
SAFETY_REFRESH_MAX_AGE_SEC = 1800
TAP_RECONNECT_DELAY_SEC = 5
TAP_READ_TIMEOUT_SEC = 90  # pisugar-server 死锁时能自动重连，不永久挂死


# ─── 后台线程 ──────────────────────────────────────

def tap_listener(events: queue.Queue) -> None:
    """单独的 PiSugar TCP 长连接，专门读 tap 事件
    （lib v0.1.1 的事件回调有 newline 比对 bug，自己实现更稳）。
    读超时 TAP_READ_TIMEOUT_SEC：pisugar-server 僵死时不会永久阻塞，
    超时后走重连逻辑，server 重启后自愈。"""
    while True:
        try:
            s = socket.create_connection(PISUGAR_HOST, timeout=10)
            s.settimeout(TAP_READ_TIMEOUT_SEC)
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

    # 提前启动外部数据获取，让初始 render 之前就开始 warm cache
    fetchers.start_all()

    s0 = take_snapshot()
    ctrl.refresh(s0, 'startup')

    threading.Thread(target=tap_listener, args=(events,), daemon=True).start()
    threading.Thread(target=poll_loop, args=(events, ctrl), daemon=True).start()

    try:
        while True:
            kind, payload = events.get()
            # 合并积压事件，避免连点暴击
            while True:
                try:
                    events.get_nowait()
                except queue.Empty:
                    break

            if kind == 'tap':
                # 单击下一页、双击上一页、长按回首页
                if payload == 'single':
                    ctrl.current_page = (ctrl.current_page + 1) % len(PAGES)
                elif payload == 'double':
                    ctrl.current_page = (ctrl.current_page - 1) % len(PAGES)
                elif payload == 'long':
                    ctrl.current_page = 0
                ctrl.refresh(take_snapshot(), f'tap:{payload}:p{ctrl.current_page}')
                continue

            ns = payload if isinstance(payload, Snapshot) else take_snapshot()
            ctrl.refresh(ns, kind)
    except KeyboardInterrupt:
        pass
    finally:
        ctrl.sleep()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
