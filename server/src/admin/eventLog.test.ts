import { beforeEach, describe, expect, test } from "vitest";
import { _resetForTest, getEvents, recordEvent, type AdminEvent } from "./eventLog";

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

  test("caps stored events at 500, dropping the oldest first", () => {
    for (let i = 0; i < 500; i++) {
      recordEvent(makeEvent({ sessionId: `s${i}` }));
    }
    recordEvent(makeEvent({ sessionId: "s500" }));

    const events = getEvents();
    expect(events.length).toBe(500);
    expect(events[0].sessionId).toBe("s1");
    expect(events[events.length - 1].sessionId).toBe("s500");
  });
});
