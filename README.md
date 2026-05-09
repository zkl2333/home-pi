# Raspberry Pi 开发工作区

本地开发目录，对应远端设备 `pi@192.168.31.35`。整套配置可重现：在新 Pi 上 `git clone` 后跑 `bootstrap.sh` 即可恢复到当前状态。

## 设备信息

| 项 | 值 |
|---|---|
| 型号 | Raspberry Pi Zero 2 W Rev 1.0（4 核 ARMv7 / 512MB RAM） |
| 系统 | Raspbian 11 (bullseye)，内核 6.1.21-v7+ |
| 主机名 | `zero2w` |
| 用户 | `pi` |
| IP | `192.168.31.35`（WiFi / wlan0，DHCP） |
| 配件 | PiSugar 3 电池板、Waveshare 2.13" V3 e-Paper 墨水屏 |

## 目录结构

```
pi/
├── README.md
├── .gitignore
├── bootstrap.sh                # 在 Pi 上一键复盘入口
├── projects/                   # 自己的项目（每个含 install.sh 即被 bootstrap 自动装）
│   └── eink-status/            # 墨水屏状态显示 daemon
├── pi-scripts/                 # 部署到 Pi 上由 cron / systemd 调用的脚本
│   └── sync-github-keys.sh     # 定时拉 GitHub 公钥
├── pi-config/                  # Pi 系统侧配置快照（被 bootstrap 同步）
│   ├── etc/rc.local
│   └── pi-crontab.txt
├── scripts/                    # 本机开发工具（不部署）
│   ├── pi.sh                   # 一键 ssh
│   └── deploy.sh               # rsync 单个项目到 Pi
└── upstream/                   # gitignored — bootstrap.sh 会按需 git clone
    ├── e-Paper/                # waveshareteam/e-Paper
    ├── PiSugar/
    ├── pisugar-power-manager-rs/
    └── sugar-wifi-conf/
```

## 快速使用

### 在已配置好的 Pi 上日常使用

```bash
ssh pi@192.168.31.35                            # 1Password / GitHub key 免密
bash scripts/deploy.sh eink-status              # 推送项目改动到 Pi
ssh pi@192.168.31.35 'sudo systemctl restart eink-status'
ssh pi@192.168.31.35 'journalctl -u eink-status -e -f'
```

### 在新 Pi（或重做 SD 卡）上恢复

```bash
# 在 Pi 上：
git clone <this-repo> ~/dev/pi
cd ~/dev/pi
bash bootstrap.sh
```

`bootstrap.sh` 会做的事（幂等）：
1. apt 装：python3-pil/numpy/spidev/rpi.gpio、fonts-wqy-microhei、git、curl
2. 启用 SPI / I2C（raspi-config）
3. 拉取 Waveshare e-Paper SDK 到 `~/e-Paper`
4. 装 PiSugar power-manager（含 systemd 服务）
5. 部署 `~/.ssh/sync-github-keys.sh` 并装 crontab（开机 + 每小时同步 GitHub 公钥）
6. 同步 `/etc/rc.local`
7. 把 `projects/*` 拷到 `~/projects/` 并跑各自的 `install.sh`

## 服务一览（Pi 上常驻）

| 端口 / 单元 | 内容 |
|---|---|
| `:22` sshd | SSH（authorized_keys 由 cron 从 GitHub 同步）|
| `:8421/8422/8423` pisugar-server | PiSugar HTTP / WebSocket / TCP |
| `sugar-wifi-config.service` | 蓝牙配 WiFi（PiSugar APP / 微信小程序 / web-bluetooth 连接）|
| `eink-status.service` | 墨水屏状态显示 daemon（事件驱动）|

PiSugar 配置项 `auto_rtc_sync = true`（bootstrap 会 patch）：开机自动从 RTC 读时间到系统、关机前从系统写回 RTC，断网时也能保留正确时间。

## SSH 公钥管理（GitHub 单一可信源）

Pi 上 cron 任务每小时和每次开机时从 `https://api.github.com/users/zkl2333/keys` 拉取，
覆盖写入 `/home/pi/.ssh/authorized_keys`——**GitHub 上增删公钥，Pi 自动跟随**。

- 脚本：[`pi-scripts/sync-github-keys.sh`](pi-scripts/sync-github-keys.sh)（部署到 `~/.ssh/sync-github-keys.sh`）
- 走 API 而非 `https://github.com/<user>.keys`，因为 Pi 当前网络对 github.com:443 直连超时；api.github.com 走 Cloudflare，IP 段未被屏蔽。
- 日志：`journalctl -t github-keys` 或 `grep github-keys /var/log/syslog`
- 手动触发：`~/.ssh/sync-github-keys.sh`

> ⚠️ 如果你在 GitHub 上把所有公钥删了，下次同步后 Pi 只能靠密码登录。

## 项目

### eink-status

墨水屏状态显示 daemon，事件驱动（PiSugar tap 事件 + 10s 轮询）。详见 [`projects/eink-status/README.md`](projects/eink-status/README.md)。
