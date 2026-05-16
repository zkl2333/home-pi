/** 天气：大温度 + 天气图标 + 高/低/体感/湿度 2×2 卡格。 */
import { StdPage, Card, Stat, Txt, Icon, ICON } from "../components.jsx";

// 中文天气词 → Phosphor 图标
function condIcon(cond = "") {
  if (cond.includes("雷")) return ICON.cloudLightning;
  if (cond.includes("雪")) return ICON.cloudSnow;
  if (cond.includes("雨")) return ICON.cloudRain;
  if (cond.includes("雾") || cond.includes("霾")) return ICON.cloudFog;
  if (cond.includes("阴") || cond.includes("云")) return ICON.cloud;
  return ICON.sun;
}

export default function Weather({ p, ctx }) {
  return (
    <StdPage p={p} ctx={ctx} gap={4}>
      {/* 顶部：城市/天气 + 大温度 + 天气图标 */}
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center" }}>
        <div style={{ display: "flex", flexDirection: "column", flex: 1, rowGap: 3 }}>
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", columnGap: 3 }}>
            <Icon name={ICON.mapPin} size={11} />
            <Txt size={14} weight={700}>{p.city}</Txt>
          </div>
          <Txt size={12}>{p.cond}</Txt>
        </div>
        <Icon name={condIcon(p.cond)} size={30} />
        <div style={{ display: "flex", flexDirection: "row", alignItems: "flex-start", marginLeft: 4 }}>
          <Txt size={36} weight={700}>{p.temp_c}</Txt>
          <Txt size={16} weight={700} mt={2}>°</Txt>
        </div>
      </div>

      {/* 2×2 卡格：高/低/体感/湿度 */}
      <div style={{ display: "flex", flexDirection: "row", columnGap: 4, flex: 1 }}>
        <Card grow>
          <Stat icon={ICON.arrowUp} label="最高 / 最低" value={`${p.high_c}° / ${p.low_c}°`} valueSize={15} />
        </Card>
        <Card grow>
          <Stat icon={ICON.thermometer} label="体感" value={`${p.feels_c}°`} valueSize={18} />
        </Card>
        <Card grow>
          <Stat icon={ICON.drop} label="湿度" value={`${p.humidity}%`} valueSize={18} />
        </Card>
      </div>

      {/* 更新时间 */}
      <div style={{ display: "flex", flexDirection: "row", justifyContent: "flex-end" }}>
        <Txt size={9}>更新 {p.weather_fresh}</Txt>
      </div>
    </StdPage>
  );
}
