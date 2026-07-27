import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { _resetForTest, dismissInvite, getPendingInvite, sendInvite } from "./invites";

describe("sendInvite / getPendingInvite / dismissInvite", () => {
  beforeEach(() => {
    _resetForTest();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("a sent invite is retrievable via getPendingInvite", () => {
    sendInvite("초대한사람", 1, "room-abc");
    expect(getPendingInvite(1)).toEqual({
      fromNickname: "초대한사람",
      roomId: "room-abc",
      expiresAt: expect.any(Number),
    });
  });

  test("a second invite to the same user overwrites the first (single slot, no queue)", () => {
    sendInvite("첫번째", 1, "room-1");
    sendInvite("두번째", 1, "room-2");
    expect(getPendingInvite(1)).toEqual({
      fromNickname: "두번째",
      roomId: "room-2",
      expiresAt: expect.any(Number),
    });
  });

  test("getPendingInvite returns null when there's no invite for that user", () => {
    expect(getPendingInvite(1)).toBeNull();
  });

  test("dismissInvite clears the pending invite", () => {
    sendInvite("초대한사람", 1, "room-xyz");
    dismissInvite(1);
    expect(getPendingInvite(1)).toBeNull();
  });

  test("an expired invite (past its 60s TTL) is treated as gone", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    sendInvite("초대한사람", 1, "room-old");

    vi.setSystemTime(60_001);
    expect(getPendingInvite(1)).toBeNull();
  });

  test("keeps an invite right up to the TTL boundary", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    sendInvite("초대한사람", 1, "room-old");

    vi.setSystemTime(60_000);
    expect(getPendingInvite(1)).not.toBeNull();
  });
});
