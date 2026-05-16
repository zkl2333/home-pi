/** 天气：城市/天气 + 大温度，高低/体感/湿度 + 更新时间。 */
import { Page, StatusBar } from "../components.jsx";

export default function Weather({ p, ctx }) {
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
