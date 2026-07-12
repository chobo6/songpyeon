import { colorRole, type Color, type Role } from "./colors";

export type PressResult =
  | { correct: true; nextCursor: number; complete: boolean }
  | { correct: false };

export function attemptPress(
  sequence: Color[],
  cursor: number,
  pressedColor: Color,
  pressingRole: Role,
): PressResult {
  if (cursor >= sequence.length) return { correct: false };

  const dueColor = sequence[cursor];
  if (pressedColor !== dueColor) return { correct: false };
  if (colorRole(dueColor) !== pressingRole) return { correct: false };

  const nextCursor = cursor + 1;
  return { correct: true, nextCursor, complete: nextCursor === sequence.length };
}
