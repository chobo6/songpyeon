import { describe, expect, test } from "vitest";
import { generateSequence } from "./sequence";
import type { Color } from "./colors";

function queueRng(values: number[]): () => number {
  let i = 0;
  return () => values[i++];
}

describe("generateSequence", () => {
  test("assembles a pig fragment then a rabbit-pair fragment to hit the exact length", () => {
    // step1 (remaining=4): pick kind index0 (pig) -> pick base color index0 (red)
    // step2 (remaining=2): pick kind index1 (rabbitPair) -> pick color index0 (green), index2 (pink)
    const rng = queueRng([0, 0, 0.34, 0, 0.99]);
    expect(generateSequence(4, rng)).toEqual(["red", "purple", "green", "pink"]);
  });

  test("produces exactly the requested length", () => {
    expect(generateSequence(18, Math.random)).toHaveLength(18);
    expect(generateSequence(60, Math.random)).toHaveLength(60);
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
