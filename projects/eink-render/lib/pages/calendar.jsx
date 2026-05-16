/** 日历：月历网格，今日反白块，表头年月 + 今日。 */
import { StdPage, Txt, Icon, ICON } from "../components.jsx";

const COL_W = 34;

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

  const dayCell = (day, key) => {
    if (day === 0) return <div key={key} style={{ display: "flex", width: COL_W }} />;
    const isToday = day === p.cal_today;
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
        {isToday ? (
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              width: 15,
              height: 12,
              background: "#000",
            }}
          >
            <Txt size={10} weight={700} color="#fff">{day}</Txt>
          </div>
        ) : (
          <Txt size={10}>{day}</Txt>
        )}
      </div>
    );
  };

  return (
    <StdPage p={p} ctx={ctx} bodyPad="2px 4px" gap={1}>
      {/* 表头：年月 / 今日 */}
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", columnGap: 4 }}>
        <Icon name={ICON.calendarBlank} size={12} />
        <Txt size={12} weight={700}>{p.cal_year}年 {p.cal_month}月</Txt>
        <div style={{ display: "flex", flex: 1 }} />
        <Txt size={11}>今 {p.cal_today}日 周{wdToday}</Txt>
      </div>
      <div style={{ height: 1, background: "#000" }} />

      {/* 周标签 */}
      <div style={{ display: "flex", flexDirection: "row", justifyContent: "center" }}>
        {[...wdLabels].map((lb) => (
          <div key={lb} style={{ display: "flex", width: COL_W, justifyContent: "center" }}>
            <Txt size={9}>{lb}</Txt>
          </div>
        ))}
      </div>

      {/* 日期网格 */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          alignItems: "center",
        }}
      >
        {weeks.map((w, wi) => (
          <div
            key={wi}
            style={{ display: "flex", flexDirection: "row", flex: 1, alignItems: "center" }}
          >
            {w.map((d, di) => dayCell(d, di))}
          </div>
        ))}
      </div>
    </StdPage>
  );
}
