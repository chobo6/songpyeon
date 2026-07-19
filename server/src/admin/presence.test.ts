import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { _resetForTest, getOnlineUsers, touchPresence } from "./presence";

describe("presence", () => {
  beforeEach(() => {
    _resetForTest();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("returns a user touched within the TTL window", () => {
    touchPresence(1, "닉네임1");
    expect(getOnlineUsers().map((u) => u.userId)).toEqual([1]);
  });

  test("re-touching the same user updates their entry instead of duplicating it", () => {
    touchPresence(1, "닉네임1");
    touchPresence(1, "닉네임1");
    expect(getOnlineUsers()).toHaveLength(1);
  });

  test("drops a user once their last touch is older than the TTL", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    touchPresence(1, "닉네임1");

    vi.setSystemTime(8001);
    expect(getOnlineUsers()).toEqual([]);
  });

  test("keeps a user right up to the TTL boundary", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    touchPresence(1, "닉네임1");

    vi.setSystemTime(8000);
    expect(getOnlineUsers().map((u) => u.userId)).toEqual([1]);
  });
});
