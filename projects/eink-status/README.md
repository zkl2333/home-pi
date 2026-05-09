# eink-status

在 Waveshare 2.13" V3 墨水屏上展示设备状态：hostname / IP / 电量 / 充电状态 / 时间。

## 依赖

- 硬件：Raspberry Pi（已开 SPI）+ Waveshare 2.13" V3 e-Paper + PiSugar 3
- 系统包：`python3-pil`、`python3-numpy`、`python3-spidev`、`python3-rpi.gpio`
- 微雪官方 lib 在 `/home/pi/e-Paper/RaspberryPi_JetsonNano/python/lib/waveshare_epd/`
- `pisugar-server` 在 `127.0.0.1:8423` 监听（默认即是）

## 部署

从开发机：

```bash
bash ../../scripts/deploy.sh eink-status
```

到 Pi 上后，安装 systemd timer：

```bash
ssh pi@192.168.31.35 'cd ~/projects/eink-status && bash install.sh'
```

## 调试

```bash
# 手动刷一次
python3 ~/projects/eink-status/eink_status.py

# 看 timer 状态
systemctl status eink-status.timer

# 看运行日志
journalctl -u eink-status.service -e

# 改刷新间隔
sudoedit /etc/systemd/system/eink-status.timer
sudo systemctl daemon-reload && sudo systemctl restart eink-status.timer
```

## 当前刷新策略（事件驱动）

服务以常驻 daemon 形态运行（systemd `Type=simple`），不再使用 timer。

**触发刷新的事件来源：**
- PiSugar 长连接：单击/双击/长按按钮 → 立即刷新
- 后台 10 秒一次轮询：仅在以下字段变化时刷新
  - 当前分钟（`HH:MM`）
  - IP 地址
  - 电量整数百分比
  - 充电状态、接电状态
  - WiFi 信号强度档位（4 格中的某格）
- 兜底：超过 10 分钟没刷过，强制刷一次

**全刷 vs 局刷：**
- 启动 / 距上次全刷 > 1 小时 / 局刷次数 ≥ 30 → 全刷 + 重设局刷基底
- 其余情况 → 局刷（约 0.3 秒）

CPU 温度、负载、内存、磁盘、运行时长、电池电压/电流不是触发字段，但每次刷新会顺带更新。
