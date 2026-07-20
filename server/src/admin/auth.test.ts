import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  _resetForTest,
  checkPassword,
  createSession,
  destroySession,
  isValidSession,
  SESSION_TTL_MS,
} from "./auth";

describe("auth", () => {
  beforeEach(() => {
    _resetForTest();
    process.env.ADMIN_PASSWORD = "correct-horse";
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("accepts the correct password", () => {
    expect(checkPassword("correct-horse")).toBe(true);
  });

  test("rejects an incorrect password", () => {
    expect(checkPassword("wrong")).toBe(false);
  });

  test("rejects a password of a different length than the correct one", () => {
    // Regression guard for the timingSafeEqual-on-hashes approach — a naive
    // switch back to comparing raw strings/buffers directly would throw on
    // mismatched lengths instead of just returning false.
    expect(checkPassword("correct-horse-but-longer")).toBe(false);
    expect(checkPassword("short")).toBe(false);
  });

  test("rejects any password when ADMIN_PASSWORD is unset", () => {
    delete process.env.ADMIN_PASSWORD;
    expect(checkPassword("anything")).toBe(false);
  });

  test("a created session validates as valid", () => {
    const token = createSession();
    expect(isValidSession(token)).toBe(true);
  });

  test("an unknown token is invalid", () => {
    expect(isValidSession("never-issued")).toBe(false);
  });

  test("destroySession invalidates the token", () => {
    const token = createSession();
    destroySession(token);
    expect(isValidSession(token)).toBe(false);
  });

  test("undefined token is invalid", () => {
    expect(isValidSession(undefined)).toBe(false);
  });

  test("a session is still valid right up to the TTL boundary", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const token = createSession();

    vi.setSystemTime(SESSION_TTL_MS - 1);
    expect(isValidSession(token)).toBe(true);
  });

  test("a session expires once the TTL has elapsed", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const token = createSession();

    vi.setSystemTime(SESSION_TTL_MS);
    expect(isValidSession(token)).toBe(false);
  });
});
