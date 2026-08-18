export type GameMode = "normal" | "beginner" | "pigOnly" | "rabbitOnly";

const VALID_MODES: readonly GameMode[] = ["normal", "beginner", "pigOnly", "rabbitOnly"];

export function sanitizeGameMode(input: unknown): GameMode {
  return VALID_MODES.includes(input as GameMode) ? (input as GameMode) : "normal";
}
