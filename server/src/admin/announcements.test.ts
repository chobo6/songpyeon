import { describe, expect, test } from "vitest";
import { shouldResend } from "./announcements";

describe("shouldResend", () => {
  test("returns false when there is no announcement yet", () => {
    expect(shouldResend(null, Date.now())).toBe(false);
  });

  test("returns true within the 5 minute window", () => {
    const now = 1_000_000;
    expect(shouldResend({ message: "hi", timestamp: now - 60_000 }, now)).toBe(true);
  });

  test("returns false once older than 5 minutes", () => {
    const now = 1_000_000;
    const fiveMinutes = 5 * 60 * 1000;
    expect(shouldResend({ message: "hi", timestamp: now - fiveMinutes - 1 }, now)).toBe(false);
  });

  test("returns true exactly at the 5 minute boundary", () => {
    const now = 1_000_000;
    const fiveMinutes = 5 * 60 * 1000;
    expect(shouldResend({ message: "hi", timestamp: now - fiveMinutes }, now)).toBe(true);
  });
});
