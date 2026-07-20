import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

// 세션 토큰 발급 후 이 시간이 지나면 자동으로 만료됨 — 로그아웃을 안 해도 무한정
// 유효하던 문제를 막기 위함. 관리자 페이지를 켜두고 며칠씩 방치하는 사용 패턴은
// 아니라고 가정하고 넉넉하게 12시간으로 잡음.
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

const sessions = new Map<string, number>(); // token -> expiresAt

// 문자열 길이가 다르면 즉시 false를 반환하는 일반 `===` 비교는, 정확한 비교
// 시간이 입력마다 미묘하게 달라져 타이밍 공격(응답 시간 차이로 한 글자씩
// 맞혀나가는 공격)에 이론상 노출됨. 두 값을 먼저 고정 길이(32바이트)로
// 해시한 뒤 그 해시값을 `timingSafeEqual`로 비교하면, 원본 문자열 길이가
// 서로 달라도 항상 같은 길이를 비교하게 되어 이 문제가 사라짐.
function sha256(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

export function checkPassword(password: string): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (typeof expected !== "string" || expected.length === 0) return false;
  return timingSafeEqual(sha256(password), sha256(expected));
}

export function createSession(): string {
  const token = randomBytes(32).toString("hex");
  sessions.set(token, Date.now() + SESSION_TTL_MS);
  return token;
}

export function isValidSession(token: string | undefined): boolean {
  if (typeof token !== "string") return false;
  const expiresAt = sessions.get(token);
  if (expiresAt === undefined) return false;
  if (Date.now() >= expiresAt) {
    sessions.delete(token);
    return false;
  }
  return true;
}

export function destroySession(token: string | undefined): void {
  if (typeof token === "string") {
    sessions.delete(token);
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const cookies = (req as unknown as { cookies?: Record<string, string> }).cookies;
  if (!isValidSession(cookies?.admin_session)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
}

export function _resetForTest(): void {
  sessions.clear();
}
