import { describe, expect, test } from "vitest";
import { BONUS_ITEM_CHANCE, rollBonusItemIndex } from "./bonusItemToken";
import type { ItemId } from "./items";

function queueRng(values: number[]): () => number {
  let i = 0;
  return () => values[i++];
}

const ALL_ITEM_IDS: ItemId[] = ["timeAdd", "timeReduce", "doughAttack", "superMortar", "mortarRestore", "goblinMagic"];

describe("rollBonusItemIndex", () => {
  test("returns null when the chance roll misses (>= BONUS_ITEM_CHANCE)", () => {
    const rng = queueRng([BONUS_ITEM_CHANCE]);
    expect(rollBonusItemIndex(18, rng)).toBeNull();
  });

  test("returns null for any roll clearly above the chance", () => {
    const rng = queueRng([0.5]);
    expect(rollBonusItemIndex(18, rng)).toBeNull();
  });

  test("on a hit, returns a valid index and one of the 6 known item ids", () => {
    // chance roll hits (0), index roll picks position 0 of 18, item roll picks index 0 -> "timeAdd"
    const rng = queueRng([0, 0, 0]);
    expect(rollBonusItemIndex(18, rng)).toEqual({ index: 0, itemId: "timeAdd" });
  });

  test("the index roll is scaled to sequence length and floored", () => {
    // chance hits (0), index roll 0.5 of a 20-length sequence -> floor(0.5*20)=10,
    // item roll 0.5 of 6 items -> floor(0.5*6)=3 -> "superMortar"
    const rng = queueRng([0, 0.5, 0.5]);
    expect(rollBonusItemIndex(20, rng)).toEqual({ index: 10, itemId: "superMortar" });
  });

  test("the item roll picks the LAST item id (goblinMagic) for a roll just under 1", () => {
    // chance hits (0), index roll 0 -> position 0, item roll 0.999999 of 6 ->
    // floor(0.999999*6)=5 -> ALL_ITEM_IDS[5] = "goblinMagic"
    const rng = queueRng([0, 0, 0.999999]);
    expect(rollBonusItemIndex(10, rng)).toEqual({ index: 0, itemId: "goblinMagic" });
  });

  test("every possible item roll maps to one of the 6 known ids", () => {
    for (let i = 0; i < 6; i++) {
      const rng = queueRng([0, 0, i / 6]);
      const result = rollBonusItemIndex(10, rng);
      expect(ALL_ITEM_IDS).toContain(result?.itemId);
    }
  });
});
