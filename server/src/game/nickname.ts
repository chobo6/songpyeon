const MAX_NICKNAME_LENGTH = 10;
const DEFAULT_NICKNAME = "플레이어";

// Pure string cleanup only — this is the only real trust boundary for
// nickname input (the client's own length limit is UX only), so keep it
// defensive: anything that isn't a usable non-empty string collapses to
// the default. Account-level concerns (persistence, uniqueness) live in
// auth/googleAuth.ts's setNickname, which calls this first.
export function sanitizeNickname(input: unknown): string {
  if (typeof input !== "string") return DEFAULT_NICKNAME;
  const trimmed = input.trim().slice(0, MAX_NICKNAME_LENGTH);
  return trimmed || DEFAULT_NICKNAME;
}
