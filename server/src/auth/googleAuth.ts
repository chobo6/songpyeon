import { OAuth2Client } from "google-auth-library";
import { db } from "../db/connection";
import { sanitizeNickname } from "../game/nickname";

let oauthClient: OAuth2Client | null = null;
function getOAuthClient(): OAuth2Client {
  if (!oauthClient) oauthClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
  return oauthClient;
}

// Google ID 토큰(credential)을 검증해 { sub, email, name }을 반환한다.
// 검증 실패(서명/audience 불일치, 만료 등) 시 throw — 호출부(라우트)가 catch해서 401 처리
export async function verifyGoogleIdToken(
  credential: string,
): Promise<{ sub: string; email?: string; name?: string }> {
  const audience = process.env.GOOGLE_CLIENT_ID;
  // audience가 undefined면 google-auth-library가 aud 클레임 검증 자체를 건너뛰어, 이 앱이
  // 아닌 다른 OAuth 클라이언트용으로 발급된 토큰도 통과해버린다 — 반드시 명시적으로 실패시킨다
  if (!audience) throw new Error("GOOGLE_CLIENT_ID가 설정되지 않았습니다.");
  const client = getOAuthClient();
  const ticket = await client.verifyIdToken({ idToken: credential, audience });
  const payload = ticket.getPayload();
  if (!payload?.sub) throw new Error("구글 토큰에 sub 클레임이 없습니다.");
  return { sub: payload.sub, email: payload.email, name: payload.name };
}

export type UserProfile = { id: number; nickname: string | null };

// googleSub 기준 upsert — UNIQUE(google_sub) + ON CONFLICT로 존재 확인/생성/갱신을 원자적으로 처리.
// 닉네임은 이 시점에 건드리지 않는다 — 로그인할 때마다 구글 실명(name)이 사용자가 정한 닉네임을
// 덮어쓰면 안 되기 때문 (신규 생성 시에만 nickname은 NULL로 남는다).
export function getOrCreateUser(googleSub: string, info: { email?: string; name?: string }): UserProfile {
  db.prepare(
    `INSERT INTO users (google_sub, email, name)
     VALUES (?, ?, ?)
     ON CONFLICT(google_sub) DO UPDATE SET
       email = COALESCE(excluded.email, users.email),
       name = COALESCE(excluded.name, users.name)`,
  ).run(googleSub, info.email ?? null, info.name ?? null);

  return db.prepare(`SELECT id, nickname FROM users WHERE google_sub = ?`).get(googleSub) as UserProfile;
}

// 닉네임이 아직 없는 계정에만 설정한다 (이번 스코프는 "최초 1회 설정, 이후 수정 불가").
// 이미 설정되어 있으면 false를 반환 — 호출부(라우트)가 409로 응답한다.
export function setNickname(userId: number, nickname: string): boolean {
  const clean = sanitizeNickname(nickname);
  const result = db.prepare(`UPDATE users SET nickname = ? WHERE id = ? AND nickname IS NULL`).run(clean, userId);
  return result.changes > 0;
}

export function getUserById(userId: number): UserProfile | undefined {
  return db.prepare(`SELECT id, nickname FROM users WHERE id = ?`).get(userId) as UserProfile | undefined;
}
