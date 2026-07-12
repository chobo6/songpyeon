import { describe, expect, test } from "vitest";
import { STARTING_MORTARS, isEliminated, loseMortar } from "./mortar";

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
});
