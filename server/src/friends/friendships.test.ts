import { beforeEach, describe, expect, test } from "vitest";
import { db } from "../db/connection";
import { getOrCreateUser } from "../auth/googleAuth";
import { sendFriendRequest, respondToRequest, cancelRequest } from "./friendships";

function makeUser(sub: string, nickname: string): number {
  const user = getOrCreateUser(sub, {});
  db.prepare(`UPDATE users SET nickname = ? WHERE id = ?`).run(nickname, user.id);
  return user.id;
}

function getFriendshipId(a: number, b: number): number {
  return (
    db.prepare(`SELECT id FROM friendships WHERE requester_id = ? AND addressee_id = ?`).get(a, b) as { id: number }
  ).id;
}

describe("sendFriendRequest", () => {
  beforeEach(() => {
    db.exec("DELETE FROM friendships");
    db.exec("DELETE FROM users");
  });

  test("creates a new pending request", () => {
    const a = makeUser("sub-a", "에이");
    const b = makeUser("sub-b", "비");

    expect(sendFriendRequest(a, b)).toBe("sent");
    const row = db.prepare(`SELECT status FROM friendships WHERE id = ?`).get(getFriendshipId(a, b)) as {
      status: string;
    };
    expect(row.status).toBe("pending");
  });

  test("rejects a request to yourself", () => {
    const a = makeUser("sub-a", "에이");
    expect(sendFriendRequest(a, a)).toBe("self");
  });

  test("rejects a duplicate pending request in the same direction", () => {
    const a = makeUser("sub-a", "에이");
    const b = makeUser("sub-b", "비");
    sendFriendRequest(a, b);

    expect(sendFriendRequest(a, b)).toBe("already_pending");
  });

  test("auto-accepts when the reverse direction already has a pending request", () => {
    const a = makeUser("sub-a", "에이");
    const b = makeUser("sub-b", "비");
    sendFriendRequest(a, b); // a -> b pending

    expect(sendFriendRequest(b, a)).toBe("auto_accepted");
    const row = db.prepare(`SELECT status FROM friendships WHERE id = ?`).get(getFriendshipId(a, b)) as {
      status: string;
    };
    expect(row.status).toBe("accepted");
    const count = db.prepare(`SELECT COUNT(*) as c FROM friendships`).get() as { c: number };
    expect(count.c).toBe(1); // no second row for the reverse direction
  });

  test("rejects a request when already friends (either direction)", () => {
    const a = makeUser("sub-a", "에이");
    const b = makeUser("sub-b", "비");
    sendFriendRequest(a, b);
    respondToRequest(getFriendshipId(a, b), b, true);

    expect(sendFriendRequest(a, b)).toBe("already_friends");
    expect(sendFriendRequest(b, a)).toBe("already_friends");
  });
});

describe("respondToRequest", () => {
  beforeEach(() => {
    db.exec("DELETE FROM friendships");
    db.exec("DELETE FROM users");
  });

  test("accepting sets status to accepted", () => {
    const a = makeUser("sub-a", "에이");
    const b = makeUser("sub-b", "비");
    sendFriendRequest(a, b);
    const id = getFriendshipId(a, b);

    expect(respondToRequest(id, b, true)).toBe(true);
    const row = db.prepare(`SELECT status FROM friendships WHERE id = ?`).get(id) as { status: string };
    expect(row.status).toBe("accepted");
  });

  test("declining deletes the row", () => {
    const a = makeUser("sub-a", "에이");
    const b = makeUser("sub-b", "비");
    sendFriendRequest(a, b);
    const id = getFriendshipId(a, b);

    expect(respondToRequest(id, b, false)).toBe(true);
    expect(db.prepare(`SELECT * FROM friendships WHERE id = ?`).get(id)).toBeUndefined();
  });

  test("refuses to let someone else respond to a request not addressed to them", () => {
    const a = makeUser("sub-a", "에이");
    const b = makeUser("sub-b", "비");
    const c = makeUser("sub-c", "씨");
    sendFriendRequest(a, b);
    const id = getFriendshipId(a, b);

    expect(respondToRequest(id, c, true)).toBe(false);
    const row = db.prepare(`SELECT status FROM friendships WHERE id = ?`).get(id) as { status: string };
    expect(row.status).toBe("pending");
  });
});

describe("cancelRequest", () => {
  beforeEach(() => {
    db.exec("DELETE FROM friendships");
    db.exec("DELETE FROM users");
  });

  test("the requester can cancel their own pending request", () => {
    const a = makeUser("sub-a", "에이");
    const b = makeUser("sub-b", "비");
    sendFriendRequest(a, b);
    const id = getFriendshipId(a, b);

    expect(cancelRequest(id, a)).toBe(true);
    expect(db.prepare(`SELECT * FROM friendships WHERE id = ?`).get(id)).toBeUndefined();
  });

  test("refuses to cancel someone else's request", () => {
    const a = makeUser("sub-a", "에이");
    const b = makeUser("sub-b", "비");
    const c = makeUser("sub-c", "씨");
    sendFriendRequest(a, b);
    const id = getFriendshipId(a, b);

    expect(cancelRequest(id, c)).toBe(false);
    expect(db.prepare(`SELECT * FROM friendships WHERE id = ?`).get(id)).toBeDefined();
  });
});
