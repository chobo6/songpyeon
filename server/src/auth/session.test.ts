import { beforeEach, describe, expect, test } from "vitest";
import { getCookieValue, SESSION_COOKIE_NAME, signSession, verifySession } from "./session";

describe("signSession / verifySession", () => {
  beforeEach(() => {
    process.env.SESSION_JWT_SECRET = "test-session-secret";
  });

  test("signs and verifies a session round-trip", () => {
    const token = signSession(42);
    expect(verifySession(token)).toBe(42);
  });

  test("rejects a tampered token", () => {
    const token = signSession(42);
    expect(verifySession(token + "x")).toBeNull();
  });

  test("rejects when the secret is unset", () => {
    const token = signSession(42);
    delete process.env.SESSION_JWT_SECRET;
    expect(verifySession(token)).toBeNull();
  });

  test("returns null for an undefined token", () => {
    expect(verifySession(undefined)).toBeNull();
  });

  test("signSession throws when the secret is unset", () => {
    delete process.env.SESSION_JWT_SECRET;
    expect(() => signSession(1)).toThrow();
  });
});

describe("getCookieValue", () => {
  test("extracts a named cookie from a header with multiple cookies", () => {
    expect(getCookieValue("foo=bar; " + SESSION_COOKIE_NAME + "=abc123; other=x", SESSION_COOKIE_NAME)).toBe(
      "abc123",
    );
  });

  test("returns undefined when the cookie is absent", () => {
    expect(getCookieValue("foo=bar", SESSION_COOKIE_NAME)).toBeUndefined();
  });

  test("returns undefined for an undefined header", () => {
    expect(getCookieValue(undefined, SESSION_COOKIE_NAME)).toBeUndefined();
  });

  test("decodes URI-encoded cookie values", () => {
    expect(getCookieValue(`${SESSION_COOKIE_NAME}=a%20b`, SESSION_COOKIE_NAME)).toBe("a b");
  });
});
