import { db } from "../db/connection";

export type AdminEvent = {
  type: "join" | "leave" | "spectate_join" | "spectate_leave";
  timestamp: number;
  nickname: string;
  roomId: string;
  roomTitle: string;
  ip: string;
  sessionId: string;
};

// 관리자 대시보드의 "최근 입장/퇴장" 목록이 한 번에 돌려주는 최대 개수 — DB 자체는
// 훨씬 오래(db/connection.ts의 90일 보관기한만큼) 보관하므로, 이 개수를 넘는 과거 기록은
// 이 함수가 아니라 DB를 직접 조회해서 찾아야 한다.
const MAX_EVENTS = 500;

// IP가 포함된 로그를 얼마나 보관할지는 db/connection.ts의 createDb()가 DB 오픈 시점
// (서버 시작 시 1회)에 정리한다 — 예전엔 여기 recordEvent()가 호출될 때마다 같이
// DELETE했는데, 그러면 입장/퇴장마다 동기 디스크 쓰기가 하나 더 늘어 다른 방의 버튼 입력
// 처리까지 순간적으로 지연시킬 수 있었음(단일 프로세스가 모든 방을 처리하므로).

export function recordEvent(event: AdminEvent): void {
  db.prepare(
    `INSERT INTO events (type, timestamp, nickname, room_id, room_title, ip, session_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(event.type, event.timestamp, event.nickname, event.roomId, event.roomTitle, event.ip, event.sessionId);
}

// 시간순(오래된 것 먼저) — 기존 인메모리 버전과 같은 순서 계약을 유지해서 호출부
// (createServer.ts의 slice(-100), AdminDashboard.tsx의 reverse())가 그대로 동작한다.
export function getEvents(): AdminEvent[] {
  const rows = db
    .prepare(
      `SELECT type, timestamp, nickname, room_id AS roomId, room_title AS roomTitle, ip, session_id AS sessionId
       FROM events ORDER BY id DESC LIMIT ?`,
    )
    .all(MAX_EVENTS) as AdminEvent[];
  return rows.reverse();
}

// getEvents()의 최근 500건 제한과 별개로, 특정 유저의 과거 IP 등을 찾을 때 쓴다.
// nickname은 부분 일치(LIKE) — "서하"로 검색하면 "서햐"는 안 걸리지만 "서하맘"처럼
// 앞뒤에 뭔가 붙은 닉네임은 걸리게, 정확한 철자를 모를 때도 찾기 쉽게 하기 위함.
// LIKE의 %/_ 와일드카드 문자는 그대로 리터럴 취급되지 않으므로 ESCAPE로 이스케이프한다.
export function searchEventsByNickname(nickname: string, limit = 200): AdminEvent[] {
  const escaped = nickname.replace(/[%_\\]/g, "\\$&");
  const rows = db
    .prepare(
      `SELECT type, timestamp, nickname, room_id AS roomId, room_title AS roomTitle, ip, session_id AS sessionId
       FROM events WHERE nickname LIKE ? ESCAPE '\\' ORDER BY id DESC LIMIT ?`,
    )
    .all(`%${escaped}%`, limit) as AdminEvent[];
  return rows;
}

export function _resetForTest(): void {
  db.prepare(`DELETE FROM events`).run();
}
