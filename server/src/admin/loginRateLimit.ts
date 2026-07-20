// /api/admin/login에 비밀번호를 무한정 계속 찔러볼 수 있던 문제 방지용 — 관리자
// 비밀번호가 유일한 방어선이라, 시도 횟수 제한이 없으면 사실상 그 비밀번호 하나만
// 뚫으면 되는 구조였음. IP별로 일정 횟수 실패하면 잠깐 잠그는 단순한 고정 윈도우
// 방식(라이브러리 없이 이 프로젝트의 다른 admin/* 모듈과 같은 스타일).
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

const attempts = new Map<string, { count: number; windowStart: number }>();

export function isRateLimited(ip: string): boolean {
  const entry = attempts.get(ip);
  if (!entry) return false;
  if (Date.now() - entry.windowStart >= WINDOW_MS) {
    attempts.delete(ip);
    return false;
  }
  return entry.count >= MAX_ATTEMPTS;
}

export function recordFailedAttempt(ip: string): void {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || now - entry.windowStart >= WINDOW_MS) {
    attempts.set(ip, { count: 1, windowStart: now });
    return;
  }
  entry.count++;
}

// 로그인에 성공하면 그 IP의 실패 기록을 지움 — 비밀번호를 몇 번 틀렸다가 맞게
// 입력한 정상적인 경우까지 남은 시도 횟수가 깎인 채로 남지 않도록.
export function recordSuccessfulLogin(ip: string): void {
  attempts.delete(ip);
}

export function _resetForTest(): void {
  attempts.clear();
}
