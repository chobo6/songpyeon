import { beforeEach, describe, expect, test } from "vitest";
import { db } from "../db/connection";
import { getOrCreateUser, getUserById, setNickname } from "./googleAuth";

describe("getOrCreateUser", () => {
  beforeEach(() => {
    db.exec("DELETE FROM users");
  });

  test("creates a new user with no nickname yet", () => {
    const user = getOrCreateUser("sub-1", { email: "a@example.com", name: "Alice" });
    expect(user.nickname).toBeNull();
  });

  test("returns the same user id on a repeat login with the same google_sub", () => {
    const first = getOrCreateUser("sub-2", { name: "Bob" });
    const second = getOrCreateUser("sub-2", { name: "Bob" });
    expect(second.id).toBe(first.id);
  });

  test("does not overwrite an existing nickname on repeat login", () => {
    const user = getOrCreateUser("sub-3", { name: "Carol" });
    setNickname(user.id, "캐롤");
    const again = getOrCreateUser("sub-3", { name: "Carol Updated" });
    expect(again.nickname).toBe("캐롤");
  });
});

describe("setNickname", () => {
  beforeEach(() => {
    db.exec("DELETE FROM users");
  });

  test("sets the nickname for a user with none yet", () => {
    const user = getOrCreateUser("sub-4", {});
    const result = setNickname(user.id, "둘리");
    expect(result).toBe("ok");
    expect(getUserById(user.id)?.nickname).toBe("둘리");
  });

  test("refuses to overwrite an already-set nickname", () => {
    const user = getOrCreateUser("sub-5", {});
    setNickname(user.id, "첫닉네임");
    const result = setNickname(user.id, "새닉네임");
    expect(result).toBe("already_set");
    expect(getUserById(user.id)?.nickname).toBe("첫닉네임");
  });

  test("sanitizes the nickname before storing (delegates to sanitizeNickname)", () => {
    const user = getOrCreateUser("sub-6", {});
    setNickname(user.id, "   ");
    expect(getUserById(user.id)?.nickname).toBe("플레이어");
  });

  test("refuses a nickname already taken by another user", () => {
    const first = getOrCreateUser("sub-7", {});
    setNickname(first.id, "먼저찜");
    const second = getOrCreateUser("sub-8", {});
    const result = setNickname(second.id, "먼저찜");
    expect(result).toBe("taken");
    expect(getUserById(second.id)?.nickname).toBeNull();
  });
});

describe("getUserById", () => {
  beforeEach(() => {
    db.exec("DELETE FROM users");
  });

  test("returns undefined for an unknown id", () => {
    expect(getUserById(999999)).toBeUndefined();
  });
});
