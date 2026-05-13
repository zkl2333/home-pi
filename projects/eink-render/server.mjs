/**
 * eink-render HTTP server —— 跑在 Pi 上，提供渲染 API。
 *
 * 内部职责：把 JSX → 1-bit PNG，长期保活 Python daemon，零 cold-start。
 *
 * API（最小版）：
 *   GET  /api/health                  → "ok"
 *   GET  /api/pages                   → { pages: [{ id, name }, ...] }
 *   POST /api/render                  → image/png    body: { pageId, params? }
 *     给 eink-status 调，传数据回 PNG。每次调用同时缓存 params。
 *   GET  /api/render?page=overview    → image/png
 *     给 dashboard / 本地 dev 调，用 defaultParams 渲染。
 *   GET  /api/snapshot                → { ts, pageId, params } | 503
 *     最近一次 eink-status POST 上来的真实 params。dev preview 拉这个替代 mock。
 *
 * 监听：默认 127.0.0.1:8787（PORT / HOST 可覆盖）。
 *   绑本地是默认安全选项，外部暴露走反向代理 / SSH tunnel。
 */
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { render, PAGES, shutdownPythonDaemon } from "./lib/renderer.jsx";

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 8787);

// 缓存最近一次 eink-status POST 过来的 params（带 ts + 当前 pageId），
// /api/snapshot 暴露给开发预览拉真实数据，告别手填 mock。
let lastSnapshot = null; // { ts, pageId, params }

const app = new Hono();

app.get("/api/health", (c) => c.text("ok"));

app.get("/api/pages", (c) =>
  c.json({ pages: PAGES.map((p) => ({ id: p.id, name: p.name })) }),
);

app.get("/api/snapshot", (c) => {
  if (!lastSnapshot) {
    return c.json({ error: "no snapshot yet" }, 503);
  }
  return c.json(lastSnapshot);
});

// POST /api/render —— 内部接口：eink-status 传当前数据回 PNG
app.post("/api/render", async (c) => {
  let body;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "expect JSON body" }, 400);
  }
  const { pageId, params } = body || {};
  if (!pageId || !PAGES.some((p) => p.id === pageId)) {
    return c.json({ error: `unknown pageId: ${pageId}` }, 400);
  }
  try {
    const out = await render(params, pageId);
    // 记录最近一次真实 params 供 /api/snapshot 输出
    if (params) {
      lastSnapshot = { ts: Date.now(), pageId, params };
    }
    return new Response(out.png, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "X-Render-Timings": JSON.stringify(out.timings),
      },
    });
  } catch (err) {
    return c.json({ error: String(err?.message || err) }, 500);
  }
});

// GET /api/render?page=overview —— dev / dashboard 用，defaultParams 渲染
app.get("/api/render", async (c) => {
  const pageId = c.req.query("page") || "overview";
  if (!PAGES.some((p) => p.id === pageId)) {
    return c.json({ error: `unknown page: ${pageId}` }, 400);
  }
  try {
    const out = await render(undefined, pageId);
    return new Response(out.png, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "X-Render-Timings": JSON.stringify(out.timings),
      },
    });
  } catch (err) {
    return c.json({ error: String(err?.message || err) }, 500);
  }
});

// ─── 启动 + 优雅退出 ──────────────────────────────────
const server = serve({ fetch: app.fetch, hostname: HOST, port: PORT });
console.log(`eink-render listening on http://${HOST}:${PORT}`);

const shutdown = (signal) => {
  console.log(`\n[${signal}] shutting down...`);
  try {
    server.close();
  } catch {}
  shutdownPythonDaemon();
  // 给 stdout 一点时间 flush
  setTimeout(() => process.exit(0), 100);
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
