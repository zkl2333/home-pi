# eink-status

在 Waveshare 2.13" V3 墨水屏上展示设备状态。事件驱动、~0.7s 局刷。

## 屏幕布局（旋转 180° 后）

```
🕐 21:14         📶 -50dBm           🔋 79% +
─────────────────────────────────────────────
192.168.31.35
zero2w · 运行 1时02分           ⚡ 3.86V
─────
🌡 温度 45°C        ⚙ 负载 0.05
▦ 内存 65% (272/427M)
⬢ 磁盘  7% (1.8/29G)            [单击]  ← tap 反馈
```

按按钮后右下角出现反白小条（`单击` / `双击` / `长按`），保留 ≥5 秒，下次刷新自动消失。

## 文件

```
eink-status/
├── eink_status.py         # 主程序（常驻 daemon）
├── eink-status.service    # systemd unit (Type=simple)
├── install.sh             # 在 Pi 本机装/更新 service
└── README.md
```

## 依赖

- 硬件：Pi（已开 SPI / I2C）+ Waveshare 2.13" V3 e-Paper + PiSugar 3
- 系统包：`python3-pil` `python3-numpy` `python3-spidev` `python3-rpi.gpio` `fonts-wqy-microhei`
- Waveshare lib：`/home/pi/e-Paper/RaspberryPi_JetsonNano/python/lib/waveshare_epd/`
- `pisugar-server` 在 `127.0.0.1:8423` 监听

以上由仓库根 `bootstrap.sh` 一并保证。

## 部署

从开发机：

```bash
bash scripts/deploy.sh eink-status --restart    # 推送 + 重启 service
```

新 Pi 上从仓库根跑 `bash bootstrap.sh` 时会自动调用本目录的 `install.sh`。

## 调试

```bash
# 实时日志（事件驱动 → 看每次刷新的 reason 和耗时）
journalctl -u eink-status -e -f

# 状态 / 重启
sudo systemctl status eink-status
sudo systemctl restart eink-status

# 看 daemon 在不在跑
pgrep -af 'eink_status.py'
```

> ⚠️ daemon 独占 SPI/GPIO，**不要在 daemon 跑着的时候手动 `python3 eink_status.py`**——会报硬件占用错误。要手动测试先 `sudo systemctl stop eink-status`。

## 事件 → 刷新策略

```
PiSugar tap (single/double/long)
   └→ 立即局刷 + 显示 tap badge

后台 10s 轮询，触发刷新的关键字段：
   - HH:MM 分钟
   - IP 地址
   - 电量整数 % (按 5% 一档去抖)
   - 充电状态 / 接电状态
其余字段（CPU 温度、负载、内存、磁盘、电压电流、RSSI）顺带更新但不触发

兜底：>10 分钟没刷过 → 强制刷一次
```

全刷 vs 局刷：
- 启动 / 距上次全刷 > 1 小时 / 局刷次数 ≥ 30 → 全刷（~5.7s）+ 重设局刷基底
- 其余 → 局刷（~0.7s）

实际刷新时长里大部分是 SPI 推送，PIL 渲染 + PiSugar 查询合计 < 100ms。

## 调参

[`eink_status.py`](eink_status.py) 顶部常量：

| 名 | 默认 | 含义 |
|---|---|---|
| `ROTATE_180` | True | 屏幕物理安装方向 |
| `POLL_INTERVAL` | 10s | 轮询间隔 |
| `PARTIAL_REFRESH_LIMIT` | 30 | 连续局刷上限，超过强制全刷清残影 |
| `FULL_REFRESH_MAX_AGE_SEC` | 3600 | 至少每小时全刷一次 |
| `SAFETY_REFRESH_MAX_AGE_SEC` | 600 | 兜底间隔 |
| `TAP_BADGE_LINGER_SEC` | 5 | tap 反馈最少保留秒数 |
