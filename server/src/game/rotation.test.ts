import { describe, expect, test } from "vitest";
import { nextActiveTeamIndex, type TeamStatus } from "./rotation";

describe("nextActiveTeamIndex", () => {
  test("advances to the next team", () => {
    const teams: TeamStatus[] = [{ id: "a", eliminated: false }, { id: "b", eliminated: false }];
    expect(nextActiveTeamIndex(teams, 0)).toBe(1);
  });

  test("wraps back to the first team", () => {
    const teams: TeamStatus[] = [{ id: "a", eliminated: false }, { id: "b", eliminated: false }];
    expect(nextActiveTeamIndex(teams, 1)).toBe(0);
  });

  test("skips an eliminated team", () => {
    const teams: TeamStatus[] = [
      { id: "a", eliminated: false },
      { id: "b", eliminated: true },
      { id: "c", eliminated: false },
    ];
    expect(nextActiveTeamIndex(teams, 0)).toBe(2);
  });

  test("skips an eliminated team while wrapping", () => {
    const teams: TeamStatus[] = [
      { id: "a", eliminated: true },
      { id: "b", eliminated: false },
      { id: "c", eliminated: false },
    ];
    expect(nextActiveTeamIndex(teams, 2)).toBe(1);
  });
});
