import { db } from "../db/connection";

export type DirectMessageEntry = {
  id: number;
  senderId: number;
  senderNickname: string;
  senderNicknameColor: string | null;
  text: string;
  createdAt: string;
};

const HISTORY_LIMIT = 100;

// 최근 100개, 시간순(오래된 것 먼저) — 화면에 그대로 위에서 아래로 뿌릴 수 있는 순서.
export function getMessages(userId: number, otherUserId: number): DirectMessageEntry[] {
  const rows = db
    .prepare(
      `SELECT m.id AS id, m.sender_id AS senderId, u.nickname AS senderNickname,
              u.nickname_color AS senderNicknameColor, m.text AS text, m.created_at AS createdAt
       FROM direct_messages m
       JOIN users u ON u.id = m.sender_id
       WHERE (m.sender_id = ? AND m.recipient_id = ?) OR (m.sender_id = ? AND m.recipient_id = ?)
       ORDER BY m.id DESC
       LIMIT ?`,
    )
    .all(userId, otherUserId, otherUserId, userId, HISTORY_LIMIT) as DirectMessageEntry[];
  return rows.reverse();
}

export function sendMessage(senderId: number, recipientId: number, text: string): void {
  db.prepare(`INSERT INTO direct_messages (sender_id, recipient_id, text) VALUES (?, ?, ?)`).run(
    senderId,
    recipientId,
    text,
  );
}

export function markRead(userId: number, otherUserId: number): void {
  const latest = db
    .prepare(`SELECT MAX(id) AS maxId FROM direct_messages WHERE sender_id = ? AND recipient_id = ?`)
    .get(otherUserId, userId) as { maxId: number | null };
  if (latest.maxId === null) return;

  db.prepare(
    `INSERT INTO chat_read_state (user_id, other_user_id, last_read_message_id)
     VALUES (?, ?, ?)
     ON CONFLICT(user_id, other_user_id) DO UPDATE SET last_read_message_id = excluded.last_read_message_id`,
  ).run(userId, otherUserId, latest.maxId);
}

// 상대(otherUserId)가 나(userId)에게 보낸 것 중, 내가 마지막으로 읽은 지점 이후 것만 센다.
export function getUnreadCount(userId: number, otherUserId: number): number {
  const readState = db
    .prepare(
      `SELECT last_read_message_id AS lastReadMessageId FROM chat_read_state WHERE user_id = ? AND other_user_id = ?`,
    )
    .get(userId, otherUserId) as { lastReadMessageId: number } | undefined;
  const lastReadMessageId = readState?.lastReadMessageId ?? 0;

  const row = db
    .prepare(`SELECT COUNT(*) AS c FROM direct_messages WHERE sender_id = ? AND recipient_id = ? AND id > ?`)
    .get(otherUserId, userId, lastReadMessageId) as { c: number };
  return row.c;
}
