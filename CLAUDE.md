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
bash scripts/deploy.sh eink-render --restart    # 推渲染服务到 Pi 并重启
bash scripts/deploy.sh eink-status --restart    # 推状态 daemon 到 Pi 并重启
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

### eink-render（生产渲染管线）

`projects/eink-render/` 是 Pi 上的**生产渲染服务**。eink-status 通过 HTTP 调它拿 1-bit PNG 推屏。旧的 `render.py`（imperative PIL 绘制）已删除。

部署形态：跟其它 `projects/*` 一致——`install.sh` 装 systemd unit `eink-render.service`，bootstrap.sh 第 7 步自动捡。在 Pi 上跑 Hono HTTP server（0.0.0.0:8787），提供：
- `POST /api/render` —— eink-status 调，传 params + pageId 回 PNG
- `GET  /api/render?page=overview` —— dashboard / dev 调
- `GET  /api/snapshot` —— 缓存最近一次 POST 的 params（dashboard 轮询用）
- `GET  /api/pages` `GET /api/health`

渲染管线：

```
JSX 模板（lib/renderer.jsx）
  → React jsx-runtime 构造 vnode（不调和、不挂 DOM）
  → lib/vdom-to-ops.js normalize + Yoga 布局 → ops JSON
  → lib/raster.mjs（自编 FreeType-WASM FT_RENDER_MODE_MONO）→ 1-bit PNG
```

渲染层 2026-05 迁移为**纯 Node**（`lib/ft-mono.mjs` 引擎 + `lib/raster.mjs` 光栅），**Python/PIL 已彻底退役**——测量与光栅同源、单进程、无 IPC。背景/选型/spike 见 EXPLORATION D12。性能：glyph 缓存后小字 ~1ms/字形，大字时钟首绘可缓存（远小于墨水屏刷新）。

FreeType-WASM 不再自编单 MONO 切片，改为消费独立通用库 [`zkl2333/freetype-wasm`](https://github.com/zkl2333/freetype-wasm)（完整公共 API、内存可增长、上游对齐），其 `dist/` 钉版入库 `vendor/freetype-wasm/`（tag `v2.14.3` = FreeType 2.14.3，见 `vendor/freetype-wasm/SOURCE.txt`）。`ft-mono.mjs` 仍只走 FT_RENDER_MODE_MONO，导出契约不变（`initFt/glyph/measure/vmetrics`），故 `raster.mjs`/`vdom-to-ops.js`/`renderer.jsx` 零改动。已用 1144 样本（4 字族 × 11 字号）实测：advance/几何/MONO 位图/竖直度量与旧自编 2.13.3 **逐字节一致**（FT 2.13.3→2.14.3 对这些字体的 hinted MONO 输出无变化）。升级版本：换 tag 重抽 `vendor/freetype-wasm/`（运行时不联网；与 Pi 屏蔽 github.com 的约束兼容）。

字体：wqy-microhei（CJK，gitignored，`setup-font.mjs` 三级 fallback 下载）+ Phosphor Regular / Fill（图标，入库 git）+ Archivo Black（Overview 时钟数字，OFL，入库 git，FONTS key `clock`）。图标尺寸约定：Regular ≥ 10px，Fill ≥ 14px；状态栏 WiFi/电池/闪电用手绘像素图。

依赖（纯 Node，无 Python）：`hono` + `@hono/node-server`（HTTP）、`yoga-layout`（布局）、`react`（jsx-runtime）、`tsx`（JSX 转译）；`vendor/freetype-wasm/`（消费 `zkl2333/freetype-wasm@v2.14.3` 的 dist，入库、零运行时原生依赖、不联网）。Node `v22.22.2`（bootstrap 第 1.5 步固化）。

首次部署用 `scripts/pi-bringup.sh <pi-ip>`。**探索路径 + 死路记录见 [`projects/eink-render/EXPLORATION.md`](projects/eink-render/EXPLORATION.md)。**

#### 写 page 时的注意点

- **`vdom-to-ops.js` 只懂 host element**：函数组件会被立即调用展开，**不要写 hooks**。Fragment 会摊平到父级。
- **CSS 子集**：`display:flex` 默认；颜色只认黑/白；不支持 `position:absolute`、`transform`、阴影、渐变。
- **text-as-leaf 陷阱**：同一节点既有 text content 又有 flex 容器 props（flex/padding/justifyContent），会被当 leaf 处理，flex props 失效。解法：text 包到内层 div。
- **`textAlign:'center'`**：文字在自身盒内水平居中（→ FreeType anchor 'mm' 盒心绘，盒心由 flex 居中保证 == 容器中心，与估宽误差无关）。CLI 跑 `npx tsx render.mjs <page>`，纯 Node 无需 `PYTHON_BIN`。

### eink-dashboard（可选，不进 bootstrap）

`projects/eink-dashboard/` 是**纯前端 SPA**（React + Vite + Tailwind + shadcn），部署到内网 Docker 主机，通过 HTTP 调 Pi 上的 eink-render API 展示 6 页实时预览。Pi 不依赖它——dashboard 挂了屏幕照常刷。

开发时 `npm run dev` 启 Vite，`/api/*` 代理到 `PI_RENDER_URL`（默认 `http://zero2w.local:8787`）。

### eink-status 设计要点（事件驱动 daemon）

- `Type=simple` 常驻进程；**不是** timer。两个数据源：
  1. **PiSugar 命令通道**：每次查询用到 `127.0.0.1:8423` 的短连接，按行 `key:value` 解析。代码里有句注释"曾尝试用 `pisugar-server-py` 0.1.1，命令解析对事件行/分包鲁棒性不足，已放弃"——继续用裸 socket，不要回退到那个库。**注意：PiSugar 报告的 `battery_i` 实测大多为 0**（plugged 时 pisugar 间歇切断输入、放电时也读不到），不可靠；电池 ETA 已改用 30 分钟历史电量样本算速率（见 `data._estimate_battery_eta`），不要回退到瞬时电流。
  2. **PiSugar 事件通道**：另一条长连接读 tap 事件（单击/双击/长按）。`tap_listener` 设了 90s 读超时（`TAP_READ_TIMEOUT_SEC`），server 死锁也能自动重连（已实战验证）。
- 6 页内容由 `remote_render.PAGE_IDS` 定义：overview / system / power / calendar / weather / news。渲染通过 HTTP POST 到 eink-render（`127.0.0.1:8787/api/render`），`remote_render.py` 带 3 次指数退避重试 + 白屏兜底（不会因 eink-render 挂掉而 crash）。tap 行为：**单击下一页、双击上一页、长按回首页**（`current_page = 0`）。
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

6. **pisugar-server 版本锁 2.3.2**：1.7.x 在 long-uptime（≈ 1h+）会出现 accept queue 堆积、HTTP/TCP 都不响应的死锁（systemd 仍报 active；上游 issue #131）。`bootstrap.sh` 第 4 节锁定 2.3.2，并在升级前 `pkill -9` 兜底防 prerm 卡死、`dpkg --force-confold` 保留我们的 config。**不要装 2.3.3**——那只是把 CI 编译目标改成 ARMv6 适配 pi zero v1，我们 Pi Zero 2 W 跑 ARMv7 反而更慢。`tap_listener` 也设了 90s 读超时（`eink_status.py:TAP_READ_TIMEOUT_SEC`），即使 server 真的再死锁，按钮线程也能自动重连。

7. **`battery_keep_input` 功能我们用不了**：server 2.3.2 加了 `set_battery_keep_input` / `get battery_keep_input` 命令，对应 PiSugar 3 寄存器 BAT_CTR2 (0x21) 的 bit 7。但 PiSugar 3 固件 v1.3.4 不识别 0x21 寄存器——`set` 命令返回 `done`、i2c 直写也"成功"，但读回永远是 `0x00`（硬件静默忽略）。**`curl https://cdn.pisugar.com/release/PiSugarUpdate.sh | sudo bash` 也无效**——cdn 上 `pisugar-3-application.bin` 当前就是 v1.3.4，跑脚本只是同版本重烧，不会解锁该功能（PiSugar3Firmware 仓库 404，固件闭源，要等官方发新版）。不要在 bootstrap 里加 set——只会写一个永远不生效的值徒增噪音。

8. **~~render.py 字体陷阱~~**（已废弃）：旧 `render.py` 已删除，渲染由 eink-render 接管。eink-render 只用 wqy-microhei（全字符集）+ Phosphor（图标），不存在 mono/CJK 字体混用问题。

9. **`battery_i`（瞬时电流）恒为 0，不可用**：充电、放电都读不到，不是"没插电才读不到"。**2026-05-17 纯放电态实锤**（PiSugar 3 / 固件 v1.3.4）：连续 8 次采样 `battery_i: 0` 一动不动，而**同源 ADC 的 `battery_v` 每次都报真实抖动值**（3.797~3.810V）、`battery` 百分比正常波动、`battery_charging`/`battery_power_plugged` 均 `false`；`i2cdetect` 确认 `0x57`（PiSugar 芯片）在线、`0x68=UU`（ds3231 被内核占用）。机理判断：电压同源 ADC 正常 ⇒ 排除"软件解析 bug / I2C 链路坏";`battery_i` 这条命令在 pisugar-server 协议里是存在的 ⇒ 是固件那头不给;症状与坑 7 完全同指纹（接口在、值恒定无效）⇒ **指向 v1.3.4 固件不上报电流**。底层有无分流电阻+ADC 采样电路无法外部证实（原理图未公开、固件闭源），但**实际后果等价于硬件不支持：不可修、不可绕**（cdn 固件就是 v1.3.4，见坑 7）。因此电池 ETA 改用 30 分钟历史电量样本算速率（`eink_status.py` 的 `data._estimate_battery_eta`）是绕开死路的**唯一正解**，不是次优——**永远不要回退到瞬时电流，不要在 bootstrap / 代码里依赖 `battery_i`**。

## TODO 候选（按性价比）

- eink-dashboard 部署到 Docker 主机（Dockerfile + docker-compose）
- 长按 → 软关机带 goodbye 画面
- RTC alarm 定时唤醒（断电省电场景）
- 更多页面模板（Docker 容器列表 / 自定义信息）
- PiShrink SD 镜像备份
