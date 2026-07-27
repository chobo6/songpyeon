import { beforeEach, describe, expect, test } from "vitest";
import { db } from "../db/connection";
import { getOrCreateUser } from "../auth/googleAuth";
import { getMessages, getUnreadCount, markRead, sendMessage } from "./directMessages";

function makeUser(sub: string, nickname: string): number {
  const user = getOrCreateUser(sub, {});
  db.prepare(`UPDATE users SET nickname = ? WHERE id = ?`).run(nickname, user.id);
  return user.id;
}

describe("directMessages", () => {
  beforeEach(() => {
    db.exec("DELETE FROM direct_messages");
    db.exec("DELETE FROM chat_read_state");
    db.exec("DELETE FROM users");
  });

  test("sendMessage stores a message retrievable by both participants", () => {
    const a = makeUser("sub-a", "에이");
    const b = makeUser("sub-b", "비");
    sendMessage(a, b, "안녕");

    const fromA = getMessages(a, b);
    const fromB = getMessages(b, a);
    expect(fromA).toHaveLength(1);
    expect(fromB).toHaveLength(1);
    expect(fromA[0].text).toBe("안녕");
    expect(fromA[0].senderNickname).toBe("에이");
  });

  test("returns messages in chronological order (oldest first)", () => {
    const a = makeUser("sub-a", "에이");
    const b = makeUser("sub-b", "비");
    sendMessage(a, b, "첫번째");
    sendMessage(b, a, "두번째");
    sendMessage(a, b, "세번째");

    const messages = getMessages(a, b);
    expect(messages.map((m) => m.text)).toEqual(["첫번째", "두번째", "세번째"]);
  });

  test("only returns the most recent 100 messages", () => {
    const a = makeUser("sub-a", "에이");
    const b = makeUser("sub-b", "비");
    for (let i = 0; i < 101; i++) sendMessage(a, b, `msg-${i}`);

    const messages = getMessages(a, b);
    expect(messages).toHaveLength(100);
    expect(messages[0].text).toBe("msg-1");
    expect(messages[messages.length - 1].text).toBe("msg-100");
  });

  test("getUnreadCount counts only messages sent by the other person", () => {
    const a = makeUser("sub-a", "에이");
    const b = makeUser("sub-b", "비");
    sendMessage(b, a, "하나");
    sendMessage(b, a, "둘");
    sendMessage(a, b, "내가 보낸 것 (안 셈)");

    expect(getUnreadCount(a, b)).toBe(2);
  });

  test("markRead resets unread count to zero", () => {
    const a = makeUser("sub-a", "에이");
    const b = makeUser("sub-b", "비");
    sendMessage(b, a, "하나");
    sendMessage(b, a, "둘");

    markRead(a, b);
    expect(getUnreadCount(a, b)).toBe(0);
  });

  test("only messages after the last read point count as unread again", () => {
    const a = makeUser("sub-a", "에이");
    const b = makeUser("sub-b", "비");
    sendMessage(b, a, "하나");
    markRead(a, b);

    sendMessage(b, a, "둘");
    expect(getUnreadCount(a, b)).toBe(1);
  });

  test("markRead with no messages from the other person is a no-op", () => {
    const a = makeUser("sub-a", "에이");
    const b = makeUser("sub-b", "비");
    expect(() => markRead(a, b)).not.toThrow();
    expect(getUnreadCount(a, b)).toBe(0);
  });
});
