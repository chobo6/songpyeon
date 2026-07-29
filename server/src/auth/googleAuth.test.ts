import { beforeEach, describe, expect, test } from "vitest";
import { db } from "../db/connection";
import {
  addGameMoney,
  adminSetNickname,
  equipEffect,
  getOrCreateUser,
  getOwnedEffects,
  getTopRanking,
  getUserById,
  listUsers,
  purchaseEffect,
  recordRolePlayed,
  recordRoundAchievement,
  rerollNicknameColor,
  setNickname,
  setNicknameColor,
  setNicknameEffect,
  setUserBanned,
  touchLastLogin,
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

  test("sets last_login_at on account creation", () => {
    const user = getOrCreateUser("sub-25", {});
    const row = listUsers().find((u) => u.id === user.id);
    expect(row?.lastLoginAt).toBeTruthy();
  });

  test("keeps last_login_at populated on a repeat login (same account)", () => {
    const user = getOrCreateUser("sub-26", {});
    const again = getOrCreateUser("sub-26", {});
    expect(again.id).toBe(user.id);
    const row = listUsers().find((u) => u.id === user.id);
    expect(row?.lastLoginAt).toBeTruthy();
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
    expect(getTopRanking(10)).toEqual([
      { nickname: "달리기", nicknameColor: null, nicknameEffect: "none", nicknameGlow: false, maxRound: 7 },
    ]);
  });

  test("never lowers an existing max_round", () => {
    const user = getOrCreateUser("sub-15", {});
    setNickname(user.id, "버티기");
    recordRoundAchievement(user.id, 9);
    recordRoundAchievement(user.id, 2);
    expect(getTopRanking(10)).toEqual([
      { nickname: "버티기", nicknameColor: null, nicknameEffect: "none", nicknameGlow: false, maxRound: 9 },
    ]);
  });
});

describe("recordRolePlayed", () => {
  beforeEach(() => {
    db.exec("DELETE FROM users");
  });

  test("increments pig_play_count independently of rabbit_play_count", () => {
    const user = getOrCreateUser("sub-role-1", {});
    recordRolePlayed(user.id, "pig");
    recordRolePlayed(user.id, "pig");
    recordRolePlayed(user.id, "rabbit");

    expect(getUserById(user.id)).toMatchObject({ pigPlayCount: 2, rabbitPlayCount: 1 });
  });

  test("starts both counts at zero for a brand-new user", () => {
    const user = getOrCreateUser("sub-role-2", {});
    expect(getUserById(user.id)).toMatchObject({ pigPlayCount: 0, rabbitPlayCount: 0 });
  });
});

describe("addGameMoney", () => {
  beforeEach(() => {
    db.exec("DELETE FROM users");
  });

  test("increases game_money by the given amount for a fresh user", () => {
    const user = getOrCreateUser("sub-money-1", {});
    addGameMoney(user.id, 20);

    expect(getUserById(user.id)).toMatchObject({ gameMoney: 20 });
  });

  test("accumulates across multiple calls", () => {
    const user = getOrCreateUser("sub-money-2", {});
    addGameMoney(user.id, 10);
    addGameMoney(user.id, 30);

    expect(getUserById(user.id)).toMatchObject({ gameMoney: 40 });
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
      { nickname: "1등후보", nicknameColor: null, nicknameEffect: "none", nicknameGlow: false, maxRound: 12 },
      { nickname: "2등후보", nicknameColor: null, nicknameEffect: "none", nicknameGlow: false, maxRound: 8 },
    ]);
  });

  test("excludes accounts that have never reached a round", () => {
    const user = getOrCreateUser("sub-19", {});
    setNickname(user.id, "구경꾼");
    expect(getTopRanking(10)).toEqual([]);
  });
});

describe("setNicknameColor", () => {
  beforeEach(() => {
    db.exec("DELETE FROM users");
  });

  test("stores a valid #RRGGBB color", () => {
    const user = getOrCreateUser("sub-22", {});
    const result = setNicknameColor(user.id, "#ff6b6b");
    expect(result).toBe("ok");
    expect(getUserById(user.id)?.nicknameColor).toBe("#ff6b6b");
  });

  test("reflects the color in listUsers and getTopRanking", () => {
    const user = getOrCreateUser("sub-23", {});
    setNickname(user.id, "색깔유저");
    recordRoundAchievement(user.id, 4);
    setNicknameColor(user.id, "#00ff00");

    expect(listUsers().find((u) => u.id === user.id)?.nicknameColor).toBe("#00ff00");
    expect(getTopRanking(10)).toEqual([
      { nickname: "색깔유저", nicknameColor: "#00ff00", nicknameEffect: "none", nicknameGlow: false, maxRound: 4 },
    ]);
  });

  test.each(["red", "#fff", "#gggggg", "#ff6b6b1", "not-a-color"])(
    "rejects an invalid color format: %s",
    (invalid) => {
      const user = getOrCreateUser(`sub-invalid-${invalid}`, {});
      const result = setNicknameColor(user.id, invalid);
      expect(result).toBe("invalid");
      expect(getUserById(user.id)?.nicknameColor).toBeNull();
    },
  );

  test("passing null clears an existing color", () => {
    const user = getOrCreateUser("sub-24", {});
    setNicknameColor(user.id, "#123456");
    const result = setNicknameColor(user.id, null);
    expect(result).toBe("ok");
    expect(getUserById(user.id)?.nicknameColor).toBeNull();
  });
});

describe("setNicknameEffect", () => {
  beforeEach(() => {
    db.exec("DELETE FROM users");
  });

  test("sets effect and glow independently", () => {
    const user = getOrCreateUser("sub-effects-1", {});
    setNicknameEffect(user.id, "rainbow", false);

    const profile = getUserById(user.id);
    expect(profile?.nicknameEffect).toBe("rainbow");
    expect(profile?.nicknameGlow).toBe(false);
  });

  test("switches between effects (only one active at a time)", () => {
    const user = getOrCreateUser("sub-effects-2", {});
    setNicknameEffect(user.id, "rainbow", true);
    setNicknameEffect(user.id, "hologram", true);

    const profile = getUserById(user.id);
    expect(profile?.nicknameEffect).toBe("hologram");
    expect(profile?.nicknameGlow).toBe(true);
  });

  test("turns everything back to none/off", () => {
    const user = getOrCreateUser("sub-effects-3", {});
    setNicknameEffect(user.id, "shine", true);
    setNicknameEffect(user.id, "none", false);

    const profile = getUserById(user.id);
    expect(profile?.nicknameEffect).toBe("none");
    expect(profile?.nicknameGlow).toBe(false);
  });

  test("getUserById returns a real boolean for glow, not a 0/1 number", () => {
    const user = getOrCreateUser("sub-effects-4", {});
    setNicknameEffect(user.id, "shine", true);

    const profile = getUserById(user.id);
    expect(typeof profile?.nicknameGlow).toBe("boolean");
  });
});

describe("setUserBanned", () => {
  beforeEach(() => {
    db.exec("DELETE FROM users");
  });

  test("banning a user sets bannedAt, unbanning clears it", () => {
    const user = getOrCreateUser("sub-20", {});
    expect(getUserById(user.id)?.bannedAt).toBeNull();

    setUserBanned(user.id, true);
    expect(getUserById(user.id)?.bannedAt).toBeTruthy();

    setUserBanned(user.id, false);
    expect(getUserById(user.id)?.bannedAt).toBeNull();
  });

  test("listUsers reflects the banned status", () => {
    const user = getOrCreateUser("sub-21", {});
    setUserBanned(user.id, true);
    const row = listUsers().find((u) => u.id === user.id);
    expect(row?.bannedAt).toBeTruthy();
  });
});

describe("touchLastLogin", () => {
  beforeEach(() => {
    db.exec("DELETE FROM users");
  });

  test("sets last_login_at for an existing user", () => {
    const user = getOrCreateUser("sub-27", {});
    db.prepare(`UPDATE users SET last_login_at = NULL WHERE id = ?`).run(user.id);
    expect(listUsers().find((u) => u.id === user.id)?.lastLoginAt).toBeNull();

    touchLastLogin(user.id);

    expect(listUsers().find((u) => u.id === user.id)?.lastLoginAt).toBeTruthy();
  });
});

describe("rerollNicknameColor", () => {
  beforeEach(() => {
    db.exec("DELETE FROM users");
  });

  test("deducts exactly 10000 and stores a valid #RRGGBB color when funds are sufficient", () => {
    const user = getOrCreateUser("sub-reroll-1", {});
    addGameMoney(user.id, 15000);

    const result = rerollNicknameColor(user.id);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.gameMoney).toBe(5000);
    expect(result.nicknameColor).toMatch(/^#[0-9a-f]{6}$/);
    expect(getUserById(user.id)).toMatchObject({
      gameMoney: 5000,
      nicknameColor: result.nicknameColor,
    });
  });

  test("succeeds at exactly the cost boundary (10000), leaving 0 left", () => {
    const user = getOrCreateUser("sub-reroll-2", {});
    addGameMoney(user.id, 10000);

    const result = rerollNicknameColor(user.id);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.gameMoney).toBe(0);
    expect(getUserById(user.id)?.gameMoney).toBe(0);
  });

  test("refuses when funds are insufficient and changes nothing", () => {
    const user = getOrCreateUser("sub-reroll-3", {});
    addGameMoney(user.id, 9999);

    const result = rerollNicknameColor(user.id);

    expect(result).toEqual({ ok: false, reason: "insufficient_funds" });
    expect(getUserById(user.id)).toMatchObject({ gameMoney: 9999, nicknameColor: null });
  });
});

describe("purchaseEffect / equipEffect / getOwnedEffects", () => {
  beforeEach(() => {
    db.exec("DELETE FROM users");
    db.exec("DELETE FROM owned_nickname_effects");
  });

  test("purchasing deducts the exact price and records ownership", () => {
    const user = getOrCreateUser("sub-shop-1", {});
    addGameMoney(user.id, 15000);

    const result = purchaseEffect(user.id, "chrome");

    expect(result).toBe("ok");
    expect(getUserById(user.id)?.gameMoney).toBe(3000);
    expect(getOwnedEffects(user.id)).toEqual(["chrome"]);
  });

  test("refuses purchase when funds are insufficient and changes nothing", () => {
    const user = getOrCreateUser("sub-shop-2", {});
    addGameMoney(user.id, 5000);

    const result = purchaseEffect(user.id, "chrome");

    expect(result).toBe("insufficient_funds");
    expect(getUserById(user.id)?.gameMoney).toBe(5000);
    expect(getOwnedEffects(user.id)).toEqual([]);
  });

  test("refuses a duplicate purchase and doesn't charge twice", () => {
    const user = getOrCreateUser("sub-shop-3", {});
    addGameMoney(user.id, 100000);
    purchaseEffect(user.id, "chrome");

    const result = purchaseEffect(user.id, "chrome");

    expect(result).toBe("already_owned");
    expect(getUserById(user.id)?.gameMoney).toBe(100000 - 12000);
    expect(getOwnedEffects(user.id)).toEqual(["chrome"]);
  });

  test("equipping an owned effect updates nicknameEffect without touching glow", () => {
    const user = getOrCreateUser("sub-shop-4", {});
    addGameMoney(user.id, 100000);
    purchaseEffect(user.id, "neon");
    setNicknameEffect(user.id, "rainbow", true); // sets glow=true and also owns rainbow

    const result = equipEffect(user.id, "neon");

    expect(result).toBe("ok");
    const profile = getUserById(user.id);
    expect(profile?.nicknameEffect).toBe("neon");
    expect(profile?.nicknameGlow).toBe(true); // untouched by equip
  });

  test("refuses to equip an effect that isn't owned", () => {
    const user = getOrCreateUser("sub-shop-5", {});

    const result = equipEffect(user.id, "hologram");

    expect(result).toBe("not_owned");
    expect(getUserById(user.id)?.nicknameEffect).toBe("none");
  });

  test("equipping 'none' is always allowed even with nothing owned", () => {
    const user = getOrCreateUser("sub-shop-6", {});

    const result = equipEffect(user.id, "none");

    expect(result).toBe("ok");
    expect(getUserById(user.id)?.nicknameEffect).toBe("none");
  });

  test("setNicknameEffect (admin grant) also records ownership", () => {
    const user = getOrCreateUser("sub-shop-7", {});

    setNicknameEffect(user.id, "shine", false);

    expect(getOwnedEffects(user.id)).toEqual(["shine"]);
    expect(getUserById(user.id)?.nicknameEffect).toBe("shine");
  });

  test("setNicknameEffect with 'none' does not add a bogus ownership row", () => {
    const user = getOrCreateUser("sub-shop-8", {});

    setNicknameEffect(user.id, "none", false);

    expect(getOwnedEffects(user.id)).toEqual([]);
  });
});
