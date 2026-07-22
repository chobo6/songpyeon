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

export type UserProfile = {
  id: number;
  nickname: string | null;
  bannedAt: string | null;
  nicknameColor: string | null;
};

// googleSub 기준 upsert — UNIQUE(google_sub) + ON CONFLICT로 존재 확인/생성/갱신을 원자적으로 처리.
// 닉네임은 이 시점에 건드리지 않는다 — 로그인할 때마다 구글 실명(name)이 사용자가 정한 닉네임을
// 덮어쓰면 안 되기 때문 (신규 생성 시에만 nickname은 NULL로 남는다).
export function getOrCreateUser(googleSub: string, info: { email?: string; name?: string }): UserProfile {
  db.prepare(
    `INSERT INTO users (google_sub, email, name, created_at)
     VALUES (?, ?, ?, datetime('now', '+9 hours'))
     ON CONFLICT(google_sub) DO UPDATE SET
       email = COALESCE(excluded.email, users.email),
       name = COALESCE(excluded.name, users.name)`,
  ).run(googleSub, info.email ?? null, info.name ?? null);

  return db
    .prepare(`SELECT id, nickname, banned_at AS bannedAt, nickname_color AS nicknameColor FROM users WHERE google_sub = ?`)
    .get(googleSub) as UserProfile;
}

export type SetNicknameResult = "ok" | "already_set" | "taken";

// 닉네임이 아직 없는 계정에만 설정한다 (이번 스코프는 "최초 1회 설정, 이후 수정 불가").
// 이미 설정되어 있으면 "already_set", 다른 계정이 이미 쓰고 있는 닉네임이면 "taken"을
// 반환 — 호출부(라우트)가 각각 다른 메시지로 409 응답한다.
export function setNickname(userId: number, nickname: string): SetNicknameResult {
  const clean = sanitizeNickname(nickname);
  const taken = db.prepare(`SELECT 1 FROM users WHERE nickname = ? AND id != ?`).get(clean, userId);
  if (taken) return "taken";
  const result = db.prepare(`UPDATE users SET nickname = ? WHERE id = ? AND nickname IS NULL`).run(clean, userId);
  return result.changes > 0 ? "ok" : "already_set";
}

export function getUserById(userId: number): UserProfile | undefined {
  return db
    .prepare(`SELECT id, nickname, banned_at AS bannedAt, nickname_color AS nicknameColor FROM users WHERE id = ?`)
    .get(userId) as UserProfile | undefined;
}

export type AdminUserRow = {
  id: number;
  email: string | null;
  name: string | null;
  nickname: string | null;
  bannedAt: string | null;
  nicknameColor: string | null;
  createdAt: string;
};

export function listUsers(): AdminUserRow[] {
  return db
    .prepare(
      `SELECT id, email, name, nickname, banned_at AS bannedAt, nickname_color AS nicknameColor, created_at AS createdAt
       FROM users ORDER BY id DESC`,
    )
    .all() as AdminUserRow[];
}

export type AdminSetNicknameResult = "ok" | "taken";

// Unlike setNickname (self-service, "최초 1회만"), this is the admin
// override — it overwrites a nickname the account already has instead of
// refusing, since the whole point is fixing/relabeling an existing account.
// Uniqueness still applies (can't collide with another account's nickname).
export function adminSetNickname(userId: number, nickname: string): AdminSetNicknameResult {
  const clean = sanitizeNickname(nickname);
  const taken = db.prepare(`SELECT 1 FROM users WHERE nickname = ? AND id != ?`).get(clean, userId);
  if (taken) return "taken";
  db.prepare(`UPDATE users SET nickname = ? WHERE id = ?`).run(clean, userId);
  return "ok";
}

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

export type SetNicknameColorResult = "ok" | "invalid";

// color가 null이면(또는 빈 문자열이면) 색 제거 — 그 화면 기본 색으로 복귀.
export function setNicknameColor(userId: number, color: string | null): SetNicknameColorResult {
  const clean = color?.trim() || null;
  if (clean !== null && !HEX_COLOR_PATTERN.test(clean)) return "invalid";
  db.prepare(`UPDATE users SET nickname_color = ? WHERE id = ?`).run(clean, userId);
  return "ok";
}

export function setUserBanned(userId: number, banned: boolean): void {
  if (banned) {
    db.prepare(`UPDATE users SET banned_at = datetime('now', '+9 hours') WHERE id = ?`).run(userId);
  } else {
    db.prepare(`UPDATE users SET banned_at = NULL WHERE id = ?`).run(userId);
  }
}

// Only ever raises a user's personal best — MAX() in the UPDATE itself means
// a lower round reached in a later, shorter match can never overwrite a
// higher one from an earlier match (and makes the read-then-write race
// impossible, not just unlikely).
export function recordRoundAchievement(userId: number, round: number): void {
  db.prepare(`UPDATE users SET max_round = MAX(max_round, ?) WHERE id = ?`).run(round, userId);
}

export type RankingEntry = { nickname: string; nicknameColor: string | null; maxRound: number };

// nickname IS NOT NULL is defensive (every account reaching a round already
// has one) — max_round > 0 keeps accounts that never finished a round out
// of the list instead of padding the top 10 with ties at 0.
export function getTopRanking(limit: number): RankingEntry[] {
  return db
    .prepare(
      `SELECT nickname, nickname_color AS nicknameColor, max_round AS maxRound FROM users
       WHERE nickname IS NOT NULL AND max_round > 0
       ORDER BY max_round DESC, id ASC
       LIMIT ?`,
    )
    .all(limit) as RankingEntry[];
}
