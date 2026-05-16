import { useEffect, useRef, useState } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

const WIDTH = 250;
const HEIGHT = 122;
const POLL_INTERVAL_MS = 10_000;

// ─── 数据钩子 ─────────────────────────────────────────
function usePages() {
  const [pages, setPages] = useState([]);
  useEffect(() => {
    fetch("/api/pages")
      .then((r) => r.json())
      .then((d) => setPages(d.pages || []))
      .catch(() => {});
  }, []);
  return pages;
}

// 拉 Pi 最近的 snapshot；定时轮询
function usePiSnapshot() {
  const [snap, setSnap] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchOnce = async () => {
    try {
      const res = await fetch("/api/snapshot", { cache: "no-store" });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`${res.status} ${txt.slice(0, 200)}`);
      }
      const data = await res.json();
      setSnap(data);
      setError(null);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOnce();
    const t = setInterval(fetchOnce, POLL_INTERVAL_MS);
    return () => clearInterval(t);
  }, []);

  return { snap, error, loading, refresh: fetchOnce };
}

// 给定 params + pages，并发渲染全部
function useRenderAll(params, pages) {
  const [byId, setById] = useState({});
  const reqId = useRef(0);
  useEffect(() => {
    if (!pages.length || !params) return;
    const id = ++reqId.current;
    (async () => {
      const results = await Promise.allSettled(
        pages.map((p) =>
          fetch("/api/render", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ params, pageId: p.id }),
          }).then((r) => r.json()),
        ),
      );
      if (id !== reqId.current) return;
      const map = {};
      pages.forEach((p, i) => {
        const r = results[i];
        if (r.status === "fulfilled" && !r.value?.error) map[p.id] = r.value;
      });
      setById(map);
    })();
  }, [params, pages]);
  return byId;
}

// ─── 工具 ──────────────────────────────────────────────
function fmtAge(ts) {
  if (!ts) return "—";
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h${m % 60}m ago`;
}

function useNow(intervalMs = 1000) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
}

// ─── 组件 ──────────────────────────────────────────────
function PagePreview({ page, png, active, scale = 2 }) {
  const w = WIDTH * scale;
  const h = HEIGHT * scale;
  return (
    <Card className={active ? "ring-2 ring-primary" : ""}>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-sm">
          <span>{page.name}</span>
          {active && <Badge variant="secondary">Pi 当前页</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div
          className="border bg-white overflow-hidden"
          style={{ width: w, height: h }}
        >
          {png ? (
            <img
              src={`data:image/png;base64,${png}`}
              alt={page.name}
              style={{
                width: w,
                height: h,
                imageRendering: "pixelated",
              }}
            />
          ) : (
            <Skeleton style={{ width: w, height: h }} />
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function SnapshotMeta({ snap, error, onRefresh }) {
  useNow(1000);
  if (error) {
    return (
      <Card className="border-destructive">
        <CardHeader>
          <CardTitle className="text-destructive text-sm">Pi 连接失败</CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground space-y-1">
          <div>{error}</div>
          <div>
            preview 通过 vite proxy 拉 <code>/api/snapshot</code>，目标
            <code className="ml-1">PI_RENDER_URL</code> 默认
            <code className="ml-1">http://zero2w.local:8787</code>
          </div>
          <Button size="sm" variant="outline" onClick={onRefresh} className="mt-2">
            重试
          </Button>
        </CardContent>
      </Card>
    );
  }
  if (!snap) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Pi 快照</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-4 w-40" />
        </CardContent>
      </Card>
    );
  }
  const p = snap.params || {};
  const entries = [
    ["time", p.time],
    ["ip", p.ip],
    ["host", p.hostname],
    ["uptime", p.uptime],
    ["battery", `${p.battery}% · ${p.state}`],
    ["bat", p.bat_v != null ? `${p.bat_v}V` : "—"],
    ["wifi", `${p.rssi}dBm (${p.rssi_bars}/4)`],
    ["cpu", `${p.temp}°C · load ${p.load}`],
    ["mem", `${p.memUsed}/${p.memTotal}M (${p.memPercent}%)`],
    ["disk", `${p.diskUsed}/${p.diskTotal}G (${p.diskPercent}%)`],
    ["eta", p.bat_eta_label ? `${p.bat_eta_label} ${p.bat_eta_val}` : "—"],
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-sm">
          <span>Pi 快照</span>
          <div className="flex items-center gap-2 font-normal">
            <Badge variant="outline" className="text-xs">
              {fmtAge(snap.ts)}
            </Badge>
            <Badge variant="secondary" className="text-xs">
              page = {snap.pageId}
            </Badge>
            <Button size="sm" variant="ghost" onClick={onRefresh}>
              刷新
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
          {entries.map(([k, v]) => (
            <div key={k} className="flex items-baseline gap-2">
              <span className="text-muted-foreground w-12">{k}</span>
              <span className="font-mono truncate">{v ?? "—"}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── App ───────────────────────────────────────────────
export default function App() {
  const pages = usePages();
  const { snap, error, loading, refresh } = usePiSnapshot();
  const params = snap?.params ?? null;
  const allByPage = useRenderAll(params, pages);
  const currentPageId = snap?.pageId;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-7xl p-6 flex flex-col gap-6">
        <header className="flex items-baseline justify-between">
          <h1 className="text-xl font-semibold">eink-render preview</h1>
          <div className="text-xs text-muted-foreground">
            数据 + 渲染均来自 Pi eink-render API
          </div>
        </header>

        <SnapshotMeta snap={snap} error={error} onRefresh={refresh} />

        <Separator />

        <div>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm font-medium">6 页全景</h2>
            <span className="text-xs text-muted-foreground">
              250×122 · 2× 放大 · pixelated
            </span>
          </div>
          {loading && !params ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[...Array(6)].map((_, i) => (
                <Skeleton key={i} style={{ width: WIDTH * 2 + 32, height: HEIGHT * 2 + 80 }} />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {pages.map((p) => (
                <PagePreview
                  key={p.id}
                  page={p}
                  png={allByPage[p.id]?.png}
                  active={p.id === currentPageId}
                  scale={2}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
