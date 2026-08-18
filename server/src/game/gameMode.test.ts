import { describe, expect, test } from "vitest";
import { sanitizeGameMode } from "./gameMode";

describe("sanitizeGameMode", () => {
  test("accepts the four valid modes as-is", () => {
    expect(sanitizeGameMode("normal")).toBe("normal");
    expect(sanitizeGameMode("beginner")).toBe("beginner");
    expect(sanitizeGameMode("pigOnly")).toBe("pigOnly");
    expect(sanitizeGameMode("rabbitOnly")).toBe("rabbitOnly");
  });

  test("defaults to normal for missing/invalid input", () => {
    expect(sanitizeGameMode(undefined)).toBe("normal");
    expect(sanitizeGameMode(null)).toBe("normal");
    expect(sanitizeGameMode("banana")).toBe("normal");
    expect(sanitizeGameMode(123)).toBe("normal");
  });
});
