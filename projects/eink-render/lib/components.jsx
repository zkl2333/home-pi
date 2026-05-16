/**
 * 公共组件 + 常量。被 lib/pages/*.jsx 与 lib/renderer.jsx 共享。
 *
 * 仅做文件拆分，不引入额外抽象：组件与旧单文件 renderer.jsx 逐字一致，
 * 各页布局行为与重构前的稳定版完全相同（卡片化美化已回退）。
 *
 * 渲染约束（来自 vdom-to-ops.js）：
 * - 只有 host element；函数组件被立即展开，不写 hooks。
 * - CSS 子集：flex / 黑白 / borderColor+borderWidth（直角四边）。
 * - text-as-leaf 陷阱：同一节点既有文字又有 flex 容器 props 会被当 leaf。
 */

export const WIDTH = 250;
export const HEIGHT = 122;
export const SB_H = 22;

// ─── Phosphor 图标码点 ──────────────────────────────
// 尺寸约定：Regular（描边）≥10px；Fill（填充）≥14px；
// 状态栏 WiFi/电池/闪电用手绘像素图，不走字体。
export const ICON = {
  batteryCharging: "",
  batteryEmpty: "",
  batteryFull: "",
  batteryHigh: "",
  batteryLow: "",
  batteryMedium: "",
  wifiHigh: "",
  wifiLow: "",
  wifiMedium: "",
  wifiNone: "",
  sun: "",
  moon: "",
  cloud: "",
  cloudRain: "",
  cloudSnow: "",
  cloudLightning: "",
  cloudFog: "",
  thermometer: "",
  wind: "",
  drop: "",
  clock: "",
  cpu: "",
  hardDrive: "",
  calendarBlank: "",
  newspaper: "",
  lightning: "",
  plug: "",
  arrowUp: "",
  arrowDown: "",
  gauge: "",
  trendUp: "",
  trendDown: "",
  house: "",
  gear: "",
  bell: "",
  warning: "",
  checkCircle: "",
  info: "",
  power: "",
  eye: "",
  snowflake: "",
  umbrella: "",
};

export const Icon = ({ name, size = 12, color, fill }) => (
  <div style={{ fontFamily: fill ? "phosphor-fill" : "phosphor", fontSize: size, color: color || "#000" }}>{name}</div>
);

// ─── 共用片段 ──────────────────────────────────────

// 5×8 Z 字闪电（像素图，状态栏专用）
const ZBOLT_ROWS = [
  [3, 3], [2, 3], [1, 2], [0, 3],
  [1, 4], [2, 3], [1, 2], [0, 1],
];
export const Zbolt = () => (
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
export const WifiIcon = ({ bars }) => (
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
export const BatteryIcon = ({ level, charging }) => {
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

export const Dot = ({ filled }) =>
  filled ? (
    <div style={{ display: "flex", width: 5, height: 5, background: "#000" }} />
  ) : (
    <div style={{ display: "flex", width: 5, height: 5, borderColor: "#000", borderWidth: 1 }} />
  );

export function StatusBar({ p, pageIdx, pageTotal, pageName }) {
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

export const Page = ({ children }) => (
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
