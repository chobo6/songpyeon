import { describe, expect, test } from "vitest";
import { BONUS_MORTAR_CHANCE, rollBonusMortarIndex } from "./bonusMortarToken";

function queueRng(values: number[]): () => number {
  let i = 0;
  return () => values[i++];
}

describe("rollBonusMortarIndex", () => {
  test("returns null when the chance roll misses (>= BONUS_MORTAR_CHANCE)", () => {
    const rng = queueRng([BONUS_MORTAR_CHANCE]);
    expect(rollBonusMortarIndex(18, rng)).toBeNull();
  });

  test("returns null for any roll clearly above the chance", () => {
    const rng = queueRng([0.5]);
    expect(rollBonusMortarIndex(18, rng)).toBeNull();
  });

  test("returns a valid index when the chance roll hits (< BONUS_MORTAR_CHANCE)", () => {
    // chance roll hits (0), then the index-position roll picks index 0 of 18
    const rng = queueRng([0, 0]);
    expect(rollBonusMortarIndex(18, rng)).toBe(0);
  });

  test("the index roll is scaled to the sequence length and floored to an integer", () => {
    // chance roll hits (0), then index-position roll 0.5 of a 20-length
    // sequence -> floor(0.5 * 20) = 10
    const rng = queueRng([0, 0.5]);
    expect(rollBonusMortarIndex(20, rng)).toBe(10);
  });

  test("an index roll just under 1 never reaches sequenceLength itself", () => {
    // chance roll hits (0), then index-position roll 0.999999 of a
    // 10-length sequence -> floor(0.999999 * 10) = 9, not 10
    const rng = queueRng([0, 0.999999]);
    expect(rollBonusMortarIndex(10, rng)).toBe(9);
  });
});
