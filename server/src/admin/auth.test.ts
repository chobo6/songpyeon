import { beforeEach, describe, expect, test } from "vitest";
import {
  _resetForTest,
  checkPassword,
  createSession,
  destroySession,
  isValidSession,
} from "./auth";

describe("auth", () => {
  beforeEach(() => {
    _resetForTest();
    process.env.ADMIN_PASSWORD = "correct-horse";
  });

  test("accepts the correct password", () => {
    expect(checkPassword("correct-horse")).toBe(true);
  });

  test("rejects an incorrect password", () => {
    expect(checkPassword("wrong")).toBe(false);
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
});
