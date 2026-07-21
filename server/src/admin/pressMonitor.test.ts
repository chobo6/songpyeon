import { beforeEach, describe, expect, test } from "vitest";
import type { Request, Response } from "express";
import { _resetForTest, _subscriberCountForTest, notifyPress, subscribe } from "./pressMonitor";

// Minimal Request/Response stand-ins — just enough surface for subscribe()
// to call (headers, flushHeaders, write, and the two "close" event hooks it
// registers). Captures what was written so tests can assert on payloads.
function makeReqRes() {
  const written: string[] = [];
  const closeHandlers: (() => void)[] = [];
  const req = {
    on: (event: string, handler: () => void) => {
      if (event === "close") closeHandlers.push(handler);
    },
  } as unknown as Request;
  const res = {
    setHeader: () => {},
    flushHeaders: () => {},
    write: (chunk: string) => {
      written.push(chunk);
    },
    on: () => {},
  } as unknown as Response;
  return { req, res, written, triggerClose: () => closeHandlers.forEach((h) => h()) };
}

describe("pressMonitor", () => {
  beforeEach(() => {
    _resetForTest();
  });

  test("notifyPress delivers only to subscribers of that exact userId", () => {
    const watched = makeReqRes();
    const other = makeReqRes();
    subscribe(1, watched.req, watched.res);
    subscribe(2, other.req, other.res);

    notifyPress(1, { color: "red", sinceLastPressMs: 400, blocked: false, timestamp: 123 });

    expect(watched.written).toHaveLength(1);
    expect(watched.written[0]).toContain('"color":"red"');
    expect(other.written).toHaveLength(0);
  });

  test("notifyPress for a userId with no subscribers is a silent no-op", () => {
    expect(() =>
      notifyPress(999, { color: "mint", sinceLastPressMs: null, blocked: false, timestamp: 1 }),
    ).not.toThrow();
  });

  test("multiple subscribers watching the same userId all receive the event", () => {
    const a = makeReqRes();
    const b = makeReqRes();
    subscribe(5, a.req, a.res);
    subscribe(5, b.req, b.res);

    notifyPress(5, { color: "purple", sinceLastPressMs: 10, blocked: true, timestamp: 456 });

    expect(a.written).toHaveLength(1);
    expect(b.written).toHaveLength(1);
    expect(a.written[0]).toContain('"blocked":true');
  });

  test("a closed connection is removed and no longer receives events", () => {
    const client = makeReqRes();
    subscribe(7, client.req, client.res);
    expect(_subscriberCountForTest(7)).toBe(1);

    client.triggerClose();
    expect(_subscriberCountForTest(7)).toBe(0);

    notifyPress(7, { color: "green", sinceLastPressMs: 50, blocked: false, timestamp: 789 });
    expect(client.written).toHaveLength(0);
  });
});
