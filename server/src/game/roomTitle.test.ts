import { describe, expect, test } from "vitest";
import { sanitizeRoomTitle } from "./roomTitle";

describe("sanitizeRoomTitle", () => {
  test("trims surrounding whitespace", () => {
    expect(sanitizeRoomTitle("  즐겜방  ")).toBe("즐겜방");
  });

  test("clamps to 20 characters", () => {
    const long = "가".repeat(25);
    expect(sanitizeRoomTitle(long)).toBe("가".repeat(20));
  });

  test("returns an empty string when empty, whitespace-only, or not a string", () => {
    expect(sanitizeRoomTitle("")).toBe("");
    expect(sanitizeRoomTitle("   ")).toBe("");
    expect(sanitizeRoomTitle(undefined)).toBe("");
    expect(sanitizeRoomTitle(42)).toBe("");
    expect(sanitizeRoomTitle(null)).toBe("");
  });
});
