import { beforeEach, describe, expect, test } from "vitest";
import { _resetForTest, getDailyVisitStats, recordVisitForDate } from "./dailyVisits";

describe("dailyVisits", () => {
  beforeEach(() => {
    _resetForTest();
  });

  test("recordVisitForDate creates a new row with count 1 for a fresh date", () => {
    recordVisitForDate("2026-08-04");

    const stats = getDailyVisitStats();
    const row = stats.recent.find((r) => r.date === "2026-08-04");
    expect(row?.count).toBe(1);
  });

  test("recordVisitForDate accumulates count on repeated calls for the same date", () => {
    recordVisitForDate("2026-08-04");
    recordVisitForDate("2026-08-04");
    recordVisitForDate("2026-08-04");

    const stats = getDailyVisitStats();
    const row = stats.recent.find((r) => r.date === "2026-08-04");
    expect(row?.count).toBe(3);
  });

  test("different dates get separate rows", () => {
    recordVisitForDate("2026-08-03");
    recordVisitForDate("2026-08-04");
    recordVisitForDate("2026-08-04");

    const stats = getDailyVisitStats();
    expect(stats.recent.find((r) => r.date === "2026-08-03")?.count).toBe(1);
    expect(stats.recent.find((r) => r.date === "2026-08-04")?.count).toBe(2);
  });

  test("getDailyVisitStats.recent always returns exactly 7 entries, filling missing dates with count 0", () => {
    recordVisitForDate("2026-08-04");

    const stats = getDailyVisitStats();
    expect(stats.recent).toHaveLength(7);
    expect(stats.recent.every((r) => typeof r.count === "number")).toBe(true);
  });

  test("getDailyVisitStats.recent is sorted by date ascending, oldest first", () => {
    recordVisitForDate("2026-08-01");
    recordVisitForDate("2026-08-04");

    const stats = getDailyVisitStats();
    const dates = stats.recent.map((r) => r.date);
    expect(dates).toEqual([...dates].sort());
  });
});
