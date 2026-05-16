/** 电源：大电量 + 状态/ETA，底部单列电压（电流已删，见已知坑 #9）。 */
import { Page, StatusBar, Icon, ICON } from "../components.jsx";

export default function Power({ p, ctx }) {
  const batPct = Math.max(0, Math.min(100, p.battery ?? 0));
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
      {/* 底部：电压（展开全宽） */}
      <div style={{ display: "flex", flexDirection: "column", flex: 1, padding: "4px 6px" }}>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", columnGap: 2 }}>
          <Icon name={ICON.plug} size={10} />
          <div style={{ display: "flex", fontSize: 10 }}>电压</div>
        </div>
        <div style={{ display: "flex", fontSize: 20, fontWeight: 700 }}>{v}</div>
      </div>
    </Page>
  );
}
