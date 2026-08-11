import { db } from "../db/connection";

export type NicknameChangeSource = "initial" | "ticket" | "admin";

export type NicknameHistoryEntry = {
  oldNickname: string | null;
  newNickname: string;
  source: NicknameChangeSource;
  changedAt: string;
};

export function recordNicknameChange(
  userId: number,
  oldNickname: string | null,
  newNickname: string,
  source: NicknameChangeSource,
): void {
  db.prepare(
    `INSERT INTO nickname_history (user_id, old_nickname, new_nickname, source) VALUES (?, ?, ?, ?)`,
  ).run(userId, oldNickname, newNickname, source);
}

export function getNicknameHistory(userId: number): NicknameHistoryEntry[] {
  const rows = db
    .prepare(
      `SELECT old_nickname AS oldNickname, new_nickname AS newNickname, source, changed_at AS changedAt
       FROM nickname_history WHERE user_id = ? ORDER BY id DESC`,
    )
    .all(userId) as NicknameHistoryEntry[];
  return rows;
}

// 특정 닉네임(과거에 썼던 것 포함)으로 검색 — old_nickname과 new_nickname 둘 다 대상.
export function searchNicknameHistory(nickname: string): (NicknameHistoryEntry & { userId: number })[] {
  const rows = db
    .prepare(
      `SELECT user_id AS userId, old_nickname AS oldNickname, new_nickname AS newNickname, source, changed_at AS changedAt
       FROM nickname_history WHERE old_nickname = ? OR new_nickname = ? ORDER BY id DESC`,
    )
    .all(nickname, nickname) as (NicknameHistoryEntry & { userId: number })[];
  return rows;
}

export function _resetForTest(): void {
  db.exec(`DELETE FROM nickname_history`);
}
