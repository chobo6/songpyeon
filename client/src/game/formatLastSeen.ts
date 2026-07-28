// lastLoginAt: DB에서 온 "YYYY-MM-DD HH:MM:SS"(KST, server/src/db/connection.ts의
// datetime('now', '+9 hours') 컨벤션 — 이미 +9시간 적용된 문자열, UTC 오프셋 없음).
// SQLite datetime()의 공백 구분 형식은 브라우저마다 Date 파싱이 일관되지 않을 수 있어서,
// 공백을 "T"로 바꾸고 KST 오프셋을 붙여 표준 ISO 8601로 만든 뒤 파싱한다.
export function formatLastSeen(lastLoginAt: string | null): string {
  if (!lastLoginAt) return "접속 기록 없음";
  const diffMs = Date.now() - new Date(`${lastLoginAt.replace(" ", "T")}+09:00`).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "방금 전";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  return `${days}일 전`;
}
