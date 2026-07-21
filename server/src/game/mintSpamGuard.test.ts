import { describe, expect, test } from "vitest";
import { isSpammedMintPress, MINT_SPAM_THRESHOLD_MS } from "./mintSpamGuard";

describe("isSpammedMintPress", () => {
  test("flags a mint press faster than the threshold", () => {
    expect(isSpammedMintPress("mint", MINT_SPAM_THRESHOLD_MS - 1)).toBe(true);
  });

  test("does not flag a mint press right at the threshold boundary", () => {
    expect(isSpammedMintPress("mint", MINT_SPAM_THRESHOLD_MS)).toBe(false);
  });

  test("does not flag a mint press slower than the threshold", () => {
    expect(isSpammedMintPress("mint", MINT_SPAM_THRESHOLD_MS + 50)).toBe(false);
  });

  test("never flags a non-mint color, no matter how fast", () => {
    expect(isSpammedMintPress("pink", 1)).toBe(false);
    expect(isSpammedMintPress("red", 0)).toBe(false);
    expect(isSpammedMintPress("green", 0)).toBe(false);
  });

  test("the first press of a turn (no previous press yet) always passes", () => {
    expect(isSpammedMintPress("mint", null)).toBe(false);
  });
});
