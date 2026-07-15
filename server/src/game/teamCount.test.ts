import { describe, expect, test } from "vitest";
import { sanitizeTeamCount } from "./teamCount";

describe("sanitizeTeamCount", () => {
  test("accepts valid counts 1-3", () => {
    expect(sanitizeTeamCount(1)).toBe(1);
    expect(sanitizeTeamCount(2)).toBe(2);
    expect(sanitizeTeamCount(3)).toBe(3);
  });

  test("defaults to 2 for missing/invalid input", () => {
    expect(sanitizeTeamCount(undefined)).toBe(2);
    expect(sanitizeTeamCount("banana")).toBe(2);
    expect(sanitizeTeamCount(null)).toBe(2);
  });

  test("clamps out-of-range counts to the default", () => {
    expect(sanitizeTeamCount(0)).toBe(2);
    expect(sanitizeTeamCount(4)).toBe(2);
    expect(sanitizeTeamCount(-1)).toBe(2);
  });

  test("rounds non-integer input", () => {
    expect(sanitizeTeamCount(2.4)).toBe(2);
    expect(sanitizeTeamCount(2.6)).toBe(3);
  });
});
