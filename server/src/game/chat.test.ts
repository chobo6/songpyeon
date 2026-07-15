import { describe, expect, test } from "vitest";
import { sanitizeChatText } from "./chat";

describe("sanitizeChatText", () => {
  test("trims and returns valid text", () => {
    expect(sanitizeChatText("  안녕  ")).toBe("안녕");
  });

  test("returns null for empty or whitespace-only text", () => {
    expect(sanitizeChatText("")).toBeNull();
    expect(sanitizeChatText("   ")).toBeNull();
  });

  test("returns null for non-string input", () => {
    expect(sanitizeChatText(undefined)).toBeNull();
    expect(sanitizeChatText(12345)).toBeNull();
    expect(sanitizeChatText(null)).toBeNull();
  });

  test("clamps to 100 characters", () => {
    const long = "a".repeat(150);
    expect(sanitizeChatText(long)).toBe("a".repeat(100));
  });
});
