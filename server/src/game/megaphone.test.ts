import { beforeEach, describe, expect, test } from "vitest";
import type { Request, Response } from "express";
import { _resetForTest, _subscriberCountForTest, broadcast, sanitizeMegaphoneMessage, subscribe } from "./megaphone";

// server/src/admin/pressMonitor.test.ts의 makeReqRes()와 동일한 최소 stand-in.
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

describe("sanitizeMegaphoneMessage", () => {
  test("trims whitespace and rejects an empty result", () => {
    expect(sanitizeMegaphoneMessage("   ")).toBeNull();
  });

  test("rejects non-string input", () => {
    expect(sanitizeMegaphoneMessage(123)).toBeNull();
  });

  test("truncates to 40 characters", () => {
    const long = "가".repeat(50);
    expect(sanitizeMegaphoneMessage(long)).toHaveLength(40);
  });

  test("passes through a normal short message unchanged", () => {
    expect(sanitizeMegaphoneMessage("안녕하세요")).toBe("안녕하세요");
  });
});

describe("megaphone subscribe/broadcast", () => {
  beforeEach(() => {
    _resetForTest();
  });

  test("broadcast delivers the nickname and message to all subscribers", () => {
    const a = makeReqRes();
    const b = makeReqRes();
    subscribe(a.req, a.res);
    subscribe(b.req, b.res);

    broadcast("공지왕", "안녕하세요");

    expect(a.written).toHaveLength(1);
    expect(a.written[0]).toContain('"nickname":"공지왕"');
    expect(a.written[0]).toContain('"message":"안녕하세요"');
    expect(b.written).toHaveLength(1);
  });

  test("a closed connection is removed and no longer receives broadcasts", () => {
    const client = makeReqRes();
    subscribe(client.req, client.res);
    expect(_subscriberCountForTest()).toBe(1);

    client.triggerClose();
    expect(_subscriberCountForTest()).toBe(0);

    broadcast("아무개", "메시지");
    expect(client.written).toHaveLength(0);
  });

  test("a newly-subscribing client immediately receives the most recent broadcast within the resend window", () => {
    broadcast("먼저온사람", "5분 전 메시지");

    const late = makeReqRes();
    subscribe(late.req, late.res);

    expect(late.written).toHaveLength(1);
    expect(late.written[0]).toContain('"nickname":"먼저온사람"');
  });
});
