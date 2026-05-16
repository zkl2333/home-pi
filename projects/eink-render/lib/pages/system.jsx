/** 系统：2×2 卡片网格（温度/负载/内存/磁盘）+ 底栏 uptime/rssi/ip。 */
import { StdPage, Card, Stat, Bar, Txt, Icon, ICON } from "../components.jsx";

export default function System({ p, ctx }) {
  const memPct = Math.min(100, p.memPercent);
  const diskPct = Math.min(100, p.diskPercent);

  return (
    <StdPage p={p} ctx={ctx} gap={3}>
      {/* 行1：温度 / 负载 */}
      <div style={{ display: "flex", flexDirection: "row", columnGap: 4, flex: 1 }}>
        <Card grow>
          <Stat icon={ICON.thermometer} label="CPU 温度" value={`${p.temp}°`} valueSize={22} />
        </Card>
        <Card grow>
          <Stat icon={ICON.gauge} label="负载" value={Number(p.load).toFixed(2)} valueSize={22} />
        </Card>
      </div>

      {/* 行2：内存 / 磁盘（带进度条） */}
      <div style={{ display: "flex", flexDirection: "row", columnGap: 4, flex: 1 }}>
        <Card grow gap={2}>
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", columnGap: 3 }}>
            <Icon name={ICON.memory} size={10} />
            <Txt size={9}>内存 {p.memUsed}/{p.memTotal}M</Txt>
          </div>
          <Txt size={17} weight={700}>{p.memPercent}%</Txt>
          <Bar pct={memPct} />
        </Card>
        <Card grow gap={2}>
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", columnGap: 3 }}>
            <Icon name={ICON.hardDrive} size={10} />
            <Txt size={9}>磁盘 {p.diskUsed}/{p.diskTotal}G</Txt>
          </div>
          <Txt size={17} weight={700}>{p.diskPercent}%</Txt>
          <Bar pct={diskPct} />
        </Card>
      </div>

      {/* 底栏：uptime / rssi / ip */}
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          columnGap: 4,
        }}
      >
        <Icon name={ICON.clock} size={9} />
        <Txt size={9}>{p.uptime}</Txt>
        <div style={{ display: "flex", flex: 1 }} />
        <Icon name={ICON.wifiHigh} size={9} />
        <Txt size={9}>{p.rssi}dBm</Txt>
        <div style={{ display: "flex", flex: 1 }} />
        <Txt size={9}>{p.ip}</Txt>
      </div>
    </StdPage>
  );
}
