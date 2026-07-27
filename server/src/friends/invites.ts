import { db } from "../db/connection";

type PendingInvite = { fromNickname: string; roomId: string; expiresAt: number };

const INVITE_TTL_MS = 60_000;

const invites = new Map<number, PendingInvite>();

// requesterId/addresseeId 방향 무관, status='accepted' row가 있는지만 확인한다.
// friendships.ts는 이 목적의 함수를 export하지 않으므로 여기서 별도로 조회한다.
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

export function sendInvite(fromNickname: string, toUserId: number, roomId: string): void {
  invites.set(toUserId, { fromNickname, roomId, expiresAt: Date.now() + INVITE_TTL_MS });
}

export function getPendingInvite(userId: number): PendingInvite | null {
  const invite = invites.get(userId);
  if (!invite) return null;
  if (invite.expiresAt < Date.now()) {
    invites.delete(userId);
    return null;
  }
  return invite;
}

export function dismissInvite(userId: number): void {
  invites.delete(userId);
}

export function _resetForTest(): void {
  invites.clear();
}
