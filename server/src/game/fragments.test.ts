import { describe, expect, test } from "vitest";
import {
  generatePigFragment,
  generateRabbitMintBracket4Fragment,
  generateRabbitMintBracket6Fragment,
  generateRabbitMintFragment,
  generateRabbitPairFragment,
} from "./fragments";

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

describe("generateRabbitMintBracket4Fragment", () => {
  test("button - mint - mint - button, drawing the two buttons independently", () => {
    expect(generateRabbitMintBracket4Fragment(queueRng([0, 0.99]))).toEqual(["green", "mint", "mint", "pink"]);
  });
});

describe("generateRabbitMintBracket6Fragment", () => {
  test("button - mint x4 - the same button again", () => {
    expect(generateRabbitMintBracket6Fragment(queueRng([0.99]))).toEqual([
      "pink", "mint", "mint", "mint", "mint", "pink",
    ]);
  });
});
