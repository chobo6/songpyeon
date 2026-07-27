type PendingInvite = { fromNickname: string; roomId: string; expiresAt: number };

const INVITE_TTL_MS = 60_000;

const invites = new Map<number, PendingInvite>();

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
