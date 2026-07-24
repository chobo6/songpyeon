import { describe, expect, test } from "vitest";
import { generateSequence } from "./sequence";
import type { Color } from "./colors";

function queueRng(values: number[]): () => number {
  let i = 0;
  return () => values[i++];
}

describe("generateSequence", () => {
  test("assembles a pig fragment then a rabbit-pair fragment to hit the exact length", () => {
    // round 1 -> zero stickiness, same as the old memoryless 70/30 draw.
    // step1 (remaining=4): weight roll 0 (<0.7) -> pig -> base color index0 (red)
    // step2 (remaining=2): weight roll 0.99 (>=0.7) -> rabbit -> pick(choices) index0 (pair) -> green, pink
    const rng = queueRng([0, 0, 0.99, 0, 0, 0.99]);
    expect(generateSequence(4, rng, 1)).toEqual(["red", "purple", "green", "pink"]);
  });

  test("a weight roll just below 0.7 selects a pig fragment", () => {
    const rng = queueRng([0.69, 0]);
    expect(generateSequence(2, rng, 1)).toEqual(["red", "purple"]);
  });

  test("a weight roll at/above 0.7 selects a rabbit fragment", () => {
    // weight roll 0.7 -> rabbit; choice roll 0.99 -> mint run; length roll (only option) -> 2
    const rng = queueRng([0.7, 0.99, 0]);
    expect(generateSequence(2, rng, 1)).toEqual(["mint", "mint"]);
  });

  test("produces exactly the requested length", () => {
    expect(generateSequence(18, Math.random, 1)).toHaveLength(18);
    expect(generateSequence(60, Math.random, 1)).toHaveLength(60);
    // High rounds (max stickiness) shouldn't change the length contract either.
    expect(generateSequence(60, Math.random, 50)).toHaveLength(60);
  });

  test("rejects an odd length instead of silently overshooting by one", () => {
    // every fragment (pig, rabbit-pair, mint run) is length 2+ — an odd
    // total leaves remaining=1 with nothing able to fit exactly.
    expect(() => generateSequence(1, Math.random, 1)).toThrow(/even/);
    expect(() => generateSequence(17, Math.random, 1)).toThrow(/even/);
  });

  test("every base pig color is immediately followed by purple", () => {
    const sequence = generateSequence(300, Math.random, 1);
    sequence.forEach((color, i) => {
      if (color === "red" || color === "orange" || color === "yellow") {
        expect(sequence[i + 1]).toBe("purple");
      }
    });
  });

  test("only produces valid colors", () => {
    const validColors: Color[] = ["red", "orange", "yellow", "purple", "mint", "green", "blue", "pink"];
    const sequence = generateSequence(300, Math.random, 1);
    sequence.forEach((color) => {
      expect(validColors).toContain(color);
    });
  });

  describe("round-based stickiness (reduces pig<->rabbit hand-offs in later rounds)", () => {
    test("round 1 behaves exactly like the old memoryless 70/30 draw, even right after a pig fragment", () => {
      // step1: roll 0 (<0.7) -> pig (red, purple). step2: roll 0.8 (>=0.7) ->
      // at round 1 there's no stickiness bonus, so this is still an ordinary
      // rabbit pick regardless of the previous fragment's role.
      const rng = queueRng([0, 0, 0.8, 0.99, 0]);
      expect(generateSequence(4, rng, 1)).toEqual(["red", "purple", "mint", "mint"]);
    });

    test("a late round makes staying pig after a pig fragment more likely — a roll that would have switched at round 1 now stays", () => {
      // step1: roll 0 (<0.7) -> pig (red, purple). step2: roll 0.72 -> at
      // round 1 this is >=0.7 (rabbit, see test above), but at round 30
      // (max stickiness, +0.05) the pig threshold is 0.75, so 0.72 stays pig
      // instead (base color roll 0 -> red again).
      const rng = queueRng([0, 0, 0.72, 0]);
      expect(generateSequence(4, rng, 30)).toEqual(["red", "purple", "red", "purple"]);
    });

    test("a late round makes staying rabbit after a rabbit fragment more likely — a roll that would have switched to pig at round 1 now stays rabbit", () => {
      // step1: roll 0.99 (>=0.7) -> rabbit; choice roll 0.99 -> mint run;
      // length roll 0 -> 2 ("mint","mint"), remaining now 2.
      // step2: roll 0.65 -> at round 1 the pig threshold after a rabbit
      // fragment is still 0.7, so 0.65 would switch to pig; at round 30 it
      // drops to 0.65 (0.7-0.05), so 0.65 no longer clears it and stays
      // rabbit — choice roll 0 -> pair fragment, color rolls 0,0 -> green,green.
      const rng = queueRng([0.99, 0.99, 0, 0.65, 0, 0, 0]);
      expect(generateSequence(4, rng, 30)).toEqual(["mint", "mint", "green", "green"]);
    });

    test("stickiness caps at round 30 — round 60 behaves identically to round 30", () => {
      const rngAt30 = queueRng([0, 0, 0.8, 0]);
      const rngAt60 = queueRng([0, 0, 0.8, 0]);
      expect(generateSequence(4, rngAt30, 30)).toEqual(generateSequence(4, rngAt60, 60));
    });
  });
});
