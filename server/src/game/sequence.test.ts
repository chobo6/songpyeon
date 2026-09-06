import { describe, expect, test } from "vitest";
import { generateSequence, generateSingleRoleSequence } from "./sequence";
import type { Color, Role } from "./colors";

function queueRng(values: number[]): () => number {
  let i = 0;
  return () => values[i++];
}

describe("generateSequence", () => {
  test("assembles a pig fragment then a rabbit-pair fragment to hit the exact length", () => {
    // round 1 -> zero stickiness, same as the old memoryless 70/30 draw.
    // step1 (remaining=4): weight roll 0 (<0.7) -> pig -> base color index0 (red)
    // step2 (remaining=2): weight roll 0.99 (>=0.7) -> rabbit -> pick(choices) index0 (pair) -> green, pink
    const rng = queueRng([0, 0, 0.99, 0, 0, 0.99]);
    expect(generateSequence(4, rng, 1)).toEqual(["red", "purple", "green", "pink"]);
  });

  test("a weight roll just below 0.7 selects a pig fragment", () => {
    const rng = queueRng([0.69, 0]);
    expect(generateSequence(2, rng, 1)).toEqual(["red", "purple"]);
  });

  test("a weight roll at/above 0.7 selects a rabbit fragment", () => {
    // weight roll 0.7 -> rabbit; choice roll 0.99 -> mint run; length roll (only option) -> 2
    const rng = queueRng([0.7, 0.99, 0]);
    expect(generateSequence(2, rng, 1)).toEqual(["mint", "mint"]);
  });

  test("produces exactly the requested length", () => {
    expect(generateSequence(18, Math.random, 1)).toHaveLength(18);
    expect(generateSequence(60, Math.random, 1)).toHaveLength(60);
    // High rounds (max stickiness) shouldn't change the length contract either.
    expect(generateSequence(60, Math.random, 50)).toHaveLength(60);
  });

  test("rejects an odd length instead of silently overshooting by one", () => {
    // every fragment (pig, rabbit-pair, mint run) is length 2+ — an odd
    // total leaves remaining=1 with nothing able to fit exactly.
    expect(() => generateSequence(1, Math.random, 1)).toThrow(/even/);
    expect(() => generateSequence(17, Math.random, 1)).toThrow(/even/);
  });

  test("every base pig color is immediately followed by purple", () => {
    const sequence = generateSequence(300, Math.random, 1);
    sequence.forEach((color, i) => {
      if (color === "red" || color === "orange" || color === "yellow") {
        expect(sequence[i + 1]).toBe("purple");
      }
    });
  });

  test("only produces valid colors", () => {
    const validColors: Color[] = ["red", "orange", "yellow", "purple", "mint", "green", "blue", "pink"];
    const sequence = generateSequence(300, Math.random, 1);
    sequence.forEach((color) => {
      expect(validColors).toContain(color);
    });
  });

  describe("round-based stickiness (reduces pig<->rabbit hand-offs in later rounds)", () => {
    test("round 1 behaves exactly like the old memoryless 70/30 draw, even right after a pig fragment", () => {
      // step1: roll 0 (<0.7) -> pig (red, purple). step2: roll 0.8 (>=0.7) ->
      // at round 1 there's no stickiness bonus, so this is still an ordinary
      // rabbit pick regardless of the previous fragment's role.
      const rng = queueRng([0, 0, 0.8, 0.99, 0]);
      expect(generateSequence(4, rng, 1)).toEqual(["red", "purple", "mint", "mint"]);
    });

    test("a late round makes staying pig after a pig fragment more likely — a roll that would have switched at round 1 now stays", () => {
      // step1: roll 0 (<0.7) -> pig (red, purple). step2: roll 0.72 -> at
      // round 1 this is >=0.7 (rabbit, see test above), but at round 30
      // (max stickiness, +0.05) the pig threshold is 0.75, so 0.72 stays pig
      // instead (base color roll 0 -> red again).
      const rng = queueRng([0, 0, 0.72, 0]);
      expect(generateSequence(4, rng, 30)).toEqual(["red", "purple", "red", "purple"]);
    });

    test("a late round makes staying rabbit after a rabbit fragment more likely — a roll that would have switched to pig at round 1 now stays rabbit", () => {
      // step1: roll 0.99 (>=0.7) -> rabbit; remaining=4 so choices are
      // [pair, mint, bracket4] (bracket6 needs remaining>=6) — choice roll
      // 0.5 -> floor(0.5*3)=1 -> mint run; length roll 0 -> 2 ("mint","mint"),
      // remaining now 2.
      // step2: roll 0.65 -> at round 1 the pig threshold after a rabbit
      // fragment is still 0.7, so 0.65 would switch to pig; at round 30 it
      // drops to 0.65 (0.7-0.05), so 0.65 no longer clears it and stays
      // rabbit — remaining=2 so brackets aren't offered ([pair, mint] only) —
      // choice roll 0 -> pair fragment, color rolls 0,0 -> green,green.
      const rng = queueRng([0.99, 0.5, 0, 0.65, 0, 0, 0]);
      expect(generateSequence(4, rng, 30)).toEqual(["mint", "mint", "green", "green"]);
    });

    test("stickiness caps at round 30 — round 60 behaves identically to round 30", () => {
      const rngAt30 = queueRng([0, 0, 0.8, 0]);
      const rngAt60 = queueRng([0, 0, 0.8, 0]);
      expect(generateSequence(4, rngAt30, 30)).toEqual(generateSequence(4, rngAt60, 60));
    });
  });

  describe("the two new bracket fragments (button-mint-mint-button / button-mint*4-button) — row-boundary and adjacency rules", () => {
    // Every fragment length is even (pig/pair=2, mint=2/4/6, bracket4=4,
    // bracket6=6), so a fragment can only ever START at an even column
    // (0, 2, or 4 of the 6-wide row) — column 4 is reachable but neither
    // bracket may start there (bracket4: only 0 or 2; bracket6: only 0).
    test("column 4 (reachable, but not an allowed bracket start) excludes both brackets even with plenty of room left", () => {
      // Two rabbit-pair fragments walk the column from 0 -> 2 -> 4.
      // step1 (remaining=10, col0): choices are [pair, mint, bracket4, bracket6]
      // (4-way) — choice roll 0 -> pair; colors 0,0 -> green,green. remaining=8.
      // step2 (remaining=8, col2): choices are [pair, mint, bracket4] (bracket6
      // needs col0) — choice roll 0 -> pair; colors 0,0 -> green,green. remaining=6.
      // step3 (remaining=6, col4): col4 permits neither bracket, so choices
      // collapse to [pair, mint] even though remaining=6 would otherwise allow
      // bracket6 — choice roll 0.99 -> floor(0.99*2)=1 -> mint; length roll
      // 0.99 -> floor(0.99*3)=2 -> the longest valid run (6).
      const rng = queueRng([0.99, 0, 0, 0, 0.99, 0, 0, 0, 0.99, 0.99, 0.99]);
      expect(generateSequence(10, rng, 1)).toEqual([
        "green", "green", "green", "green", "mint", "mint", "mint", "mint", "mint", "mint",
      ]);
    });

    test("right after a bracket4 fragment, the next fragment excludes both brackets even at column 0, where they'd otherwise be allowed", () => {
      // step1 (remaining=12, col0): choice roll 0 -> pair; colors 0,0 ->
      // green,green. remaining=10.
      // step2 (remaining=10, col2): choices are [pair, mint, bracket4] (col2
      // excludes bracket6) — choice roll 0.99 -> floor(0.99*3)=2 -> bracket4;
      // buttons 0,0.99 -> green,pink. remaining=6. Ends exactly at the row
      // boundary, so the next fragment starts at col0.
      // step3 (remaining=6, col0): col0 alone would permit both brackets, but
      // the previous fragment WAS a bracket, so choices collapse to
      // [pair, mint] regardless — choice roll 0.99 -> floor(0.99*2)=1 -> mint;
      // length roll 0.99 -> floor(0.99*3)=2 -> the longest valid run (6).
      const rng = queueRng([0.99, 0, 0, 0, 0.99, 0.99, 0, 0.99, 0.99, 0.99, 0.99]);
      expect(generateSequence(12, rng, 1)).toEqual([
        "green", "green", "green", "mint", "mint", "pink", "mint", "mint", "mint", "mint", "mint", "mint",
      ]);
    });
  });
});

describe("generateSingleRoleSequence", () => {
  test("pig role only ever produces base-color + purple pig fragments", () => {
    // 돼지 역할의 fragmentChoicesForRole은 선택지가 항상 1개뿐이라 pick(choices, rng)가
    // 값을 소비해도 결과는 항상 고정(0번째)이다 — 그래도 rng() 호출 자체는 일어난다.
    // 조각 하나(길이 2)당: [choice-pick(결과 무시, 0번 고정), base-color pick] 순서로 rng
    // 2번 소비. 4길이 = 조각 2개 = rng 4번: [0(choice, 무시), 0(red), 0.5(choice, 무시), 0(red)]
    const rng = queueRng([0, 0, 0.5, 0]);
    expect(generateSingleRoleSequence(4, rng, "pig")).toEqual(["red", "purple", "red", "purple"]);
  });

  test("rabbit role only ever produces mint runs or rabbit-pair fragments, never pig colors", () => {
    const sequence = generateSingleRoleSequence(300, Math.random, "rabbit");
    const validRabbitColors: Color[] = ["mint", "green", "blue", "pink"];
    sequence.forEach((color) => {
      expect(validRabbitColors).toContain(color);
    });
  });

  test("produces exactly the requested length for both roles", () => {
    expect(generateSingleRoleSequence(24, Math.random, "pig")).toHaveLength(24);
    expect(generateSingleRoleSequence(24, Math.random, "rabbit")).toHaveLength(24);
    expect(generateSingleRoleSequence(12, Math.random, "rabbit")).toHaveLength(12);
  });

  test("every pig base color is immediately followed by purple", () => {
    const sequence = generateSingleRoleSequence(300, Math.random, "pig");
    sequence.forEach((color, i) => {
      if (color === "red" || color === "orange" || color === "yellow") {
        expect(sequence[i + 1]).toBe("purple");
      }
    });
  });
});
