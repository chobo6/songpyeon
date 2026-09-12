import { describe, expect, test } from "vitest";
import { isHotTime } from "./hotTime";

// 아래 UTC 시각들은 전부 KST(UTC+9)로 환산해 주석에 실제 KST 요일/시각을 적어둠.
describe("isHotTime", () => {
  test("토요일 22:59 KST -> false (핫타임 시작 전)", () => {
    expect(isHotTime(new Date("2026-09-12T13:59:00Z"))).toBe(false);
  });

  test("토요일 23:00 KST -> true (핫타임 시작)", () => {
    expect(isHotTime(new Date("2026-09-12T14:00:00Z"))).toBe(true);
  });

  test("토요일 23:59 KST -> true (핫타임 끝나기 직전)", () => {
    expect(isHotTime(new Date("2026-09-12T14:59:00Z"))).toBe(true);
  });

  test("일요일 00:00 KST -> false (자정 넘어가면 핫타임 아님, 날짜 경계 검증)", () => {
    expect(isHotTime(new Date("2026-09-12T15:00:00Z"))).toBe(false);
  });

  test("일요일 23:30 KST -> true", () => {
    expect(isHotTime(new Date("2026-09-13T14:30:00Z"))).toBe(true);
  });

  test("금요일 23:30 KST -> false (평일)", () => {
    expect(isHotTime(new Date("2026-09-11T14:30:00Z"))).toBe(false);
  });

  test("월요일 23:30 KST -> false (평일)", () => {
    expect(isHotTime(new Date("2026-09-14T14:30:00Z"))).toBe(false);
  });
});
