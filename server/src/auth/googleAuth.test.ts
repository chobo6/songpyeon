import { beforeEach, describe, expect, test } from "vitest";
import { db } from "../db/connection";
import {
  adminSetNickname,
  getOrCreateUser,
  getTopRanking,
  getUserById,
  listUsers,
  recordRoundAchievement,
  setNickname,
} from "./googleAuth";

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

describe("listUsers", () => {
  beforeEach(() => {
    db.exec("DELETE FROM users");
  });

  test("returns every user, newest first", () => {
    const first = getOrCreateUser("sub-9", { email: "a@example.com", name: "Alice" });
    const second = getOrCreateUser("sub-10", { email: "b@example.com", name: "Bob" });
    setNickname(second.id, "밥");

    const rows = listUsers();
    expect(rows.map((r) => r.id)).toEqual([second.id, first.id]);
    expect(rows[0]).toMatchObject({ id: second.id, email: "b@example.com", name: "Bob", nickname: "밥" });
  });
});

describe("adminSetNickname", () => {
  beforeEach(() => {
    db.exec("DELETE FROM users");
  });

  test("overwrites an already-set nickname (unlike setNickname)", () => {
    const user = getOrCreateUser("sub-11", {});
    setNickname(user.id, "옛날닉네임");
    const result = adminSetNickname(user.id, "새닉네임");
    expect(result).toBe("ok");
    expect(getUserById(user.id)?.nickname).toBe("새닉네임");
  });

  test("still refuses a nickname already taken by another user", () => {
    const first = getOrCreateUser("sub-12", {});
    setNickname(first.id, "먼저찜");
    const second = getOrCreateUser("sub-13", {});
    const result = adminSetNickname(second.id, "먼저찜");
    expect(result).toBe("taken");
    expect(getUserById(second.id)?.nickname).toBeNull();
  });
});

describe("recordRoundAchievement", () => {
  beforeEach(() => {
    db.exec("DELETE FROM users");
  });

  test("raises max_round when the new round is higher", () => {
    const user = getOrCreateUser("sub-14", {});
    recordRoundAchievement(user.id, 3);
    recordRoundAchievement(user.id, 7);
    expect(getTopRanking(10)).toEqual([]); // no nickname yet, excluded from ranking
    setNickname(user.id, "달리기");
    expect(getTopRanking(10)).toEqual([{ nickname: "달리기", maxRound: 7 }]);
  });

  test("never lowers an existing max_round", () => {
    const user = getOrCreateUser("sub-15", {});
    setNickname(user.id, "버티기");
    recordRoundAchievement(user.id, 9);
    recordRoundAchievement(user.id, 2);
    expect(getTopRanking(10)).toEqual([{ nickname: "버티기", maxRound: 9 }]);
  });
});

describe("getTopRanking", () => {
  beforeEach(() => {
    db.exec("DELETE FROM users");
  });

  test("returns the highest max_round users first, capped at the given limit", () => {
    const players = [
      ["sub-16", "1등후보", 12],
      ["sub-17", "2등후보", 8],
      ["sub-18", "3등후보", 5],
    ] as const;
    for (const [sub, nickname, round] of players) {
      const user = getOrCreateUser(sub, {});
      setNickname(user.id, nickname);
      recordRoundAchievement(user.id, round);
    }

    expect(getTopRanking(2)).toEqual([
      { nickname: "1등후보", maxRound: 12 },
      { nickname: "2등후보", maxRound: 8 },
    ]);
  });

  test("excludes accounts that have never reached a round", () => {
    const user = getOrCreateUser("sub-19", {});
    setNickname(user.id, "구경꾼");
    expect(getTopRanking(10)).toEqual([]);
  });
});
