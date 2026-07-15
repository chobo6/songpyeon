const MAX_CHAT_LENGTH = 100;

// Unlike sanitizeNickname (which always returns something displayable), an
// empty/invalid chat message has nothing sensible to fall back to — the
// caller must simply drop it, so this returns null instead of a placeholder.
export function sanitizeChatText(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim().slice(0, MAX_CHAT_LENGTH);
  return trimmed || null;
}
