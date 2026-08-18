import { describe, expect, test } from "vitest";
import { sequenceLengthForRound } from "./sequenceLength";

describe("sequenceLengthForRound", () => {
  test("round 1 starts at 3 rows (18 buttons)", () => {
    expect(sequenceLengthForRound(1)).toBe(18);
  });

  test("round 10 is still the first tier (18 buttons)", () => {
    expect(sequenceLengthForRound(10)).toBe(18);
  });

  test("round 11 grows by one row (24 buttons)", () => {
    expect(sequenceLengthForRound(11)).toBe(24);
  });

  test("round 21 grows by another row (30 buttons)", () => {
    expect(sequenceLengthForRound(21)).toBe(30);
  });

  test("a custom startingRows overrides the default (2 rows = 12 buttons at round 1)", () => {
    expect(sequenceLengthForRound(1, 2)).toBe(12);
  });

  test("a custom startingRows still grows by one row every 10 rounds", () => {
    expect(sequenceLengthForRound(11, 4)).toBe(30); // 4행 시작 + 1행 = 5행 * 6
  });
});
