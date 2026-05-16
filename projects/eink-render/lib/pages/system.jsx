/** 系统：温度/负载大字 + 内存/磁盘进度条 + 底栏 uptime/rssi/ip。 */
import { Page, StatusBar, Icon, ICON } from "../components.jsx";

export default function System({ p, ctx }) {
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
