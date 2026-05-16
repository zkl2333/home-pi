/** 概览：巨型时钟为主角，顶栏日期/电量，底栏 IP/温度。 */
import { Page, Icon, ICON, WifiIcon, BatteryIcon } from "../components.jsx";

export default function Overview({ p }) {
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
