import { db } from "../db/connection";

export type AdminEvent = {
  type: "join" | "leave";
  timestamp: number;
  nickname: string;
  roomId: string;
  roomTitle: string;
  ip: string;
  sessionId: string;
};

// 관리자 대시보드의 "최근 입장/퇴장" 목록이 한 번에 돌려주는 최대 개수 — DB 자체는
// RETENTION_DAYS만큼 더 오래 보관하므로, 이 개수를 넘는 과거 기록은 이 함수가 아니라
// DB를 직접 조회해서 찾아야 한다.
const MAX_EVENTS = 500;

// IP가 포함된 로그를 얼마나 보관할지. 예전엔 서버 메모리에만 있어서 재시작(재배포)
// 때마다 사라졌음 — 특정 유저의 과거 IP를 나중에 찾으려 했더니 이미 날아가 있던 사고로
// DB 저장으로 옮김. 용량은 하루 수천 건이 쌓여도 한 달에 수십MB 수준이라 문제가 아니고,
// 그보다는 개인 데이터(IP)를 무기한 쌓아두지 않기 위한 선택.
const RETENTION_DAYS = 90;

export function recordEvent(event: AdminEvent): void {
  db.prepare(
    `INSERT INTO events (type, timestamp, nickname, room_id, room_title, ip, session_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(event.type, event.timestamp, event.nickname, event.roomId, event.roomTitle, event.ip, event.sessionId);

  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  db.prepare(`DELETE FROM events WHERE timestamp < ?`).run(cutoff);
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
