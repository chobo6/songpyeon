import { describe, expect, test } from "vitest";
import { generatePigFragment, generateRabbitMintFragment, generateRabbitPairFragment } from "./fragments";

function queueRng(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

describe("generatePigFragment", () => {
  test("picks the first base color and appends purple", () => {
    expect(generatePigFragment(queueRng([0]))).toEqual(["red", "purple"]);
  });

  test("picks the last base color and appends purple", () => {
    expect(generatePigFragment(queueRng([0.99]))).toEqual(["yellow", "purple"]);
  });
});

describe("generateRabbitMintFragment", () => {
  test("picks the shortest run (2)", () => {
    expect(generateRabbitMintFragment(queueRng([0]))).toEqual(["mint", "mint"]);
  });

  test("picks the longest run (6)", () => {
    expect(generateRabbitMintFragment(queueRng([0.99]))).toEqual([
      "mint", "mint", "mint", "mint", "mint", "mint",
    ]);
  });
});

describe("generateRabbitPairFragment", () => {
  test("draws two colors independently from green/blue/pink", () => {
    expect(generateRabbitPairFragment(queueRng([0, 0.99]))).toEqual(["green", "pink"]);
  });
});
