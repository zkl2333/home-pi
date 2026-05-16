# eink-render 探索日志

> 这份是 `explore/satori-eink` 分支的复盘文档。记录**为什么是当前架构、怎么走过来的、有哪些死路**——以后看代码"看不懂为什么这样写"时回来翻。

**一句话总结**：想用 CSS flexbox 写 250×122 墨水屏布局，输出真 1-bit PNG。绕了 5 圈才落到「JSX → Yoga → ops JSON → Python PIL FreeType MONO → 1-bit PNG」+ Pi 上 Hono server 提供 HTTP API。

---

## 时间线

| 阶段 | commit | 大事记 |
|---|---|---|
| 1. Satori 起步 | `833801d` | VPS 上 JSX + CSS → Satori → SVG → sharp 1-bit。**真机字模糊**。 |
| 2. 渲染管线 pivot | `6829a15` | 抛弃 Satori 的 SVG 光栅化，引入 Yoga + Python PIL，HTML 字符串模板。 |
| 3. Pi 装 Node.js | `86506d7` | 固化 v22.22.2（armv7l 最后官方 LTS）到 `bootstrap.sh`。 |
| 4. JSX 改造 | `d180c66` | HTML 字符串 → JSX，移除 `satori-html`。 |
| 5. Python daemon 化 | `6e53b6a` | Python 子进程长期保活，单次 400ms → 10ms。 |
| 6. 落地 Pi（代码） | `48421bd` | 搬到 `projects/eink-render/`，加 Hono HTTP server + systemd。 |
| 7. Pi 实际跑通 | `ffcd1c7` | bringup 脚本 + setup-font 三级 fallback，6 页 PNG 真机渲染跟本机像素一致。 |
| 8. Phosphor 图标 | `bdf70a6` | 引入 Phosphor Regular/Fill 字体做页面图标；状态栏保留手绘像素图标（小尺寸更清晰）。 |
| 9. Dashboard 拆分 | `59f64eb` | eink-dashboard 拆为独立项目（纯前端 SPA，proxy 到 Pi API），eink-render 瘦身为纯渲染服务。 |
| 10. eink-status 集成 | `3141446` | render.py → remote_render.py，HTTP 调 eink-render + 3 次重试 + 白屏兜底。 |
| 11. Squash 合并 | `2302f24` | 23 次探索提交压缩为一个 commit 合入 main。 |

---

## 关键决策点

### D1：为什么不能用 Satori → SVG 路线

**Context**：墨水屏只有黑白两种像素（无灰、无 AA），任何中间灰像素都会让"屏看上去脏"——尤其文字。

**试过**：
- Satori → resvg 默认（AA + 后续阈值化）：灰边一堆
- Satori → resvg `shape-rendering: crispEdges`：灰边没了但**小字号笔画消失**
- Satori → 2× supersample + Otsu threshold：缓解但治标不治本
- Pi 端 `PIL.convert('1', dither=NONE)` 保险层：避免双重抖动，但 sharp 输出根本不是真 1-bit

**根因**：Satori 用 opentype.js 读字形轮廓，每个字符是浮点坐标的 Bezier path（实测见 `d="M13.1 11.0L13.1 11.0Q13.1 12.2 12.9 13.2…"`）。任何 SVG 光栅化（librsvg / resvg / Cairo / sharp）在 250×122 像素网格上画这种浮点曲线，**没 hinting 就只能给灰边**——一根 1px 笔画落在 x=10.3 时 70/30 分到相邻两像素。阈值化必死一边或两边模糊。

**结论**：**SVG-rasterize 路线是死结**。文字必须走带 hinting 的字形光栅化器（FreeType MONO 是最自然选择）。

### D2：为什么用 Python PIL 而不是 node-canvas

**Context**：决定走 FreeType 后，FreeType MONO 模式（每像素直接 0/1，自动 hint）是必经之路。Node 端有 `canvas` 包封装 Cairo，能配 `antialias='none'`。

**试过**：
- node-canvas + Cairo MONO：输出确实是 0/255 纯黑白
- 但 **Windows 上 node-canvas 的 fontconfig / Pango 注册不稳定**，dev 预览跟 Pi 实机渲染像素不一致
- node-canvas Cairo 的"硬阈值化"也不如 PIL hint 好看

**结论**：Python PIL `mode='1'` + `ImageDraw.text()` 自动走 FreeType MONO。Pi 上 PIL 现成（eink-status 已经在用），跨平台一致。

### D3：保留 CSS 编写体验 = Yoga 独立布局

**Context**：手写绝对坐标在墨水屏上能搞定，但写起来痛——eink-status 原版 `render.py` 就是 imperative PIL，加一行布局元素都得重排所有坐标。

**方案**：把布局和绘制解耦。
- **布局**：用 Yoga（Facebook flexbox 引擎），跟 React Native 同款，纯 JS/wasm，跨平台
- **绘制**：用 PIL（解决 D2）

**桥接**：自己 walk vnode 树构建 Yoga 节点 → `calculateLayout` 算出每个节点的绝对坐标 → 再 walk 一遍发射 ops JSON（rect/text/ellipse/line/pixels），喂给 Python。

### D4：HTML 字符串 → JSX

**Context**：第一版 pivot 后用 `satori-html` 把 HTML 模板字符串 parse 成 vnode（保留 Satori 时期的编写体验）。但只用了它的 parser，Satori 生态其它都丢了——**纯历史包袱**。

**换 JSX 收益**：
- 零运行时 parse（编译期 `_jsx()` 直接构造对象）
- 字符串插值自动转义（HTML 模板里出现 `<` 会破布局，JSX 不会）
- 跟 `src/App.jsx` 预览面板用一套写法

**代价**：lib/ 加 `react` 这一个 runtime dep（仅 `react/jsx-runtime`，不挂 DOM 不调和不 hooks），CLI 加 `tsx` 做 JSX 转译。`react` 体积小、tsx 不影响 prod 运行（npm install --omit=dev 之后才装 tsx 是 dep 不是 devDep——见 D7）。

### D5：vdom 一次性 normalize 而不是惰性展开

**Context**：JSX 里有三种非 host 节点会让 vdom-to-ops 挂掉：
- 函数组件（`<Page>`、`<StatusBar>`）：`vnode.type` 是函数引用，不是字符串
- Fragment（`<>...</>`）：`vnode.type` 是 Symbol(react.fragment)
- 嵌套数组、`false`、`null`、空字符串

**第一版试过**：在 `buildYogaTree` 和 `emitOps` 各自的 children walker 里调 `expand(vnode)`。

**翻车**：函数组件**每次调用返回新的 vnode 实例**——`buildYogaTree` 给实例 A 写 `__inherited`/`__text`，`emitOps` walk 时拿到的是实例 B，读不到。

**解法**：入口先做一次性 `normalizeTree`，把整棵 JSX 树压成 host-only 树（`type` 全是字符串、`children` 全是扁平数组）。下游 walker 直接读 `vnode.props.children`，稳定可靠。

### D6：Python daemon 化

**Context**：第一版每次 render 都 `spawn` 新的 Python 进程，冷启 ~370ms。Pi 上更慢，且字体每次重新加载。

**方案**：Python 端加 `--daemon` 模式，长期保活；按行读 JSON 请求、length-prefix 写 PNG 响应。
- 请求：一行 JSON + `\n`
- 响应：成功 `OK <len>\n` + len 字节 PNG；失败 `ERR <message>\n`

**字体缓存**：从 `render()` 函数局部抽到模块级 `_DAEMON_FONT_CACHE`，跨请求保活。**key 用 path 而非 name**（避免相同 name 映射到不同字体路径时缓存冲突）。

**实测**（Win Python 3.14）：
- 首张：~1.5s（进程启动 + 字体加载）
- 后续：~10ms/页（layout 2-6ms + PIL 3-7ms）

**Node 端**：`ensureDaemon()` 保活，stdout 解析按状态机走（`header` ↔ `payload`），FIFO 队列对应 in-flight 请求。CLI 单次跑完要 `shutdownPythonDaemon()` 主动关，否则 Node event loop 等不到 stdin 关闭、进程不退。

### D7：tsx 是 dep 不是 devDep

**Context**：Pi 上 `server.mjs` import `renderer.jsx`，必须有 JSX 转译。两条路：
- A. Pi 上跑 `tsx` 实时转译
- B. 开发机预 build 成 .js，Pi 上跑编译产物

**选 A**：B 加一层 build 步骤，devops 复杂度上升，收益（启动稍快、不依赖 tsx）不大。tsx 才几 MB。

**配置**：`tsconfig.json` 设 `"jsx": "react-jsx"` 让 tsx 走 automatic runtime（否则默认 classic 需要 `import React`）。Vite 那边 `@vitejs/plugin-react` 自带 automatic，两边一致。

### D8：dashboard 不上 Pi，部署在内网 Docker

**Context**：Pi Zero 2W 512MB RAM，资源紧。Pi 又要保持"自治"（断网照常刷屏）。

**选项对比**：
| 方案 | 优 | 劣 |
|---|---|---|
| Dashboard 跑 Pi | 真正自治、数据本地 | RAM 紧、SD 卡历史数据有寿命压力 |
| Dashboard 跑 VPS | 资源不愁 | 数据上云、Pi 主动推、跨网络反模式 |
| **Dashboard 跑内网 Docker** | 资源不愁、不依赖外网 | 需要内网另一台机器 |

**用户决策**：内网 Docker，Pi **不依赖** dashboard 运行，dashboard 是"远程工具"性质。**Pi 不存历史数据**——dashboard 想看趋势自己在浏览器内存里存。

**Pi 端接口**：
- `POST /api/render` —— 内部，eink-status 调
- `GET /api/render?page=...` —— dashboard / dev 调，返 PNG
- 数据走独立接口（待 eink-status 实现 HTTP 端点）

### D11：bringup 单独脚本，不直接走 bootstrap.sh

**Context**：CLAUDE.md 约定 `projects/<name>/install.sh` 由 bootstrap.sh 第 7 步自动捡。理论上推到 Pi 后 `bash bootstrap.sh` 即可。

**为啥另起 `scripts/pi-bringup.sh`**：
- 首次部署想**精确控制**：只装 eink-render，不重跑整个 bootstrap（apt update / e-Paper SDK / PiSugar 升级都很慢，且没必要）
- 自带**验证步骤**：health check + curl 拉 6 张 PNG 回本机肉眼对比
- 失败回滚命令打在最后，一键卸载

**关系**：bringup 是开发期工具，bootstrap.sh 是新机一键复盘。bringup 验证过了，下次新 Pi 走 bootstrap.sh 路径会自动包含 eink-render。

### D9：Phosphor 图标字体策略

**Context**：6 页内容需要小图标（WiFi、电池、日历、温度计等），手绘像素图标逐个画太慢。

**试过**：
- Phosphor Fill（实心）：≥14px 看得清，8-12px 在 1-bit 下糊成黑块
- Phosphor Regular（线条）：≥10px 清晰，8px 勉强可用

**结论**：
- 页面内容图标（≥10px）：用 Phosphor Regular 字体，通过 Unicode codepoint 引用
- 状态栏小图标（WiFi 信号、电池电量）：保留手绘像素图标——在 4-8px 级别比任何字体图标都清晰
- Phosphor 字体入库 git（920KB，Pi 无 CDN 下载源）；wqy-microhei 继续 gitignored（9.8MB，setup-font.mjs 三级 fallback）

**约定写入 renderer.jsx**：Regular ≥10px，Fill ≥14px，状态栏用手绘。

### D10：PNG 镜像走 PNG，不传 vdom 树

**用户问**：能不能传 vdom 树（"像 SSR"）让浏览器自己渲染屏幕镜像？

**结论：不行**。
- **大小没省**：vdom JSON ~1.5-2KB；1-bit PNG ~600B 实际，base64 后 ~800B
- **"像不像"差很多**：浏览器 AA / sub-pixel rendering / 字体度量不同，渲染出来跟墨水屏 PIL FreeType MONO 视觉差异很大——不算镜像
- **方案**：dashboard 主显示 PNG（所见即所得），可选附带 vdom 给 dev 调试用

### D12：测量/渲染的单一真相源 —— 三种架构调研

**Context**：anchor 居中修复暴露的根问题：**字体度量被劈成两个不一致的源**。布局在 JS（Yoga），测量靠 `measureText` 拍脑袋（ASCII×0.55）；真正画字在 Python（PIL/FreeType MONO，精确）。所有居中/换行/ellipsis 偏差都源于此。字宽表（含按 fontFamily 标定）治标——对 CJK 等于要枚举几万字，已否决。第一性原理：**测量必须与渲染同源**（浏览器之所以无此问题，是布局引擎直接问字体、且测量与光栅是同一字体同一引擎）。

**三条路：**

1. **单进程·Python 端布局（yoga-py）**：JSX 只作者书写，未布局树序列化给 Python，Python 端 Yoga + measureFunc 直接用正在画字的 FreeType 量。**调研否决**：
   - `pyyoga`/`yoga-python` 要 Python ≥3.10/3.12，Pi 是 3.9.2；且无 armv7l wheel（`yoga-python` 仅 aarch64）。
   - `poga`（唯一 Py 版本可行）：sdist 自带 vendored Yoga（编译不用联网，✓），`YGNodeSetMeasureFunc` 也暴露（✓）——**但 vendored 的是老 Yoga ~1.x，全树无 `gap`/`Gutter`/`columnGap`**（gap 是 Yoga 2.0 才加）。我们每页重度用 gap、JS 端是 yoga-layout 3.2.1。用它＝gap 全失效 + 引入"Python 老 Yoga / JS 新 Yoga"两个版本，反而比字体度量分裂更糟；还要 512MB Pi 上 pybind11 源码编译。

2. **单进程·Node 端绘制（FreeType-in-Node）**：保留 JS Yoga 3.2.1（gap ✓，无 poga 问题），在 Node 里同时做测量（精确 advance）和光栅（MONO），退役 Python/PIL。**调研可行**：
   - 决定性约束：光栅器必须**原生出 hinted 1-bit（FreeType MONO）**。任何 AA→阈值引擎（Skia=`@napi-rs/canvas`、Cairo=`canvas`、`resvg`、`opentype.js`/`fontkit` 轮廓填充）都重演 Satori 小字 CJK 糊的死路——即使 `@napi-rs/canvas` 有 `linux-arm-gnueabihf`(armv7l) 预编译，Skia 文字仍 AA，淘汰。
   - `freetype2`（node-freetype2，N-API，贴近原生 FreeType API）：能 `FT_RENDER_MODE_MONO` + 取精确 advance，与 PIL 同源、单引擎在 Node。代价：原生 addon，需 armv7l 预编译或 Pi 上 node-gyp 编译（apt `libfreetype6-dev`+g++，小 addon、512MB 可行，远轻于 pybind11/Yoga）；跨平台像素一致需验证（但本项目已证 FreeType-MONO Win/Pi 逐像素一致，同源应同）。
   - `freetype-wasm`：纯 WASM（跨平台逐像素一致、零原生编译、可入库不联网），架构上最优；但 v0.0.4、2022 起停滞、API 自述"未暴露全部"、面向 browser/Deno——MONO bitmap/metrics 表面未验证，需 spike/fork。

**结论 / 方向**：单一真相源的优雅解不必"把布局搬去 Python"——可"**把绘制搬来 Node**"：JS Yoga（成熟、有 gap）+ Node 端 FreeType-MONO 同时供测量与光栅，一举消除"测量分裂"和"JS↔Python 序列化缝"，Python/PIL 管线退役。

#### D12 spike 结果（`spike-freetype-wasm/`，仓库根，不在 projects/ 故不部署）

用 stock `freetype-wasm@0.0.4` 在 Node 实测，**架构基本面全绿**：

- **Node 集成**（风险#1解）：ESM 下需 `globalThis.__dirname`+`globalThis.require` 垫片、`pathToFileURL` 动态 import、传 `Module.wasmBinary`。配方有效，启动 ~30ms。
- **真 MONO**（命门，证实）：`FT_LOAD_RENDER|FT_LOAD_TARGET_MONO` 渲出的字形 **alpha 通道严格 0/255、零灰**——真 hinted MONO，非 AA。
- **测量同源**：advance 与 PIL/FreeType **逐数字一致**（Archivo Black @64px：数字 43、冒号 21、合计 193）。
- **端到端**：自写 JS compositor + 零依赖 PNG 编码渲出 crisp "15:04",无糊。
- 集成坑（已解，非阻断）：imagedata 是 `(0,0,0,alpha)`——字形在 **alpha 通道**不是 RGB；imagedata 是 Emscripten 堆视图，**须逐字形立刻拷出**（跨后续 FT 调用会失效）。

**唯一阻断（仅 stock 产物，非方案）**：stock 预编译 .wasm 加载 4.4MB wqy CJK 字体 **`Aborted(OOM)`，且 JS `INITIAL_MEMORY=256MB` 覆盖无效**（非增长构建/内存上限焊死）。CJK 是本项目正文主体 → **stock 包生产不可用**。

**收敛结论**：纯 Node 路（JS Yoga 不动 + FreeType-WASM MONO 供测量+光栅、退役 Python）在每个基本面都成立，唯一阻断是 stock wasm 的 CJK 内存上限——即两轮前已标注的"自编最小 FreeType-WASM"兜底。spike 把它从"可能要"变成"**必须且明确值得**(其余全绿)"。

#### spike#2 结果（自编 FreeType-WASM，CI 实证，`spike2-freetype-wasm/`）

`glue.c`(最小 C 面，直接导出 1-bit buffer) + `build.sh`(emsdk 里 CMake 编 FreeType 2.13.3，砍 zlib/png/harfbuzz/brotli) + `Dockerfile`/CI workflow（`emscripten/emsdk:3.1.74`，commit `c0bf543`，2 轮迭代转绿——第 1 轮 `$0` 相对路径找不到 glue.c，开头抓绝对 SCRIPT_DIR 即修，典型 spike 节奏）。CI(`emscripten/emsdk` 容器)实跑结果：

- **产物**：`freetype-mono.wasm` **589KB**（比 stock 998KB 小 40%），+ 64KB ES6 glue。arch 中立，可入库如字体。
- **Node 启动** ~12ms，干净 ES6 模块。
- **真 MONO**：Archivo Black 与 **wqy CJK 均 `pixel_mode=1`**，crisp 无 AA（产物 PNG 肉眼确认 `15:04` / `晴22°C`）。
- **OOM 阻断消除**：**wqy-microhei.ttc 4.94MB（比原 ttf 更大）`load=0.1ms` 正常**——`-sALLOW_MEMORY_GROWTH=1` 生效，stock 那个唯一阻断没了。
- **测量同源**：advance `'1'=43 ':'=21 合计193`，与 PIL/FreeType **逐数字一致**。
- 直接读 1-bit buffer（`HEAPU8` 按 pitch/MSB-first 解包），spike#1 的 RGBA-alpha + 堆视图失效两个坑从源头消失。

**结论**：纯 Node 路（JS Yoga 不动 + 自编 FreeType-WASM MONO 供测量与光栅、退役 Python/PIL）**端到端实证通过，无遗留阻断**。

#### Pi armv7l 真机实测（最后一个未知数，已落地）

CI 产物 .wasm 推 Pi(`~/spike2-freetype-wasm/`，Node v22.22.2，armv7l)跑 test.mjs，2 次稳定：

- 模块 init ~280–334ms：一次性，常驻 daemon（同现 Python 模式）摊销掉，无关。
- 小字 CJK（wqy 24px）：5 字形 ~7ms（~1.3ms/字形）——正文级别快。
- 大字时钟（Archivo 64px）：5 字形 ~57ms——唯一偏大值，但是 **未缓存首绘最坏情况**；时钟字符集有限（10 数字+冒号）天然可缓存→稳态≈0；且其后紧跟的墨水屏局刷本身数百 ms~秒级，渲染被完全淹没；eink-status 仅分钟/关键字段变化才刷。
- `pixel_mode=1`、advance `43/21/193`、`晴=24…` 与 PIL/CI **逐像素一致**——真机亦成立。

**判定：Pi 性能可接受，无红灯。** 纯 Node 路 = 端到端 + 真机全部验证通过。

#### 迁移落地（2026-05-16，已完成）

- `vendor/freetype-mono.wasm`（589KB，GitHub CI `emscripten/emsdk` 自编，入库）
- `lib/ft-mono.mjs`：wasm 引擎，family→bytes 常驻堆，glyph 缓存（key=family|px|cp），小数 advance
- `lib/raster.mjs`：ops→1-bit 画布→灰度 PNG，复刻 PIL `la/lm/mm` 三 anchor 模式
- `renderer.jsx` 走 `renderToPng`；**`python/`、daemon 管线、`shutdownPythonDaemon`、`RENDER_BACKEND` 回退、`PYTHON_BIN` 全删**
- parity：同 spec vs 旧 Python 仅亚像素 FreeType-hinting 抖动（1-4%，XOR 为纯字形描边，零结构差）；6 页 Pi 真机肉眼与旧版一致
- 文档同步：CLAUDE.md / README / package.json

至此渲染层 = JSX + JS Yoga + 自编 FreeType-WASM MONO，单语言单进程，测量与光栅同源，Python/PIL 彻底退役。eink-status 仍用 PIL 仅作屏驱动 `getbuffer`（与渲染无关）。本条 D12 结。

---

## 踩过的坑

### P1：`satori-html` 在我们场景下是包袱
原本是为了保留 HTML+CSS 编写体验。换 JSX 后这层 parser 是死代码，移除。

### P2：函数组件每次调用返回新实例
JSX 编译后 `<MyComp ... />` 是 `_jsx(MyComp, props)`，运行时 `_jsx` 返回 `{ type: MyComp, props }` 但**不调用** MyComp。两次 walker 各自展开会拿到两个不同实例——`__inherited`/`__text` 挂歪。解法：一次性 normalize 见 D5。

### P3：Windows `python.exe` 是 Store 占位符
`spawn('python', ...)` 在 Windows 上常解析到 `WindowsApps\python.exe`——空可执行，调用静默退出 9009。本机调试必须 `PYTHON_BIN=py` 覆盖。Pi 上 `python` 走系统 python3，无需设置。

### P4：CLI 单次跑完 daemon 留尾巴
Python daemon 是 long-running 子进程，`render.mjs` 单次跑完写完 PNG 后，Node event loop 因为子进程 stdin 还连着不退出。解法：`shutdownPythonDaemon()` 在 finally 里调，主动 kill。

### P5：font cache key 不能只用 name
原来 `(name, size)` 做 key，daemon 模式下如果两次请求传不同 `fonts_map`（相同 name 映射到不同字体路径），缓存会错挂。改成 `(path, size)`。

### P6：Node v24+ 没有 armv7l 官方包
Pi Zero 2W 是 armv7l 32 位。官方在 v24 把 armv7 从 Tier 1 降为 Experimental（[commit 6682861d](https://github.com/nodejs/node/commit/6682861d6f)）、不再发布预编译包。**v22.22.2 是最后一个有官方 armv7l 预编译包的 LTS**。

### P7：Vite dev server 在 Windows 下后台进程不易清理
背景启动的 `vite dev` 在测试结束后不会自动退出，下次 `git mv` 因为文件句柄占用会报 Permission denied。需要按 PID 精确杀掉，**不要** `taskkill /F /IM node.exe`（会误杀其它 node 进程）。

### P8：Pi 上 `github.com:443` 被屏蔽，字体下载会 ETIMEDOUT
首次 bringup 时 `setup-font.mjs` 直接 fetch `github.com/anthonyfok/...` 卡 30s 超时（根目录 CLAUDE.md "已知坑 4" 已记）。解法是三级 fallback：
1. 复用系统 `/usr/share/fonts/truetype/wqy/wqy-microhei.ttc`（bootstrap.sh 第 1 步 apt 装 `fonts-wqy-microhei` 已经提供）
2. `cdn.jsdelivr.net`（Cloudflare 可达）
3. github.com 原站（兜底，主要给开发机用）

**规律**：Pi 上任何依赖直接拉 GitHub 资源的脚本都要按这套兜底逻辑设计，**别假定 github.com 通**。`api.github.com` 走 Cloudflare 可达（authorized_keys 同步用的就是它）。

---

## 当前架构

```
开发机（Windows + git-bash）
   │
   │ scripts/deploy.sh / bootstrap.sh
   ▼
Pi (zero2w.local)
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  eink-status (Python daemon)                             │
│    ├ PiSugar 数据采集                                    │
│    ├ tap 事件（单击/双击/长按）                           │
│    ├ remote_render.py → HTTP POST eink-render            │
│    │   (3 次重试 + 白屏兜底，不会因渲染挂而 crash)        │
│    └ e-Paper 屏驱动                                      │
│                                                         │
│  eink-render (Node + Hono on :8787)                      │
│    │                                                    │
│    ├ POST /api/render  (eink-status 调，传数据回 PNG)    │
│    ├ GET  /api/render?page=...  (dashboard/dev)         │
│    └ Python daemon（stdin 流，长期保活）                  │
│        └ render_ops.py（PIL mode='1' + FreeType MONO）   │
│                                                         │
└─────────────────────────────────────────────────────────┘
   ▲
   │ HTTP（内网，Vite proxy / 可选反代）
   │
内网 Docker 主机（或开发机 npm run dev）
┌─────────────────────────────────────────────────────────┐
│  eink-dashboard (projects/eink-dashboard/, 同仓库)       │
│    ├ React + Vite + Tailwind + shadcn SPA                │
│    ├ /api/* proxy → Pi:8787                              │
│    └ 6 页 PNG 实时预览（Pi 不依赖它运行）                  │
└─────────────────────────────────────────────────────────┘
```

## 渲染管线（细化）

```
JSX 模板（lib/renderer.jsx 的 Overview/System/... 组件）
   ↓  React 自动运行时（_jsx 构造 { type, props }，不挂 DOM、不 reconcile）
vnode 树（含函数组件 + Fragment + 嵌套数组）
   ↓  lib/vdom-to-ops.js : normalizeTree()
host-only 树（type 全是字符串、children 扁平数组）
   ↓  buildYogaTree() : Yoga useWebDefaults + flexbox 子集
Yoga 树 + calculateLayout()
   ↓  emitOps() : walk 第二遍
ops JSON ({op:rect/text/ellipse/line/pixels, x,y,...})
   ↓  stdin 一行 JSON
Python daemon (render_ops.py daemon_loop())
   ↓  PIL Image.new('1', ...) + ImageDraw + FreeType MONO
1-bit PNG (mode='P' 2-color palette, extrema 严格 (0,255))
   ↓  HTTP body / stdout
消费者（eink-status / dashboard）
```

## Pi 实测（首次 bringup）

代码搞定后的第一次真机部署。**没动 eink-status、没推屏**——eink-render server 被动 listen，靠从开发机 `curl http://127.0.0.1:8787/api/render?page=...` 拉 PNG 回本机肉眼验证。

### 流程（`scripts/pi-bringup.sh <ip>` 自动跑）
1. ssh 检查 node v22.22.2 / python 3.9.2 / eink-status 仍 active
2. `tar` 推 `projects/eink-render/` 到 Pi（排除 `node_modules` / `output-*.png`，Phosphor 字体随代码一起推）
3. Pi 上 `install.sh`：
   - 字体三级 fallback（P8）→ 复用系统 ttc，秒过
   - `npm install --omit=dev` → 11 包，12 秒
   - 装 systemd unit → enable + start
4. 健康检查：`/api/health` 一次就过
5. curl 6 张 PNG 拉回本机

### 跨平台一致性
开发机（Windows + Python 3.14）渲染的 PNG 跟 Pi（armv7l + Python 3.9.2）渲染的 PNG **逐像素一致**——FreeType MONO 跨平台 hint 一致、Yoga 布局一致、wqy-microhei 字体度量一致。这是 D2「PIL 是必经之路」选择的关键回报：dev/prod 不会出"开发机好看上屏花"的惊喜。

PNG 大小（Pi 上）：

| 页 | 大小 |
|---|---|
| overview | 1152 B |
| system | 987 B |
| power | 849 B |
| calendar | 1003 B |
| weather | 769 B |
| news | 1679 B |

### 资源占用（Pi 上 systemd 视角）
- Main PID: `npm exec tsx server.mjs`
- Tasks: 43（npm → tsx → Node → Python daemon → 几个 worker thread）
- CPU 累计（启动 + 6 次渲染）: ~13s 钟级
- 内存：未到 `MemoryMax=180M` 上限。具体数字待长跑后再补
- 启动到 ready: ~2s（systemd "Started" 到 `/api/health` 200）

### 还没做的
- 长跑观察（一晚 / 一天）看内存泄漏、Python daemon 是否会死
- 完整覆盖 bootstrap.sh 第 7 步路径（理论上 bringup 验证过，bootstrap 也会过；新机重装时再验证）
- eink-dashboard 部署到 Docker 主机（Dockerfile + docker-compose）

## 性能数据

测试环境：Windows Python 3.14 + Node 22。Pi Zero 2W 可能比这慢 2-3 倍但量级一致。

| 阶段 | 冷启（首张） | 热路径（后续） |
|---|---|---|
| JSX → vnode（_jsx） | <1ms | <1ms |
| normalize | <1ms | <1ms |
| Yoga 布局 | 15-20ms | 2-6ms |
| emitOps | <1ms | <1ms |
| Python 进程启动 + PIL import + 字体加载 | ~1.4s | 0（daemon 复用） |
| PIL 绘制 + PNG 编码 | ~10ms | 3-7ms |
| **total** | **~1.5s** | **6-13ms** |

输出 PNG 大小：~600-1200B（取决于内容复杂度）。

---

## 待办 / 未来方向

| 状态 | 任务 | 备注 |
|---|---|---|
| ✅ | **eink-status 调 eink-render** | remote_render.py，HTTP POST + 3 次重试 + 白屏兜底 |
| ✅ | **Dashboard 拆分** | projects/eink-dashboard/，同仓库独立项目，proxy 到 Pi API |
| ✅ | **Phosphor 图标集成** | Regular/Fill 字体入库，状态栏保留手绘像素图标 |
| ✅ | **Squash 合并到 main** | 23 次探索提交 → 1 个 commit (`2302f24`) |
| 🔵 | **eink-dashboard Docker 部署** | Dockerfile + docker-compose，部署到内网 Docker 主机 |
| ⚪ | tap 长按软关机带 goodbye 画面 | eink-status 已有 tap 路由，只是 action map 未填 |
| ⚪ | 真机 PNG 跟浏览器渲染 diff 工具 | dashboard 上加"高亮像素差异"模式 |
| ⚪ | 更多页面模板 | Docker 容器列表 / 自定义信息 |

## 不会走回头路的几条死路

- ❌ **再用 Satori 光栅化**：浮点 Bezier 无 hinting，墨水屏小字必糊
- ❌ **再用 node-canvas**：Windows fontconfig 不稳，跨平台一致性差
- ❌ **Node 端 AA 光栅器（Skia=`@napi-rs/canvas` / Cairo / `resvg` / opentype.js 轮廓填充）**：文字 AA→阈值化＝Satori 小字 CJK 糊的同一死路。Node 绘制只走 FreeType-MONO（`freetype2` / `freetype-wasm`），见 D12
- ❌ **再用 satori-html**：JSX 后唯一收益是"能解析 HTML 字符串"，不需要
- ❌ **`pisugar-server-py` 0.1.1**：库本身的事件解析 bug 没修，PiSugar TCP 协议处理不当（详见根目录 CLAUDE.md "已知坑" 第 2 条）
- ❌ **Web dashboard 跑 Pi**：违反"Pi 自治、dashboard 是可选远程工具"的设计
- ❌ **dashboard 缓存历史数据**：用户明确说不存历史，浏览器内存够
- ❌ **Phosphor Fill 做小图标**：Fill 变体在 1-bit 下 <14px 糊成黑块，Regular（线条）≥10px 清晰
- ❌ **Phosphor 替换状态栏图标**：WiFi 信号 / 电池电量在 4-8px 级别，手绘像素图标比任何字体图标都清晰

## 参考

- 根目录 [`CLAUDE.md`](../../CLAUDE.md) "eink-render（生产渲染管线）" 章节有简化版
- `lib/vdom-to-ops.js` 顶部注释列了支持的 CSS 子集
- `python/render_ops.py` 顶部注释列了支持的 ops 类型
- `server.mjs` 顶部注释列了 HTTP API
