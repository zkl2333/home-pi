/** 概览：巨型时钟为主角，顶栏日期/电量，底栏 IP/温度。 */
import { Page, Txt, Icon, ICON, WifiIcon, BatteryIcon } from "../components.jsx";

export default function Overview({ p }) {
  const now = new Date();
  const dateStr = `${now.getMonth() + 1}月${now.getDate()}日`;
  const weekdays = "日一二三四五六";
  const wdStr = `周${weekdays[now.getDay()]}`;
  const charging = p.state === "充电中";

  return (
    <Page>
      {/* 顶栏：日期 周几 / WiFi 电量 */}
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
          <Txt size={15} weight={700}>{dateStr}</Txt>
          <Txt size={15} weight={700}>{wdStr}</Txt>
        </div>
        <div style={{ display: "flex", flex: 1 }} />
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", columnGap: 5 }}>
          <WifiIcon bars={p.rssi_bars} />
          <Txt size={14} weight={700}>{p.battery}%</Txt>
          <BatteryIcon level={p.battery} charging={charging} />
        </div>
      </div>
      <div style={{ height: 1, background: "#000" }} />

      {/* 中部：巨型时钟（主角） */}
      <div
        style={{
          display: "flex",
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
        }}
      >
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

      {/* 底栏：IP / 温度 */}
      <div style={{ height: 1, background: "#000" }} />
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          height: 26,
          padding: "0 10px",
        }}
      >
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", columnGap: 4 }}>
          <Icon name={ICON.wifiHigh} size={13} />
          <Txt size={14}>{p.ip}</Txt>
        </div>
        <div style={{ display: "flex", flex: 1 }} />
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", columnGap: 4 }}>
          <Icon name={ICON.thermometer} size={15} />
          <Txt size={15} weight={700}>{p.temp}°C</Txt>
        </div>
      </div>
    </Page>
  );
}
