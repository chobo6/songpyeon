import { describe, expect, test } from "vitest";
import { applyDoughAttack, applyTimeReduce, ItemUseTracker } from "./items";
import type { Color } from "./colors";

describe("ItemUseTracker", () => {
  test("tryUse returns true the first time an item is used", () => {
    const tracker = new ItemUseTracker();
    expect(tracker.tryUse("timeAdd")).toBe(true);
  });

  test("tryUse returns false for the same item used again before a reset", () => {
    const tracker = new ItemUseTracker();
    tracker.tryUse("timeAdd");
    expect(tracker.tryUse("timeAdd")).toBe(false);
  });

  test("tryUse for a different item is independent of another item's usage", () => {
    const tracker = new ItemUseTracker();
    tracker.tryUse("timeAdd");
    expect(tracker.tryUse("superMortar")).toBe(true);
  });

  test("reset() allows a previously-used item to be used again", () => {
    const tracker = new ItemUseTracker();
    tracker.tryUse("timeAdd");
    tracker.reset();
    expect(tracker.tryUse("timeAdd")).toBe(true);
  });

  test("has() reports usage without consuming it", () => {
    const tracker = new ItemUseTracker();
    expect(tracker.has("doughAttack")).toBe(false);
    tracker.tryUse("doughAttack");
    expect(tracker.has("doughAttack")).toBe(true);
    // calling has() again must not itself count as a use
    expect(tracker.has("doughAttack")).toBe(true);
  });
});

describe("applyDoughAttack", () => {
  test("prepends a row of 6 mint tokens", () => {
    const sequence: Color[] = ["red", "purple"];
    expect(applyDoughAttack(sequence)).toEqual([
      "mint", "mint", "mint", "mint", "mint", "mint",
      "red", "purple",
    ]);
  });

  test("does not mutate the original array", () => {
    const sequence: Color[] = ["red", "purple"];
    applyDoughAttack(sequence);
    expect(sequence).toEqual(["red", "purple"]);
  });
});

describe("applyTimeReduce", () => {
  test("subtracts 1000ms from a normal duration", () => {
    expect(applyTimeReduce(4000)).toBe(3000);
  });

  test("floors at 1000ms instead of going lower", () => {
    expect(applyTimeReduce(500)).toBe(1000);
  });

  test("lands exactly on the floor without going negative", () => {
    expect(applyTimeReduce(2000)).toBe(1000);
  });
});
