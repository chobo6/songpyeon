import { db } from "../db/connection";

export function findUserByNickname(nickname: string): { id: number } | undefined {
  return db.prepare(`SELECT id FROM users WHERE nickname = ?`).get(nickname) as { id: number } | undefined;
}

type FriendshipRow = { id: number; requester_id: number; addressee_id: number; status: string };

// 두 유저 사이의 유효한 row를 방향 무관하게 찾는다 — pending/accepted 어느 쪽이든.
function findFriendshipRow(userA: number, userB: number): FriendshipRow | undefined {
  return db
    .prepare(
      `SELECT * FROM friendships
       WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)`,
    )
    .get(userA, userB, userB, userA) as FriendshipRow | undefined;
}

export type SendFriendRequestResult = "sent" | "auto_accepted" | "already_friends" | "already_pending" | "self";

export function sendFriendRequest(requesterId: number, addresseeId: number): SendFriendRequestResult {
  if (requesterId === addresseeId) return "self";

  const existing = findFriendshipRow(requesterId, addresseeId);
  if (existing) {
    if (existing.status === "accepted") return "already_friends";
    if (existing.requester_id === requesterId) return "already_pending";
    // 반대 방향(addressee가 이미 requester에게 요청해둠) pending — 바로 수락 처리.
    db.prepare(
      `UPDATE friendships SET status = 'accepted', responded_at = datetime('now', '+9 hours') WHERE id = ?`,
    ).run(existing.id);
    return "auto_accepted";
  }

  db.prepare(`INSERT INTO friendships (requester_id, addressee_id, status) VALUES (?, ?, 'pending')`).run(
    requesterId,
    addresseeId,
  );
  return "sent";
}

export function respondToRequest(requestId: number, addresseeId: number, accept: boolean): boolean {
  const row = db.prepare(`SELECT * FROM friendships WHERE id = ? AND status = 'pending'`).get(requestId) as
    | FriendshipRow
    | undefined;
  if (!row || row.addressee_id !== addresseeId) return false;

  if (accept) {
    db.prepare(
      `UPDATE friendships SET status = 'accepted', responded_at = datetime('now', '+9 hours') WHERE id = ?`,
    ).run(requestId);
  } else {
    db.prepare(`DELETE FROM friendships WHERE id = ?`).run(requestId);
  }
  return true;
}

export function cancelRequest(requestId: number, requesterId: number): boolean {
  const row = db.prepare(`SELECT * FROM friendships WHERE id = ? AND status = 'pending'`).get(requestId) as
    | FriendshipRow
    | undefined;
  if (!row || row.requester_id !== requesterId) return false;

  db.prepare(`DELETE FROM friendships WHERE id = ?`).run(requestId);
  return true;
}
