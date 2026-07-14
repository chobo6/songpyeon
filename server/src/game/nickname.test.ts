import { describe, expect, test } from "vitest";
import { sanitizeNickname } from "./nickname";

describe("sanitizeNickname", () => {
  test("trims surrounding whitespace", () => {
    expect(sanitizeNickname("  홍길동  ")).toBe("홍길동");
  });

  test("clamps to 10 characters", () => {
    expect(sanitizeNickname("가나다라마바사아자차카타파하")).toBe("가나다라마바사아자차");
  });

  test("falls back to default when empty or whitespace-only", () => {
    expect(sanitizeNickname("")).toBe("플레이어");
    expect(sanitizeNickname("   ")).toBe("플레이어");
  });

  test("falls back to default when input isn't a string", () => {
    expect(sanitizeNickname(undefined)).toBe("플레이어");
    expect(sanitizeNickname(42)).toBe("플레이어");
    expect(sanitizeNickname(null)).toBe("플레이어");
  });
});
