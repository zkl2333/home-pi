/** 电源：大电量 + 横向电量条 + 电压/续航卡（电流已删，见已知坑 #9）。 */
import { StdPage, Card, Stat, BatteryBar, Txt, Icon, ICON } from "../components.jsx";

export default function Power({ p, ctx }) {
  const batPct = Math.max(0, Math.min(100, p.battery ?? 0));
  const v = p.bat_v != null ? Number(p.bat_v).toFixed(3) : "-";
  const charging = p.state === "充电中";
  const stateIcon = charging ? ICON.batteryCharging : ICON.lightning;

  return (
    <StdPage p={p} ctx={ctx} gap={4}>
      {/* 顶部：超大电量 % + 状态 */}
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center" }}>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "flex-end" }}>
          <Txt size={40} weight={700}>{batPct}</Txt>
          <Txt size={18} weight={700} mt={-4}>%</Txt>
        </div>
        <div style={{ display: "flex", flex: 1 }} />
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", rowGap: 2 }}>
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", columnGap: 3 }}>
            <Icon name={stateIcon} size={13} />
            <Txt size={13} weight={700}>{p.state}</Txt>
          </div>
          {p.bat_eta_val && <Txt size={10}>{p.bat_eta_label} {p.bat_eta_val}</Txt>}
        </div>
      </div>

      {/* 横向电量条 */}
      <BatteryBar level={batPct} />

      {/* 卡片：电压 / 续航 */}
      <div style={{ display: "flex", flexDirection: "row", columnGap: 4, flex: 1 }}>
        <Card grow>
          <Stat icon={ICON.plug} label="电压" value={v} unit="V" valueSize={18} />
        </Card>
        <Card grow>
          <Stat
            icon={ICON.clock}
            label={p.bat_eta_label || "状态"}
            value={p.bat_eta_val || p.state}
            valueSize={p.bat_eta_val ? 18 : 15}
          />
        </Card>
      </div>
    </StdPage>
  );
}
