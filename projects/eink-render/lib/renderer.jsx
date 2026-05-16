/**
 * 渲染入口：组装 PAGES、跑 JSX → Yoga → ops → 1-bit PNG。
 *
 * 管线：JSX vnode → vdom-to-ops.js（Yoga 布局 + 精确测量）→ ops JSON
 *      → raster.mjs（FreeType-WASM MONO）→ 灰度 PNG（仅 0/255）。
 *
 * 页面拆分：每页一个 lib/pages/*.jsx，公共组件在 lib/components.jsx。
 * 本文件只负责注册表 + 渲染编排，导出契约（render / PAGES）不变，
 * server.mjs / render.mjs 零改动。
 *
 * PAGES 顺序必须严格对齐 eink-status/remote_render.py 的 PAGE_IDS。
 */
import { vdomToOps } from "./vdom-to-ops.js";
import { renderToPng } from "./raster.mjs";
import { initFt, measure as ftMeasure } from "./ft-mono.mjs";
import { WIDTH, HEIGHT, ICON } from "./components.jsx";
import Overview from "./pages/overview.jsx";
import System from "./pages/system.jsx";
import Power from "./pages/power.jsx";
import Calendar from "./pages/calendar.jsx";
import Weather from "./pages/weather.jsx";
import News from "./pages/news.jsx";

export { WIDTH, HEIGHT, ICON };

// 注入给 Yoga 的精确测量器：与光栅同一 FreeType 引擎，消除 0.55 估算
const exactMeasure = (text, px, family) => ftMeasure(family, px, text);

const FONTS = {
  regular: "fonts/wqy-microhei.ttf",
  "phosphor-fill": "fonts/Phosphor-Fill.ttf",
  phosphor: "fonts/Phosphor.ttf",
  clock: "fonts/archivo-black.ttf", // Overview 时钟数字（Archivo Black, OFL）
};

// ─── 页面注册表（顺序对齐 remote_render.py PAGE_IDS） ──
export const PAGES = [
  { id: "overview", name: "概览", build: Overview },
  { id: "system", name: "系统", build: System },
  { id: "power", name: "电源", build: Power },
  { id: "calendar", name: "日历", build: Calendar },
  { id: "weather", name: "天气", build: Weather },
  { id: "news", name: "新闻", build: News },
];

export function getPage(pageId) {
  const idx = PAGES.findIndex((p) => p.id === pageId);
  return idx >= 0 ? { ...PAGES[idx], idx } : { ...PAGES[0], idx: 0 };
}

export function defaultParams() {
  const now = new Date();
  return {
    time: now.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
    ip: "192.168.31.35",
    hostname: "zero2w",
    uptime: "3天 5时",
    battery: 78,
    state: "放电",
    bat_v: 4.123,
    bat_eta_label: "续航约",
    bat_eta_val: "8时30分",
    rssi: -55,
    rssi_bars: 3,
    temp: 42,
    load: 0.3,
    memUsed: 109,
    memTotal: 426,
    memPercent: 26,
    diskUsed: 3.5,
    diskTotal: 29,
    diskPercent: 12,
    city: "上海",
    cond: "多云",
    temp_c: 22,
    high_c: 24,
    low_c: 18,
    feels_c: 23,
    humidity: 65,
    weather_fresh: "21:30",
    news_date: "2026-05-13",
    news: [
      "AI 大模型再迎里程碑 / 推理成本进一步降低",
      "国际经济观察 / 全球供应链调整",
      "今日多地高温 / 部分地区有雷阵雨",
      "新能源汽车出口同比增长 30%",
      "科技前沿 / 量子计算新进展",
      "体育 / 主队晋级半决赛",
    ],
    cal_year: now.getFullYear(),
    cal_month: now.getMonth() + 1,
    cal_today: now.getDate(),
  };
}

export async function render(params, pageId) {
  const p = { ...defaultParams(), ...(params || {}) };
  const page = getPage(pageId);
  const ctx = { pageIdx: page.idx, pageTotal: PAGES.length, pageName: page.name };

  // ft-mono 须在布局前就绪：Yoga 测量同步回调进 FreeType advance
  await initFt();

  const t0 = performance.now();
  // JSX 组件直接调用为函数，拿原始 vnode（不走 React reconciler）
  const Component = page.build;
  const vnode = <Component p={p} ctx={ctx} />;
  const spec = vdomToOps(vnode, {
    width: WIDTH,
    height: HEIGHT,
    fonts: FONTS,
    measure: exactMeasure,
  });
  const t1 = performance.now();

  const png = await renderToPng(spec);
  const t2 = performance.now();

  return {
    params: p,
    pageId: page.id,
    pageName: page.name,
    png,
    spec,
    timings: {
      layout: +(t1 - t0).toFixed(2),
      raster: +(t2 - t1).toFixed(2),
      total: +(t2 - t0).toFixed(2),
    },
  };
}
