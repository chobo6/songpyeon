import { db } from "../db/connection";

export type ChatLogEntry = {
  nickname: string;
  text: string;
  createdAt: string;
};

export function recordChatLog(nickname: string, text: string): void {
  db.prepare(`INSERT INTO chat_logs (nickname, text) VALUES (?, ?)`).run(nickname, text);
}

// 최근 메시지가 먼저 나오도록 최신순으로 반환한다.
export function getChatLogs(limit = 500): ChatLogEntry[] {
  const rows = db
    .prepare(`SELECT nickname, text, created_at AS createdAt FROM chat_logs ORDER BY id DESC LIMIT ?`)
    .all(limit) as ChatLogEntry[];
  return rows;
}

export function _resetForTest(): void {
  db.exec(`DELETE FROM chat_logs`);
}
