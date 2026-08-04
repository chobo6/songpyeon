import { db } from "../db/connection";

export type DailyVisitStats = {
  today: number;
  recent: { date: string; count: number }[];
};

// SQLite의 date('now', '+9 hours')로 오늘(KST) 날짜를 구해서 그대로 넘긴다 —
// JS Date로 타임존 계산을 따로 하지 않는다.
export function recordVisit(): void {
  const today = db.prepare(`SELECT date('now', '+9 hours') AS today`).get() as { today: string };
  recordVisitForDate(today.today);
}

// recordVisit()의 실제 로직 — 날짜를 인자로 받아 테스트에서 특정 날짜로
// 고정해 검증할 수 있게 분리해뒀다. 실제 라우트는 항상 recordVisit()을 쓴다.
export function recordVisitForDate(date: string): void {
  db.prepare(
    `INSERT INTO daily_visits (date, count) VALUES (?, 1)
     ON CONFLICT(date) DO UPDATE SET count = count + 1`,
  ).run(date);
}

// 오늘 포함 최근 7일을 오름차순(오래된 날짜 먼저)으로, 데이터 없는 날짜는
// count: 0으로 채워서 항상 정확히 7개를 반환한다 — 호출부(관리자 대시보드)가
// 빈 날짜를 따로 처리할 필요가 없도록.
export function getDailyVisitStats(): DailyVisitStats {
  const todayRow = db.prepare(`SELECT date('now', '+9 hours') AS today`).get() as { today: string };
  const today = todayRow.today;

  const rows = db
    .prepare(`SELECT date, count FROM daily_visits WHERE date >= date(?, '-6 days')`)
    .all(today) as { date: string; count: number }[];
  const byDate = new Map(rows.map((r) => [r.date, r.count]));

  const recent: { date: string; count: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const dateRow = db.prepare(`SELECT date(?, '-' || ? || ' days') AS d`).get(today, i) as { d: string };
    recent.push({ date: dateRow.d, count: byDate.get(dateRow.d) ?? 0 });
  }

  return { today: byDate.get(today) ?? 0, recent };
}

export function _resetForTest(): void {
  db.exec(`DELETE FROM daily_visits`);
}
