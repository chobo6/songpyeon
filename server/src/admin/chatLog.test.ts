import { beforeEach, describe, expect, test } from "vitest";
import { _resetForTest, getChatLogs, recordChatLog } from "./chatLog";

describe("chatLog", () => {
  beforeEach(() => {
    _resetForTest();
  });

  test("records nickname and text", () => {
    recordChatLog("홍바들", "안녕하세요");

    const rows = getChatLogs();
    expect(rows).toHaveLength(1);
    expect(rows[0].nickname).toBe("홍바들");
    expect(rows[0].text).toBe("안녕하세요");
    expect(rows[0].createdAt).toBeTruthy();
  });

  test("returns rows newest-first", () => {
    recordChatLog("홍바들", "첫번째");
    recordChatLog("홍바들", "두번째");

    const rows = getChatLogs();
    expect(rows.map((r) => r.text)).toEqual(["두번째", "첫번째"]);
  });

  test("respects the limit", () => {
    recordChatLog("홍바들", "1");
    recordChatLog("홍바들", "2");
    recordChatLog("홍바들", "3");

    expect(getChatLogs(2)).toHaveLength(2);
  });
});
