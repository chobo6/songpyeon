const MAX_NICKNAME_LENGTH = 10;
const DEFAULT_NICKNAME = "플레이어";

// Nickname is a per-session display label, not an account — no persistence,
// no uniqueness check. This is the only real trust boundary for it (the
// client's own length limit is UX only), so keep it defensive: anything
// that isn't a usable non-empty string collapses to the default.
export function sanitizeNickname(input: unknown): string {
  if (typeof input !== "string") return DEFAULT_NICKNAME;
  const trimmed = input.trim().slice(0, MAX_NICKNAME_LENGTH);
  return trimmed || DEFAULT_NICKNAME;
}
