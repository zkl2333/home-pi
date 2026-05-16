/** 新闻：60秒看世界，标题行 + 6 条列表。 */
import { Page, StatusBar } from "../components.jsx";

export default function News({ p, ctx }) {
  const items = (p.news || []).slice(0, 6);
  return (
    <Page>
      <StatusBar p={p} pageIdx={ctx.pageIdx} pageTotal={ctx.pageTotal} pageName={ctx.pageName} />
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          padding: "2px 6px",
          columnGap: 4,
          fontSize: 11,
        }}
      >
        <div>60秒看世界</div>
        {p.news_date && (
          <>
            <div>·</div>
            <div>{p.news_date}</div>
          </>
        )}
      </div>
      <div
        style={{ display: "flex", flexDirection: "column", flex: 1, padding: "0 6px" }}
      >
        {items.map((t, i) => (
          <div key={i} style={{ display: "flex", fontSize: 11, height: 14 }}>
            {i + 1}. {t}
          </div>
        ))}
      </div>
    </Page>
  );
}
