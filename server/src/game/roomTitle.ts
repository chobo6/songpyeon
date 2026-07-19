const MAX_ROOM_TITLE_LENGTH = 20;

// Empty/invalid input resolves to "" — the caller (MatchRoom.onCreate)
// decides the displayed fallback, since a sensible default may depend on
// context this module doesn't have (e.g. the host's nickname).
export function sanitizeRoomTitle(input: unknown): string {
  if (typeof input !== "string") return "";
  return input.trim().slice(0, MAX_ROOM_TITLE_LENGTH);
}
