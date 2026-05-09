# home-pi

个人 Raspberry Pi 工作区——一台 **Pi Zero 2 W + PiSugar 3 + Waveshare 2.13" V3 墨水屏**，把它玩成一个常亮的状态显示小站。

整套配置可重现：在新 Pi 上 `git clone` 后跑 [`bootstrap.sh`](bootstrap.sh) 即可恢复到当前状态。

## 设备

| 项 | 值 |
|---|---|
| 型号 | Raspberry Pi Zero 2 W Rev 1.0（4 核 ARMv7 / 512MB） |
| 系统 | Raspbian 11 (bullseye)，内核 6.1.21-v7+ |
| 主机名 / IP | `zero2w` / `192.168.31.35`（DHCP / WiFi） |
| 电源 | PiSugar 3（含 RTC，已接入内核） |
| 屏幕 | Waveshare 2.13" V3 e-Paper（250×122，黑白） |

## 目录结构

```
home-pi/
├── bootstrap.sh                # 在新 Pi 上一键复盘
├── projects/
│   └── eink-status/            # 墨水屏状态显示 daemon
├── pi-scripts/
│   └── sync-github-keys.sh     # 从 GitHub API 同步公钥
├── pi-config/                  # 系统侧配置快照（rc.local 等）
├── scripts/                    # 本机开发工具（不部署到 Pi）
│   ├── pi.sh                   # 一键 ssh
│   └── deploy.sh               # tar | ssh tar 推项目到 Pi
└── upstream/                   # gitignored — bootstrap 按需 git clone
```

## 日常使用

```bash
bash scripts/pi.sh                                  # ssh 进 Pi
bash scripts/deploy.sh eink-status --restart       # 推项目改动并重启服务
bash scripts/pi.sh "journalctl -u eink-status -e -f"  # 看实时日志
```

## 在新 Pi（或重做 SD 卡）上恢复

```bash
git clone https://github.com/zkl2333/home-pi ~/dev/pi
cd ~/dev/pi
bash bootstrap.sh
```

幂等。详细做了哪些事看 [`bootstrap.sh`](bootstrap.sh)，覆盖：apt 依赖、SPI/I2C、e-Paper SDK、PiSugar 套件、sugar-wifi-conf BLE 配 WiFi、SSH 公钥同步 cron、内核 RTC、systemd 服务安装。

## Pi 上常驻服务

| 单元 | 内容 |
|---|---|
| `sshd` | SSH（authorized_keys 由 cron 从 GitHub API 同步）|
| `pisugar-server` | PiSugar 3 状态服务（HTTP 8421 / WS 8422 / TCP 8423）|
| `sugar-wifi-config` | 蓝牙配 WiFi（PiSugar APP / 微信小程序 / web-bluetooth 都可连）|
| `eink-status` | 墨水屏状态显示 daemon（事件驱动）|

## SSH 公钥管理

Pi 上 cron 任务每小时和每次开机时从 `https://api.github.com/users/zkl2333/keys` 拉取，
覆盖写入 `~/.ssh/authorized_keys`——**GitHub 上增删公钥，Pi 自动跟随**。

走 API 而非 `https://github.com/<user>.keys`，因为 Pi 当前网络对 github.com:443 直连超时，api.github.com 走 Cloudflare 不被屏蔽。

> ⚠️ 在 GitHub 上把所有公钥删了 → 下次同步后 Pi 只能靠密码登录。

## 项目

- [eink-status](projects/eink-status) — 墨水屏状态显示 daemon
