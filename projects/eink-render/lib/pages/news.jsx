/** 新闻：60秒看世界，序号反白块 + 标题列表。 */
import { StdPage, Txt, Icon, ICON } from "../components.jsx";

export default function News({ p, ctx }) {
  const items = (p.news || []).slice(0, 6);
  return (
    <StdPage p={p} ctx={ctx} bodyPad="2px 6px" gap={2}>
      {/* 标题栏 */}
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", columnGap: 4 }}>
        <Icon name={ICON.newspaper} size={12} />
        <Txt size={12} weight={700}>60秒看世界</Txt>
        <div style={{ display: "flex", flex: 1 }} />
        {p.news_date && <Txt size={10}>{p.news_date}</Txt>}
      </div>
      <div style={{ height: 1, background: "#000" }} />

      {/* 列表 */}
      <div style={{ display: "flex", flexDirection: "column", flex: 1, rowGap: 2 }}>
        {items.map((t, i) => (
          <div
            key={i}
            style={{ display: "flex", flexDirection: "row", alignItems: "center", columnGap: 4 }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                width: 11,
                height: 11,
                background: "#000",
                flexShrink: 0,
              }}
            >
              <Txt size={8} weight={700} color="#fff">{i + 1}</Txt>
            </div>
            <Txt size={11}>{t}</Txt>
          </div>
        ))}
      </div>
    </StdPage>
  );
}
