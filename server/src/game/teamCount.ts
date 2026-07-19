const MIN_TEAM_COUNT = 1;
const MAX_TEAM_COUNT = 4;
const DEFAULT_TEAM_COUNT = 2;

export function sanitizeTeamCount(input: unknown): number {
  const n = Math.round(Number(input));
  if (!Number.isFinite(n) || n < MIN_TEAM_COUNT || n > MAX_TEAM_COUNT) return DEFAULT_TEAM_COUNT;
  return n;
}
