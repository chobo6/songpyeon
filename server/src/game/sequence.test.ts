import { describe, expect, test } from "vitest";
import { generateSequence } from "./sequence";
import type { Color } from "./colors";

function queueRng(values: number[]): () => number {
  let i = 0;
  return () => values[i++];
}

describe("generateSequence", () => {
  test("assembles a pig fragment then a rabbit-pair fragment to hit the exact length", () => {
    // step1 (remaining=4): weight roll 0 (<0.7) -> pig -> base color index0 (red)
    // step2 (remaining=2): weight roll 0.99 (>=0.7) -> rabbit -> pick(choices) index0 (pair) -> green, pink
    const rng = queueRng([0, 0, 0.99, 0, 0, 0.99]);
    expect(generateSequence(4, rng)).toEqual(["red", "purple", "green", "pink"]);
  });

  test("a weight roll just below 0.7 selects a pig fragment", () => {
    const rng = queueRng([0.69, 0]);
    expect(generateSequence(2, rng)).toEqual(["red", "purple"]);
  });

  test("a weight roll at/above 0.7 selects a rabbit fragment", () => {
    // weight roll 0.7 -> rabbit; choice roll 0.99 -> mint run; length roll (only option) -> 2
    const rng = queueRng([0.7, 0.99, 0]);
    expect(generateSequence(2, rng)).toEqual(["mint", "mint"]);
  });

  test("produces exactly the requested length", () => {
    expect(generateSequence(18, Math.random)).toHaveLength(18);
    expect(generateSequence(60, Math.random)).toHaveLength(60);
  });

  test("rejects an odd length instead of silently overshooting by one", () => {
    // every fragment (pig, rabbit-pair, mint run) is length 2+ — an odd
    // total leaves remaining=1 with nothing able to fit exactly.
    expect(() => generateSequence(1, Math.random)).toThrow(/even/);
    expect(() => generateSequence(17, Math.random)).toThrow(/even/);
  });

  test("every base pig color is immediately followed by purple", () => {
    const sequence = generateSequence(300, Math.random);
    sequence.forEach((color, i) => {
      if (color === "red" || color === "orange" || color === "yellow") {
        expect(sequence[i + 1]).toBe("purple");
      }
    });
  });

  test("only produces valid colors", () => {
    const validColors: Color[] = ["red", "orange", "yellow", "purple", "mint", "green", "blue", "pink"];
    const sequence = generateSequence(300, Math.random);
    sequence.forEach((color) => {
      expect(validColors).toContain(color);
    });
  });
});
