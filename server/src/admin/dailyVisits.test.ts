import { beforeEach, describe, expect, test } from "vitest";
import { db } from "../db/connection";
import { _resetForTest, getDailyVisitStats, recordVisitForDate } from "./dailyVisits";

describe("dailyVisits", () => {
  beforeEach(() => {
    _resetForTest();
  });

  test("the same logged-in user visiting twice on the same date is only counted once", () => {
    recordVisitForDate("2026-08-05", 42, "1.2.3.4");
    recordVisitForDate("2026-08-05", 42, "5.6.7.8"); // IP가 바뀌어도 userId로 식별되므로 여전히 같은 사람

    const stats = getDailyVisitStats();
    expect(stats.recent.find((r) => r.date === "2026-08-05")?.count).toBe(1);
  });

  test("the same anonymous IP visiting twice on the same date is only counted once", () => {
    recordVisitForDate("2026-08-05", undefined, "9.9.9.9");
    recordVisitForDate("2026-08-05", undefined, "9.9.9.9");

    const stats = getDailyVisitStats();
    expect(stats.recent.find((r) => r.date === "2026-08-05")?.count).toBe(1);
  });

  test("two different logged-in users on the same date count as 2", () => {
    recordVisitForDate("2026-08-05", 1, "1.1.1.1");
    recordVisitForDate("2026-08-05", 2, "1.1.1.1"); // 같은 IP라도 userId가 다르면 다른 사람

    const stats = getDailyVisitStats();
    expect(stats.recent.find((r) => r.date === "2026-08-05")?.count).toBe(2);
  });

  test("two different anonymous IPs on the same date count as 2", () => {
    recordVisitForDate("2026-08-05", undefined, "1.1.1.1");
    recordVisitForDate("2026-08-05", undefined, "2.2.2.2");

    const stats = getDailyVisitStats();
    expect(stats.recent.find((r) => r.date === "2026-08-05")?.count).toBe(2);
  });

  test("a logged-in user and an anonymous visitor on the same date count as 2", () => {
    recordVisitForDate("2026-08-05", 1, "1.1.1.1");
    recordVisitForDate("2026-08-05", undefined, "2.2.2.2");

    const stats = getDailyVisitStats();
    expect(stats.recent.find((r) => r.date === "2026-08-05")?.count).toBe(2);
  });

  test("the same user is counted separately on different dates", () => {
    recordVisitForDate("2026-08-04", 42, "1.2.3.4");
    recordVisitForDate("2026-08-05", 42, "1.2.3.4");

    const stats = getDailyVisitStats();
    expect(stats.recent.find((r) => r.date === "2026-08-04")?.count).toBe(1);
    expect(stats.recent.find((r) => r.date === "2026-08-05")?.count).toBe(1);
  });

  test("getDailyVisitStats.recent always returns exactly 7 entries, filling missing dates with count 0", () => {
    recordVisitForDate("2026-08-05", 1, "1.1.1.1");

    const stats = getDailyVisitStats();
    expect(stats.recent).toHaveLength(7);
    expect(stats.recent.every((r) => typeof r.count === "number")).toBe(true);
  });

  test("getDailyVisitStats.recent is sorted by date ascending, oldest first", () => {
    recordVisitForDate("2026-08-01", 1, "1.1.1.1");
    recordVisitForDate("2026-08-05", 2, "1.1.1.1");

    const stats = getDailyVisitStats();
    const dates = stats.recent.map((r) => r.date);
    expect(dates).toEqual([...dates].sort());
  });

  test("prunes visits older than the 90-day retention window on write", () => {
    const today = "2026-08-05";
    const ninetyOneDaysAgo = "2026-05-06"; // 2026-08-05 기준 91일 전 — date('2026-08-05', '-90 days') = '2026-05-07'보다 이전이라 정리 대상

    recordVisitForDate(ninetyOneDaysAgo, 1, "1.1.1.1");
    recordVisitForDate(today, 2, "2.2.2.2"); // 이 쓰기가 위 옛날 행을 정리한다

    // getDailyVisitStats()는 최근 7일로 범위를 고정해서 조회하므로, 정리가
    // 실제로 일어났는지(단순히 화면에 안 보이는 것과는 다름)는 raw 테이블을
    // 직접 봐야 확인할 수 있다.
    const remaining = db.prepare(`SELECT date FROM daily_visit_log WHERE date = ?`).all(ninetyOneDaysAgo);
    expect(remaining).toHaveLength(0);

    const stats = getDailyVisitStats();
    expect(stats.recent.find((r) => r.date === today)?.count).toBe(1);
  });
});
