import { db } from "../db/connection";

export type UserIpEntry = {
  ip: string;
  firstSeen: string;
  lastSeen: string;
};

// ip가 "unknown"이면(캡처 실패) 기록하지 않는다 — 의미 없는 값이라 저장할
// 필요가 없다. PRIMARY KEY (user_id, ip) 제약이 "같은 IP면 last_seen만
// 갱신, 다른 IP면 새 행"을 알아서 처리하므로 애플리케이션 코드에서 별도로
// "이전 값과 비교"할 필요가 없다.
export function recordUserIp(userId: number, ip: string): void {
  if (ip === "unknown") return;
  db.prepare(
    `INSERT INTO user_ips (user_id, ip) VALUES (?, ?)
     ON CONFLICT(user_id, ip) DO UPDATE SET last_seen = datetime('now', '+9 hours')`,
  ).run(userId, ip);
}

// 최근에 쓴 IP가 먼저 나오도록 last_seen 내림차순으로 반환한다.
export function getIpsForUser(userId: number): UserIpEntry[] {
  const rows = db
    .prepare(`SELECT ip, first_seen, last_seen FROM user_ips WHERE user_id = ? ORDER BY last_seen DESC`)
    .all(userId) as { ip: string; first_seen: string; last_seen: string }[];
  return rows.map((r) => ({ ip: r.ip, firstSeen: r.first_seen, lastSeen: r.last_seen }));
}

export function _resetForTest(): void {
  db.exec(`DELETE FROM user_ips`);
}
