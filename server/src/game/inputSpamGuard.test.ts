import { describe, expect, test } from "vitest";
import { isSpammedPress, MINT_SPAM_THRESHOLD_MS, PIG_SPAM_THRESHOLD_MS } from "./inputSpamGuard";

describe("isSpammedPress — mint (rabbit)", () => {
  test("flags a mint press faster than the threshold", () => {
    expect(isSpammedPress("mint", MINT_SPAM_THRESHOLD_MS - 1)).toBe(true);
  });

  test("does not flag a mint press right at the threshold boundary", () => {
    expect(isSpammedPress("mint", MINT_SPAM_THRESHOLD_MS)).toBe(false);
  });

  test("does not flag a mint press slower than the threshold", () => {
    expect(isSpammedPress("mint", MINT_SPAM_THRESHOLD_MS + 50)).toBe(false);
  });

  test("never flags the other rabbit colors, no matter how fast", () => {
    expect(isSpammedPress("green", 0)).toBe(false);
    expect(isSpammedPress("blue", 0)).toBe(false);
    expect(isSpammedPress("pink", 0)).toBe(false);
  });
});

describe("isSpammedPress — pig (all 4 colors)", () => {
  test("flags a pig-colored press faster than the threshold", () => {
    expect(isSpammedPress("red", PIG_SPAM_THRESHOLD_MS - 1)).toBe(true);
    expect(isSpammedPress("orange", PIG_SPAM_THRESHOLD_MS - 1)).toBe(true);
    expect(isSpammedPress("yellow", PIG_SPAM_THRESHOLD_MS - 1)).toBe(true);
    expect(isSpammedPress("purple", PIG_SPAM_THRESHOLD_MS - 1)).toBe(true);
  });

  test("does not flag a pig-colored press right at the threshold boundary", () => {
    expect(isSpammedPress("red", PIG_SPAM_THRESHOLD_MS)).toBe(false);
  });

  test("does not flag a pig-colored press slower than the threshold", () => {
    expect(isSpammedPress("purple", PIG_SPAM_THRESHOLD_MS + 50)).toBe(false);
  });
});

describe("isSpammedPress — shared behavior", () => {
  test("the first press of a turn (no previous press yet) always passes", () => {
    expect(isSpammedPress("mint", null)).toBe(false);
    expect(isSpammedPress("red", null)).toBe(false);
  });
});
