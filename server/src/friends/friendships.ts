import { db, sqliteBool } from "../db/connection";

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

export type FriendshipStatus = "self" | "friends" | "pending_sent" | "pending_received" | "none";

export type FriendshipStatusResult = { status: FriendshipStatus; friendshipId: number | null };

export function getFriendshipStatus(viewerId: number, targetId: number): FriendshipStatusResult {
  if (viewerId === targetId) return { status: "self", friendshipId: null };
  const row = findFriendshipRow(viewerId, targetId);
  if (!row) return { status: "none", friendshipId: null };
  if (row.status === "accepted") return { status: "friends", friendshipId: row.id };
  return { status: row.requester_id === viewerId ? "pending_sent" : "pending_received", friendshipId: row.id };
}

// requesterId/addresseeId 방향 무관, status='accepted' row가 있는지만 확인한다.
export function areFriends(userIdA: number, userIdB: number): boolean {
  const row = db
    .prepare(
      `SELECT 1 FROM friendships
       WHERE status = 'accepted'
         AND ((requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?))`,
    )
    .get(userIdA, userIdB, userIdB, userIdA);
  return !!row;
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

export function removeFriend(userId: number, friendshipId: number): boolean {
  const row = db.prepare(`SELECT * FROM friendships WHERE id = ? AND status = 'accepted'`).get(friendshipId) as
    | FriendshipRow
    | undefined;
  if (!row || (row.requester_id !== userId && row.addressee_id !== userId)) return false;

  db.prepare(`DELETE FROM friendships WHERE id = ?`).run(friendshipId);
  return true;
}

export type FriendListEntry = {
  friendshipId: number;
  userId: number;
  nickname: string;
  lastLoginAt: string | null;
  nicknameColor: string | null;
  nicknameRainbow: boolean;
  nicknameGlow: boolean;
};

export function listFriends(userId: number): FriendListEntry[] {
  const rows = db
    .prepare(
      `SELECT f.id AS friendshipId,
              u.id AS userId,
              u.nickname AS nickname,
              u.last_login_at AS lastLoginAt,
              u.nickname_color AS nicknameColor,
              u.nickname_rainbow AS nicknameRainbow,
              u.nickname_glow AS nicknameGlow
       FROM friendships f
       JOIN users u ON u.id = CASE WHEN f.requester_id = ? THEN f.addressee_id ELSE f.requester_id END
       WHERE f.status = 'accepted' AND (f.requester_id = ? OR f.addressee_id = ?)`,
    )
    .all(userId, userId, userId) as (Omit<FriendListEntry, "nicknameRainbow" | "nicknameGlow"> & {
    nicknameRainbow: number;
    nicknameGlow: number;
  })[];
  return rows.map((row) => ({
    ...row,
    nicknameRainbow: sqliteBool(row.nicknameRainbow),
    nicknameGlow: sqliteBool(row.nicknameGlow),
  }));
}

export type ReceivedRequestEntry = {
  requestId: number;
  fromUserId: number;
  fromNickname: string;
  createdAt: string;
  fromNicknameColor: string | null;
  fromNicknameRainbow: boolean;
  fromNicknameGlow: boolean;
};

export function listReceivedRequests(userId: number): ReceivedRequestEntry[] {
  const rows = db
    .prepare(
      `SELECT f.id AS requestId, u.id AS fromUserId, u.nickname AS fromNickname, f.created_at AS createdAt,
              u.nickname_color AS fromNicknameColor,
              u.nickname_rainbow AS fromNicknameRainbow,
              u.nickname_glow AS fromNicknameGlow
       FROM friendships f
       JOIN users u ON u.id = f.requester_id
       WHERE f.addressee_id = ? AND f.status = 'pending'`,
    )
    .all(userId) as (Omit<ReceivedRequestEntry, "fromNicknameRainbow" | "fromNicknameGlow"> & {
    fromNicknameRainbow: number;
    fromNicknameGlow: number;
  })[];
  return rows.map((row) => ({
    ...row,
    fromNicknameRainbow: sqliteBool(row.fromNicknameRainbow),
    fromNicknameGlow: sqliteBool(row.fromNicknameGlow),
  }));
}

export type SentRequestEntry = {
  requestId: number;
  toUserId: number;
  toNickname: string;
  createdAt: string;
  toNicknameColor: string | null;
  toNicknameRainbow: boolean;
  toNicknameGlow: boolean;
};

export function listSentRequests(userId: number): SentRequestEntry[] {
  const rows = db
    .prepare(
      `SELECT f.id AS requestId, u.id AS toUserId, u.nickname AS toNickname, f.created_at AS createdAt,
              u.nickname_color AS toNicknameColor,
              u.nickname_rainbow AS toNicknameRainbow,
              u.nickname_glow AS toNicknameGlow
       FROM friendships f
       JOIN users u ON u.id = f.addressee_id
       WHERE f.requester_id = ? AND f.status = 'pending'`,
    )
    .all(userId) as (Omit<SentRequestEntry, "toNicknameRainbow" | "toNicknameGlow"> & {
    toNicknameRainbow: number;
    toNicknameGlow: number;
  })[];
  return rows.map((row) => ({
    ...row,
    toNicknameRainbow: sqliteBool(row.toNicknameRainbow),
    toNicknameGlow: sqliteBool(row.toNicknameGlow),
  }));
}
