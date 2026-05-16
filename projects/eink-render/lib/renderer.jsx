/**
 * 唯一渲染管线：JSX vnode → Yoga 布局 → ops JSON → Python PIL → 1-bit PNG。
 *
 * 设计要点：
 * - 编写体验：JSX + camelCase 内联 style（CSS flexbox 子集）
 * - 布局：Yoga（useWebDefaults，flexDirection 默认 row）
 * - 渲染：PIL mode='1' + FreeType MONO，文字 hint 到像素网格 → 像素艺术
 * - 输出：真 2-color palette PNG，PIL/e-ink 一脉相承（pi 端 eink-status 同款）
 *
 * JSX 走 React 自动运行时（automatic runtime）：编译期转 `react/jsx-runtime`，
 * 运行时只是构造 `{ type, props }` 对象，不调和、不 reconcile，不挂 DOM。
 */
import path from "node:path";
import { spawn } from "node:child_process";
import { vdomToOps } from "./vdom-to-ops.js";

export const WIDTH = 250;
export const HEIGHT = 122;
const SB_H = 22;

const PYTHON_SCRIPT = path.resolve("python/render_ops.py");
const FONTS = {
  regular: "fonts/wqy-microhei.ttf",
  "phosphor-fill": "fonts/Phosphor-Fill.ttf",
  phosphor: "fonts/Phosphor.ttf",
  clock: "fonts/archivo-black.ttf", // Overview 时钟数字（Archivo Black, OFL）
};
// 本机 Windows 上 `python` 常是 Store 占位符（静默退出 9009）；用 PYTHON_BIN=py 覆盖。
// Pi 上 `python` 走系统 python3，无需设置。
const PYTHON_BIN = process.env.PYTHON_BIN || "python";

// ─── Python daemon（守 stdin 流，消除每次 ~370ms 子进程冷启） ────────────────
// 协议见 python/render_ops.py daemon_loop() 注释：
//   请求：一行 JSON + \n
//   响应：成功 "OK <len>\n" + len 字节 PNG；失败 "ERR <message>\n"
// 单线程串行：同一时刻只有一个 in-flight 请求（队列 FIFO）。
let daemonProc = null;
let daemonQueue = []; // 每项 { resolve, reject } —— 等响应的回调
let daemonState = "idle"; // "idle" | "header" | "payload"
let headerBuf = Buffer.alloc(0);
let payloadChunks = [];
let payloadRemaining = 0;

function ensureDaemon() {
  if (daemonProc && daemonProc.exitCode === null && !daemonProc.killed) return daemonProc;
  daemonProc = spawn(PYTHON_BIN, [PYTHON_SCRIPT, "--daemon"], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  daemonState = "header";
  headerBuf = Buffer.alloc(0);
  payloadChunks = [];
  payloadRemaining = 0;

  daemonProc.stdout.on("data", handleStdoutChunk);
  daemonProc.stderr.on("data", (c) => {
    process.stderr.write(`[py daemon] ${c}`);
  });
  daemonProc.on("error", (err) => {
    rejectAll(err);
    daemonProc = null;
  });
  daemonProc.on("exit", (code, signal) => {
    rejectAll(new Error(`python daemon exited code=${code} signal=${signal}`));
    daemonProc = null;
  });
  // 父进程退出兜底
  process.once("exit", () => {
    try {
      daemonProc?.kill();
    } catch {}
  });
  return daemonProc;
}

function rejectAll(err) {
  const q = daemonQueue;
  daemonQueue = [];
  for (const { reject } of q) reject(err);
}

function handleStdoutChunk(chunk) {
  let buf = chunk;
  while (buf.length > 0) {
    if (daemonState === "header") {
      const nl = buf.indexOf(0x0a); // '\n'
      if (nl < 0) {
        headerBuf = Buffer.concat([headerBuf, buf]);
        return;
      }
      headerBuf = Buffer.concat([headerBuf, buf.subarray(0, nl)]);
      buf = buf.subarray(nl + 1);
      const header = headerBuf.toString("ascii");
      headerBuf = Buffer.alloc(0);

      if (header.startsWith("OK ")) {
        payloadRemaining = parseInt(header.slice(3), 10);
        if (!Number.isFinite(payloadRemaining) || payloadRemaining < 0) {
          rejectAll(new Error(`bad daemon header: ${header}`));
          try { daemonProc?.kill(); } catch {}
          return;
        }
        if (payloadRemaining === 0) {
          // 空 PNG：理论不会发生，但兜底
          const job = daemonQueue.shift();
          job?.resolve(Buffer.alloc(0));
          daemonState = "header";
        } else {
          daemonState = "payload";
        }
      } else if (header.startsWith("ERR ")) {
        const job = daemonQueue.shift();
        job?.reject(new Error(`python: ${header.slice(4)}`));
        daemonState = "header";
      } else {
        rejectAll(new Error(`bad daemon header: ${header}`));
        try { daemonProc?.kill(); } catch {}
        return;
      }
    } else if (daemonState === "payload") {
      const take = Math.min(payloadRemaining, buf.length);
      payloadChunks.push(buf.subarray(0, take));
      buf = buf.subarray(take);
      payloadRemaining -= take;
      if (payloadRemaining === 0) {
        const png = Buffer.concat(payloadChunks);
        payloadChunks = [];
        const job = daemonQueue.shift();
        job?.resolve(png);
        daemonState = "header";
      }
    }
  }
}

function pyRender(spec) {
  return new Promise((resolve, reject) => {
    const proc = ensureDaemon();
    daemonQueue.push({ resolve, reject });
    proc.stdin.write(JSON.stringify(spec) + "\n");
  });
}

// 提供给上层在 SIGINT / 测试后清理用
export function shutdownPythonDaemon() {
  if (daemonProc) {
    try { daemonProc.stdin.end(); } catch {}
    try { daemonProc.kill(); } catch {}
    daemonProc = null;
  }
}

// ─── Phosphor 图标 ──────────────────────────────────
// 尺寸约定（1-bit FreeType MONO 下的可辨认阈值）：
//   Phosphor Regular（描边）：最小 10px，推荐 12px+
//   Phosphor Fill（填充）：最小 14px，小于此糊成黑块
//   状态栏 WiFi/电池/闪电：用手绘像素图，不走字体
export const ICON = {
  batteryCharging: "",
  batteryEmpty: "",
  batteryFull: "",
  batteryHigh: "",
  batteryLow: "",
  batteryMedium: "",
  wifiHigh: "",
  wifiLow: "",
  wifiMedium: "",
  wifiNone: "",
  sun: "",
  moon: "",
  cloud: "",
  cloudRain: "",
  cloudSnow: "",
  cloudLightning: "",
  cloudFog: "",
  thermometer: "",
  wind: "",
  drop: "",
  clock: "",
  cpu: "",
  hardDrive: "",
  calendarBlank: "",
  newspaper: "",
  lightning: "",
  plug: "",
  arrowUp: "",
  arrowDown: "",
  gauge: "",
  trendUp: "",
  trendDown: "",
  house: "",
  gear: "",
  bell: "",
  warning: "",
  checkCircle: "",
  info: "",
  power: "",
  eye: "",
  snowflake: "",
  umbrella: "",
};

const Icon = ({ name, size = 12, color, fill }) => (
  <div style={{ fontFamily: fill ? "phosphor-fill" : "phosphor", fontSize: size, color: color || "#000" }}>{name}</div>
);

// ─── 共用片段 ──────────────────────────────────────

// 5×8 Z 字闪电（像素图，状态栏专用）
const ZBOLT_ROWS = [
  [3, 3], [2, 3], [1, 2], [0, 3],
  [1, 4], [2, 3], [1, 2], [0, 1],
];
const Zbolt = () => (
  <div style={{ display: "flex", flexDirection: "column", flexShrink: 0, width: 5, height: 8 }}>
    {ZBOLT_ROWS.map(([x1, x2], i) => {
      const left = x1;
      const w = x2 - x1 + 1;
      return (
        <div key={i} style={{ display: "flex", flexDirection: "row", width: 5, height: 1 }}>
          {left > 0 && <div style={{ display: "flex", width: left, height: 1 }} />}
          <div style={{ display: "flex", width: w, height: 1, background: "#000" }} />
        </div>
      );
    })}
  </div>
);

// 4 格 WiFi 信号（像素图，状态栏专用）
const WifiIcon = ({ bars }) => (
  <div style={{ display: "flex", alignItems: "flex-end", columnGap: 1, flexShrink: 0 }}>
    {[3, 5, 7, 9].map((h, i) => (
      <div
        key={i}
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-end",
          width: 2,
          height: h,
        }}
      >
        <div style={{ width: 2, height: i < bars ? h : 1, background: "#000" }} />
      </div>
    ))}
  </div>
);

// 电池胶囊（像素图，状态栏专用）
const BatteryIcon = ({ level, charging }) => {
  const pct = Math.max(0, Math.min(100, level ?? 0));
  const innerW = Math.round(pct * 0.22);
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", flexShrink: 0 }}>
      <div
        style={{
          display: "flex",
          width: 26,
          height: 12,
          borderColor: "#000",
          borderWidth: 1,
          padding: 1,
          justifyContent: charging ? "center" : "flex-start",
          alignItems: "center",
        }}
      >
        {charging ? (
          <Zbolt />
        ) : (
          <div style={{ display: "flex", width: innerW, height: 8, background: "#000" }} />
        )}
      </div>
      <div style={{ display: "flex", width: 2, height: 6, background: "#000", marginLeft: 1 }} />
    </div>
  );
};

const Dot = ({ filled }) =>
  filled ? (
    <div style={{ display: "flex", width: 5, height: 5, background: "#000" }} />
  ) : (
    <div style={{ display: "flex", width: 5, height: 5, borderColor: "#000", borderWidth: 1 }} />
  );

function StatusBar({ p, pageIdx, pageTotal, pageName }) {
  return (
    <>
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          height: SB_H,
          padding: "0 6px",
        }}
      >
        <div style={{ display: "flex", fontSize: 14, fontWeight: 700, flexShrink: 0 }}>{p.time}</div>
        <div
          style={{
            display: "flex",
            flex: 1,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            columnGap: 4,
            marginTop: 1,
          }}
        >
          {Array.from({ length: pageTotal }, (_, i) => (
            <Dot key={i} filled={i === pageIdx} />
          ))}
          {pageName && (
            <div style={{ display: "flex", fontSize: 12, marginLeft: 2 }}>{pageName}</div>
          )}
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            columnGap: 4,
            flexShrink: 0,
          }}
        >
          <WifiIcon bars={p.rssi_bars} />
          <div style={{ display: "flex", fontSize: 12, fontWeight: 700 }}>{p.battery}%</div>
          <BatteryIcon level={p.battery} charging={p.state === "充电中"} />
        </div>
      </div>
      <div style={{ height: 1, background: "#000" }} />
    </>
  );
}

const Page = ({ children }) => (
  <div
    style={{
      display: "flex",
      flexDirection: "column",
      width: WIDTH,
      height: HEIGHT,
      background: "#fff",
    }}
  >
    {children}
  </div>
);

// ─── 各页 ────────────────────────────────────────────
function Overview({ p, ctx }) {
  const now = new Date();
  const dateStr = `${now.getMonth() + 1}月${now.getDate()}日`;
  const weekdays = "日一二三四五六";
  const wdStr = `周${weekdays[now.getDay()]}`;
  const charging = p.state === "充电中";

  return (
    <Page>
      {/* 顶部状态行：日期周几 / WiFi · 电量 */}
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          height: 26,
          padding: "0 10px",
        }}
      >
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", columnGap: 6 }}>
          <div style={{ display: "flex", fontSize: 15, fontWeight: 700 }}>{dateStr}</div>
          <div style={{ display: "flex", fontSize: 15, fontWeight: 700 }}>{wdStr}</div>
        </div>
        <div style={{ display: "flex", flex: 1 }} />
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", columnGap: 5 }}>
          <WifiIcon bars={p.rssi_bars} />
          <div style={{ display: "flex", fontSize: 14, fontWeight: 700 }}>{p.battery}%</div>
          <BatteryIcon level={p.battery} charging={charging} />
        </div>
      </div>

      {/* 中部：巨型时钟（主角） */}
      <div style={{ display: "flex", flex: 1, justifyContent: "center", alignItems: "center" }}>
        <div
          style={{
            display: "flex",
            fontFamily: "clock",
            fontSize: 64,
            fontWeight: 700,
            textAlign: "center",
          }}
        >
          {p.time}
        </div>
      </div>

      {/* 底部状态行：IP / 温度 */}
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          height: 26,
          padding: "0 10px",
        }}
      >
        <div style={{ display: "flex", fontSize: 14 }}>{p.ip}</div>
        <div style={{ display: "flex", flex: 1 }} />
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", columnGap: 4 }}>
          <Icon name={ICON.thermometer} size={15} />
          <div style={{ display: "flex", fontSize: 15, fontWeight: 700 }}>{p.temp}°C</div>
        </div>
      </div>
    </Page>
  );
}

function System({ p, ctx }) {
  const mem = `${p.memUsed}/${p.memTotal}M`;
  const disk = `${p.diskUsed}/${p.diskTotal}G`;

  return (
    <Page>
      <StatusBar p={p} pageIdx={ctx.pageIdx} pageTotal={ctx.pageTotal} pageName={ctx.pageName} />
      {/* 第一行：温度 + 负载 大字 */}
      <div style={{ display: "flex", flexDirection: "row", padding: "2px 6px", columnGap: 6 }}>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", flex: 1, columnGap: 3 }}>
          <Icon name={ICON.thermometer} size={14} />
          <div style={{ display: "flex", fontSize: 22, fontWeight: 700 }}>{p.temp}°</div>
        </div>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", flex: 1, columnGap: 3 }}>
          <Icon name={ICON.gauge} size={14} />
          <div style={{ display: "flex", fontSize: 22, fontWeight: 700 }}>{Number(p.load).toFixed(2)}</div>
        </div>
      </div>
      <div style={{ height: 1, background: "#000" }} />
      {/* 第二行：内存 + 磁盘，带进度条 */}
      <div style={{ display: "flex", flexDirection: "row", flex: 1, padding: "2px 6px", columnGap: 8 }}>
        <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", columnGap: 2 }}>
            <Icon name={ICON.cpu} size={10} />
            <div style={{ display: "flex", fontSize: 10 }}>内存 {mem}</div>
          </div>
          <div style={{ display: "flex", fontSize: 20, fontWeight: 700 }}>{p.memPercent}%</div>
          <div style={{ display: "flex", height: 3, borderColor: "#000", borderWidth: 1 }}>
            <div style={{ display: "flex", width: `${Math.min(100, p.memPercent)}%`, background: "#000" }} />
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", columnGap: 2 }}>
            <Icon name={ICON.hardDrive} size={10} />
            <div style={{ display: "flex", fontSize: 10 }}>磁盘 {disk}</div>
          </div>
          <div style={{ display: "flex", fontSize: 20, fontWeight: 700 }}>{p.diskPercent}%</div>
          <div style={{ display: "flex", height: 3, borderColor: "#000", borderWidth: 1 }}>
            <div style={{ display: "flex", width: `${Math.min(100, p.diskPercent)}%`, background: "#000" }} />
          </div>
        </div>
      </div>
      <div style={{ height: 1, background: "#000" }} />
      {/* 底栏 */}
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          height: 12,
          padding: "0 6px",
          columnGap: 3,
          fontSize: 9,
        }}
      >
        <Icon name={ICON.clock} size={8} />
        <div>{p.uptime}</div>
        <div style={{ display: "flex", flex: 1 }} />
        <Icon name={ICON.wifiHigh} size={8} />
        <div>{p.rssi}dBm</div>
        <div style={{ display: "flex", flex: 1 }} />
        <div>{p.ip}</div>
      </div>
    </Page>
  );
}

function Power({ p, ctx }) {
  const batPct = Math.max(0, Math.min(100, p.battery ?? 0));
  const ma = p.bat_i != null ? `${p.bat_i > 0 ? "+" : ""}${Number(p.bat_i).toFixed(0)}mA` : "-";
  const v = p.bat_v != null ? `${Number(p.bat_v).toFixed(3)}V` : "-";
  const charging = p.state === "充电中";
  const stateIcon = charging ? ICON.batteryCharging : ICON.lightning;

  return (
    <Page>
      <StatusBar p={p} pageIdx={ctx.pageIdx} pageTotal={ctx.pageTotal} pageName={ctx.pageName} />
      {/* 顶部：大电量 + 状态 */}
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          padding: "4px 6px 0 6px",
        }}
      >
        <div style={{ display: "flex", fontSize: 32, fontWeight: 700 }}>{batPct}</div>
        <div style={{ display: "flex", fontSize: 16, fontWeight: 700, marginTop: 8 }}>%</div>
        <div style={{ display: "flex", flex: 1 }} />
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", rowGap: 1 }}>
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", columnGap: 2 }}>
            <Icon name={stateIcon} size={12} />
            <div style={{ display: "flex", fontSize: 12, fontWeight: 700 }}>{p.state}</div>
          </div>
          {p.bat_eta_val && (
            <div style={{ display: "flex", fontSize: 10 }}>
              {p.bat_eta_label} {p.bat_eta_val}
            </div>
          )}
        </div>
      </div>
      <div style={{ height: 1, background: "#000" }} />
      {/* 底部：电压 | 电流，两列对称 */}
      <div style={{ display: "flex", flexDirection: "row", flex: 1 }}>
        <div style={{ display: "flex", flexDirection: "column", flex: 1, padding: "2px 6px" }}>
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", columnGap: 2 }}>
            <Icon name={ICON.plug} size={10} />
            <div style={{ display: "flex", fontSize: 10 }}>电压</div>
          </div>
          <div style={{ display: "flex", fontSize: 18, fontWeight: 700 }}>{v}</div>
        </div>
        <div style={{ width: 1, background: "#000" }} />
        <div style={{ display: "flex", flexDirection: "column", flex: 1, padding: "2px 6px" }}>
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", columnGap: 2 }}>
            <Icon name={ICON.lightning} size={10} />
            <div style={{ display: "flex", fontSize: 10 }}>电流</div>
          </div>
          <div style={{ display: "flex", fontSize: 18, fontWeight: 700 }}>{ma}</div>
        </div>
      </div>
    </Page>
  );
}

function Calendar({ p, ctx }) {
  const first = new Date(p.cal_year, p.cal_month - 1, 1);
  const lastDay = new Date(p.cal_year, p.cal_month, 0).getDate();
  const firstWeekday = (first.getDay() + 6) % 7;
  const weeks = [];
  let week = new Array(firstWeekday).fill(0);
  for (let d = 1; d <= lastDay; d++) {
    week.push(d);
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }
  if (week.length) {
    while (week.length < 7) week.push(0);
    weeks.push(week);
  }

  const wdLabels = "一二三四五六日";
  const wdToday = wdLabels[(new Date(p.cal_year, p.cal_month - 1, p.cal_today).getDay() + 6) % 7];

  // 固定列宽，避免 flex:1 因文字宽度不同导致列不等宽
  const COL_W = 34;

  const dayCell = (day, key) => {
    if (day === 0) return <div key={key} style={{ width: COL_W }} />;
    if (day === p.cal_today) {
      return (
        <div
          key={key}
          style={{
            display: "flex",
            width: COL_W,
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              width: 14,
              height: 11,
              background: "#000",
            }}
          >
            <div style={{ fontSize: 10, fontWeight: 700, color: "#fff" }}>{day}</div>
          </div>
        </div>
      );
    }
    return (
      <div
        key={key}
        style={{
          display: "flex",
          width: COL_W,
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <div style={{ fontSize: 10 }}>{day}</div>
      </div>
    );
  };

  return (
    <Page>
      <StatusBar p={p} pageIdx={ctx.pageIdx} pageTotal={ctx.pageTotal} pageName={ctx.pageName} />
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          padding: "2px 6px",
        }}
      >
        <div style={{ display: "flex", fontSize: 12, fontWeight: 700 }}>
          {p.cal_year}年 {p.cal_month}月
        </div>
        <div style={{ display: "flex", flex: 1 }} />
        <div style={{ display: "flex", fontSize: 11 }}>
          今 {p.cal_today}日 周{wdToday}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "row", justifyContent: "center", padding: "0 4px" }}>
        {[...wdLabels].map((lb) => (
          <div
            key={lb}
            style={{
              display: "flex",
              width: COL_W,
              justifyContent: "center",
            }}
          >
            <div style={{ fontSize: 10 }}>{lb}</div>
          </div>
        ))}
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          padding: "0 4px 2px 4px",
          alignItems: "center",
        }}
      >
        {weeks.map((w, wi) => (
          <div key={wi} style={{ display: "flex", flexDirection: "row", flex: 1, alignItems: "center" }}>
            {w.map((d, di) => dayCell(d, di))}
          </div>
        ))}
      </div>
    </Page>
  );
}

function Weather({ p, ctx }) {
  return (
    <Page>
      <StatusBar p={p} pageIdx={ctx.pageIdx} pageTotal={ctx.pageTotal} pageName={ctx.pageName} />
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          flex: 1,
          padding: "2px 6px",
          alignItems: "flex-start",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", flex: 1, rowGap: 4 }}>
          <div style={{ display: "flex", fontSize: 14, fontWeight: 700 }}>{p.city}</div>
          <div style={{ display: "flex", fontSize: 13 }}>{p.cond}</div>
        </div>
        <div style={{ display: "flex", fontSize: 32, fontWeight: 700 }}>{p.temp_c}°</div>
      </div>
      <div style={{ height: 1, background: "#000" }} />
      <div style={{ display: "flex", flexDirection: "row", padding: "3px 6px", fontSize: 11 }}>
        <div>
          高{p.high_c}° 低{p.low_c}°  体感{p.feels_c}°  湿{p.humidity}%
        </div>
      </div>
      <div
        style={{ display: "flex", flexDirection: "row", justifyContent: "flex-end", padding: "0 6px" }}
      >
        <div style={{ display: "flex", fontSize: 10 }}>{p.weather_fresh}</div>
      </div>
    </Page>
  );
}

function News({ p, ctx }) {
  const items = (p.news || []).slice(0, 6);
  return (
    <Page>
      <StatusBar p={p} pageIdx={ctx.pageIdx} pageTotal={ctx.pageTotal} pageName={ctx.pageName} />
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          padding: "2px 6px",
          columnGap: 4,
          fontSize: 11,
        }}
      >
        <div>60秒看世界</div>
        {p.news_date && (
          <>
            <div>·</div>
            <div>{p.news_date}</div>
          </>
        )}
      </div>
      <div
        style={{ display: "flex", flexDirection: "column", flex: 1, padding: "0 6px" }}
      >
        {items.map((t, i) => (
          <div key={i} style={{ display: "flex", fontSize: 11, height: 14 }}>
            {i + 1}. {t}
          </div>
        ))}
      </div>
    </Page>
  );
}

// ─── 页面注册表 ──────────────────────────────────────
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
    bat_i: -150,
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

  const t0 = performance.now();
  // JSX 组件直接调用为函数，拿原始 vnode（不走 React reconciler）
  const Component = page.build;
  const vnode = <Component p={p} ctx={ctx} />;
  const spec = vdomToOps(vnode, { width: WIDTH, height: HEIGHT, fonts: FONTS });
  const t1 = performance.now();

  const png = await pyRender(spec);
  const t2 = performance.now();

  return {
    params: p,
    pageId: page.id,
    pageName: page.name,
    png,
    spec,
    timings: {
      layout: +(t1 - t0).toFixed(2),
      pil: +(t2 - t1).toFixed(2),
      total: +(t2 - t0).toFixed(2),
    },
  };
}
