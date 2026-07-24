import { describe, expect, test } from "vitest";
import { STARTING_MORTARS, gainMortar, isEliminated, loseMortar } from "./mortar";

describe("mortar (team-shared lives)", () => {
  test("a team starts with 5 mortars", () => {
    expect(STARTING_MORTARS).toBe(5);
  });

  test("losing a mortar decrements the count", () => {
    expect(loseMortar(5)).toBe(4);
  });

  test("mortars never go below zero", () => {
    expect(loseMortar(0)).toBe(0);
  });

  test("a team with mortars remaining is not eliminated", () => {
    expect(isEliminated(1)).toBe(false);
  });

  test("a team with zero mortars is eliminated", () => {
    expect(isEliminated(0)).toBe(true);
  });

  test("gaining a mortar increments the count", () => {
    expect(gainMortar(3)).toBe(4);
  });

  test("mortars never exceed STARTING_MORTARS (already full has no effect)", () => {
    expect(gainMortar(STARTING_MORTARS)).toBe(STARTING_MORTARS);
  });
});
