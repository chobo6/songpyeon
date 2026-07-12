import { describe, expect, test } from "vitest";
import { attemptPress } from "./turnOrder";
import type { Color } from "./colors";

const sequence: Color[] = ["red", "purple", "mint", "mint"];

describe("attemptPress", () => {
  test("correct press advances the cursor without completing", () => {
    expect(attemptPress(sequence, 0, "red", "pig")).toEqual({
      correct: true,
      nextCursor: 1,
      complete: false,
    });
  });

  test("correct press on the final button completes the sequence", () => {
    expect(attemptPress(sequence, 3, "mint", "rabbit")).toEqual({
      correct: true,
      nextCursor: 4,
      complete: true,
    });
  });

  test("wrong color at the current cursor is rejected", () => {
    expect(attemptPress(sequence, 0, "purple", "pig")).toEqual({ correct: false });
  });

  test("correct color but pressed by the wrong role is rejected", () => {
    // cursor 2 is due "mint" (rabbit-owned) — a pig player cannot press it
    // even though "mint" is technically the right color, because their
    // button panel never shows rabbit-only colors (§12.2).
    expect(attemptPress(sequence, 2, "mint", "pig")).toEqual({ correct: false });
  });

  test("pressing past the end of an already-completed sequence is rejected", () => {
    expect(attemptPress(sequence, 4, "red", "pig")).toEqual({ correct: false });
  });
});
