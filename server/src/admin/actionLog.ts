import { db } from "../db/connection";

export type AdminAction = {
  timestamp: number;
  nickname: string;
  action: string;
  detail: string;
  ip: string;
};

// 조사 대상 계정 하나만 하드코딩 — 클라이언트 번들에는 이 문자열이 절대 노출되지
// 않는다(GET /api/auth/me가 이 함수로 계산한 trackActions 불리언만 클라이언트로
// 내려보낸다). 대상이 바뀌면 여기 한 곳만 고치면 된다.
const TRACKED_NICKNAME = "렌아";

export function isTrackedNickname(nickname: string): boolean {
  return nickname === TRACKED_NICKNAME;
}

// 대상이 아닌 닉네임은 조용히 무시한다 — 호출부(MatchRoom.ts, createServer.ts)가
// 매번 isTrackedNickname을 먼저 체크할 필요 없이 항상 호출만 하면 되게 하기 위함.
export function recordAction(action: AdminAction): void {
  if (!isTrackedNickname(action.nickname)) return;
  db.prepare(
    `INSERT INTO action_log (timestamp, nickname, action, detail, ip) VALUES (?, ?, ?, ?, ?)`,
  ).run(action.timestamp, action.nickname, action.action, action.detail, action.ip);
}

// 시간순(오래된 것 먼저) — eventLog.ts의 getEvents()와 동일한 순서 계약.
export function getActionLog(limit = 500): AdminAction[] {
  const rows = db
    .prepare(`SELECT timestamp, nickname, action, detail, ip FROM action_log ORDER BY id DESC LIMIT ?`)
    .all(limit) as AdminAction[];
  return rows.reverse();
}

export function _resetForTest(): void {
  db.prepare(`DELETE FROM action_log`).run();
}
