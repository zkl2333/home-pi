# eink-render

墨水屏（Waveshare 2.13" V3, 250×122）渲染管线探索。**目标**：本地用 JSX 写页面布局，输出真 1-bit PNG，对接 Pi 端 `projects/eink-status` 现有的 PIL 显示链路。

> 当前状态：**生产中**。纯 Node 渲染（自编 FreeType-WASM，Python/PIL 已退役），6 页 Pi 真机验证通过，eink-status 经 HTTP 集成，systemd 部署。

> **想知道为什么是当前架构、踩过哪些坑** → 看 [`EXPLORATION.md`](./EXPLORATION.md)（探索日志，含死路记录）。

## 当前架构

```
JSX 模板（lib/renderer.jsx 各 Page 组件）
   ↓                      ← 编译期 _jsx() 构造 vnode 对象，零运行时 parse
React 自动运行时（vnode = { type, props }）
   ↓
lib/vdom-to-ops.js
  ├ normalizeTree(): 展开函数组件 + 摊平 Fragment → 纯 host 树（一次性）
  ├ walk host 树 → Yoga 树（useWebDefaults，flexDirection 默认 row）
  ├ Yoga calculateLayout()
  └ 走第二遍 emit ops JSON: [{op:rect/text/ellipse/line/pixels, x,y,...}]
   ↓
lib/ft-mono.mjs + lib/raster.mjs
  └ 自编 FreeType-WASM（FT_RENDER_MODE_MONO，自动 hinting）+ glyph 缓存
   ↓
1-bit PNG（灰度仅 0/255，eink-status convert('1') 无损）
```

输出 250×122，~1-2 KB/page。**纯 Node，无 Python/PIL**（2026-05 迁移，见 [`EXPLORATION.md`](./EXPLORATION.md) D12）。

**性能**（FreeType-WASM，单进程，glyph 缓存）：

| 阶段 | 冷启（首张） | 热路径（后续，缓存） |
|---|---|---|
| Node layout (Yoga) | 15-20ms | 2-6ms |
| wasm init | ~300ms (Pi) / ~12ms (CI) 一次性 | 0 |
| FreeType-WASM raster | 小字 ~1ms/字形；大字时钟首绘可缓存 | ~0（缓存命中） |

字体缓存 `_DAEMON_FONT_CACHE` 跨请求保活，所以热路径不重复 truetype 加载。

## 用法

### 准备字体

```bash
cd projects/eink-render
npm install
npm run setup-font   # 三级 fallback：系统 apt 字体 → jsdelivr → github.com
```

> 字体来源优先级：
> 1. `/usr/share/fonts/truetype/wqy/wqy-microhei.ttc`（Debian `fonts-wqy-microhei` 包，Pi 上 bootstrap 装过）
> 2. `cdn.jsdelivr.net`（Cloudflare 代理 GitHub，国内可达）
> 3. `github.com` 原站（开发机用）

### Web 预览

```bash
npm run dev   # → http://127.0.0.1:5173
```

左侧表单调任意 mock 参数（电量 / WiFi 强度 / CPU 温度 / 天气 / 新闻 …），右侧实时看 1-bit 输出。tab 切换 6 个页面（概览 / 系统 / 电源 / 日历 / 天气 / 新闻）。

### CLI（一次性渲染）

```bash
npm run render overview      # → output-overview.png
npm run render system        # → output-system.png
```

> 纯 Node，无需 Python。CLI：`npm run render <page>`（= `tsx render.mjs`）。

### HTTP Server（本机调试）

```bash
npm run server                        # 监听 127.0.0.1:8787
curl 'http://127.0.0.1:8787/api/health'
curl 'http://127.0.0.1:8787/api/render?page=overview' -o overview.png
```

### Pi 部署

首次 / 单独装：

```bash
# 在开发机（git-bash）执行
bash scripts/pi-bringup.sh <pi-ip-or-mdns>
```

`pi-bringup.sh` 会自动：tar 推代码 → Pi 上跑 `install.sh` → 等 health → curl 6 张 PNG 回本机 `pi-bringup-output/` 给你肉眼检查 → 打印回滚命令。

新机一键复盘走根目录 `bootstrap.sh` 第 7 步，它会自动捡 `projects/*/install.sh`，无需手动指定。

回滚（如想下掉）：

```bash
bash scripts/pi.sh 'sudo systemctl disable --now eink-render && \
  sudo rm /etc/systemd/system/eink-render.service && \
  sudo systemctl daemon-reload'
```

## 探索过程 / 为啥落到这架构

一开始（`explore/satori-eink` 第一个 commit）想用 Vercel 的 **Satori**（HTML+CSS → SVG）：

```
JSX/HTML → Satori → SVG → sharp/resvg/librsvg → 1-bit PNG
```

写起来很爽（用 CSS flexbox 写 250×122 屏布局），但**真机上字看不清**。诊断了一圈才搞清楚：

| 试过 | 结论 |
|---|---|
| Satori → resvg `shape-rendering:crispEdges` | 比 AA + threshold 干净，但小字号笔画消失（无 hinting） |
| Satori → 2× supersample + threshold | 缓解但治标，本质问题在浮点 Bezier 无 hinting |
| Pi 端 PIL.convert('1', dither=NONE) 保险层 | 修了双重抖动，但 sharp 输出根本不是真 1-bit |
| Yoga（JS 对象树）+ Python PIL | **像素级清晰**，但抛弃了 HTML+CSS 写法（不可接受）|
| node-canvas `antialias='none'` | Cairo MONO 真的纯 0/255，但 Windows fontconfig 不稳，且不如 PIL hint 漂亮 |
| satori-html + Yoga + Python PIL | HTML 字符串写法 + Yoga + PIL hint，跑通了 |
| **JSX + Yoga + Python PIL（最终）** | 去掉 satori-html，直接用 JSX 写 vnode |

### 关键根因（值得记一笔）

PIL 在 `mode='1'` 画布上调 `ImageDraw.text()` 走的是 **FreeType MONO 模式**，自动 hint 笔画到像素网格，每像素直接 0 或 1，**不存在抗锯齿灰边**。

Satori 不走 FreeType，它用 opentype.js 读字形轮廓，输出 SVG 里每个字符都是浮点坐标的 Bezier `<path>`（实测第一版输出可见 `d="M13.1 11.0L13.1 11.0Q13.1 12.2 12.9 13.2…"`）。任何 SVG 光栅化（librsvg/resvg/Cairo）在 250×122 像素网格上画这种浮点曲线，**没 hinting 就只能给灰边**——一根 1px 宽的笔画落在 x=10.3 时，70% 给像素 10、30% 给像素 11，两边都是灰，阈值化必死一边或两边模糊。这是 SVG-rasterize 路线的死结。

所以 PIL（自带 FreeType MONO）是必经之路。

### 为啥换掉 satori-html

第一版用 `satori-html` 把 HTML 模板字符串 parse 成 vnode（保留了 HTML+CSS 编写体验）。但只用到它的 parser，Satori 整个生态都丢了——纯历史包袱。换 JSX 后：

- **零运行时 parse**：JSX 编译期就是 `_jsx({ type, props })` 函数调用，不像字符串还要 tokenize
- **children 自动转义**：HTML 字符串里出现 `<` 会破布局，JSX 把表达式当文本节点处理
- **跟 src/App.jsx 共用一套写法**：之前模板 HTML 字符串、预览 UI 是 JSX，两套语义
- **代价**：lib/ 多了 `react` 这一个 runtime dep（只用 `react/jsx-runtime`，不挂 DOM 不调和），CLI 多了 `tsx` 这个 devDep 做 JSX 转译

## 文件结构

```
lib/
  renderer.jsx         页面 JSX 模板 + PAGES 注册表 + render() 入口
  vdom-to-ops.js       JSX vnode → normalize → Yoga → ops JSON
python/
  render_ops.py        ops JSON → PIL mode='1' → 1-bit PNG
scripts/
  setup-font.mjs       下载 + 抽取 wqy-microhei.ttf
src/                   React 单预览面板 + 参数表单（dev-only，不进 Pi）
fonts/                 wqy-microhei.ttf（gitignored）
render.mjs             CLI 入口（npm run render <page>，走 tsx 转 JSX）
tsconfig.json          只为 tsx 走 react-jsx automatic runtime
vite.config.js         /api/render + /api/pages 两个 middleware 端点
```

## 依赖

```
runtime:  react (仅 jsx-runtime) + yoga-layout       Node 端，纯 JS/wasm
runtime:  python + Pillow                            Python 端，Pi 已有
dev only: vite + react-dom + @vitejs/plugin-react    预览页
dev only: tsx                                        CLI 用，转 JSX
```

## 与 Pi 端 `projects/eink-status` 的关系

不冲突也不替代：

- eink-status 是当前线上跑的 daemon，PIL imperative 绘制 + Waveshare 驱动，事件循环 + tap 处理。
- eink-render 只关心"从数据画一张 PNG"，跟 Pi 端的 service 还没有任何对接。

## 已知 / TODO

- [ ] **真机验证**：远程开发看不见屏幕，先靠 1-bit PNG 看效果
- [x] ~~**性能**：daemon 化~~ → 已做，冷启 ~1.5s + 后续 ~10ms/页
- [x] ~~**状态栏 WiFi 占位**~~ → 未满格画 2×1 底部黑点
- [x] ~~**电源页 ETA 字号**~~ → 13→14 跟电压/电流对齐
- [ ] **接 Pi（路径 A）独立运行**：Pi 装 Node + yoga + 字体，加 `install.sh`，跟 `eink-status` 集成或替换 `render.py`
- [ ] **Web dashboard**：Pi 本机跑一个炫酷面板（实时屏预览 / 历史数据 / 远程切页 / 调参）
