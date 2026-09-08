import { describe, expect, test } from "vitest";
import { applyDoughAttack, applyGoblinMagic, applyTimeReduce, ItemUseTracker } from "./items";
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

  test('an explicit "rabbit" role still prepends a row of 6 mint tokens (same as no role arg)', () => {
    const sequence: Color[] = ["red", "purple"];
    expect(applyDoughAttack(sequence, "rabbit")).toEqual([
      "mint", "mint", "mint", "mint", "mint", "mint",
      "red", "purple",
    ]);
  });

  // pigOnly 방은 참가자 전원이 돼지 역할이라 민트(토끼 색)를 아무도 누를 수 없다 —
  // role: "pig"일 땐 민트 대신 돼지가 처리 가능한 색(빨강/주황/노랑/보라)으로
  // 6버튼을 채워야 그 턴이 실제로 풀릴 수 있다.
  test('role: "pig" prepends 6 pig-colored buttons instead of mint', () => {
    const sequence: Color[] = ["red", "purple"];
    const pigColors = ["red", "orange", "yellow", "purple"];
    const result = applyDoughAttack(sequence, "pig");
    expect(result).toHaveLength(8);
    expect(result.slice(0, 6).every((c) => pigColors.includes(c))).toBe(true);
    expect(result.slice(0, 6)).not.toContain("mint");
    expect(result.slice(6)).toEqual(["red", "purple"]);
  });

  test('role: "pig" does not mutate the original array', () => {
    const sequence: Color[] = ["red", "purple"];
    applyDoughAttack(sequence, "pig");
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

describe("applyGoblinMagic", () => {
  test("swaps the pig and rabbit sessionIds", () => {
    expect(applyGoblinMagic("pig-session", "rabbit-session")).toEqual({
      pigSessionId: "rabbit-session",
      rabbitSessionId: "pig-session",
    });
  });

  test("applying it twice restores the original assignment", () => {
    const once = applyGoblinMagic("pig-session", "rabbit-session");
    const twice = applyGoblinMagic(once.pigSessionId, once.rabbitSessionId);
    expect(twice).toEqual({ pigSessionId: "pig-session", rabbitSessionId: "rabbit-session" });
  });
});
