# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 仓库定位

本地（Windows / git-bash）开发工作区，对应远端设备 `pi@zero2w.local`（IP 由路由器分配，会变；连接走 mDNS。Raspberry Pi Zero 2 W，Raspbian 11，配 PiSugar 3 + Waveshare 2.13" V3 墨水屏）。**代码在本机编辑，运行环境只在 Pi 上**——本机没有 GPIO / SPI / `waveshare_epd` / `pisugar-server`，不要试图在 Windows 本地跑 `projects/eink-status/eink_status.py`。

整个仓库的承诺：在新 Pi 上 `git clone` + `bash bootstrap.sh` 即可完整复盘当前线上状态。改任何系统侧配置时，要同时改 `bootstrap.sh` 让它仍幂等。

## 常用命令

开发机（git-bash）→ Pi：

```bash
bash scripts/pi.sh                              # ssh 进 Pi（自动用 Windows OpenSSH + 1Password agent）
bash scripts/pi.sh '<任意远端命令>'             # 单条远端命令
bash scripts/deploy.sh eink-status              # 推 projects/eink-status 到 ~/projects/eink-status（tar over ssh）
bash scripts/deploy.sh eink-status --restart    # 推完顺手 sudo systemctl restart eink-status.service
```

Pi 本机：

```bash
bash bootstrap.sh                                                  # 幂等复盘整机
cd ~/projects/eink-status && bash install.sh                       # 单项目 (re)install
sudo systemctl restart eink-status && journalctl -u eink-status -e -f
python3 ~/projects/eink-status/eink_status.py                      # 手动跑一次（前台）
```

仓库里没有 lint / test / build——纯 Bash + Python 脚本，靠在 Pi 上跑 service 验证。

## 架构

四个职责清晰的目录：

- **`projects/<name>/`** — 部署到 Pi 的应用。约定：每个项目自带 `install.sh`（在 Pi 本机运行，把自己装成 systemd unit），`bootstrap.sh` 会循环跑所有 `projects/*/install.sh`。新增项目就按此约定加目录，无需改 `bootstrap.sh`。
- **`pi-scripts/`** — 部署到 Pi 上由 cron / systemd / rc.local 调用的脚本（如 `sync-github-keys.sh`，每小时拉 GitHub 公钥覆写 `authorized_keys`）。
- **`pi-config/`** — Pi 系统侧配置快照（`etc/rc.local`、`pi-crontab.txt`），`bootstrap.sh` diff 后同步过去。改这里 = 改 Pi 上的系统状态。
- **`scripts/`** — 仅在开发机用的工具，**不部署**。
- **`upstream/`** — gitignored，`bootstrap.sh` 按需 `git clone`（Waveshare e-Paper SDK、PiSugar 等）。不要把上游代码 commit 进来。

`bootstrap.sh` 是单一真理来源：apt 包、SPI/I2C、e-Paper SDK、PiSugar power-manager、sugar-wifi-conf、`auto_rtc_sync`、`dtoverlay=i2c-rtc,ds3231`、SSH key 同步、crontab、`/etc/rc.local`、所有 `projects/*` 部署，全在这里。任何"在 Pi 上手工跑过的安装步骤"都要补回这个脚本。

### eink-status 设计要点（事件驱动 daemon）

- `Type=simple` 常驻进程；**不是** timer。两个数据源：
  1. **PiSugar 命令通道**：每次查询用到 `127.0.0.1:8423` 的短连接，按行 `key:value` 解析。代码里有句注释"曾尝试用 `pisugar-server-py` 0.1.1，命令解析对事件行/分包鲁棒性不足，已放弃"——继续用裸 socket，不要回退到那个库。
  2. **PiSugar 事件通道**：另一条长连接读 tap 事件（单击/双击/长按）。
- 后台 10s 轮询，仅当关键字段（`HH:MM` / IP / 电量整数 / 充电 / 接电 / WiFi 4 格档位）变化时触发刷新；超 10 分钟没刷过则强制刷一次兜底。
- 全刷 vs 局刷：启动 / 距上次全刷 > 1h / 局刷次数 ≥ 30 → 全刷；否则局刷。改刷新相关常量（`POLL_INTERVAL`、`PARTIAL_REFRESH_LIMIT`、`FULL_REFRESH_MAX_AGE_SEC` 等）在文件顶部。
- 依赖系统级 Waveshare lib，硬编码路径 `/home/pi/e-Paper/RaspberryPi_JetsonNano/python/lib`，并 `sys.path.insert` 进去——这是 `bootstrap.sh` 第 3 步保证的。
- 时间正确性靠两层：内核层 `dtoverlay=i2c-rtc,ds3231`（让 `/dev/rtc0` 在 systemd 启动早期就有正确时间）+ pisugar-server 的 `auto_rtc_sync`。改时间相关行为前先看清楚这两层。

## 约定 / 注意事项

- 与用户用中文沟通。
- Windows git-bash 下写脚本：用 Unix 路径和 `bash`；涉及 ssh 时优先 `/c/Windows/System32/OpenSSH/ssh.exe`（`scripts/` 里两个脚本都做了这层 fallback，新脚本沿用这个写法以兼容 1Password agent）。
- `deploy.sh` 用 tar over ssh 而非 rsync（git-bash 默认没 rsync），`--exclude` 列表里已排除 `.git / __pycache__ / *.pyc / node_modules / .venv`，新项目若有别的产物，加到这里。
- SSH 可信源是 GitHub（`https://api.github.com/users/zkl2333/keys`，走 Cloudflare 而非被屏蔽的 github.com:443）。在 GitHub 删完所有公钥就只能密码登录了。
- 改 `/boot/config.txt`（如再加 overlay）务必复用 `bootstrap.sh` 里的备份 + 幂等 grep 模式，并设 `REBOOT_NEEDED=1`。
- 提交风格：`<type>: <中文描述>`，例 `feat: 启用 PiSugar RTC 双向同步` / `fix(eink-status): ...`。
- `*.sh / *.py / *.service` 由 `.gitattributes` 强制 LF；新加跑在 Linux 的文件类型记得补一行，否则 git checkout 出来 CRLF 会让 bash 报 `/usr/bin/env: 'bash\r'`。
- PiSugar `/etc/pisugar-server/config.json` 含密码字段（`auth_user/auth_password`）——**绝不整文件入库**。bootstrap 用 `jq` patch 单字段。

## 已知坑（别再踩）

1. **不要用 `paramiko.exec_command` 跑常驻 daemon**——SSH channel 关闭后 daemon 不退，被 init 收养，独占 SPI/GPIO/PiSugar TCP 连接，systemd 启的新 daemon 抢不到资源。表现：屏幕看似在工作但按按钮没反应。daemon 全部由 systemd 管，部署只走"短命令"（ssh + tar）。

2. **`pisugar-server-py` 0.1.1 不可用**：
   - 事件回调比较 `event == b'single'` 但 PiSugar 推 `b'single\n'`，**永不触发**
   - 命令通道单次 `recv` + 字符串 replace 过滤事件行，TCP 分包就错位，连续报 `Expected b'battery' but got b'\n'`
   - 库最后 commit 是 2022-06，停滞状态。我们用裸 socket。

3. **PiSugar TCP 协议**：任意一条连接（含命令通道）都会被广播 button event（`single\n`/`double\n`/`long\n`），命令响应解析必须能识别并跳过这些行。

4. **Pi 网络限制**：`github.com:443` 直连超时（被屏蔽，ping 通但 TCP 不通），`api.github.com` 走 Cloudflare 可达。Pi 上拉 GitHub 资源前先想这点。

5. **e-Paper 局刷状态**：`displayPartial()` 内部会改 LUT，回到全刷需要重新 `init()`。`ScreenController._init_mode` 跟踪当前 LUT 模式以决定是否要 re-init。

## TODO 候选（按性价比）

- PiSugar 双击/长按绑特定功能（当前都只触发"立即刷新"），例：长按 → 软关机带 goodbye 画面；双击 → 切换显示页（系统/网络/PiSugar 详情）
- RTC alarm 定时唤醒（断电省电场景，比如凌晨开机抓数据再关）
- 屏幕加多页轮播（CPU 频率 / 网速 / Docker 容器列表 / 你想看的）
- PiShrink 做一次 SD 镜像快照备份（A 方案 = 仓库 + bootstrap 已够；B 方案 = .img.xz 是冷备份，需要 WSL）
- Whisplay HAT 替换墨水屏后做 AI 应用（PiSugar 自家 demo：聊天机器人 / Lumon MDR 终端复刻）
