import { OAuth2Client } from "google-auth-library";
import { db, sqliteBool } from "../db/connection";
import { sanitizeNickname } from "../game/nickname";

export type NicknameEffect = "none" | "rainbow" | "shine" | "hologram" | "pulse" | "neon" | "chrome";
export const NICKNAME_EFFECTS: readonly NicknameEffect[] = [
  "none",
  "rainbow",
  "shine",
  "hologram",
  "pulse",
  "neon",
  "chrome",
];

export type NicknameParticle = "none" | "twinkle" | "rising" | "orbit" | "snow";
export const NICKNAME_PARTICLES: readonly NicknameParticle[] = ["none", "twinkle", "rising", "orbit", "snow"];

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
  nicknameEffect: NicknameEffect;
  nicknameGlow: boolean;
  nicknameParticle: NicknameParticle;
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

  const row = db
    .prepare(
      `SELECT id, nickname, banned_at AS bannedAt, nickname_color AS nicknameColor,
              max_round AS maxRound, pig_play_count AS pigPlayCount, rabbit_play_count AS rabbitPlayCount,
              game_money AS gameMoney, nickname_effect AS nicknameEffect, nickname_glow AS nicknameGlow,
              nickname_particle AS nicknameParticle
       FROM users WHERE google_sub = ?`,
    )
    .get(googleSub) as Omit<UserProfile, "nicknameGlow"> & { nicknameGlow: number };
  return { ...row, nicknameGlow: sqliteBool(row.nicknameGlow) };
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
  const row = db
    .prepare(
      `SELECT id, nickname, banned_at AS bannedAt, nickname_color AS nicknameColor,
              max_round AS maxRound, pig_play_count AS pigPlayCount, rabbit_play_count AS rabbitPlayCount,
              game_money AS gameMoney, nickname_effect AS nicknameEffect, nickname_glow AS nicknameGlow,
              nickname_particle AS nicknameParticle
       FROM users WHERE id = ?`,
    )
    .get(userId) as (Omit<UserProfile, "nicknameGlow"> & { nicknameGlow: number }) | undefined;
  if (!row) return undefined;
  return { ...row, nicknameGlow: sqliteBool(row.nicknameGlow) };
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
  nicknameEffect: NicknameEffect;
  nicknameGlow: boolean;
  nicknameParticle: NicknameParticle;
  gameMoney: number;
};

export function listUsers(): AdminUserRow[] {
  const rows = db
    .prepare(
      `SELECT id, email, name, nickname, banned_at AS bannedAt, nickname_color AS nicknameColor,
              created_at AS createdAt, last_login_at AS lastLoginAt,
              nickname_effect AS nicknameEffect, nickname_glow AS nicknameGlow,
              nickname_particle AS nicknameParticle, game_money AS gameMoney
       FROM users ORDER BY id DESC`,
    )
    .all() as (Omit<AdminUserRow, "nicknameGlow"> & { nicknameGlow: number })[];
  return rows.map((row) => ({
    ...row,
    nicknameGlow: sqliteBool(row.nicknameGlow),
  }));
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

// 색(setNicknameColor)과 완전히 같은 자리 — 관리자가 /admin에서 select+체크박스로
// 즉시 바꾼다. effect 유효성 검증은 라우트 레벨(NICKNAME_EFFECTS 화이트리스트)에서
// 이미 끝나므로 이 함수 자체는 실패 케이스가 없어 결과 타입도 없음(항상 성공).
// 관리자가 지급한 효과는 상점에서 산 것과 동일하게 소유 처리한다 — 안 그러면 유저가
// 나중에 다른 효과로 장착을 바꿨다가 이걸로 스스로 되돌아올 수 없다.
export function setNicknameEffect(
  userId: number,
  effect: NicknameEffect,
  glow: boolean,
  particle: NicknameParticle,
): void {
  const previous = db.prepare(`SELECT nickname_effect AS effect FROM users WHERE id = ?`).get(userId) as
    | { effect: NicknameEffect }
    | undefined;
  db.prepare(`UPDATE users SET nickname_effect = ?, nickname_glow = ?, nickname_particle = ? WHERE id = ?`).run(
    effect,
    glow ? 1 : 0,
    particle,
    userId,
  );
  if (effect !== "none") {
    db.prepare(`INSERT OR IGNORE INTO owned_nickname_effects (user_id, effect, source) VALUES (?, ?, 'admin')`).run(
      userId,
      effect,
    );
  } else if (previous && previous.effect !== "none") {
    // 관리자가 지급한 효과를 회수할 때만 소유권도 같이 지운다 — 실제로 구매한
    // 효과는 여기서 절대 지워지지 않는다(구매 시 source='purchase'로 기록됨).
    db.prepare(`DELETE FROM owned_nickname_effects WHERE user_id = ? AND effect = ? AND source = 'admin'`).run(
      userId,
      previous.effect,
    );
  }
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
  db.prepare(`UPDATE users SET game_money = MAX(0, game_money + ?) WHERE id = ?`).run(amount, userId);
}

export type RankingEntry = {
  nickname: string;
  nicknameColor: string | null;
  maxRound: number;
  nicknameEffect: NicknameEffect;
  nicknameGlow: boolean;
  nicknameParticle: NicknameParticle;
};

// nickname IS NOT NULL is defensive (every account reaching a round already
// has one) — max_round > 0 keeps accounts that never finished a round out
// of the list instead of padding the top 10 with ties at 0.
export function getTopRanking(limit: number): RankingEntry[] {
  const rows = db
    .prepare(
      `SELECT nickname, nickname_color AS nicknameColor, max_round AS maxRound,
              nickname_effect AS nicknameEffect, nickname_glow AS nicknameGlow,
              nickname_particle AS nicknameParticle
       FROM users
       WHERE nickname IS NOT NULL AND max_round > 0
       ORDER BY max_round DESC, id ASC
       LIMIT ?`,
    )
    .all(limit) as (Omit<RankingEntry, "nicknameGlow"> & { nicknameGlow: number })[];
  return rows.map((row) => ({
    ...row,
    nicknameGlow: sqliteBool(row.nicknameGlow),
  }));
}

export const NICKNAME_REROLL_COST = 6000;

export type RerollNicknameColorResult =
  | { ok: true; nicknameColor: string; gameMoney: number }
  | { ok: false; reason: "insufficient_funds" };

// 게임머니 10,000원을 차감하고 #RRGGBB(16^6가지) 중 하나를 균등 랜덤으로 뽑아
// nickname_color에 저장한다. 잔액 부족이면 아무것도 바꾸지 않고 실패를 반환한다.
// better-sqlite3는 완전히 동기적이라(이 두 문장 사이에 await 없음) 조회 후 UPDATE
// 사이에 다른 요청이 끼어들 수 없다 — getOrCreateUser의 기존 논리와 동일한 이유로
// 트랜잭션 없이도 원자적이다.
export function rerollNicknameColor(userId: number): RerollNicknameColorResult {
  const row = db.prepare(`SELECT game_money AS gameMoney FROM users WHERE id = ?`).get(userId) as
    | { gameMoney: number }
    | undefined;
  if (!row || row.gameMoney < NICKNAME_REROLL_COST) {
    return { ok: false, reason: "insufficient_funds" };
  }
  const color = randomHexColor();
  db.prepare(`UPDATE users SET game_money = game_money - ?, nickname_color = ? WHERE id = ?`).run(
    NICKNAME_REROLL_COST,
    color,
    userId,
  );
  return { ok: true, nicknameColor: color, gameMoney: row.gameMoney - NICKNAME_REROLL_COST };
}

function randomHexColor(): string {
  const n = Math.floor(Math.random() * 0x1000000);
  return `#${n.toString(16).padStart(6, "0")}`;
}

export const NICKNAME_TICKET_COST = 30000;

export type UseNicknameTicketResult = "ok" | "taken" | "insufficient_funds";

// setNickname과 같은 유니크 체크를 쓰되, "이미 설정된 닉네임"이라는 이유로 막지 않는다
// (그게 이 아이템의 존재 이유 — 최초 1회 제한을 유료로 우회). 유니크 확인 → 잔액 확인 →
// 차감+변경 순서 — 유니크 확인이 공짜라 먼저 걸러서, 어차피 실패할 요청 때문에 돈부터
// 빠지는 일이 없게 한다.
export function useNicknameTicket(userId: number, nickname: string): UseNicknameTicketResult {
  const clean = sanitizeNickname(nickname);
  const taken = db.prepare(`SELECT 1 FROM users WHERE nickname = ? AND id != ?`).get(clean, userId);
  if (taken) return "taken";
  const row = db.prepare(`SELECT game_money AS gameMoney FROM users WHERE id = ?`).get(userId) as
    | { gameMoney: number }
    | undefined;
  if (!row || row.gameMoney < NICKNAME_TICKET_COST) return "insufficient_funds";
  db.prepare(`UPDATE users SET game_money = game_money - ?, nickname = ? WHERE id = ?`).run(
    NICKNAME_TICKET_COST,
    clean,
    userId,
  );
  return "ok";
}

export const MEGAPHONE_COST = 3000;

export type UseMegaphoneResult = { ok: true; gameMoney: number } | { ok: false; reason: "insufficient_funds" };

// 방송 자체(누구에게 보여줄지)는 이 함수의 관심사가 아님 — 여기서는 잔액만 확인/차감하고,
// 실제 SSE 방송은 라우트가 game/megaphone.ts의 broadcast()를 따로 호출한다.
export function useMegaphone(userId: number): UseMegaphoneResult {
  const row = db.prepare(`SELECT game_money AS gameMoney FROM users WHERE id = ?`).get(userId) as
    | { gameMoney: number }
    | undefined;
  if (!row || row.gameMoney < MEGAPHONE_COST) return { ok: false, reason: "insufficient_funds" };
  db.prepare(`UPDATE users SET game_money = game_money - ? WHERE id = ?`).run(MEGAPHONE_COST, userId);
  return { ok: true, gameMoney: row.gameMoney - MEGAPHONE_COST };
}

export type ShopEffect = Exclude<NicknameEffect, "none">;

// 임시 가격 — 나중에 이 숫자들만 바꾸면 됨.
export const SHOP_PRICES: Record<ShopEffect, number> = {
  rainbow: 1500000,
  shine: 500000,
  hologram: 1500000,
  pulse: 500000,
  neon: 500000,
  chrome: 600000,
};

export function getOwnedEffects(userId: number): NicknameEffect[] {
  const rows = db.prepare(`SELECT effect FROM owned_nickname_effects WHERE user_id = ?`).all(userId) as {
    effect: NicknameEffect;
  }[];
  return rows.map((row) => row.effect);
}

export type PurchaseEffectResult = "ok" | "insufficient_funds" | "already_owned";

// 이미 소유했는지부터 확인(중복 결제 방지) — 그다음 잔액 확인 후 차감+INSERT.
// better-sqlite3는 완전히 동기적이라 이 세 문장 사이에 다른 요청이 끼어들 수 없다.
export function purchaseEffect(userId: number, effect: ShopEffect): PurchaseEffectResult {
  const alreadyOwned = db
    .prepare(`SELECT 1 FROM owned_nickname_effects WHERE user_id = ? AND effect = ?`)
    .get(userId, effect);
  if (alreadyOwned) return "already_owned";

  const price = SHOP_PRICES[effect];
  const row = db.prepare(`SELECT game_money AS gameMoney FROM users WHERE id = ?`).get(userId) as
    | { gameMoney: number }
    | undefined;
  if (!row || row.gameMoney < price) return "insufficient_funds";

  db.prepare(`UPDATE users SET game_money = game_money - ? WHERE id = ?`).run(price, userId);
  db.prepare(`INSERT INTO owned_nickname_effects (user_id, effect, source) VALUES (?, ?, 'purchase')`).run(
    userId,
    effect,
  );
  return "ok";
}

export type EquipEffectResult = "ok" | "not_owned";

// glow는 안 건드린다(이번 스코프 제외 — 관리자가 지급한 글로우 상태를 장착 변경이
// 실수로 꺼버리면 안 됨). "none"은 항상 허용(장착 해제).
export function equipEffect(userId: number, effect: NicknameEffect): EquipEffectResult {
  if (effect !== "none") {
    const owned = db
      .prepare(`SELECT 1 FROM owned_nickname_effects WHERE user_id = ? AND effect = ?`)
      .get(userId, effect);
    if (!owned) return "not_owned";
  }
  db.prepare(`UPDATE users SET nickname_effect = ? WHERE id = ?`).run(effect, userId);
  return "ok";
}
