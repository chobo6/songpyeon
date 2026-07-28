# 닉네임 특수효과(레인보우/글로우) 설계

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:writing-plans to turn this spec into an implementation plan.

**Goal:** 기존 닉네임 단색 지정(`nicknameColor`, 관리자가 `/admin`에서 수동 지급) 옆에 두 가지 특수효과를 추가한다 — **레인보우**(움직이는 그라데이션, 지정된 단색을 덮어씀)와 **글로우**(닉네임 자기 색 기준으로 빛나는 효과, 단독으로도 레인보우와 함께도 켤 수 있음). 지급 방식은 색과 완전히 동일하게 관리자가 `/admin`에서 유저별로 수동으로 켠다(상점/자동 지급 없음 — 다만 나중에 상점 기능이 추가되면 지금 만드는 데이터/함수를 그대로 재사용해 다른 진입점에서 같은 값을 켜주기만 하면 되는 구조로 만든다). 색이 이미 적용되던 모든 화면에 레인보우/글로우도 같이 적용하고, 이번 기회에 색 자체가 아직 없던 **관전자 목록**과 **친구창(친구 목록/받은 요청/보낸 요청 3개 탭 전부)** 에도 색+효과를 새로 추가한다.

**Architecture:** `users` 테이블에 `nickname_rainbow`/`nickname_glow` boolean 컬럼 두 개를 추가하고(기존 `pig_play_count` 등과 같은 이중 정의 패턴), 기존 `setNicknameColor`와 나란히 `setNicknameEffects(userId, {rainbow, glow})`를 추가한다. 닉네임을 렌더링하는 곳마다 지금은 `style={{ color: nicknameColor || undefined }}`를 각자 따로 쓰고 있어서, 클라이언트에 공용 헬퍼 `nicknameStyle(color, rainbow, glow)` 하나를 새로 만들어 모든 화면이 이걸 통해서만 스타일을 계산하게 한다(레인보우의 움직이는 그라데이션 CSS도 이 헬퍼 옆에 딱 한 번만 정의). 인게임 실시간 데이터(팀 로스터/채팅/관전자)는 Colyseus state(`MatchState.ts`)로, 나머지(친구/랭킹/프로필 팝업/1:1 채팅)는 REST 응답으로 흘러가므로 두 경로 모두 확장한다.

## Global Constraints

- 지급 방식: 관리자가 `/admin` 유저 목록에서 체크박스 두 개(레인보우/글로우)로 즉시 켜고 끔 — 별도 저장 버튼 없이 체크 즉시 반영. 상점/자동 지급 없음(이번 스코프).
- **레인보우**: 움직이는(애니메이션) 그라데이션. 지정된 `nicknameColor`를 무시하고 덮어씀(배타적).
- **글로우**: 닉네임 자기 색(`nicknameColor`) 기준의 은은한 빛 효과. 레인보우와 독립적인 on/off — 레인보우와 동시에 켤 수 있음. 색이 없으면(또는 레인보우가 켜져 있어 대표색이 없으면) 흰색(`#ffffff`)으로 대체.
- 적용 범위: 색이 이미 적용되던 모든 곳(인게임 팀 로스터, 대기실 역할선택 화면 로스터/대기 목록, 인게임+대기실 채팅, 1:1 친구 채팅, 랭킹, 프로필 팝업, 관리자 유저 목록) + 이번에 새로 색 자체를 추가하는 두 곳(관전자 목록, 친구창의 친구 목록/받은 요청/보낸 요청 3개 탭 전부).
- 혼자 연습 모드는 서버 API를 전혀 안 타므로 대상 아님(손댈 코드 없음).
- 새 DB 컬럼은 기존 컬럼들과 같은 이중 정의 패턴(`CREATE TABLE` + `ALTER TABLE ADD COLUMN` 가드)을 따른다.
- SQLite는 boolean 타입이 없어 `INTEGER`(0/1)로 저장 — 서버 코드가 이 값을 읽을 때마다 실제 TS `boolean`으로 명시적으로 변환한다(무심코 `as UserProfile`로 캐스팅해서 0/1 숫자가 boolean인 척 흘러가지 않게).

## `server/src/db/connection.ts` 변경

`CREATE TABLE IF NOT EXISTS users` 블록, 기존 마지막 부분:

```sql
      pig_play_count INTEGER NOT NULL DEFAULT 0,
      rabbit_play_count INTEGER NOT NULL DEFAULT 0,
      game_money INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours'))
```

변경:

```sql
      pig_play_count INTEGER NOT NULL DEFAULT 0,
      rabbit_play_count INTEGER NOT NULL DEFAULT 0,
      game_money INTEGER NOT NULL DEFAULT 0,
      nickname_rainbow INTEGER NOT NULL DEFAULT 0,
      nickname_glow INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours'))
```

`ALTER TABLE ADD COLUMN` 가드 블록, `game_money` 체크 다음에 추가:

```ts
  if (!columns.includes("nickname_rainbow")) {
    db.exec(`ALTER TABLE users ADD COLUMN nickname_rainbow INTEGER NOT NULL DEFAULT 0`);
  }
  if (!columns.includes("nickname_glow")) {
    db.exec(`ALTER TABLE users ADD COLUMN nickname_glow INTEGER NOT NULL DEFAULT 0`);
  }
```

파일 끝(export 함수들이 있는 자리)에 공용 변환 헬퍼 추가 — 이 파일이 `db`를 export하는 유일한 곳이라 자연스러운 위치:

```ts
// SQLite는 boolean이 없어 0/1 INTEGER로 저장한다 — 이 값을 읽는 모든 곳(여러
// 파일에 흩어진 SELECT 결과)에서 이 함수로 명시적으로 변환해서 실제 TS
// boolean으로 다룬다. 그냥 `as SomeType`으로 캐스팅하면 타입은 boolean인데
// 실제 값은 0/1 숫자로 남아있는 거짓말이 생긴다.
export function sqliteBool(value: number): boolean {
  return value === 1;
}
```

## `server/src/auth/googleAuth.ts` 변경

import에 `sqliteBool` 추가(기존 `import { db } from "../db/connection";`):

```ts
import { db, sqliteBool } from "../db/connection";
```

`UserProfile` 타입, 기존:

```ts
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
```

변경:

```ts
export type UserProfile = {
  id: number;
  nickname: string | null;
  bannedAt: string | null;
  nicknameColor: string | null;
  maxRound: number;
  pigPlayCount: number;
  rabbitPlayCount: number;
  gameMoney: number;
  nicknameRainbow: boolean;
  nicknameGlow: boolean;
};
```

`getOrCreateUser`의 반환 부분, 기존:

```ts
  return db
    .prepare(
      `SELECT id, nickname, banned_at AS bannedAt, nickname_color AS nicknameColor,
              max_round AS maxRound, pig_play_count AS pigPlayCount, rabbit_play_count AS rabbitPlayCount,
              game_money AS gameMoney
       FROM users WHERE google_sub = ?`,
    )
    .get(googleSub) as UserProfile;
```

변경:

```ts
  const row = db
    .prepare(
      `SELECT id, nickname, banned_at AS bannedAt, nickname_color AS nicknameColor,
              max_round AS maxRound, pig_play_count AS pigPlayCount, rabbit_play_count AS rabbitPlayCount,
              game_money AS gameMoney, nickname_rainbow AS nicknameRainbow, nickname_glow AS nicknameGlow
       FROM users WHERE google_sub = ?`,
    )
    .get(googleSub) as Omit<UserProfile, "nicknameRainbow" | "nicknameGlow"> & {
    nicknameRainbow: number;
    nicknameGlow: number;
  };
  return { ...row, nicknameRainbow: sqliteBool(row.nicknameRainbow), nicknameGlow: sqliteBool(row.nicknameGlow) };
```

`getUserById` 전체, 기존:

```ts
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
```

변경:

```ts
export function getUserById(userId: number): UserProfile | undefined {
  const row = db
    .prepare(
      `SELECT id, nickname, banned_at AS bannedAt, nickname_color AS nicknameColor,
              max_round AS maxRound, pig_play_count AS pigPlayCount, rabbit_play_count AS rabbitPlayCount,
              game_money AS gameMoney, nickname_rainbow AS nicknameRainbow, nickname_glow AS nicknameGlow
       FROM users WHERE id = ?`,
    )
    .get(userId) as
    | (Omit<UserProfile, "nicknameRainbow" | "nicknameGlow"> & { nicknameRainbow: number; nicknameGlow: number })
    | undefined;
  if (!row) return undefined;
  return { ...row, nicknameRainbow: sqliteBool(row.nicknameRainbow), nicknameGlow: sqliteBool(row.nicknameGlow) };
}
```

`setNicknameColor` 함수 바로 뒤에 새 함수 추가:

```ts
export type NicknameEffects = { rainbow: boolean; glow: boolean };

// 색(setNicknameColor)과 완전히 같은 자리 — 관리자가 /admin에서 체크박스로
// 즉시 켜고 끈다. 형식 검증이 필요한 색과 달리 boolean 두 개라 실패 케이스가
// 없어 결과 타입도 없음(항상 성공).
export function setNicknameEffects(userId: number, effects: NicknameEffects): void {
  db.prepare(`UPDATE users SET nickname_rainbow = ?, nickname_glow = ? WHERE id = ?`).run(
    effects.rainbow ? 1 : 0,
    effects.glow ? 1 : 0,
    userId,
  );
}
```

`AdminUserRow` 타입, 기존:

```ts
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
```

변경:

```ts
export type AdminUserRow = {
  id: number;
  email: string | null;
  name: string | null;
  nickname: string | null;
  bannedAt: string | null;
  nicknameColor: string | null;
  createdAt: string;
  lastLoginAt: string | null;
  nicknameRainbow: boolean;
  nicknameGlow: boolean;
};
```

`listUsers` 전체, 기존:

```ts
export function listUsers(): AdminUserRow[] {
  return db
    .prepare(
      `SELECT id, email, name, nickname, banned_at AS bannedAt, nickname_color AS nicknameColor,
              created_at AS createdAt, last_login_at AS lastLoginAt
       FROM users ORDER BY id DESC`,
    )
    .all() as AdminUserRow[];
}
```

변경:

```ts
export function listUsers(): AdminUserRow[] {
  const rows = db
    .prepare(
      `SELECT id, email, name, nickname, banned_at AS bannedAt, nickname_color AS nicknameColor,
              created_at AS createdAt, last_login_at AS lastLoginAt,
              nickname_rainbow AS nicknameRainbow, nickname_glow AS nicknameGlow
       FROM users ORDER BY id DESC`,
    )
    .all() as (Omit<AdminUserRow, "nicknameRainbow" | "nicknameGlow"> & {
    nicknameRainbow: number;
    nicknameGlow: number;
  })[];
  return rows.map((row) => ({
    ...row,
    nicknameRainbow: sqliteBool(row.nicknameRainbow),
    nicknameGlow: sqliteBool(row.nicknameGlow),
  }));
}
```

`RankingEntry` 타입, 기존:

```ts
export type RankingEntry = { nickname: string; nicknameColor: string | null; maxRound: number };
```

변경:

```ts
export type RankingEntry = {
  nickname: string;
  nicknameColor: string | null;
  maxRound: number;
  nicknameRainbow: boolean;
  nicknameGlow: boolean;
};
```

`getTopRanking` 전체, 기존:

```ts
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
```

변경:

```ts
export function getTopRanking(limit: number): RankingEntry[] {
  const rows = db
    .prepare(
      `SELECT nickname, nickname_color AS nicknameColor, max_round AS maxRound,
              nickname_rainbow AS nicknameRainbow, nickname_glow AS nicknameGlow
       FROM users
       WHERE nickname IS NOT NULL AND max_round > 0
       ORDER BY max_round DESC, id ASC
       LIMIT ?`,
    )
    .all(limit) as (Omit<RankingEntry, "nicknameRainbow" | "nicknameGlow"> & {
    nicknameRainbow: number;
    nicknameGlow: number;
  })[];
  return rows.map((row) => ({
    ...row,
    nicknameRainbow: sqliteBool(row.nicknameRainbow),
    nicknameGlow: sqliteBool(row.nicknameGlow),
  }));
}
```

## `server/src/friends/friendships.ts` 변경

import에 `sqliteBool` 추가(기존 `import { db } from "../db/connection";`):

```ts
import { db, sqliteBool } from "../db/connection";
```

`FriendListEntry` 타입, 기존:

```ts
export type FriendListEntry = { friendshipId: number; userId: number; nickname: string; lastLoginAt: string | null };
```

변경(색 자체도 이번에 새로 추가):

```ts
export type FriendListEntry = {
  friendshipId: number;
  userId: number;
  nickname: string;
  lastLoginAt: string | null;
  nicknameColor: string | null;
  nicknameRainbow: boolean;
  nicknameGlow: boolean;
};
```

`listFriends` 전체, 기존:

```ts
export function listFriends(userId: number): FriendListEntry[] {
  return db
    .prepare(
      `SELECT f.id AS friendshipId,
              u.id AS userId,
              u.nickname AS nickname,
              u.last_login_at AS lastLoginAt
       FROM friendships f
       JOIN users u ON u.id = CASE WHEN f.requester_id = ? THEN f.addressee_id ELSE f.requester_id END
       WHERE f.status = 'accepted' AND (f.requester_id = ? OR f.addressee_id = ?)`,
    )
    .all(userId, userId, userId) as FriendListEntry[];
}
```

변경:

```ts
export function listFriends(userId: number): FriendListEntry[] {
  const rows = db
    .prepare(
      `SELECT f.id AS friendshipId,
              u.id AS userId,
              u.nickname AS nickname,
              u.last_login_at AS lastLoginAt,
              u.nickname_color AS nicknameColor,
              u.nickname_rainbow AS nicknameRainbow,
              u.nickname_glow AS nicknameGlow
       FROM friendships f
       JOIN users u ON u.id = CASE WHEN f.requester_id = ? THEN f.addressee_id ELSE f.requester_id END
       WHERE f.status = 'accepted' AND (f.requester_id = ? OR f.addressee_id = ?)`,
    )
    .all(userId, userId, userId) as (Omit<FriendListEntry, "nicknameRainbow" | "nicknameGlow"> & {
    nicknameRainbow: number;
    nicknameGlow: number;
  })[];
  return rows.map((row) => ({
    ...row,
    nicknameRainbow: sqliteBool(row.nicknameRainbow),
    nicknameGlow: sqliteBool(row.nicknameGlow),
  }));
}
```

`ReceivedRequestEntry` 타입, 기존:

```ts
export type ReceivedRequestEntry = { requestId: number; fromUserId: number; fromNickname: string; createdAt: string };
```

변경:

```ts
export type ReceivedRequestEntry = {
  requestId: number;
  fromUserId: number;
  fromNickname: string;
  createdAt: string;
  fromNicknameColor: string | null;
  fromNicknameRainbow: boolean;
  fromNicknameGlow: boolean;
};
```

`listReceivedRequests` 전체, 기존:

```ts
export function listReceivedRequests(userId: number): ReceivedRequestEntry[] {
  return db
    .prepare(
      `SELECT f.id AS requestId, u.id AS fromUserId, u.nickname AS fromNickname, f.created_at AS createdAt
       FROM friendships f
       JOIN users u ON u.id = f.requester_id
       WHERE f.addressee_id = ? AND f.status = 'pending'`,
    )
    .all(userId) as ReceivedRequestEntry[];
}
```

변경:

```ts
export function listReceivedRequests(userId: number): ReceivedRequestEntry[] {
  const rows = db
    .prepare(
      `SELECT f.id AS requestId, u.id AS fromUserId, u.nickname AS fromNickname, f.created_at AS createdAt,
              u.nickname_color AS fromNicknameColor,
              u.nickname_rainbow AS fromNicknameRainbow,
              u.nickname_glow AS fromNicknameGlow
       FROM friendships f
       JOIN users u ON u.id = f.requester_id
       WHERE f.addressee_id = ? AND f.status = 'pending'`,
    )
    .all(userId) as (Omit<ReceivedRequestEntry, "fromNicknameRainbow" | "fromNicknameGlow"> & {
    fromNicknameRainbow: number;
    fromNicknameGlow: number;
  })[];
  return rows.map((row) => ({
    ...row,
    fromNicknameRainbow: sqliteBool(row.fromNicknameRainbow),
    fromNicknameGlow: sqliteBool(row.fromNicknameGlow),
  }));
}
```

`SentRequestEntry` 타입, 기존:

```ts
export type SentRequestEntry = { requestId: number; toUserId: number; toNickname: string; createdAt: string };
```

변경:

```ts
export type SentRequestEntry = {
  requestId: number;
  toUserId: number;
  toNickname: string;
  createdAt: string;
  toNicknameColor: string | null;
  toNicknameRainbow: boolean;
  toNicknameGlow: boolean;
};
```

`listSentRequests` 전체, 기존:

```ts
export function listSentRequests(userId: number): SentRequestEntry[] {
  return db
    .prepare(
      `SELECT f.id AS requestId, u.id AS toUserId, u.nickname AS toNickname, f.created_at AS createdAt
       FROM friendships f
       JOIN users u ON u.id = f.addressee_id
       WHERE f.requester_id = ? AND f.status = 'pending'`,
    )
    .all(userId) as SentRequestEntry[];
}
```

변경:

```ts
export function listSentRequests(userId: number): SentRequestEntry[] {
  const rows = db
    .prepare(
      `SELECT f.id AS requestId, u.id AS toUserId, u.nickname AS toNickname, f.created_at AS createdAt,
              u.nickname_color AS toNicknameColor,
              u.nickname_rainbow AS toNicknameRainbow,
              u.nickname_glow AS toNicknameGlow
       FROM friendships f
       JOIN users u ON u.id = f.addressee_id
       WHERE f.requester_id = ? AND f.status = 'pending'`,
    )
    .all(userId) as (Omit<SentRequestEntry, "toNicknameRainbow" | "toNicknameGlow"> & {
    toNicknameRainbow: number;
    toNicknameGlow: number;
  })[];
  return rows.map((row) => ({
    ...row,
    toNicknameRainbow: sqliteBool(row.toNicknameRainbow),
    toNicknameGlow: sqliteBool(row.toNicknameGlow),
  }));
}
```

## `server/src/chat/directMessages.ts` 변경

import 변경, 기존 `import { db } from "../db/connection";`:

```ts
import { db, sqliteBool } from "../db/connection";
```

`DirectMessageEntry` 타입, 기존:

```ts
export type DirectMessageEntry = {
  id: number;
  senderId: number;
  senderNickname: string;
  senderNicknameColor: string | null;
  text: string;
  createdAt: string;
};
```

변경:

```ts
export type DirectMessageEntry = {
  id: number;
  senderId: number;
  senderNickname: string;
  senderNicknameColor: string | null;
  senderNicknameRainbow: boolean;
  senderNicknameGlow: boolean;
  text: string;
  createdAt: string;
};
```

`getMessages` 전체, 기존:

```ts
export function getMessages(userId: number, otherUserId: number): DirectMessageEntry[] {
  const rows = db
    .prepare(
      `SELECT m.id AS id, m.sender_id AS senderId, u.nickname AS senderNickname,
              u.nickname_color AS senderNicknameColor, m.text AS text, m.created_at AS createdAt
       FROM direct_messages m
       JOIN users u ON u.id = m.sender_id
       WHERE (m.sender_id = ? AND m.recipient_id = ?) OR (m.sender_id = ? AND m.recipient_id = ?)
       ORDER BY m.id DESC
       LIMIT ?`,
    )
    .all(userId, otherUserId, otherUserId, userId, HISTORY_LIMIT) as DirectMessageEntry[];
  return rows.reverse();
}
```

변경:

```ts
export function getMessages(userId: number, otherUserId: number): DirectMessageEntry[] {
  const rows = db
    .prepare(
      `SELECT m.id AS id, m.sender_id AS senderId, u.nickname AS senderNickname,
              u.nickname_color AS senderNicknameColor,
              u.nickname_rainbow AS senderNicknameRainbow,
              u.nickname_glow AS senderNicknameGlow,
              m.text AS text, m.created_at AS createdAt
       FROM direct_messages m
       JOIN users u ON u.id = m.sender_id
       WHERE (m.sender_id = ? AND m.recipient_id = ?) OR (m.sender_id = ? AND m.recipient_id = ?)
       ORDER BY m.id DESC
       LIMIT ?`,
    )
    .all(userId, otherUserId, otherUserId, userId, HISTORY_LIMIT) as (Omit<
    DirectMessageEntry,
    "senderNicknameRainbow" | "senderNicknameGlow"
  > & { senderNicknameRainbow: number; senderNicknameGlow: number })[];
  return rows
    .map((row) => ({
      ...row,
      senderNicknameRainbow: sqliteBool(row.senderNicknameRainbow),
      senderNicknameGlow: sqliteBool(row.senderNicknameGlow),
    }))
    .reverse();
}
```

## `server/src/createServer.ts` 변경

새 import(기존 `setNicknameColor`가 들어있는 import 블록에 `setNicknameEffects` 추가):

```ts
  setNicknameColor,
  setNicknameEffects,
```

`POST /api/admin/users/:id/nickname-color` 라우트 바로 뒤에 새 라우트 추가:

```ts
  app.post("/api/admin/users/:id/nickname-effects", requireAdmin, (req, res) => {
    const userId = Number(req.params.id);
    if (!Number.isInteger(userId)) {
      res.status(400).json({ error: "invalid id" });
      return;
    }
    const { rainbow, glow } = req.body as { rainbow?: unknown; glow?: unknown };
    if (typeof rainbow !== "boolean" || typeof glow !== "boolean") {
      res.status(400).json({ error: "rainbow와 glow는 boolean이어야 합니다." });
      return;
    }
    setNicknameEffects(userId, { rainbow, glow });
    res.json({ ok: true });
  });
```

`GET /api/profile/:nickname` 라우트의 응답, 기존:

```ts
    res.json({
      userId: target.id,
      nickname: user.nickname,
      nicknameColor: user.nicknameColor,
      maxRound: user.maxRound,
      pigPlayCount: user.pigPlayCount,
      rabbitPlayCount: user.rabbitPlayCount,
      friendshipStatus: status,
      friendshipId,
    });
```

변경:

```ts
    res.json({
      userId: target.id,
      nickname: user.nickname,
      nicknameColor: user.nicknameColor,
      nicknameRainbow: user.nicknameRainbow,
      nicknameGlow: user.nicknameGlow,
      maxRound: user.maxRound,
      pigPlayCount: user.pigPlayCount,
      rabbitPlayCount: user.rabbitPlayCount,
      friendshipStatus: status,
      friendshipId,
    });
```

`GET /api/friends` 라우트는 `listFriends(userId).map((f) => ({ ...f, ... }))` 형태라 `f`에 이미 `nicknameColor`/`nicknameRainbow`/`nicknameGlow`가 들어있으므로(위 friendships.ts 변경) **이 라우트 자체는 코드 변경 불필요** — `...f` 스프레드가 자동으로 실어 나른다. `GET /api/friends/requests`, `GET /api/friends/sent`도 각각 `listReceivedRequests`/`listSentRequests`를 그대로 `res.json()`하는 구조라 **마찬가지로 코드 변경 불필요**.

## `server/src/rooms/MatchState.ts` 변경

`PlayerState` 클래스, 기존:

```ts
export class PlayerState extends Schema {
  @type("string") sessionId: string = "";
  @type("string") nickname: string = "";
  @type("string") nicknameColor: string = "";
  @type("string") role: RoleChoice = "";
  @type("string") teamId: string = "";
  @type(["string"]) inventory = new ArraySchema<string>();
```

변경:

```ts
export class PlayerState extends Schema {
  @type("string") sessionId: string = "";
  @type("string") nickname: string = "";
  @type("string") nicknameColor: string = "";
  @type("boolean") nicknameRainbow: boolean = false;
  @type("boolean") nicknameGlow: boolean = false;
  @type("string") role: RoleChoice = "";
  @type("string") teamId: string = "";
  @type(["string"]) inventory = new ArraySchema<string>();
```

`ChatMessage` 클래스, 기존:

```ts
  @type("string") nickname: string = "";
  @type("string") nicknameColor: string = "";
  @type("string") text: string = "";
  @type("number") sentAt: number = 0;
```

변경:

```ts
  @type("string") nickname: string = "";
  @type("string") nicknameColor: string = "";
  @type("boolean") nicknameRainbow: boolean = false;
  @type("boolean") nicknameGlow: boolean = false;
  @type("string") text: string = "";
  @type("number") sentAt: number = 0;
```

`SpectatorState` 클래스, 기존:

```ts
export class SpectatorState extends Schema {
  @type("string") sessionId: string = "";
  @type("string") nickname: string = "";
  @type("string") nicknameColor: string = "";
}
```

변경:

```ts
export class SpectatorState extends Schema {
  @type("string") sessionId: string = "";
  @type("string") nickname: string = "";
  @type("string") nicknameColor: string = "";
  @type("boolean") nicknameRainbow: boolean = false;
  @type("boolean") nicknameGlow: boolean = false;
}
```

## `server/src/rooms/MatchRoom.ts` 변경

`onAuth`의 반환문, 기존:

```ts
    return { ip: context.ip, userId: user.id, nickname: user.nickname, nicknameColor: user.nicknameColor ?? "" };
```

변경:

```ts
    return {
      ip: context.ip,
      userId: user.id,
      nickname: user.nickname,
      nicknameColor: user.nicknameColor ?? "",
      nicknameRainbow: user.nicknameRainbow,
      nicknameGlow: user.nicknameGlow,
    };
```

`onJoin`의 관전자 분기, 기존:

```ts
      const spectator = new SpectatorState();
      spectator.sessionId = client.sessionId;
      spectator.nickname = client.auth?.nickname ?? "관전자";
      spectator.nicknameColor = client.auth?.nicknameColor ?? "";
      this.state.spectators.set(client.sessionId, spectator);
```

변경:

```ts
      const spectator = new SpectatorState();
      spectator.sessionId = client.sessionId;
      spectator.nickname = client.auth?.nickname ?? "관전자";
      spectator.nicknameColor = client.auth?.nicknameColor ?? "";
      spectator.nicknameRainbow = client.auth?.nicknameRainbow ?? false;
      spectator.nicknameGlow = client.auth?.nicknameGlow ?? false;
      this.state.spectators.set(client.sessionId, spectator);
```

`onJoin`의 플레이어 분기, 기존:

```ts
    const player = new PlayerState();
    player.sessionId = client.sessionId;
    player.nickname = nickname;
    player.nicknameColor = client.auth?.nicknameColor ?? "";
    this.state.players.set(client.sessionId, player);
```

변경:

```ts
    const player = new PlayerState();
    player.sessionId = client.sessionId;
    player.nickname = nickname;
    player.nicknameColor = client.auth?.nicknameColor ?? "";
    player.nicknameRainbow = client.auth?.nicknameRainbow ?? false;
    player.nicknameGlow = client.auth?.nicknameGlow ?? false;
    this.state.players.set(client.sessionId, player);
```

`handleSendChat`, 기존:

```ts
  private handleSendChat(client: Client, rawText: unknown) {
    const text = sanitizeChatText(rawText);
    if (!text) return;

    const player = this.state.players.get(client.sessionId);
    if (player) {
      const list = this.state.phase === "lobby" ? this.state.lobbyChat : this.state.matchChat;
      this.pushChat(list, player.nickname, text, player.nicknameColor);
      return;
    }

    const spectator = this.state.spectators.get(client.sessionId);
    if (spectator) {
      // 관전자는 진행 중인 매치(phase !== "lobby")에만 존재할 수 있으므로
      // (onJoin 참고) 항상 matchChat으로 보낸다.
      this.pushChat(this.state.matchChat, `${spectator.nickname} (관전)`, text, spectator.nicknameColor);
    }
  }

  private pushChat(list: ArraySchema<ChatMessage>, nickname: string, text: string, nicknameColor: string = "") {
    const message = new ChatMessage();
    message.nickname = nickname;
    message.nicknameColor = nicknameColor;
    message.text = text;
    message.sentAt = Date.now();
    list.push(message);
    if (list.length > MAX_CHAT_MESSAGES) list.shift();
  }
```

변경:

```ts
  private handleSendChat(client: Client, rawText: unknown) {
    const text = sanitizeChatText(rawText);
    if (!text) return;

    const player = this.state.players.get(client.sessionId);
    if (player) {
      const list = this.state.phase === "lobby" ? this.state.lobbyChat : this.state.matchChat;
      this.pushChat(list, player.nickname, text, player.nicknameColor, player.nicknameRainbow, player.nicknameGlow);
      return;
    }

    const spectator = this.state.spectators.get(client.sessionId);
    if (spectator) {
      // 관전자는 진행 중인 매치(phase !== "lobby")에만 존재할 수 있으므로
      // (onJoin 참고) 항상 matchChat으로 보낸다.
      this.pushChat(
        this.state.matchChat,
        `${spectator.nickname} (관전)`,
        text,
        spectator.nicknameColor,
        spectator.nicknameRainbow,
        spectator.nicknameGlow,
      );
    }
  }

  private pushChat(
    list: ArraySchema<ChatMessage>,
    nickname: string,
    text: string,
    nicknameColor: string = "",
    nicknameRainbow: boolean = false,
    nicknameGlow: boolean = false,
  ) {
    const message = new ChatMessage();
    message.nickname = nickname;
    message.nicknameColor = nicknameColor;
    message.nicknameRainbow = nicknameRainbow;
    message.nicknameGlow = nicknameGlow;
    message.text = text;
    message.sentAt = Date.now();
    list.push(message);
    if (list.length > MAX_CHAT_MESSAGES) list.shift();
  }
```

(입장/퇴장 시스템 메시지를 만드는 다른 `pushChat` 호출들 — 예: `this.pushChat(this.state.lobbyChat, "", ...)` — 은 nickname 자체가 빈 문자열이라 새 파라미터 없이 그대로 둔다. 기본값 `false`가 적용됨.)

## 클라이언트 — 공용 헬퍼 (신규)

### `client/src/game/nicknameStyle.ts`

```ts
import type { CSSProperties } from "react";
import styles from "./nicknameStyle.module.css";

const DEFAULT_GLOW_COLOR = "#ffffff";

// 닉네임을 렌더링하는 모든 화면(팀 로스터/채팅/랭킹/친구창/관전자 목록/
// 프로필 팝업)이 공통으로 쓰는 스타일 계산기. 레인보우는 지정된 색을
// 덮어쓰는 움직이는 그라데이션(className으로 적용 — 애니메이션은 CSS
// keyframes가 필요해 인라인 style로는 불가능). 글로우는 닉네임 자기 색
// 기준의 text-shadow이며 레인보우와 독립적으로 켤 수 있다 — 레인보우가
// 켜져 있으면 대표색이 없으므로 흰색으로 대체한다.
export function nicknameStyle(
  color: string | null | undefined,
  rainbow: boolean | undefined,
  glow: boolean | undefined,
): { className: string; style: CSSProperties } {
  const style: CSSProperties = {};

  if (glow) {
    const glowColor = rainbow ? DEFAULT_GLOW_COLOR : color || DEFAULT_GLOW_COLOR;
    style.textShadow = `0 0 6px ${glowColor}, 0 0 16px ${glowColor}`;
  }

  if (rainbow) {
    return { className: styles.rainbow, style };
  }

  if (color) {
    style.color = color;
  }
  return { className: "", style };
}
```

### `client/src/game/nicknameStyle.module.css`

```css
.rainbow {
  background: linear-gradient(90deg, #ff6b6b, #ffb84d, #ffe86b, #6bd98a, #4dc4ff, #9b7bff, #ff6bcf, #ff6b6b);
  background-size: 220% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  -webkit-text-fill-color: transparent;
  animation: rainbow-shift 4s linear infinite;
}

@keyframes rainbow-shift {
  from {
    background-position: 0% 0;
  }
  to {
    background-position: 220% 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .rainbow {
    animation-duration: 40s;
  }
}
```

**사용 패턴** (아래 각 화면에서 반복): 기존에 `style={{ color: X || undefined }}`로 끝나던 자리를

```tsx
const effect = nicknameStyle(X.nicknameColor, X.nicknameRainbow, X.nicknameGlow);
```

로 값을 한 번 계산해두고, 엘리먼트에는

```tsx
className={`${기존클래스} ${effect.className}`}
style={effect.style}
```

로 적용한다(`effect.className`이 빈 문자열이면 템플릿 리터럴에 빈 칸만 남아 무해함).

## 클라이언트 — 타입 동기화

### `client/src/game/matchTypes.ts`

`PlayerState`, 기존:

```ts
export interface PlayerState {
  sessionId: string;
  nickname: string;
  nicknameColor: string;
  role: RoleChoice;
  teamId: string;
  inventory: ItemId[];
}
```

변경:

```ts
export interface PlayerState {
  sessionId: string;
  nickname: string;
  nicknameColor: string;
  nicknameRainbow: boolean;
  nicknameGlow: boolean;
  role: RoleChoice;
  teamId: string;
  inventory: ItemId[];
}
```

`ChatMessage`, 기존:

```ts
export interface ChatMessage {
  nickname: string;
  nicknameColor: string;
  text: string;
  sentAt: number;
}
```

변경:

```ts
export interface ChatMessage {
  nickname: string;
  nicknameColor: string;
  nicknameRainbow: boolean;
  nicknameGlow: boolean;
  text: string;
  sentAt: number;
}
```

`SpectatorState`, 기존:

```ts
export interface SpectatorState {
  sessionId: string;
  nickname: string;
  nicknameColor: string;
}
```

변경:

```ts
export interface SpectatorState {
  sessionId: string;
  nickname: string;
  nicknameColor: string;
  nicknameRainbow: boolean;
  nicknameGlow: boolean;
}
```

### `client/src/colyseus.ts`

`RankingEntry`, 기존:

```ts
export interface RankingEntry {
  nickname: string;
  nicknameColor: string | null;
  maxRound: number;
}
```

변경:

```ts
export interface RankingEntry {
  nickname: string;
  nicknameColor: string | null;
  nicknameRainbow: boolean;
  nicknameGlow: boolean;
  maxRound: number;
}
```

### `client/src/game/friends.ts`

`FriendEntry`, 기존:

```ts
export type FriendEntry = {
  friendshipId: number;
  userId: number;
  nickname: string;
  online: boolean;
  roomId: string | null;
  unreadCount: number;
  lastLoginAt: string | null;
};
```

변경:

```ts
export type FriendEntry = {
  friendshipId: number;
  userId: number;
  nickname: string;
  online: boolean;
  roomId: string | null;
  unreadCount: number;
  lastLoginAt: string | null;
  nicknameColor: string | null;
  nicknameRainbow: boolean;
  nicknameGlow: boolean;
};
```

`ReceivedRequestEntry`, 기존:

```ts
export type ReceivedRequestEntry = { requestId: number; fromUserId: number; fromNickname: string; createdAt: string };
```

변경:

```ts
export type ReceivedRequestEntry = {
  requestId: number;
  fromUserId: number;
  fromNickname: string;
  createdAt: string;
  fromNicknameColor: string | null;
  fromNicknameRainbow: boolean;
  fromNicknameGlow: boolean;
};
```

`SentRequestEntry`, 기존:

```ts
export type SentRequestEntry = { requestId: number; toUserId: number; toNickname: string; createdAt: string };
```

변경:

```ts
export type SentRequestEntry = {
  requestId: number;
  toUserId: number;
  toNickname: string;
  createdAt: string;
  toNicknameColor: string | null;
  toNicknameRainbow: boolean;
  toNicknameGlow: boolean;
};
```

### `client/src/game/profile.ts`

`PublicProfile`, 기존:

```ts
export type PublicProfile = {
  userId: number;
  nickname: string;
  nicknameColor: string | null;
  maxRound: number;
  pigPlayCount: number;
  rabbitPlayCount: number;
  friendshipStatus: FriendshipStatus;
  friendshipId: number | null;
};
```

변경:

```ts
export type PublicProfile = {
  userId: number;
  nickname: string;
  nicknameColor: string | null;
  nicknameRainbow: boolean;
  nicknameGlow: boolean;
  maxRound: number;
  pigPlayCount: number;
  rabbitPlayCount: number;
  friendshipStatus: FriendshipStatus;
  friendshipId: number | null;
};
```

### `client/src/game/chat.ts`

`DirectMessageEntry`, 기존:

```ts
export type DirectMessageEntry = {
  id: number;
  senderId: number;
  senderNickname: string;
  senderNicknameColor: string | null;
  text: string;
  createdAt: string;
};
```

변경:

```ts
export type DirectMessageEntry = {
  id: number;
  senderId: number;
  senderNickname: string;
  senderNicknameColor: string | null;
  senderNicknameRainbow: boolean;
  senderNicknameGlow: boolean;
  text: string;
  createdAt: string;
};
```

### `client/src/game/directMessageToChatMessage.ts`

전체, 기존:

```ts
import type { ChatMessage } from "./matchTypes";
import type { DirectMessageEntry } from "./chat";

export function directMessageToChatMessage(m: DirectMessageEntry): ChatMessage {
  return {
    nickname: m.senderNickname,
    nicknameColor: m.senderNicknameColor ?? "",
    text: m.text,
    sentAt: new Date(`${m.createdAt.replace(" ", "T")}+09:00`).getTime(),
  };
}
```

변경:

```ts
import type { ChatMessage } from "./matchTypes";
import type { DirectMessageEntry } from "./chat";

export function directMessageToChatMessage(m: DirectMessageEntry): ChatMessage {
  return {
    nickname: m.senderNickname,
    nicknameColor: m.senderNicknameColor ?? "",
    nicknameRainbow: m.senderNicknameRainbow,
    nicknameGlow: m.senderNicknameGlow,
    text: m.text,
    sentAt: new Date(`${m.createdAt.replace(" ", "T")}+09:00`).getTime(),
  };
}
```

## 클라이언트 — 화면별 배선

### `client/src/components/ChatBox.tsx`

인게임 채팅과 1:1 친구 채팅이 전부 이 컴포넌트를 공유하므로, 여기 한 곳만 고치면 둘 다 반영된다. 기존:

```tsx
import { memo, useEffect, useRef, useState } from "react";
import type { ChatMessage } from "../game/matchTypes";
import styles from "./ChatBox.module.css";
```

변경:

```tsx
import { memo, useEffect, useRef, useState } from "react";
import type { ChatMessage } from "../game/matchTypes";
import { nicknameStyle } from "../game/nicknameStyle";
import styles from "./ChatBox.module.css";
```

메시지 렌더링 부분, 기존:

```tsx
        {messages.map((m, i) =>
          m.nickname ? (
            <p key={i} className={styles.line}>
              <span className={styles.nickname} style={{ color: m.nicknameColor || undefined }}>
                {m.nickname}
              </span>
              <span className={styles.text}>{m.text}</span>
            </p>
          ) : (
```

변경(`.map`의 화살표 함수를 표현식 바디에서 블록 바디로 바꿔 `effect`를 한 번만 계산):

```tsx
        {messages.map((m, i) => {
          const effect = nicknameStyle(m.nicknameColor, m.nicknameRainbow, m.nicknameGlow);
          return m.nickname ? (
            <p key={i} className={styles.line}>
              <span className={`${styles.nickname} ${effect.className}`} style={effect.style}>
                {m.nickname}
              </span>
              <span className={styles.text}>{m.text}</span>
            </p>
          ) : (
```

이 아래 시스템 메시지 분기(`// Server-pushed system notices...` 주석과 `<p key={i} className={...system}>{m.text}</p>`)는 그대로 두되, 화살표 함수를 블록 바디로 바꿨으니 맨 끝만 그에 맞게 고친다. 기존:

```tsx
            <p key={i} className={`${styles.line} ${styles.system}`}>
              {m.text}
            </p>
          ),
        )}
```

변경(닫는 괄호만 블록 바디 형태로):

```tsx
            <p key={i} className={`${styles.line} ${styles.system}`}>
              {m.text}
            </p>
          );
        })}
```

### `client/src/components/RankingModal.tsx`

import 추가:

```tsx
import { nicknameStyle } from "../game/nicknameStyle";
```

렌더링 부분, 기존:

```tsx
            {ranking.map((entry, i) => (
              <li key={entry.nickname} className={i === 0 ? `${styles.row} ${styles.first}` : styles.row}>
                <span className={styles.rank}>{i + 1}</span>
                <span className={styles.nickname} style={{ color: entry.nicknameColor || undefined }}>
                  {entry.nickname}
                </span>
                <span className={styles.round}>{entry.maxRound}라운드</span>
              </li>
            ))}
```

변경(`.map`을 블록 바디로 바꿔 `effect`를 한 번만 계산):

```tsx
            {ranking.map((entry, i) => {
              const effect = nicknameStyle(entry.nicknameColor, entry.nicknameRainbow, entry.nicknameGlow);
              return (
                <li key={entry.nickname} className={i === 0 ? `${styles.row} ${styles.first}` : styles.row}>
                  <span className={styles.rank}>{i + 1}</span>
                  <span className={`${styles.nickname} ${effect.className}`} style={effect.style}>
                    {entry.nickname}
                  </span>
                  <span className={styles.round}>{entry.maxRound}라운드</span>
                </li>
              );
            })}
```

### `client/src/components/ProfileModal.tsx`

import 추가:

```tsx
import { nicknameStyle } from "../game/nicknameStyle";
```

`useState` 선언들 바로 뒤, `useEffect` 앞에 한 줄 추가(컴포넌트 본문, `profile`이 아직 `null`일 수 있으므로 기본값 처리):

```tsx
  const effect = profile
    ? nicknameStyle(profile.nicknameColor, profile.nicknameRainbow, profile.nicknameGlow)
    : { className: "", style: {} };
```

heading 렌더링, 기존:

```tsx
            <h2 className={styles.heading} style={{ color: profile.nicknameColor || undefined }}>
              {profile.nickname}
            </h2>
```

변경:

```tsx
            <h2 className={`${styles.heading} ${effect.className}`} style={effect.style}>
              {profile.nickname}
            </h2>
```

### `client/src/components/TeamRosterPanel.tsx`

import 추가:

```tsx
import { nicknameStyle } from "../game/nicknameStyle";
```

`Seat` 컴포넌트 전체, 기존:

```tsx
function Seat({
  nickname,
  nicknameColor,
  roleIcon,
}: {
  nickname: string | undefined;
  nicknameColor: string | undefined;
  roleIcon: string;
}) {
  return (
    <div className={styles.seat}>
      <img className={styles.seatIcon} src={roleIcon} alt="" />
      <span className={styles.seatName} style={{ color: nicknameColor || undefined }}>
        {nickname ?? "-"}
      </span>
    </div>
  );
}
```

변경:

```tsx
function Seat({
  nickname,
  nicknameColor,
  nicknameRainbow,
  nicknameGlow,
  roleIcon,
}: {
  nickname: string | undefined;
  nicknameColor: string | undefined;
  nicknameRainbow: boolean | undefined;
  nicknameGlow: boolean | undefined;
  roleIcon: string;
}) {
  const effect = nicknameStyle(nicknameColor, nicknameRainbow, nicknameGlow);
  return (
    <div className={styles.seat}>
      <img className={styles.seatIcon} src={roleIcon} alt="" />
      <span className={`${styles.seatName} ${effect.className}`} style={effect.style}>
        {nickname ?? "-"}
      </span>
    </div>
  );
}
```

`TeamRosterPanel` 본문의 `Seat` 호출부, 기존:

```tsx
            <Seat
              nickname={players.get(team.pigSessionId)?.nickname}
              nicknameColor={players.get(team.pigSessionId)?.nicknameColor}
              roleIcon="/game-assets/ui/thanksgiving_room_start_player_pig.png"
            />
            <Seat
              nickname={players.get(team.rabbitSessionId)?.nickname}
              nicknameColor={players.get(team.rabbitSessionId)?.nicknameColor}
              roleIcon="/game-assets/ui/thanksgiving_room_start_player_rabbit.png"
            />
```

변경:

```tsx
            <Seat
              nickname={players.get(team.pigSessionId)?.nickname}
              nicknameColor={players.get(team.pigSessionId)?.nicknameColor}
              nicknameRainbow={players.get(team.pigSessionId)?.nicknameRainbow}
              nicknameGlow={players.get(team.pigSessionId)?.nicknameGlow}
              roleIcon="/game-assets/ui/thanksgiving_room_start_player_pig.png"
            />
            <Seat
              nickname={players.get(team.rabbitSessionId)?.nickname}
              nicknameColor={players.get(team.rabbitSessionId)?.nicknameColor}
              nicknameRainbow={players.get(team.rabbitSessionId)?.nicknameRainbow}
              nicknameGlow={players.get(team.rabbitSessionId)?.nicknameGlow}
              roleIcon="/game-assets/ui/thanksgiving_room_start_player_rabbit.png"
            />
```

### `client/src/components/RoleSelect.tsx`

import 추가:

```tsx
import { nicknameStyle } from "../game/nicknameStyle";
```

`nicknameColorFor` 헬퍼 바로 뒤에 두 헬퍼 추가, 기존:

```tsx
  function nicknameColorFor(sessionId: string): string | undefined {
    return sessionId ? room.state.players.get(sessionId)?.nicknameColor || undefined : undefined;
  }
```

변경(새 헬퍼 두 개 추가):

```tsx
  function nicknameColorFor(sessionId: string): string | undefined {
    return sessionId ? room.state.players.get(sessionId)?.nicknameColor || undefined : undefined;
  }

  function nicknameRainbowFor(sessionId: string): boolean {
    return sessionId ? (room.state.players.get(sessionId)?.nicknameRainbow ?? false) : false;
  }

  function nicknameGlowFor(sessionId: string): boolean {
    return sessionId ? (room.state.players.get(sessionId)?.nicknameGlow ?? false) : false;
  }
```

"역할 선택 중" 대기 목록, 기존:

```tsx
              {unassignedPlayers.map((p) => (
                <button
                  key={p.sessionId}
                  className={styles.pendingName}
                  style={{ color: p.nicknameColor || undefined }}
                  onClick={() => setProfileNickname(p.nickname)}
                >
                  {p.nickname}
                </button>
              ))}
```

변경:

```tsx
              {unassignedPlayers.map((p) => {
                const effect = nicknameStyle(p.nicknameColor, p.nicknameRainbow, p.nicknameGlow);
                return (
                  <button
                    key={p.sessionId}
                    className={`${styles.pendingName} ${effect.className}`}
                    style={effect.style}
                    onClick={() => setProfileNickname(p.nickname)}
                  >
                    {p.nickname}
                  </button>
                );
              })}
```

팀 로스터 전체(`teams.map`), 기존:

```tsx
      <div className={styles.roster}>
        {teams.map((team) => (
          <div key={team.id} className={styles.rosterTeam}>
            {team.pigSessionId ? (
              <button
                className={styles.rosterName}
                style={{ color: nicknameColorFor(team.pigSessionId) }}
                onClick={() => setProfileNickname(nicknameFor(team.pigSessionId))}
              >
                {nicknameFor(team.pigSessionId)}
              </button>
            ) : (
              <span className={styles.rosterName}>{nicknameFor(team.pigSessionId)}</span>
            )}
            {team.rabbitSessionId ? (
              <button
                className={styles.rosterName}
                style={{ color: nicknameColorFor(team.rabbitSessionId) }}
                onClick={() => setProfileNickname(nicknameFor(team.rabbitSessionId))}
              >
                {nicknameFor(team.rabbitSessionId)}
              </button>
            ) : (
              <span className={styles.rosterName}>{nicknameFor(team.rabbitSessionId)}</span>
            )}
          </div>
        ))}
      </div>
```

변경(`.map`을 블록 바디로 바꿔 팀당 `pigEffect`/`rabbitEffect`를 한 번씩만 계산):

```tsx
      <div className={styles.roster}>
        {teams.map((team) => {
          const pigEffect = nicknameStyle(
            nicknameColorFor(team.pigSessionId),
            nicknameRainbowFor(team.pigSessionId),
            nicknameGlowFor(team.pigSessionId),
          );
          const rabbitEffect = nicknameStyle(
            nicknameColorFor(team.rabbitSessionId),
            nicknameRainbowFor(team.rabbitSessionId),
            nicknameGlowFor(team.rabbitSessionId),
          );
          return (
            <div key={team.id} className={styles.rosterTeam}>
              {team.pigSessionId ? (
                <button
                  className={`${styles.rosterName} ${pigEffect.className}`}
                  style={pigEffect.style}
                  onClick={() => setProfileNickname(nicknameFor(team.pigSessionId))}
                >
                  {nicknameFor(team.pigSessionId)}
                </button>
              ) : (
                <span className={styles.rosterName}>{nicknameFor(team.pigSessionId)}</span>
              )}
              {team.rabbitSessionId ? (
                <button
                  className={`${styles.rosterName} ${rabbitEffect.className}`}
                  style={rabbitEffect.style}
                  onClick={() => setProfileNickname(nicknameFor(team.rabbitSessionId))}
                >
                  {nicknameFor(team.rabbitSessionId)}
                </button>
              ) : (
                <span className={styles.rosterName}>{nicknameFor(team.rabbitSessionId)}</span>
              )}
            </div>
          );
        })}
      </div>
```

### `client/src/components/SpectatorCountBadge.tsx` (색 자체를 이번에 새로 추가)

import 추가:

```tsx
import { nicknameStyle } from "../game/nicknameStyle";
```

관전자 행, 기존:

```tsx
                {spectators.map((s) => (
                  <li key={s.sessionId}>
                    <button className={styles.row} onClick={() => setProfileNickname(s.nickname)}>
                      {s.nickname}
                    </button>
                  </li>
                ))}
```

변경:

```tsx
                {spectators.map((s) => {
                  const effect = nicknameStyle(s.nicknameColor, s.nicknameRainbow, s.nicknameGlow);
                  return (
                    <li key={s.sessionId}>
                      <button
                        className={`${styles.row} ${effect.className}`}
                        style={effect.style}
                        onClick={() => setProfileNickname(s.nickname)}
                      >
                        {s.nickname}
                      </button>
                    </li>
                  );
                })}
```

### `client/src/components/FriendsModal.tsx` (색 자체를 이번에 새로 추가, 3개 탭 전부)

import 추가:

```tsx
import { nicknameStyle } from "../game/nicknameStyle";
```

받은 요청 목록 전체, 기존:

```tsx
              {received?.map((r) => (
                <div key={r.requestId} className={styles.row}>
                  <button className={styles.rowNickname} onClick={() => setProfileNickname(r.fromNickname)}>
                    {r.fromNickname}
                  </button>
                  <div className={styles.rowActions}>
                    <button className={styles.acceptButton} onClick={() => handleAccept(r.requestId)}>
                      수락
                    </button>
                    <button className={styles.declineButton} onClick={() => handleDecline(r.requestId)}>
                      거절
                    </button>
                  </div>
                </div>
              ))}
```

변경(`.map`을 블록 바디로 바꿔 `effect`를 한 번만 계산):

```tsx
              {received?.map((r) => {
                const effect = nicknameStyle(r.fromNicknameColor, r.fromNicknameRainbow, r.fromNicknameGlow);
                return (
                  <div key={r.requestId} className={styles.row}>
                    <button
                      className={`${styles.rowNickname} ${effect.className}`}
                      style={effect.style}
                      onClick={() => setProfileNickname(r.fromNickname)}
                    >
                      {r.fromNickname}
                    </button>
                    <div className={styles.rowActions}>
                      <button className={styles.acceptButton} onClick={() => handleAccept(r.requestId)}>
                        수락
                      </button>
                      <button className={styles.declineButton} onClick={() => handleDecline(r.requestId)}>
                        거절
                      </button>
                    </div>
                  </div>
                );
              })}
```

보낸 요청 목록 전체, 기존:

```tsx
              {sent?.map((r) => (
                <div key={r.requestId} className={styles.row}>
                  <button className={styles.rowNickname} onClick={() => setProfileNickname(r.toNickname)}>
                    {r.toNickname}
                  </button>
                  <button className={styles.cancelButton} onClick={() => handleCancel(r.requestId)}>
                    취소
                  </button>
                </div>
              ))}
```

변경:

```tsx
              {sent?.map((r) => {
                const effect = nicknameStyle(r.toNicknameColor, r.toNicknameRainbow, r.toNicknameGlow);
                return (
                  <div key={r.requestId} className={styles.row}>
                    <button
                      className={`${styles.rowNickname} ${effect.className}`}
                      style={effect.style}
                      onClick={() => setProfileNickname(r.toNickname)}
                    >
                      {r.toNickname}
                    </button>
                    <button className={styles.cancelButton} onClick={() => handleCancel(r.requestId)}>
                      취소
                    </button>
                  </div>
                );
              })}
```

친구 목록 전체, 기존:

```tsx
            {friends?.map((f) => (
              <div key={f.friendshipId} className={`${styles.row} ${styles.friendRow}`}>
                <div className={styles.friendRowTop}>
                  <button className={styles.rowNickname} onClick={() => setProfileNickname(f.nickname)}>
                    {f.nickname}
                  </button>
                  <span className={styles.status}>{f.online ? "🟢 온라인" : formatLastSeen(f.lastLoginAt)}</span>
                </div>
                <div className={styles.friendRowButtons}>
                  <button
                    className={styles.chatButton}
                    onClick={() => setChatWith({ userId: f.userId, nickname: f.nickname })}
                  >
                    채팅
                    {f.unreadCount > 0 && <span className={styles.unreadBadge}>{f.unreadCount}</span>}
                  </button>
                  {f.online && f.roomId && (
                    <button className={styles.followButton} onClick={() => onJoinRoom(f.roomId!)}>
                      따라가기
                    </button>
                  )}
                  <button className={styles.removeButton} onClick={() => handleRemove(f.friendshipId)}>
                    삭제
                  </button>
                </div>
              </div>
            ))}
```

변경:

```tsx
            {friends?.map((f) => {
              const effect = nicknameStyle(f.nicknameColor, f.nicknameRainbow, f.nicknameGlow);
              return (
                <div key={f.friendshipId} className={`${styles.row} ${styles.friendRow}`}>
                  <div className={styles.friendRowTop}>
                    <button
                      className={`${styles.rowNickname} ${effect.className}`}
                      style={effect.style}
                      onClick={() => setProfileNickname(f.nickname)}
                    >
                      {f.nickname}
                    </button>
                    <span className={styles.status}>{f.online ? "🟢 온라인" : formatLastSeen(f.lastLoginAt)}</span>
                  </div>
                  <div className={styles.friendRowButtons}>
                    <button
                      className={styles.chatButton}
                      onClick={() => setChatWith({ userId: f.userId, nickname: f.nickname })}
                    >
                      채팅
                      {f.unreadCount > 0 && <span className={styles.unreadBadge}>{f.unreadCount}</span>}
                    </button>
                    {f.online && f.roomId && (
                      <button className={styles.followButton} onClick={() => onJoinRoom(f.roomId!)}>
                        따라가기
                      </button>
                    )}
                    <button className={styles.removeButton} onClick={() => handleRemove(f.friendshipId)}>
                      삭제
                    </button>
                  </div>
                </div>
              );
            })}
```

## `client/src/components/AdminUsers.tsx` 변경 (관리자 지급 UI)

`UserRow` 타입, 기존:

```tsx
type UserRow = {
  id: number;
  email: string | null;
  name: string | null;
  nickname: string | null;
  bannedAt: string | null;
  nicknameColor: string | null;
  createdAt: string;
  lastLoginAt: string | null;
};
```

변경:

```tsx
type UserRow = {
  id: number;
  email: string | null;
  name: string | null;
  nickname: string | null;
  bannedAt: string | null;
  nicknameColor: string | null;
  createdAt: string;
  lastLoginAt: string | null;
  nicknameRainbow: boolean;
  nicknameGlow: boolean;
};
```

`saveColorEdit` 함수 뒤에 새 함수 추가(색과 달리 별도 편집 상태 없이 체크 즉시 반영):

```tsx
  async function toggleEffect(user: UserRow, effect: "rainbow" | "glow") {
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${user.id}/nickname-effects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          rainbow: effect === "rainbow" ? !user.nicknameRainbow : user.nicknameRainbow,
          glow: effect === "glow" ? !user.nicknameGlow : user.nicknameGlow,
        }),
      });
      if (!res.ok) {
        if (res.status === 401) {
          onUnauthorized();
          return;
        }
        setError("효과 변경에 실패했습니다");
        return;
      }
      await loadUsers();
    } catch {
      setError("효과 변경에 실패했습니다");
    }
  }
```

테이블 헤더, 기존:

```tsx
              <tr>
                <th>id</th>
                <th>이메일</th>
                <th>이름</th>
                <th>닉네임</th>
                <th>색상</th>
                <th>가입일</th>
                <th>최근 로그인</th>
                <th></th>
              </tr>
```

변경(색상 다음에 "효과" 컬럼 추가):

```tsx
              <tr>
                <th>id</th>
                <th>이메일</th>
                <th>이름</th>
                <th>닉네임</th>
                <th>색상</th>
                <th>효과</th>
                <th>가입일</th>
                <th>최근 로그인</th>
                <th></th>
              </tr>
```

색상 `<td>` 바로 뒤(가입일 `<td>` 앞)에 새 `<td>` 추가:

```tsx
                  <td>
                    <label className={styles.effectLabel}>
                      <input
                        type="checkbox"
                        checked={user.nicknameRainbow}
                        onChange={() => toggleEffect(user, "rainbow")}
                      />
                      레인보우
                    </label>
                    <label className={styles.effectLabel}>
                      <input type="checkbox" checked={user.nicknameGlow} onChange={() => toggleEffect(user, "glow")} />
                      글로우
                    </label>
                  </td>
```

`AdminUsers.module.css`에 다음 클래스 추가(기존 파일 끝):

```css
.effectLabel {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.8rem;
  white-space: nowrap;
}
```

## 테스트

- **서버**: `server/src/auth/googleAuth.test.ts`에 `describe("setNicknameEffects", ...)` 추가 — (1) rainbow/glow 각각 독립적으로 켜지는지, (2) 끄면 다시 꺼지는지, (3) `getUserById` 결과가 실제 `boolean`(0/1 숫자가 아님)인지 `typeof`로 확인. `server/src/friends/friendships.test.ts`에 `listFriends`/`listReceivedRequests`/`listSentRequests`가 색/효과 필드를 올바르게 반환하는지 케이스 추가. `sqliteBool`은 `server/src/db/connection.test.ts`(없으면 새로 생성)에 순수 함수 단위테스트 2줄(1 → true, 0 → false).
- **클라이언트**: 테스트 프레임워크 없음. 브라우저로 실제 검증 — 관리자 페이지에서 특정 유저에게 레인보우/글로우를 체크한 뒤, 대기실 로스터/인게임 로스터/채팅/랭킹/프로필 팝업/친구창(3개 탭)/관전자 목록 각각에서 효과가 보이는지 확인. 레인보우+글로우 조합(흰색 글로우 대체)도 확인.
