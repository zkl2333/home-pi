/** 日历：月历网格，今日反白块，表头年月 + 今日。 */
import { Page, StatusBar } from "../components.jsx";

export default function Calendar({ p, ctx }) {
  const first = new Date(p.cal_year, p.cal_month - 1, 1);
  const lastDay = new Date(p.cal_year, p.cal_month, 0).getDate();
  const firstWeekday = (first.getDay() + 6) % 7;
  const weeks = [];
  let week = new Array(firstWeekday).fill(0);
  for (let d = 1; d <= lastDay; d++) {
    week.push(d);
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }
  if (week.length) {
    while (week.length < 7) week.push(0);
    weeks.push(week);
  }

  const wdLabels = "一二三四五六日";
  const wdToday = wdLabels[(new Date(p.cal_year, p.cal_month - 1, p.cal_today).getDay() + 6) % 7];

  // 固定列宽，避免 flex:1 因文字宽度不同导致列不等宽
  const COL_W = 34;

  const dayCell = (day, key) => {
    if (day === 0) return <div key={key} style={{ width: COL_W }} />;
    if (day === p.cal_today) {
      return (
        <div
          key={key}
          style={{
            display: "flex",
            width: COL_W,
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              width: 14,
              height: 11,
              background: "#000",
            }}
          >
            <div style={{ fontSize: 10, fontWeight: 700, color: "#fff" }}>{day}</div>
          </div>
        </div>
      );
    }
    return (
      <div
        key={key}
        style={{
          display: "flex",
          width: COL_W,
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <div style={{ fontSize: 10 }}>{day}</div>
      </div>
    );
  };

  return (
    <Page>
      <StatusBar p={p} pageIdx={ctx.pageIdx} pageTotal={ctx.pageTotal} pageName={ctx.pageName} />
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          padding: "2px 6px",
        }}
      >
        <div style={{ display: "flex", fontSize: 12, fontWeight: 700 }}>
          {p.cal_year}年 {p.cal_month}月
        </div>
        <div style={{ display: "flex", flex: 1 }} />
        <div style={{ display: "flex", fontSize: 11 }}>
          今 {p.cal_today}日 周{wdToday}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "row", justifyContent: "center", padding: "0 4px" }}>
        {[...wdLabels].map((lb) => (
          <div
            key={lb}
            style={{
              display: "flex",
              width: COL_W,
              justifyContent: "center",
            }}
          >
            <div style={{ fontSize: 10 }}>{lb}</div>
          </div>
        ))}
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          padding: "0 4px 2px 4px",
          alignItems: "center",
        }}
      >
        {weeks.map((w, wi) => (
          <div key={wi} style={{ display: "flex", flexDirection: "row", flex: 1, alignItems: "center" }}>
            {w.map((d, di) => dayCell(d, di))}
          </div>
        ))}
      </div>
    </Page>
  );
}
