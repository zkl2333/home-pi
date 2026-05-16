/**
 * 公共组件 + 常量。被 lib/pages/*.jsx 与 lib/renderer.jsx 共享。
 *
 * 渲染约束（来自 vdom-to-ops.js）：
 * - 只有 host element；函数组件被立即展开，不写 hooks。
 * - CSS 子集：flex / 黑白 / borderColor+borderWidth（直角四边）。
 *   不支持圆角卡片（borderRadius 仅 ≤16px 当圆点）、阴影、渐变、absolute。
 * - text-as-leaf 陷阱：同一节点既有文字又有 flex 容器 props 会被当 leaf。
 *   故所有文字都包到「纯文本叶子 div」里。
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
  mapPin: "",
  memory: "",
};

// ─── 文字叶子：规避 text-as-leaf 陷阱 ────────────────
export const Txt = ({ children, size, weight, family, color, mt }) => (
  <div
    style={{
      display: "flex",
      fontSize: size,
      fontWeight: weight,
      fontFamily: family,
      color,
      marginTop: mt,
    }}
  >
    {children}
  </div>
);

// ─── 分隔线 ────────────────────────────────────────
export const HR = ({ m }) => (
  <div style={{ height: 1, background: "#000", marginTop: m, marginBottom: m }} />
);
export const VR = () => <div style={{ width: 1, background: "#000" }} />;

// ─── Phosphor 图标 ──────────────────────────────────
export const Icon = ({ name, size = 12, color, fill }) => (
  <div
    style={{
      display: "flex",
      fontFamily: fill ? "phosphor-fill" : "phosphor",
      fontSize: size,
      color: color || "#000",
    }}
  >
    {name}
  </div>
);

// ─── 手绘像素图标（状态栏专用，1-bit 小尺寸更锐利） ──
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

const Dot = ({ filled }) =>
  filled ? (
    <div style={{ display: "flex", width: 5, height: 5, background: "#000" }} />
  ) : (
    <div style={{ display: "flex", width: 5, height: 5, borderColor: "#000", borderWidth: 1 }} />
  );

// 横向电量条（Power 页主视觉，撑充实度）
export const BatteryBar = ({ level }) => {
  const pct = Math.max(0, Math.min(100, level ?? 0));
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        height: 12,
        borderColor: "#000",
        borderWidth: 1,
        padding: 1,
        alignItems: "center",
      }}
    >
      <div style={{ display: "flex", width: `${pct}%`, height: 8, background: "#000" }} />
    </div>
  );
};

// ─── 卡片：直角描边分区（圆角不支持，用 1px 黑边还原参考图分区感） ──
export const Card = ({ children, grow, dir = "column", pad = 4, gap }) => (
  <div
    style={{
      display: "flex",
      flexDirection: dir,
      flex: grow ? 1 : undefined,
      borderColor: "#000",
      borderWidth: 1,
      padding: pad,
      rowGap: dir === "column" ? gap : undefined,
      columnGap: dir === "row" ? gap : undefined,
    }}
  >
    {children}
  </div>
);

// ─── Stat：图标 + 大数字 + 小标签（参考图核心信息单元） ──
export const Stat = ({ icon, iconFill, label, value, unit, valueSize = 20 }) => (
  <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", columnGap: 3 }}>
      {icon && <Icon name={icon} size={iconFill ? 11 : 10} fill={iconFill} />}
      <Txt size={9}>{label}</Txt>
    </div>
    <div style={{ display: "flex", flexDirection: "row", alignItems: "flex-end", columnGap: 2 }}>
      <Txt size={valueSize} weight={700}>{value}</Txt>
      {unit && <Txt size={10} mt={-1}>{unit}</Txt>}
    </div>
  </div>
);

// 进度条（内存/磁盘用）
export const Bar = ({ pct }) => (
  <div style={{ display: "flex", height: 3, borderColor: "#000", borderWidth: 1 }}>
    <div style={{ display: "flex", width: `${Math.min(100, pct)}%`, background: "#000" }} />
  </div>
);

// ─── 卡片标题行：图标 + 标题 + 右侧次要信息（参考图 To-Do/World Clock 头） ──
export const CardHead = ({ icon, iconFill, title, right }) => (
  <div
    style={{
      display: "flex",
      flexDirection: "row",
      alignItems: "center",
      columnGap: 4,
      paddingBottom: 2,
    }}
  >
    {icon && <Icon name={icon} size={iconFill ? 14 : 11} fill={iconFill} />}
    <Txt size={12} weight={700}>{title}</Txt>
    <div style={{ display: "flex", flex: 1 }} />
    {right != null && <Txt size={11}>{right}</Txt>}
  </div>
);

// ─── 状态栏（非 overview 各页共用顶栏） ───────────────
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
        <Txt size={14} weight={700}>{p.time}</Txt>
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
          {pageName && <Txt size={12}>{pageName}</Txt>}
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
          <Txt size={12} weight={700}>{p.battery}%</Txt>
          <BatteryIcon level={p.battery} charging={p.state === "充电中"} />
        </div>
      </div>
      <div style={{ height: 1, background: "#000" }} />
    </>
  );
}

// ─── 页面外壳 ──────────────────────────────────────
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

// 状态栏 + body 的常规页布局（body 撑满剩余空间）
export const StdPage = ({ p, ctx, children, bodyPad = "3px 5px", gap = 4 }) => (
  <Page>
    <StatusBar p={p} pageIdx={ctx.pageIdx} pageTotal={ctx.pageTotal} pageName={ctx.pageName} />
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        padding: bodyPad,
        rowGap: gap,
      }}
    >
      {children}
    </div>
  </Page>
);
