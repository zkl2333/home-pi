"""数据采集：PiSugar 命令通道 + 系统 metric + Snapshot 快照。

PiSugar 命令通道：每次查询用短连接、按行 key:value 解析、过滤事件行。
（事件通道由 eink_status.tap_listener 单独长连接读取。）
"""
from __future__ import annotations

import os
import socket
import subprocess
import time
from dataclasses import dataclass
from datetime import datetime

PISUGAR_HOST = ('127.0.0.1', 8423)


# ─── PiSugar 命令通道 ──────────────────────────────

def query_pisugar(cmds: list[str], timeout: float = 2.0) -> dict[str, str]:
    """短连接发多条 get 命令，按 key:value 解析并过滤混入的事件行。"""
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


# ─── 系统 metric 采集 ──────────────────────────────

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


# ─── Snapshot ─────────────────────────────────────

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
    # 由 _estimate_battery_eta 填充：'充满还要' / '续航约' / '采样中' / 状态文字
    bat_eta_label: str = ''
    bat_eta_val: str = ''


# ─── 电池估算（用历史采样推算变化率，不依赖 bat_i —— PiSugar 报 0 居多）
_BATTERY_HISTORY: list[tuple[float, float]] = []
_HISTORY_MAX_AGE = 1800   # 保留 30 分钟内
_HISTORY_MIN_WIN  = 300   # 至少 5 分钟样本才算速率（窗口短噪声大）


def _update_battery_history(ts: float, level: float | None) -> None:
    if level is None:
        return
    _BATTERY_HISTORY.append((ts, level))
    cutoff = ts - _HISTORY_MAX_AGE
    while _BATTERY_HISTORY and _BATTERY_HISTORY[0][0] < cutoff:
        _BATTERY_HISTORY.pop(0)


def _fmt_eta(sec: float) -> str:
    sec = int(max(0, sec))
    h, rem = divmod(sec, 3600)
    m = rem // 60
    if h > 48:
        return f'{h // 24}天{h % 24}时'
    if h:
        return f'{h}时{m:02d}分'
    return f'{m}分'


def _estimate_battery_eta(level: float | None,
                          charging: bool, plugged: bool) -> tuple[str, str]:
    if level is None:
        return '', ''
    n = len(_BATTERY_HISTORY)
    if n < 2:
        return '采样中', '需 5 分钟'
    now_ts, now_level = _BATTERY_HISTORY[-1]
    early_ts, early_level = _BATTERY_HISTORY[0]
    win = now_ts - early_ts
    if win < _HISTORY_MIN_WIN:
        remain = _HISTORY_MIN_WIN - win
        return '采样中', f'还需{int(remain // 60) + 1}分'

    rate = (now_level - early_level) / win   # %/秒
    if charging and rate > 1e-5:
        return '充满还要', _fmt_eta((100 - now_level) / rate)
    if not plugged and rate < -1e-5:
        return '续航约', _fmt_eta(now_level / -rate)
    # 充电中但电量不升（pisugar 间歇切断）/ 接电不充 / 满电待机
    if plugged and now_level >= 95:
        return '已满电', ''
    if plugged:
        return '接电中', ''
    if now_level < 20:
        return '电量偏低', ''
    return '电量稳定', ''


def take_snapshot() -> Snapshot:
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
    ts = time.time()
    _update_battery_history(ts, battery_raw)
    eta_label, eta_val = _estimate_battery_eta(battery_raw, charging, plugged)
    return Snapshot(
        ts=ts,
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
        bat_eta_label=eta_label,
        bat_eta_val=eta_val,
    )


def _key_tuple(s: Snapshot) -> tuple:
    bat_lvl = (s.battery_pct // 5) if s.battery_pct is not None else None
    return (s.minute_str, s.ip, bat_lvl, s.charging, s.plugged, s.rssi_bars)


def changed_significantly(a: Snapshot | None, b: Snapshot) -> bool:
    if a is None:
        return True
    return _key_tuple(a) != _key_tuple(b)
