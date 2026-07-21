import { beforeEach, describe, expect, test } from "vitest";
import { _resetForTest, getEvents, recordEvent, searchEventsByNickname, type AdminEvent } from "./eventLog";

function makeEvent(overrides: Partial<AdminEvent> = {}): AdminEvent {
  return {
    type: "join",
    timestamp: Date.now(),
    nickname: "테스트",
    roomId: "room1",
    roomTitle: "테스트방",
    ip: "127.0.0.1",
    sessionId: "sess1",
    ...overrides,
  };
}

describe("eventLog", () => {
  beforeEach(() => {
    _resetForTest();
  });

  test("returns recorded events in insertion order", () => {
    recordEvent(makeEvent({ sessionId: "a" }));
    recordEvent(makeEvent({ sessionId: "b" }));

    expect(getEvents().map((e) => e.sessionId)).toEqual(["a", "b"]);
  });

  test("getEvents returns at most the 500 most recent events, dropping older ones", () => {
    for (let i = 0; i < 510; i++) {
      recordEvent(makeEvent({ sessionId: `s${i}` }));
    }

    const events = getEvents();
    expect(events.length).toBe(500);
    expect(events[0].sessionId).toBe("s10");
    expect(events[events.length - 1].sessionId).toBe("s509");
  });

  test("prunes events older than the 90-day retention window on write", () => {
    const ninetyOneDaysAgo = Date.now() - 91 * 24 * 60 * 60 * 1000;
    recordEvent(makeEvent({ sessionId: "old", timestamp: ninetyOneDaysAgo }));
    recordEvent(makeEvent({ sessionId: "new" }));

    expect(getEvents().map((e) => e.sessionId)).toEqual(["new"]);
  });
});

describe("searchEventsByNickname", () => {
  beforeEach(() => {
    _resetForTest();
  });

  test("finds events by exact nickname match", () => {
    recordEvent(makeEvent({ sessionId: "a", nickname: "차은우" }));
    recordEvent(makeEvent({ sessionId: "b", nickname: "장원영" }));

    expect(searchEventsByNickname("차은우").map((e) => e.sessionId)).toEqual(["a"]);
  });

  test("matches substrings, most recent first", () => {
    recordEvent(makeEvent({ sessionId: "a", nickname: "서하" }));
    recordEvent(makeEvent({ sessionId: "b", nickname: "서하맘" }));

    expect(searchEventsByNickname("서하").map((e) => e.sessionId)).toEqual(["b", "a"]);
  });

  test("does not match a different nickname that merely looks similar", () => {
    recordEvent(makeEvent({ sessionId: "a", nickname: "서하" }));
    recordEvent(makeEvent({ sessionId: "b", nickname: "서햐" }));

    expect(searchEventsByNickname("서하").map((e) => e.sessionId)).toEqual(["a"]);
  });

  test("finds events beyond getEvents()'s 500-event window", () => {
    recordEvent(makeEvent({ sessionId: "target", nickname: "옛날유저" }));
    for (let i = 0; i < 500; i++) {
      recordEvent(makeEvent({ sessionId: `s${i}`, nickname: "다른사람" }));
    }

    expect(getEvents().some((e) => e.sessionId === "target")).toBe(false);
    expect(searchEventsByNickname("옛날유저").map((e) => e.sessionId)).toEqual(["target"]);
  });

  test("treats % and _ in the query as literal characters, not SQL wildcards", () => {
    recordEvent(makeEvent({ sessionId: "a", nickname: "100%유저" }));
    recordEvent(makeEvent({ sessionId: "b", nickname: "완전다른닉네임" }));

    expect(searchEventsByNickname("100%유저").map((e) => e.sessionId)).toEqual(["a"]);
  });
});
