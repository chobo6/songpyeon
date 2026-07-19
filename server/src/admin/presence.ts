export type PresenceEntry = { userId: number; nickname: string; lastSeen: number };

// RoomList polls /api/rooms every 2s while browsing (see client/src/components/
// RoomList.tsx) — that's the only signal we get for "logged in and online but
// not in a room yet" (Colyseus only tracks room membership, not lobby
// presence). A generous multiple of the poll interval avoids a single missed
// beat (a slow request, a tab backgrounded briefly) flickering someone off
// the list.
const PRESENCE_TTL_MS = 8000;

const presence = new Map<number, PresenceEntry>();

export function touchPresence(userId: number, nickname: string): void {
  presence.set(userId, { userId, nickname, lastSeen: Date.now() });
}

export function getOnlineUsers(): PresenceEntry[] {
  const cutoff = Date.now() - PRESENCE_TTL_MS;
  return [...presence.values()].filter((entry) => entry.lastSeen >= cutoff);
}

export function _resetForTest(): void {
  presence.clear();
}
