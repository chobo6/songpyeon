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
  maxRound: number;
  pigPlayCount: number;
  rabbitPlayCount: number;
  gameMoney: number;
};

// googleSub 기준 조회 후 생성/갱신 — 이 함수는 로그인할 때마다(신규 계정이든 재로그인이든)
// 호출되므로, last_login_at을 매번 갱신하는 자리로도 그대로 쓴다 — 별도의 "로그인 이벤트"
// 배선이 필요 없다. 닉네임은 이 시점에 건드리지 않는다 — 로그인할 때마다 구글 실명(name)이
// 사용자가 정한 닉네임을 덮어쓰면 안 되기 때문 (신규 생성 시에만 nickname은 NULL로 남는다).
//
// 예전엔 INSERT ... ON CONFLICT DO UPDATE 한 문장으로 처리했는데, SQLite가 재로그인(=매번
// UPDATE로 끝나는 경우)에도 AUTOINCREMENT 카운터를 하나씩 태워버려 id가 실제 유저 수보다
// 훨씬 빨리 늘어나는 부작용이 있었다. better-sqlite3는 완전히 동기적이고(이 사이의 await
// 없음) 이 프로세스는 단일 커넥션만 쓰므로, SELECT와 INSERT/UPDATE 사이에 다른 요청이
// 끼어들 수 없다 — 원자적 upsert 대신 조회 후 분기해도 안전하다.
export function getOrCreateUser(googleSub: string, info: { email?: string; name?: string }): UserProfile {
  const existing = db.prepare(`SELECT id FROM users WHERE google_sub = ?`).get(googleSub) as { id: number } | undefined;

  if (existing) {
    db.prepare(
      `UPDATE users SET
         email = COALESCE(?, email),
         name = COALESCE(?, name),
         last_login_at = datetime('now', '+9 hours')
       WHERE id = ?`,
    ).run(info.email ?? null, info.name ?? null, existing.id);
  } else {
    db.prepare(
      `INSERT INTO users (google_sub, email, name, created_at, last_login_at)
       VALUES (?, ?, ?, datetime('now', '+9 hours'), datetime('now', '+9 hours'))`,
    ).run(googleSub, info.email ?? null, info.name ?? null);
  }

  return db
    .prepare(
      `SELECT id, nickname, banned_at AS bannedAt, nickname_color AS nicknameColor,
              max_round AS maxRound, pig_play_count AS pigPlayCount, rabbit_play_count AS rabbitPlayCount,
              game_money AS gameMoney
       FROM users WHERE google_sub = ?`,
    )
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
    .prepare(
      `SELECT id, nickname, banned_at AS bannedAt, nickname_color AS nicknameColor,
              max_round AS maxRound, pig_play_count AS pigPlayCount, rabbit_play_count AS rabbitPlayCount,
              game_money AS gameMoney
       FROM users WHERE id = ?`,
    )
    .get(userId) as UserProfile | undefined;
}

// getOrCreateUser의 last_login_at 갱신은 실제 구글 로그인 팝업을 거칠 때만 호출된다
// (/api/auth/google). 세션 쿠키가 30일 유효해서, 이미 로그인된 상태로 재방문하면
// /api/auth/me(세션 검증만 하고 끝)만 타고 그쪽은 아예 안 거치므로 "최근 로그인"이
// 30일 동안 안 바뀌는 문제가 있었음 — /api/auth/me가 세션을 확인할 때마다 이걸 불러
// "최근 접속" 의미에 가깝게 만든다.
export function touchLastLogin(userId: number): void {
  db.prepare(`UPDATE users SET last_login_at = datetime('now', '+9 hours') WHERE id = ?`).run(userId);
}

export type AdminUserRow = {
  id: number;
  email: string | null;
  name: string | null;
  nickname: string | null;
  bannedAt: string | null;
  nicknameColor: string | null;
  createdAt: string;
  lastLoginAt: string | null;
};

export function listUsers(): AdminUserRow[] {
  return db
    .prepare(
      `SELECT id, email, name, nickname, banned_at AS bannedAt, nickname_color AS nicknameColor,
              created_at AS createdAt, last_login_at AS lastLoginAt
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

// 매치가 실제로 시작될 때(대기 화면 카운트다운이 끝나는 시점) 그 판에 배정된
// 역할로 +1 — 관전자는 대상이 아니고, 중간에 나가도 이미 카운트된 판은 그대로
// 유지된다(끝까지 완주했는지가 아니라 그 역할로 몇 번 시작했는지를 센다).
export function recordRolePlayed(userId: number, role: "pig" | "rabbit"): void {
  if (role === "pig") {
    db.prepare(`UPDATE users SET pig_play_count = pig_play_count + 1 WHERE id = ?`).run(userId);
  } else {
    db.prepare(`UPDATE users SET rabbit_play_count = rabbit_play_count + 1 WHERE id = ?`).run(userId);
  }
}

// 팀이 자기 차례(턴)를 성공적으로 완료할 때마다 호출된다(MatchRoom.ts의
// handlePressButton, turnOutcome이 "success"로 확정되는 지점). amount는
// 호출부에서 이미 "10 × 팀 수"로 계산해서 넘겨준다 — 여기서는 그냥 누적만 한다.
export function addGameMoney(userId: number, amount: number): void {
  db.prepare(`UPDATE users SET game_money = game_money + ? WHERE id = ?`).run(amount, userId);
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
