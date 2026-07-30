# 닉네임 파티클 효과 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 닉네임 주위에 떠다니는 파티클 효과 4종(반짝임/상승/궤도/눈)을 관리자 전용 지급 기능으로 정식 구현한다.

**Architecture:** 이미 스파이크(임시 코드를 실제 게임에 바로 적용한 반복 검증)로 레이아웃·랜덤성 문제를 전부 풀어냈다 — 이 플랜은 그 검증된 로직을 `users.nickname_particle` 컬럼 기반 정식 데이터 흐름으로 정리하는 것이다. `nickname_effect`/`nickname_glow`를 추가했을 때와 완전히 같은 전파 패턴(서버 DB/API 타입 → Colyseus Schema → 클라이언트 타입 → 9개 렌더링 지점)을 한 번 더 반복한다.

**Tech Stack:** Node.js/TypeScript/Express/better-sqlite3/Colyseus(서버), React/TypeScript/Vite(클라이언트)

## Global Constraints

- 파티클 값: `"none" | "twinkle" | "rising" | "orbit" | "snow"` — 정확히 이 5개, 이 철자.
- `nickname_effect`/`nickname_glow`와 완전히 독립적인 세 번째 축 — 서로 다른 값 조합 전부 유효.
- 상점 판매 없음 — 관리자 전용 지급(`/admin` 유저 정보 페이지)만 지원.
- 9개 렌더링 지점 전부 적용: `TeamRosterPanel`, `RankingModal`, `FriendsModal`(받은요청/보낸요청/친구목록 3곳), `ChatBox`, `SpectatorCountBadge`, `ProfileModal`, `RoomList`(로비 프로필바), `RoleSelect`(역할선택 대기목록 1곳 + 로스터 2곳), `ShopModal`(미리보기).
- 점 개수 6개, 색상 문자열 시드 기반 유사난수로 폭 전체(4%~96%)에 독립 스폰 — `Math.random()` 금지(리렌더마다 위치가 튐).
- `NicknameParticle` 타입은 프로젝트 컨벤션대로 3곳에 독립 정의: `server/src/auth/googleAuth.ts`, `server/src/rooms/MatchState.ts`, `client/src/game/nicknameStyle.ts`. 나머지 파일은 전부 `import type`만 한다.
- CSS 클래스/키프레임명에서 "spike"/"TEMP" 표시를 떼고 정식 이름으로 정리(`spikeWrap`→`particleWrap`, `spikeDot`→`particleDot`, `spikeOrbit`→`particleOrbit`, 키프레임 `spike-*`→`particle-*`).

---

### Task 1: 서버 데이터 모델 — `nickname_particle` 컬럼 + `setNicknameEffect` 확장

**Files:**
- Modify: `server/src/db/connection.ts:88-93`
- Modify: `server/src/auth/googleAuth.ts` (여러 곳, 아래 상세)
- Test: `server/src/auth/googleAuth.test.ts`

**Interfaces:**
- Produces: `NicknameParticle` type, `NICKNAME_PARTICLES` 배열, `setNicknameEffect(userId: number, effect: NicknameEffect, glow: boolean, particle: NicknameParticle): void` (4번째 인자 추가), `UserProfile.nicknameParticle: NicknameParticle`, `AdminUserRow.nicknameParticle: NicknameParticle`, `RankingEntry.nicknameParticle: NicknameParticle`

- [ ] **Step 1: `connection.ts`에 컬럼 마이그레이션 추가**

`server/src/db/connection.ts:88-93` (기존 `nickname_glow`/`nickname_effect` 가드 바로 뒤)에 추가:

```ts
  if (!columns.includes("nickname_glow")) {
    db.exec(`ALTER TABLE users ADD COLUMN nickname_glow INTEGER NOT NULL DEFAULT 0`);
  }
  if (!columns.includes("nickname_effect")) {
    db.exec(`ALTER TABLE users ADD COLUMN nickname_effect TEXT NOT NULL DEFAULT 'none'`);
  }
  if (!columns.includes("nickname_particle")) {
    db.exec(`ALTER TABLE users ADD COLUMN nickname_particle TEXT NOT NULL DEFAULT 'none'`);
  }
```

`CREATE TABLE IF NOT EXISTS users` 블록(라인 7-24)의 컬럼 목록에도 `nickname_particle TEXT NOT NULL DEFAULT 'none',`을 `nickname_glow INTEGER NOT NULL DEFAULT 0,` 바로 뒤에 추가한다(신규 DB용).

- [ ] **Step 2: 실패하는 테스트 먼저 작성**

`server/src/auth/googleAuth.test.ts`의 `import` 목록에 `NICKNAME_PARTICLES`는 필요 없지만(직접 안 씀), 기존 `describe("setNicknameEffect", ...)` 블록(라인 289-330) 끝에 추가:

```ts
  test("stores particle independently of effect/glow", () => {
    const user = getOrCreateUser("sub-effects-5", {});
    setNicknameEffect(user.id, "rainbow", true, "snow");

    const profile = getUserById(user.id);
    expect(profile?.nicknameEffect).toBe("rainbow");
    expect(profile?.nicknameGlow).toBe(true);
    expect(profile?.nicknameParticle).toBe("snow");
  });

  test("switching effect doesn't reset particle, and vice versa", () => {
    const user = getOrCreateUser("sub-effects-6", {});
    setNicknameEffect(user.id, "none", false, "twinkle");
    setNicknameEffect(user.id, "chrome", false, "twinkle");

    const profile = getUserById(user.id);
    expect(profile?.nicknameEffect).toBe("chrome");
    expect(profile?.nicknameParticle).toBe("twinkle");
  });
```

- [ ] **Step 2b: 기존 테스트 호출부에 4번째 인자 추가**

같은 `describe` 블록의 기존 4개 테스트(라인 294-329)가 전부 `setNicknameEffect(user.id, effect, glow)`를 3개 인자로 호출한다. `setNicknameEffect`를 4번째 인자(`particle`) 필수로 바꾸면 컴파일 에러가 나므로, 각 호출에 `"none"`을 추가한다:

```ts
  test("sets effect and glow independently", () => {
    const user = getOrCreateUser("sub-effects-1", {});
    setNicknameEffect(user.id, "rainbow", false, "none");
    ...
  test("switches between effects (only one active at a time)", () => {
    const user = getOrCreateUser("sub-effects-2", {});
    setNicknameEffect(user.id, "rainbow", true, "none");
    setNicknameEffect(user.id, "hologram", true, "none");
    ...
  test("turns everything back to none/off", () => {
    const user = getOrCreateUser("sub-effects-3", {});
    setNicknameEffect(user.id, "shine", true, "none");
    setNicknameEffect(user.id, "none", false, "none");
    ...
  test("getUserById returns a real boolean for glow, not a 0/1 number", () => {
    const user = getOrCreateUser("sub-effects-4", {});
    setNicknameEffect(user.id, "shine", true, "none");
```

`describe("purchaseEffect / equipEffect / getOwnedEffects", ...)` 블록에도 6개 호출이 더 있다 — 전부 4번째 인자 `"none"`을 추가한다(정확한 현재 위치, `grep -n "setNicknameEffect(" server/src/auth/googleAuth.test.ts`로 재확인 가능):

```
461:    setNicknameEffect(user.id, "rainbow", true); // sets glow=true and also owns rainbow
492:    setNicknameEffect(user.id, "shine", false);
501:    setNicknameEffect(user.id, "none", false);
508:    setNicknameEffect(user.id, "pulse", false);
511:    setNicknameEffect(user.id, "none", false);
524:    setNicknameEffect(user.id, "none", false);
```

전부 `"none"`을 4번째 인자로 추가(예: `setNicknameEffect(user.id, "rainbow", true, "none"); // sets glow=true and also owns rainbow`). 이 태스크는 이 필드의 존재만 확인하는 거라 전부 `"none"`으로 충분 — 파티클 자체의 동작(admin grant/revoke와 소유권 무관)은 이미 스펙에서 "파티클은 상점 소유권 대상 아님"으로 확정됐다.

`server/src/rooms/MatchRoom.test.ts:118`의 호출(`setNicknameEffect(user.id, nicknameEffects.effect ?? "none", nicknameEffects.glow ?? false);`)은 Task 4에서 같이 고친다(그 태스크가 이 테스트 파일 전체를 다루므로 여기서는 건드리지 않음).

- [ ] **Step 3: 테스트가 타입 에러/실패로 막히는지 확인**

Run: `cd server && npm test`
Expected: 컴파일 에러(TS2554: Expected 4 arguments, but got 3) — `setNicknameEffect`가 아직 3개 인자만 받기 때문.

- [ ] **Step 4: `googleAuth.ts` 구현**

`server/src/auth/googleAuth.ts:5-14` (`NicknameEffect`/`NICKNAME_EFFECTS` 바로 뒤)에 추가:

```ts
export type NicknameParticle = "none" | "twinkle" | "rising" | "orbit" | "snow";
export const NICKNAME_PARTICLES: readonly NicknameParticle[] = ["none", "twinkle", "rising", "orbit", "snow"];
```

`UserProfile` 타입(라인 38-49)에 필드 추가:

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
  nicknameEffect: NicknameEffect;
  nicknameGlow: boolean;
  nicknameParticle: NicknameParticle;
};
```

`getOrCreateUser`의 SELECT(라인 79-87)와 `getUserById`의 SELECT(라인 103-114)에 `nickname_particle AS nicknameParticle`을 추가(문자열이라 `sqliteBool` 변환 불필요, `nickname_effect`와 동일하게 그대로 통과):

```ts
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
```

(`getUserById`도 동일한 패턴 — SELECT에 `nickname_particle AS nicknameParticle` 추가, 반환문은 그대로.)

`AdminUserRow` 타입(라인 125-136)에 필드 추가, `listUsers`의 SELECT(라인 140-146)에도 `nickname_particle AS nicknameParticle` 추가:

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
  nicknameEffect: NicknameEffect;
  nicknameGlow: boolean;
  nicknameParticle: NicknameParticle;
};
```

`RankingEntry` 타입(라인 242-248)에 필드 추가, `getTopRanking`의 SELECT(라인 256-257)에도 추가:

```ts
export type RankingEntry = {
  nickname: string;
  nicknameColor: string | null;
  maxRound: number;
  nicknameEffect: NicknameEffect;
  nicknameGlow: boolean;
  nicknameParticle: NicknameParticle;
};
```

```ts
      `SELECT nickname, nickname_color AS nicknameColor, max_round AS maxRound,
              nickname_effect AS nicknameEffect, nickname_glow AS nicknameGlow,
              nickname_particle AS nicknameParticle
       FROM users
       WHERE nickname IS NOT NULL AND max_round > 0
       ORDER BY max_round DESC, id ASC
       LIMIT ?`,
```

`setNicknameEffect`(라인 184-...)를 4번째 인자 추가하도록 수정:

```ts
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
    db.prepare(`DELETE FROM owned_nickname_effects WHERE user_id = ? AND effect = ? AND source = 'admin'`).run(
      userId,
      previous.effect,
    );
  }
}
```

(파티클은 상점 소유권 대상이 아니므로 `owned_nickname_effects` 관련 로직은 건드리지 않는다 — 그대로 둔다.)

- [ ] **Step 5: 테스트 통과 확인**

Run: `cd server && npm test -- googleAuth`
Expected: PASS (모든 테스트, 새로 추가한 2개 포함)

- [ ] **Step 6: 커밋**

```bash
git add server/src/db/connection.ts server/src/auth/googleAuth.ts server/src/auth/googleAuth.test.ts
git commit -m "서버: nickname_particle 컬럼과 setNicknameEffect 확장 추가"
```

---

### Task 2: 서버 API 라우트 — 관리자 지급 + 프로필/세션 응답

**Files:**
- Modify: `server/src/createServer.ts`

**Interfaces:**
- Consumes: Task 1의 `NicknameParticle`, `NICKNAME_PARTICLES`, `setNicknameEffect(userId, effect, glow, particle)`, `UserProfile.nicknameParticle`
- Produces: `POST /api/admin/users/:id/nickname-effects`가 `particle` 필드를 검증+저장, `GET /api/auth/me`와 `GET /api/profile/:nickname`이 `nicknameParticle` 필드를 응답에 포함

- [ ] **Step 1: import 추가**

`server/src/createServer.ts`의 googleAuth import 블록(라인 16-37 부근, `NICKNAME_EFFECTS,` 다음 줄)에 추가:

```ts
  NICKNAME_EFFECTS,
  NICKNAME_PARTICLES,
  type NicknameEffect,
  type NicknameParticle,
```

- [ ] **Step 2: `/api/admin/users/:id/nickname-effects` 라우트 확장**

`server/src/createServer.ts:278-295`를 교체:

```ts
  app.post("/api/admin/users/:id/nickname-effects", requireAdmin, (req, res) => {
    const userId = Number(req.params.id);
    if (!Number.isInteger(userId)) {
      res.status(400).json({ error: "invalid id" });
      return;
    }
    const { effect, glow, particle } = req.body as { effect?: unknown; glow?: unknown; particle?: unknown };
    if (typeof effect !== "string" || !NICKNAME_EFFECTS.includes(effect as NicknameEffect)) {
      res.status(400).json({ error: "effect는 'none'|'rainbow'|'shine'|'hologram' 중 하나여야 합니다." });
      return;
    }
    if (typeof glow !== "boolean") {
      res.status(400).json({ error: "glow는 boolean이어야 합니다." });
      return;
    }
    if (typeof particle !== "string" || !NICKNAME_PARTICLES.includes(particle as NicknameParticle)) {
      res.status(400).json({ error: "particle은 'none'|'twinkle'|'rising'|'orbit'|'snow' 중 하나여야 합니다." });
      return;
    }
    setNicknameEffect(userId, effect as NicknameEffect, glow, particle as NicknameParticle);
    res.json({ ok: true });
  });
```

- [ ] **Step 3: `/api/auth/me` 응답에 필드 추가**

`server/src/createServer.ts:397-409` 부근의 응답 객체에 `nicknameParticle` 추가:

```ts
    res.json(
      user
        ? {
            id: user.id,
            nickname: user.nickname,
            nicknameColor: user.nicknameColor,
            nicknameEffect: user.nicknameEffect,
            nicknameGlow: user.nicknameGlow,
            nicknameParticle: user.nicknameParticle,
            maxRound: user.maxRound,
            pigPlayCount: user.pigPlayCount,
            rabbitPlayCount: user.rabbitPlayCount,
            gameMoney: user.gameMoney,
```

(그 아래 줄들은 그대로 둔다 — `: null` 부분까지 원래 구조 유지.)

- [ ] **Step 4: `/api/profile/:nickname` 응답에 필드 추가**

`server/src/createServer.ts:752-763`을 교체:

```ts
    res.json({
      userId: target.id,
      nickname: user.nickname,
      nicknameColor: user.nicknameColor,
      nicknameEffect: user.nicknameEffect,
      nicknameGlow: user.nicknameGlow,
      nicknameParticle: user.nicknameParticle,
      maxRound: user.maxRound,
      pigPlayCount: user.pigPlayCount,
      rabbitPlayCount: user.rabbitPlayCount,
      friendshipStatus: status,
      friendshipId,
    });
```

- [ ] **Step 5: 타입체크**

Run: `cd server && npm run build`
Expected: 에러 없음(타입체크만, 산출물 없음)

- [ ] **Step 6: 서버 테스트 스위트 전체 실행 (회귀 확인)**

Run: `cd server && npm test`
Expected: 전부 PASS — 이 태스크는 라우트만 건드렸고 Task 1에서 이미 테스트를 맞춰뒀으므로 새 실패가 없어야 함.

- [ ] **Step 7: 커밋**

```bash
git add server/src/createServer.ts
git commit -m "서버: 관리자 파티클 지급 라우트 + 프로필/세션 응답에 파티클 필드 추가"
```

---

### Task 3: 서버 친구/채팅 데이터 — FriendListEntry, DirectMessageEntry에 파티클 필드

**Files:**
- Modify: `server/src/friends/friendships.ts`
- Modify: `server/src/friends/friendships.test.ts`
- Modify: `server/src/chat/directMessages.ts`

**Interfaces:**
- Consumes: Task 1의 `NicknameParticle`
- Produces: `FriendListEntry.nicknameParticle`, `ReceivedRequestEntry.fromNicknameParticle`, `SentRequestEntry.toNicknameParticle`, `DirectMessageEntry.senderNicknameParticle`

- [ ] **Step 1: `friendships.ts` — import 및 3개 타입/함수 확장**

`server/src/friends/friendships.ts` 상단 import에 `NicknameParticle` 추가(기존 `NicknameEffect` import 옆에).

`FriendListEntry`(라인 103-111)와 `listFriends`(라인 113-132):

```ts
export type FriendListEntry = {
  friendshipId: number;
  userId: number;
  nickname: string;
  lastLoginAt: string | null;
  nicknameColor: string | null;
  nicknameEffect: NicknameEffect;
  nicknameGlow: boolean;
  nicknameParticle: NicknameParticle;
};

export function listFriends(userId: number): FriendListEntry[] {
  const rows = db
    .prepare(
      `SELECT f.id AS friendshipId,
              u.id AS userId,
              u.nickname AS nickname,
              u.last_login_at AS lastLoginAt,
              u.nickname_color AS nicknameColor,
              u.nickname_effect AS nicknameEffect,
              u.nickname_glow AS nicknameGlow,
              u.nickname_particle AS nicknameParticle
       FROM friendships f
       JOIN users u ON u.id = CASE WHEN f.requester_id = ? THEN f.addressee_id ELSE f.requester_id END
       WHERE f.status = 'accepted' AND (f.requester_id = ? OR f.addressee_id = ?)`,
    )
    .all(userId, userId, userId) as (Omit<FriendListEntry, "nicknameGlow"> & { nicknameGlow: number })[];
  return rows.map((row) => ({
    ...row,
    nicknameGlow: sqliteBool(row.nicknameGlow),
  }));
}
```

`ReceivedRequestEntry`(라인 134-142)와 `listReceivedRequests`(라인 144-160):

```ts
export type ReceivedRequestEntry = {
  requestId: number;
  fromUserId: number;
  fromNickname: string;
  createdAt: string;
  fromNicknameColor: string | null;
  fromNicknameEffect: NicknameEffect;
  fromNicknameGlow: boolean;
  fromNicknameParticle: NicknameParticle;
};

export function listReceivedRequests(userId: number): ReceivedRequestEntry[] {
  const rows = db
    .prepare(
      `SELECT f.id AS requestId, u.id AS fromUserId, u.nickname AS fromNickname, f.created_at AS createdAt,
              u.nickname_color AS fromNicknameColor,
              u.nickname_effect AS fromNicknameEffect,
              u.nickname_glow AS fromNicknameGlow,
              u.nickname_particle AS fromNicknameParticle
       FROM friendships f
       JOIN users u ON u.id = f.requester_id
       WHERE f.addressee_id = ? AND f.status = 'pending'`,
    )
    .all(userId) as (Omit<ReceivedRequestEntry, "fromNicknameGlow"> & { fromNicknameGlow: number })[];
  return rows.map((row) => ({
    ...row,
    fromNicknameGlow: sqliteBool(row.fromNicknameGlow),
  }));
}
```

`SentRequestEntry`(라인 162-170)와 `listSentRequests`(라인 172-188)도 동일 패턴(`to` 접두사)으로 `toNicknameParticle` 추가.

- [ ] **Step 2: 기존 테스트의 `toEqual` 블록에 필드 추가**

`server/src/friends/friendships.test.ts:193-215`(listFriends 2건), `:222-232`(listReceivedRequests), `:241-251`(listSentRequests) — 각 예상 객체에 `nicknameParticle: "none"`(또는 `from`/`to` 접두사)을 추가:

```ts
    expect(listFriends(a)).toEqual([
      {
        friendshipId: id,
        userId: b,
        nickname: "비",
        lastLoginAt: expect.any(String),
        nicknameColor: null,
        nicknameEffect: "none",
        nicknameGlow: false,
        nicknameParticle: "none",
      },
    ]);
    expect(listFriends(b)).toEqual([
      {
        friendshipId: id,
        userId: a,
        nickname: "에이",
        lastLoginAt: expect.any(String),
        nicknameColor: null,
        nicknameEffect: "none",
        nicknameGlow: false,
        nicknameParticle: "none",
      },
    ]);
```

```ts
    expect(listReceivedRequests(b)).toEqual([
      {
        requestId: getFriendshipId(a, b),
        fromUserId: a,
        fromNickname: "에이",
        createdAt: expect.any(String),
        fromNicknameColor: null,
        fromNicknameEffect: "none",
        fromNicknameGlow: false,
        fromNicknameParticle: "none",
      },
    ]);
```

```ts
    expect(listSentRequests(a)).toEqual([
      {
        requestId: getFriendshipId(a, b),
        toUserId: b,
        toNickname: "비",
        createdAt: expect.any(String),
        toNicknameColor: null,
        toNicknameEffect: "none",
        toNicknameGlow: false,
        toNicknameParticle: "none",
      },
    ]);
```

- [ ] **Step 3: `directMessages.ts` 확장**

`server/src/chat/directMessages.ts`:

```ts
import { db, sqliteBool } from "../db/connection";
import type { NicknameEffect, NicknameParticle } from "../auth/googleAuth";

export type DirectMessageEntry = {
  id: number;
  senderId: number;
  senderNickname: string;
  senderNicknameColor: string | null;
  senderNicknameEffect: NicknameEffect;
  senderNicknameGlow: boolean;
  senderNicknameParticle: NicknameParticle;
  text: string;
  createdAt: string;
};

const HISTORY_LIMIT = 100;

export function getMessages(userId: number, otherUserId: number): DirectMessageEntry[] {
  const rows = db
    .prepare(
      `SELECT m.id AS id, m.sender_id AS senderId, u.nickname AS senderNickname,
              u.nickname_color AS senderNicknameColor,
              u.nickname_effect AS senderNicknameEffect,
              u.nickname_glow AS senderNicknameGlow,
              u.nickname_particle AS senderNicknameParticle,
              m.text AS text, m.created_at AS createdAt
       FROM direct_messages m
       JOIN users u ON u.id = m.sender_id
       WHERE (m.sender_id = ? AND m.recipient_id = ?) OR (m.sender_id = ? AND m.recipient_id = ?)
       ORDER BY m.id DESC
       LIMIT ?`,
    )
    .all(userId, otherUserId, otherUserId, userId, HISTORY_LIMIT) as (Omit<
    DirectMessageEntry,
    "senderNicknameGlow"
  > & { senderNicknameGlow: number })[];
  return rows
    .map((row) => ({
      ...row,
      senderNicknameGlow: sqliteBool(row.senderNicknameGlow),
    }))
    .reverse();
}
```

(파일의 나머지 부분 — `sendMessage` 등 — 은 그대로 둔다.)

- [ ] **Step 4: 테스트 실행**

Run: `cd server && npm test -- friendships`
Expected: PASS

Run: `cd server && npm test -- directMessages`
Expected: PASS (이 파일은 전체 객체 `toEqual` 검증이 없어 필드 추가만으로는 안 깨짐 — 만약 실행해서 실패하는 게 있으면 해당 테스트도 같은 패턴으로 `senderNicknameParticle: "none"` 추가)

- [ ] **Step 5: 커밋**

```bash
git add server/src/friends/friendships.ts server/src/friends/friendships.test.ts server/src/chat/directMessages.ts
git commit -m "서버: 친구/채팅 API 응답에 파티클 필드 추가"
```

---

### Task 4: Colyseus 실시간 상태 — MatchState/MatchRoom에 파티클 전파

**Files:**
- Modify: `server/src/rooms/MatchState.ts`
- Modify: `server/src/rooms/MatchRoom.ts`
- Modify: `server/src/rooms/MatchRoom.test.ts`

**Interfaces:**
- Consumes: Task 1의 `nicknameParticle` (UserProfile 필드)
- Produces: `PlayerState.nicknameParticle`, `ChatMessage.nicknameParticle`, `SpectatorState.nicknameParticle` (Colyseus Schema), `client.auth.nicknameParticle`

- [ ] **Step 1: `MatchState.ts`에 타입 + 스키마 필드 추가**

`server/src/rooms/MatchState.ts:7`(`NicknameEffect` 타입 정의) 바로 뒤에 추가:

```ts
export type NicknameParticle = "none" | "twinkle" | "rising" | "orbit" | "snow";
```

`PlayerState`(라인 9-18), `ChatMessage`(라인 29-36), `SpectatorState`(라인 38-44) 각각에 `nicknameGlow` 필드 바로 뒤 추가:

```ts
  @type("boolean") nicknameGlow: boolean = false;
  @type("string") nicknameParticle: NicknameParticle = "none";
```

(3곳 전부 동일하게.)

- [ ] **Step 2: `MatchRoom.ts` — import + onAuth + onJoin ×2 + pushChat**

`server/src/rooms/MatchRoom.ts:4`의 import에 `NicknameParticle` 추가:

```ts
import { MatchState, PlayerState, TeamState, ChatMessage, SpectatorState, type NicknameEffect, type NicknameParticle } from "./MatchState";
```

`onAuth`(라인 220-227) 반환 객체에 추가:

```ts
    return {
      ip: context.ip,
      userId: user.id,
      nickname: user.nickname,
      nicknameColor: user.nicknameColor ?? "",
      nicknameEffect: user.nicknameEffect,
      nicknameGlow: user.nicknameGlow,
      nicknameParticle: user.nicknameParticle,
    };
```

`onJoin`의 관전자 분기(라인 248-253)에 추가:

```ts
      spectator.nicknameGlow = client.auth?.nicknameGlow ?? false;
      spectator.nicknameParticle = client.auth?.nicknameParticle ?? "none";
```

`onJoin`의 플레이어 분기(라인 273-278)에 추가:

```ts
    player.nicknameGlow = client.auth?.nicknameGlow ?? false;
    player.nicknameParticle = client.auth?.nicknameParticle ?? "none";
```

`pushChat`(라인 462-479)과 두 호출부(라인 443, 451-458) 확장:

```ts
  private pushChat(
    list: ArraySchema<ChatMessage>,
    nickname: string,
    text: string,
    nicknameColor: string = "",
    nicknameEffect: NicknameEffect = "none",
    nicknameGlow: boolean = false,
    nicknameParticle: NicknameParticle = "none",
  ) {
    const message = new ChatMessage();
    message.nickname = nickname;
    message.nicknameColor = nicknameColor;
    message.nicknameEffect = nicknameEffect;
    message.nicknameGlow = nicknameGlow;
    message.nicknameParticle = nicknameParticle;
    message.text = text;
    message.sentAt = Date.now();
    list.push(message);
    if (list.length > MAX_CHAT_MESSAGES) list.shift();
  }
```

호출부(라인 443):

```ts
      this.pushChat(
        list,
        player.nickname,
        text,
        player.nicknameColor,
        player.nicknameEffect,
        player.nicknameGlow,
        player.nicknameParticle,
      );
```

호출부(라인 451-458):

```ts
      this.pushChat(
        this.state.matchChat,
        `${spectator.nickname} (관전)`,
        text,
        spectator.nicknameColor,
        spectator.nicknameEffect,
        spectator.nicknameGlow,
        spectator.nicknameParticle,
      );
```

- [ ] **Step 3: `MatchRoom.test.ts` — 헬퍼 함수 시그니처 확장**

`server/src/rooms/MatchRoom.test.ts:14`의 import에 `type NicknameParticle` 추가(기존 `type NicknameEffect,` 옆).

`connectAsUser` 헬퍼(라인 106-119):

```ts
async function connectAsUser(
  colyseus: ColyseusTestServer,
  room: ServerRoom<MatchState>,
  nickname: string,
  nicknameColor?: string,
  nicknameEffects?: { effect?: NicknameEffect; glow?: boolean; particle?: NicknameParticle },
) {
  testUserCounter += 1;
  const user = getOrCreateUser(`test-google-sub-${testUserCounter}`, {});
  setNickname(user.id, nickname);
  if (nicknameColor) setNicknameColor(user.id, nicknameColor);
  if (nicknameEffects) {
    setNicknameEffect(user.id, nicknameEffects.effect ?? "none", nicknameEffects.glow ?? false, nicknameEffects.particle ?? "none");
  }
```

- [ ] **Step 4: 타입체크 + 서버 테스트 스위트 전체 실행**

Run: `cd server && npm run build && npm test`
Expected: 타입 에러 없음, 전부 PASS (기존 MatchRoom 테스트들은 `.toBe()`로 개별 필드만 확인하므로 새 필드 추가로는 안 깨짐)

- [ ] **Step 5: 커밋**

```bash
git add server/src/rooms/MatchState.ts server/src/rooms/MatchRoom.ts server/src/rooms/MatchRoom.test.ts
git commit -m "서버: Colyseus 실시간 상태(로스터/채팅/관전자)에 파티클 필드 전파"
```

---

### Task 5: 클라이언트 `nicknameStyle` — 스파이크 코드를 정식 이름으로 정리 + 4번째 인자

**Files:**
- Modify: `client/src/game/nicknameStyle.ts`
- Modify: `client/src/game/nicknameStyle.module.css`

**Interfaces:**
- Produces: `NicknameParticle` type(클라이언트 독립 정의, 3번째), `ParticleDot` type, `nicknameStyle(color, effect, glow, particle): { className: string; style: CSSProperties; particles: ParticleDot[] }`

- [ ] **Step 1: `nicknameStyle.ts` 전체 교체**

`client/src/game/nicknameStyle.ts`를 아래 내용으로 완전히 교체한다(스파이크의 `SPIKE_PARTICLE` 모듈 상수를 삭제하고 실제 파라미터로 대체, 이름 정리):

```ts
import type { CSSProperties } from "react";
import styles from "./nicknameStyle.module.css";

export type NicknameEffect = "none" | "rainbow" | "shine" | "hologram" | "pulse" | "neon" | "chrome";
export type NicknameParticle = "none" | "twinkle" | "rising" | "orbit" | "snow";

const DEFAULT_GLOW_COLOR = "#ffffff";
const DEFAULT_SHINE_BASE_COLOR = "#6fb1ff";
const DEFAULT_PULSE_BASE_COLOR = "#6fb1ff";
const DEFAULT_NEON_BASE_COLOR = "#ff3df0";

const EFFECT_CLASSNAME: Record<Exclude<NicknameEffect, "none">, string> = {
  rainbow: styles.rainbow,
  shine: styles.shine,
  hologram: styles.hologram,
  pulse: styles.pulse,
  neon: styles.neon,
  chrome: styles.chrome,
};

// Pulse·네온사인은 그 자체가 이미 애니메이션되는 text-shadow라, 독립 글로우의 인라인
// style.textShadow를 얹으면 인라인 스타일이 CSS 클래스의 애니메이션 그림자를 덮어써서
// 깜빡임/숨쉬기 자체가 죽는다(단순히 안 예쁜 수준이 아니라 실제로 효과가 사라지는 버그) —
// 그래서 이 둘일 땐 글로우를 아예 계산하지 않는다.
const NO_INDEPENDENT_GLOW = new Set<NicknameEffect>(["pulse", "neon"]);

const PARTICLE_DOT_COUNT = 6;
const PARTICLE_SIMPLE_CLASSNAME: Record<Exclude<NicknameParticle, "none" | "orbit">, string> = {
  twinkle: styles.twinkleDot,
  rising: styles.risingDot,
  snow: styles.snowDot,
};

export type ParticleDot = { key: number; className: string; style: CSSProperties };

// 문자열 해시 → [0,1) 유사난수. Math.random()은 nicknameStyle()이 리렌더마다
// 다시 호출되는 일반 함수라 쓰면 매번 위치가 튀어 보이므로, color 문자열(유저마다
// 고유)을 시드로 써서 "그 사람은 항상 같은 위치" + "사람마다 달라 보임"을 동시에
// 만족시킨다. salt를 바꿔가며 여러 개의 서로 다른(상관없어 보이는) 값을 뽑는다.
function seededUnit(seed: number, salt: number): number {
  const x = Math.sin(seed * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}
function seededOffset(seed: number, salt: number, range: number): number {
  return (seededUnit(seed, salt) - 0.5) * 2 * range;
}
function stringSeed(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0;
  }
  return hash;
}

// 점 하나하나(PARTICLE_DOT_COUNT개)가 실제 DOM 엘리먼트라 닉네임 폭 전체
// (4%~96%)에서 각자 독립적인 위치·타이밍으로 스폰된다 — 색상 문자열 시드
// 기반이라 사실상 랜덤처럼 보이지만 같은 사람은 항상 같은 배치를 유지한다.
function particleDots(
  particle: Exclude<NicknameParticle, "none" | "orbit">,
  color: string | null | undefined,
): ParticleDot[] {
  const seed = stringSeed(color || "particle-default-seed");
  const dotClass = PARTICLE_SIMPLE_CLASSNAME[particle];
  const duration = particle === "snow" ? 2.8 : 2.6;

  const dots: ParticleDot[] = [];
  for (let i = 0; i < PARTICLE_DOT_COUNT; i++) {
    const leftPct = 4 + seededUnit(seed, 100 + i * 7) * 92;
    const delay = seededUnit(seed, 200 + i * 11) * duration;
    const style: CSSProperties & Record<string, string> = {
      left: `${leftPct.toFixed(1)}%`,
      animationDelay: `${delay.toFixed(2)}s`,
    };
    if (particle === "twinkle") {
      // 반짝임은 이동이 없으니 세로 위치도 폭 전체에 걸쳐 자유롭게 흩뿌린다.
      const topPct = 4 + seededUnit(seed, 300 + i * 13) * 92;
      style.top = `${topPct.toFixed(1)}%`;
    } else {
      // 상승/눈은 낙하·상승 중 좌우로 흔들리는 drift(바람에 날리는 느낌) —
      // translateY만 있으면 매번 완전히 같은 수직선을 그려서 반복이 티가 남.
      style["--drift-mid"] = `${seededOffset(seed, 400 + i * 17, 0.3).toFixed(2)}em`;
      style["--drift-end"] = `${seededOffset(seed, 500 + i * 19, 0.5).toFixed(2)}em`;
    }
    dots.push({ key: i, className: `${styles.particleDot} ${dotClass}`, style });
  }
  return dots;
}

// 닉네임을 렌더링하는 모든 화면이 공통으로 쓰는 스타일 계산기. 레인보우/샤인/홀로그램/
// Pulse/네온사인/크롬은 서로 배타적(닉네임의 "기본 색"을 정의하는 효과라 동시에 켤 수
// 없음 — nicknameEffect가 이미 하나의 값만 가지므로 구조적으로 보장됨). 글로우와
// 파티클은 효과와 독립적으로 켤 수 있다(파티클은 nicknameEffect/nicknameGlow와
// 완전히 다른 세 번째 축).
export function nicknameStyle(
  color: string | null | undefined,
  effect: NicknameEffect | undefined,
  glow: boolean | undefined,
  particle: NicknameParticle | undefined,
): { className: string; style: CSSProperties; particles: ParticleDot[] } {
  const style: CSSProperties = {};

  if (glow && !(effect && NO_INDEPENDENT_GLOW.has(effect))) {
    const glowColor = effect && effect !== "none" ? DEFAULT_GLOW_COLOR : color || DEFAULT_GLOW_COLOR;
    style.textShadow = `0 0 6px ${glowColor}, 0 0 16px ${glowColor}`;
  }

  if (effect === "shine" || effect === "pulse" || effect === "neon") {
    // 이 셋은 "그 사람 색 위에" 얹히는 효과라 레인보우/홀로그램/크롬과 달리 고정
    // 팔레트가 아님 — CSS 변수로 베이스 색을 주입한다(CSSProperties엔 커스텀
    // 프로퍼티 타입이 없어 캐스팅이 필요).
    const fallback =
      effect === "shine"
        ? DEFAULT_SHINE_BASE_COLOR
        : effect === "pulse"
          ? DEFAULT_PULSE_BASE_COLOR
          : DEFAULT_NEON_BASE_COLOR;
    (style as CSSProperties & Record<string, string>)["--nickname-base-color"] = color || fallback;
  }

  let particleClass = "";
  let particles: ParticleDot[] = [];
  if (particle === "orbit") {
    particleClass = `${styles.particleWrap} ${styles.particleOrbit}`;
  } else if (particle && particle !== "none") {
    particleClass = styles.particleWrap;
    particles = particleDots(particle, color);
  }

  if (effect && effect !== "none") {
    return { className: `${EFFECT_CLASSNAME[effect]} ${particleClass}`.trim(), style, particles };
  }

  if (color) {
    style.color = color;
  }
  return { className: particleClass, style, particles };
}
```

- [ ] **Step 2: `nicknameStyle.module.css`의 스파이크 섹션을 정식 이름으로 교체**

`client/src/game/nicknameStyle.module.css:165-292`(`/* TEMP SPIKE ... */`부터 `/* ==== */`닫는 줄까지)를 전부 아래로 교체:

```css
/* ============================================================
   닉네임 파티클 효과 — 반짝임/상승/궤도/눈
   ============================================================ */
.particleWrap {
  position: relative;
  display: inline-block;
}

/* 점 하나하나가 실제 DOM 엘리먼트(ParticleDot)라 각자 독립적인 left/top/delay를
   인라인 style로 받는다 — 폭 전체에서 각자 다른 위치에 스폰될 수 있다. */
.particleDot {
  position: absolute;
  border-radius: 50%;
  width: 3px;
  height: 3px;
  pointer-events: none;
}

/* 반짝임 — 이동이 없어서 폭 전체(가로+세로)에 자유롭게 흩뿌린다. */
.twinkleDot {
  background: #ffd76e;
  box-shadow: 0 0 3px 1px #ffd76e;
  animation: particle-twinkle 2.6s ease-in-out infinite;
}
@keyframes particle-twinkle {
  0%,
  100% {
    opacity: 0;
    transform: scale(0.5);
  }
  50% {
    opacity: 1;
    transform: scale(1.1);
  }
}

/* 상승 — 줄 높이 수준(1.2em)으로 이동거리를 압축, 낙하 중 좌우로 흔들리는
   drift(바람에 날리는 느낌) 추가 — translateY만 있으면 매 루프 완전히 같은
   수직선을 그려서 "항상 같은 경로"처럼 보임. */
.risingDot {
  background: #7cf5c4;
  box-shadow: 0 0 3px 1px #7cf5c4;
  bottom: -8%;
  animation: particle-rise 2.6s ease-in infinite;
}
@keyframes particle-rise {
  0% {
    opacity: 0;
    transform: translateY(0) translateX(0);
  }
  20% {
    opacity: 1;
  }
  50% {
    transform: translateY(-0.6em) translateX(var(--drift-mid, 0));
  }
  80% {
    opacity: 0.8;
  }
  100% {
    opacity: 0;
    transform: translateY(-1.2em) translateX(var(--drift-end, 0));
  }
}

/* 궤도 — 반지름을 글자 높이 수준(0.65em)으로 압축, em 단위라 화면마다
   폰트 크기가 달라도 늘 텍스트 자기 크기에 비례해서 따라감. 좁은 줄
   높이에서는 글자와 겹칠 수 있음(알려진 한계, 스펙 참고). */
.particleWrap.particleOrbit::before {
  content: "";
  position: absolute;
  top: 50%;
  left: 50%;
  width: 0;
  height: 0;
  box-shadow: 0 -0.65em 0 1.5px #ff8fd0;
  animation: particle-spin 3s linear infinite;
}
.particleWrap.particleOrbit::after {
  content: "";
  position: absolute;
  top: 50%;
  left: 50%;
  width: 0;
  height: 0;
  box-shadow: 0 -0.45em 0 1.5px #7cf5c4;
  animation: particle-spin 2.2s linear infinite reverse;
}
@keyframes particle-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

/* 눈 — 낙하거리를 줄 높이 수준(1.2em)으로 압축. 좌우로 흔들리는 drift(바람에
   날리는 느낌) 추가 — translateY만 있으면 매 루프 완전히 같은 수직선을
   반복해서 "항상 같은 자리에서 떨어진다"는 인상을 줌. */
.snowDot {
  background: #cfe8ff;
  box-shadow:
    0 0 0 1px rgba(30, 60, 100, 0.25),
    0 0 3px 1px #cfe8ff;
  top: -8%;
  animation: particle-snow 2.8s linear infinite;
}
@keyframes particle-snow {
  0% {
    opacity: 0;
    transform: translateY(0) translateX(0);
  }
  15% {
    opacity: 1;
  }
  50% {
    transform: translateY(0.6em) translateX(var(--drift-mid, 0));
  }
  85% {
    opacity: 0.8;
  }
  100% {
    opacity: 0;
    transform: translateY(1.2em) translateX(var(--drift-end, 0));
  }
}
/* ============================================================ */
```

`prefers-reduced-motion` 블록(파일 맨 아래, 라인 294-312 부근)에 파티클 애니메이션도 추가:

```css
@media (prefers-reduced-motion: reduce) {
  .rainbow.rainbow {
    animation-duration: 40s;
  }

  .shine.shine,
  .hologram.hologram,
  .pulse.pulse,
  .neon.neon,
  .chrome.chrome {
    animation-duration: 40s;
  }

  .twinkleDot,
  .risingDot,
  .snowDot,
  .particleWrap.particleOrbit::before,
  .particleWrap.particleOrbit::after {
    animation-duration: 40s !important;
  }
}
```

- [ ] **Step 3: 타입체크**

Run: `cd client && npx tsc -b`
Expected: 이 파일 자체는 통과하지만, `nicknameStyle(`을 호출하는 9곳(아직 3개 인자만 넘김)에서 에러가 남 — Task 7에서 고침. 지금은 "Expected 4 arguments, but got 3" 류 에러가 여러 파일에서 나는 게 정상.

- [ ] **Step 4: 커밋**

```bash
git add client/src/game/nicknameStyle.ts client/src/game/nicknameStyle.module.css
git commit -m "클라이언트: 파티클 스파이크 코드를 정식 nicknameStyle API로 정리"
```

(타입 에러가 남아있는 채로 커밋하는 게 어색하면, Task 7까지 끝난 뒤 한 번에 커밋해도 됨 — 순서상 이 태스크가 먼저 오는 이유는 나머지 태스크들이 이 파일의 최종 시그니처를 알아야 하기 때문.)

---

### Task 6: 클라이언트 타입 미러 — matchTypes/profile/auth/friends/chat/colyseus

**Files:**
- Modify: `client/src/game/matchTypes.ts`
- Modify: `client/src/game/profile.ts`
- Modify: `client/src/game/auth.ts`
- Modify: `client/src/game/friends.ts`
- Modify: `client/src/game/chat.ts`
- Modify: `client/src/game/directMessageToChatMessage.ts`
- Modify: `client/src/colyseus.ts`

**Interfaces:**
- Consumes: Task 5의 `NicknameParticle` (from `./nicknameStyle`)
- Produces: 9개 렌더링 지점이 소비할 모든 데이터 타입에 `nicknameParticle`(또는 `from`/`to`/`sender` 접두사 버전) 필드

- [ ] **Step 1: `matchTypes.ts`**

`client/src/game/matchTypes.ts:2`의 import를 `import type { NicknameEffect, NicknameParticle } from "./nicknameStyle";`로 바꾸고, `PlayerState`(라인 12-21), `ChatMessage`(라인 32-39), `SpectatorState`(라인 41-47) 각각의 `nicknameGlow: boolean;` 바로 뒤에 `nicknameParticle: NicknameParticle;` 추가.

- [ ] **Step 2: `profile.ts`**

`client/src/game/profile.ts:1`의 import를 `import type { NicknameEffect, NicknameParticle } from "./nicknameStyle";`로 바꾸고, `PublicProfile`(라인 5-16)의 `nicknameGlow: boolean;` 뒤에 `nicknameParticle: NicknameParticle;` 추가.

- [ ] **Step 3: `auth.ts`**

`client/src/game/auth.ts:1`의 import를 `import type { NicknameEffect, NicknameParticle } from "./nicknameStyle";`로 바꾸고, `Profile` 타입(라인 59-69)의 `nicknameGlow: boolean;` 뒤에 `nicknameParticle: NicknameParticle;` 추가.

- [ ] **Step 4: `friends.ts`**

`client/src/game/friends.ts:1`의 import를 `import type { NicknameEffect, NicknameParticle } from "./nicknameStyle";`로 바꾸고:
- `FriendEntry`(라인 3-14)의 `nicknameGlow: boolean;` 뒤에 `nicknameParticle: NicknameParticle;`
- `ReceivedRequestEntry`(라인 16-24)의 `fromNicknameGlow: boolean;` 뒤에 `fromNicknameParticle: NicknameParticle;`
- `SentRequestEntry`(라인 26-34)의 `toNicknameGlow: boolean;` 뒤에 `toNicknameParticle: NicknameParticle;`

- [ ] **Step 5: `chat.ts`**

`client/src/game/chat.ts:1`의 import를 `import type { NicknameEffect, NicknameParticle } from "./nicknameStyle";`로 바꾸고, `DirectMessageEntry`(라인 3-12)의 `senderNicknameGlow: boolean;` 뒤에 `senderNicknameParticle: NicknameParticle;` 추가.

- [ ] **Step 6: `directMessageToChatMessage.ts`**

`client/src/game/directMessageToChatMessage.ts` 전체 교체:

```ts
import type { ChatMessage } from "./matchTypes";
import type { DirectMessageEntry } from "./chat";

export function directMessageToChatMessage(m: DirectMessageEntry): ChatMessage {
  return {
    nickname: m.senderNickname,
    nicknameColor: m.senderNicknameColor ?? "",
    nicknameEffect: m.senderNicknameEffect,
    nicknameGlow: m.senderNicknameGlow,
    nicknameParticle: m.senderNicknameParticle,
    text: m.text,
    sentAt: new Date(`${m.createdAt.replace(" ", "T")}+09:00`).getTime(),
  };
}
```

- [ ] **Step 7: `colyseus.ts`**

`client/src/colyseus.ts:2`의 import를 `import type { NicknameEffect, NicknameParticle } from "./game/nicknameStyle";`로 바꾸고, `RankingEntry` interface(라인 37-43)의 `nicknameGlow: boolean;` 뒤에 `nicknameParticle: NicknameParticle;` 추가.

- [ ] **Step 8: 타입체크**

Run: `cd client && npx tsc -b`
Expected: 여전히 9개 컴포넌트 파일에서 `nicknameStyle(...)` 호출 인자 부족 에러 — Task 7에서 고침. 이 태스크가 건드린 파일들 자체는 에러 없어야 함.

- [ ] **Step 9: 커밋**

```bash
git add client/src/game/matchTypes.ts client/src/game/profile.ts client/src/game/auth.ts client/src/game/friends.ts client/src/game/chat.ts client/src/game/directMessageToChatMessage.ts client/src/colyseus.ts
git commit -m "클라이언트: 타입 미러 전부에 nicknameParticle 필드 추가"
```

---

### Task 7: 클라이언트 컴포넌트 배선 — 9개 렌더링 지점 + prop 체인

**Files:**
- Modify: `client/src/App.tsx`
- Modify: `client/src/components/RoomList.tsx`
- Modify: `client/src/components/ShopModal.tsx`
- Modify: `client/src/components/ChatBox.tsx`
- Modify: `client/src/components/FriendsModal.tsx`
- Modify: `client/src/components/ProfileModal.tsx`
- Modify: `client/src/components/RankingModal.tsx`
- Modify: `client/src/components/RoleSelect.tsx`
- Modify: `client/src/components/SpectatorCountBadge.tsx`
- Modify: `client/src/components/TeamRosterPanel.tsx`

**Interfaces:**
- Consumes: Task 5의 `nicknameStyle(color, effect, glow, particle)` (4개 인자 필수), Task 6의 모든 타입에 추가된 `nicknameParticle` 필드

**중요:** 이 9개 파일은 전부 이전 스파이크 단계에서 이미 `{effect.particles.map((p) => <span key={p.key} className={p.className} style={p.style} />)}` 형태의 점 렌더링 JSX가 `nicknameStyle(...)`를 호출하는 자리마다 추가돼 있다. 이 JSX 자체는 건드릴 필요가 없다 — 이 태스크는 오직 `nicknameStyle(...)` 호출의 인자 개수(3개→4개)와, 그 결과인 `effect`/`preview`가 참조하는 실제 데이터 소스(스파이크 때는 없던 실제 `nicknameParticle` 필드)를 연결하는 것만 다룬다. 아래 각 Step의 코드에 `{effect.particles.map(...)}` 줄이 안 보여도, 이미 있는 그 블록은 그대로 둔 채 바로 위 `nicknameStyle(...)` 호출 줄만 교체하면 된다.

- [ ] **Step 1: `App.tsx` → `RoomList`로 prop 전달**

`client/src/App.tsx`에서 `<RoomList>`를 렌더링하는 곳(`nicknameGlow={me.nicknameGlow}` 줄 바로 뒤)에 추가:

```tsx
        nicknameGlow={me.nicknameGlow}
        nicknameParticle={me.nicknameParticle}
```

- [ ] **Step 2: `RoomList.tsx`**

`client/src/components/RoomList.tsx:5`의 import를 `import { nicknameStyle, type NicknameEffect, type NicknameParticle } from "../game/nicknameStyle";`로 바꾼다. props 타입(라인 20-45 부근)에 `nicknameParticle: NicknameParticle;` 추가(구조분해 목록과 타입 둘 다). `nicknameStyle` 호출(라인 57)을 교체:

```tsx
  const effect = nicknameStyle(nicknameColor, nicknameEffect, nicknameGlow, nicknameParticle);
```

`<ShopModal>` 렌더링 지점(라인 218 근처, `nicknameGlow={nicknameGlow}` 뒤)에 추가:

```tsx
          nicknameParticle={nicknameParticle}
```

- [ ] **Step 3: `ShopModal.tsx`**

`client/src/components/ShopModal.tsx:4`의 import를 `import { nicknameStyle, type NicknameEffect, type NicknameParticle } from "../game/nicknameStyle";`로 바꾼다. props 타입에 `nicknameParticle: NicknameParticle;` 추가. `preview` 계산(라인 97)을 교체:

```tsx
                const preview = nicknameStyle(nicknameColor, effect, nicknameGlow, nicknameParticle);
```

(주의: 여기서 `effect`는 shop 아이템 순회 변수라 `NicknameEffect` 값이고, 파티클은 미리보기 대상이 아니라 유저의 실제 장착 파티클을 고정으로 보여준다 — 스펙의 "관리자 전용, 상점 판매 없음" 결정과 일치.)

- [ ] **Step 4: `ChatBox.tsx`**

`nicknameStyle` 호출(라인 116) 교체:

```tsx
          const effect = nicknameStyle(m.nicknameColor, m.nicknameEffect, m.nicknameGlow, m.nicknameParticle);
```

- [ ] **Step 5: `FriendsModal.tsx`**

3개 호출 전부 교체:

```tsx
                const effect = nicknameStyle(r.fromNicknameColor, r.fromNicknameEffect, r.fromNicknameGlow, r.fromNicknameParticle);
```

```tsx
                const effect = nicknameStyle(r.toNicknameColor, r.toNicknameEffect, r.toNicknameGlow, r.toNicknameParticle);
```

```tsx
              const effect = nicknameStyle(f.nicknameColor, f.nicknameEffect, f.nicknameGlow, f.nicknameParticle);
```

- [ ] **Step 6: `ProfileModal.tsx`**

`nicknameStyle` 호출(라인 13)과 fallback(라인 14) 교체:

```tsx
  const effect = profile
    ? nicknameStyle(profile.nicknameColor, profile.nicknameEffect, profile.nicknameGlow, profile.nicknameParticle)
    : { className: "", style: {}, particles: [] };
```

- [ ] **Step 7: `RankingModal.tsx`**

`nicknameStyle` 호출(라인 34) 교체:

```tsx
              const effect = nicknameStyle(entry.nicknameColor, entry.nicknameEffect, entry.nicknameGlow, entry.nicknameParticle);
```

- [ ] **Step 8: `RoleSelect.tsx`**

`nicknameParticleFor` 헬퍼 추가(기존 `nicknameGlowFor` 바로 뒤, 라인 45-47):

```tsx
  function nicknameGlowFor(sessionId: string): boolean {
    return sessionId ? (room.state.players.get(sessionId)?.nicknameGlow ?? false) : false;
  }

  function nicknameParticleFor(sessionId: string): NicknameParticle {
    return sessionId ? (room.state.players.get(sessionId)?.nicknameParticle ?? "none") : "none";
  }
```

`client/src/components/RoleSelect.tsx:5`의 import를 `import { nicknameStyle, type NicknameEffect, type NicknameParticle } from "../game/nicknameStyle";`로 바꾼다.

대기 목록의 `nicknameStyle` 호출(라인 65) 교체:

```tsx
                const effect = nicknameStyle(p.nicknameColor, p.nicknameEffect, p.nicknameGlow, p.nicknameParticle);
```

로스터의 `pigEffect`/`rabbitEffect` 계산(라인 109-118) 교체:

```tsx
          const pigEffect = nicknameStyle(
            nicknameColorFor(team.pigSessionId),
            nicknameEffectFor(team.pigSessionId),
            nicknameGlowFor(team.pigSessionId),
            nicknameParticleFor(team.pigSessionId),
          );
          const rabbitEffect = nicknameStyle(
            nicknameColorFor(team.rabbitSessionId),
            nicknameEffectFor(team.rabbitSessionId),
            nicknameGlowFor(team.rabbitSessionId),
            nicknameParticleFor(team.rabbitSessionId),
          );
```

- [ ] **Step 9: `SpectatorCountBadge.tsx`**

`nicknameStyle` 호출(라인 27) 교체:

```tsx
                  const effect = nicknameStyle(s.nicknameColor, s.nicknameEffect, s.nicknameGlow, s.nicknameParticle);
```

- [ ] **Step 10: `TeamRosterPanel.tsx`**

`Seat` 컴포넌트의 props 타입(라인 40-52)에 `nicknameParticle` 추가:

```tsx
function Seat({
  nickname,
  nicknameColor,
  nicknameEffect,
  nicknameGlow,
  nicknameParticle,
  roleIcon,
}: {
  nickname: string | undefined;
  nicknameColor: string | undefined;
  nicknameEffect: NicknameEffect | undefined;
  nicknameGlow: boolean | undefined;
  nicknameParticle: NicknameParticle | undefined;
  roleIcon: string;
}) {
  const effect = nicknameStyle(nicknameColor, nicknameEffect, nicknameGlow, nicknameParticle);
```

`client/src/components/TeamRosterPanel.tsx:3`의 import를 `import { nicknameStyle, type NicknameEffect, type NicknameParticle } from "../game/nicknameStyle";`로 바꾼다.

두 `<Seat>` 호출부(라인 73-79, 80-86)에 각각 추가:

```tsx
            <Seat
              nickname={players.get(team.pigSessionId)?.nickname}
              nicknameColor={players.get(team.pigSessionId)?.nicknameColor}
              nicknameEffect={players.get(team.pigSessionId)?.nicknameEffect}
              nicknameGlow={players.get(team.pigSessionId)?.nicknameGlow}
              nicknameParticle={players.get(team.pigSessionId)?.nicknameParticle}
              roleIcon="/game-assets/ui/thanksgiving_room_start_player_pig.png"
            />
            <Seat
              nickname={players.get(team.rabbitSessionId)?.nickname}
              nicknameColor={players.get(team.rabbitSessionId)?.nicknameColor}
              nicknameEffect={players.get(team.rabbitSessionId)?.nicknameEffect}
              nicknameGlow={players.get(team.rabbitSessionId)?.nicknameGlow}
              nicknameParticle={players.get(team.rabbitSessionId)?.nicknameParticle}
              roleIcon="/game-assets/ui/thanksgiving_room_start_player_rabbit.png"
            />
```

- [ ] **Step 11: 타입체크 (전체 그린 확인)**

Run: `cd client && npx tsc -b`
Expected: 에러 없음 — Task 5/6/7이 전부 맞아떨어지면 여기서 처음으로 클라이언트 전체가 그린이 됨.

- [ ] **Step 12: 빌드 + 로컬 동기화**

Run: `npm run sync-public` (루트에서)
Expected: 빌드 성공, `server/public` 갱신.

- [ ] **Step 13: Playwright로 실제 동작 확인**

로컬 서버(`npm run dev:server` 또는 이미 떠 있는 서버) 대상으로, 테스트 유저를 만들어 세션 쿠키를 주입한 뒤(이 세션에서 여러 번 썼던 패턴 — `server/.env`의 `SESSION_JWT_SECRET`으로 JWT 서명, `page.context().addCookies(...)`) 관리자 페이지에서 파티클을 지급하고, 최소 3곳(로비 프로필바, 랭킹, 친구 목록)에서 점이 실제로 뜨는지 스크린샷으로 확인한다. 확인 후 테스트 유저는 반드시 정리한다.

- [ ] **Step 14: 커밋**

```bash
git add client/src/App.tsx client/src/components/RoomList.tsx client/src/components/ShopModal.tsx client/src/components/ChatBox.tsx client/src/components/FriendsModal.tsx client/src/components/ProfileModal.tsx client/src/components/RankingModal.tsx client/src/components/RoleSelect.tsx client/src/components/SpectatorCountBadge.tsx client/src/components/TeamRosterPanel.tsx
git commit -m "클라이언트: 9개 렌더링 지점에 실제 파티클 데이터 배선"
```

---

### Task 8: 관리자 페이지 — 파티클 지급 드롭다운

**Files:**
- Modify: `client/src/components/AdminUsers.tsx`

**Interfaces:**
- Consumes: Task 2의 `POST /api/admin/users/:id/nickname-effects`(이제 `particle` 필드 필수), Task 6의 `NicknameParticle`

- [ ] **Step 1: `UserRow` 타입 확장 + import**

`client/src/components/AdminUsers.tsx:2`의 import를 `import type { NicknameEffect, NicknameParticle } from "../game/nicknameStyle";`로 바꾸고, `UserRow`(라인 8-19)의 `nicknameGlow: boolean;` 뒤에 `nicknameParticle: NicknameParticle;` 추가.

- [ ] **Step 2: `setEffect`/`toggleGlow`가 보내는 body에 particle 포함**

`setEffect`(라인 154-175)의 POST body(라인 161)를 교체:

```tsx
        body: JSON.stringify({ effect, glow: user.nicknameGlow, particle: user.nicknameParticle }),
```

`toggleGlow`(라인 177-198)의 POST body(라인 184)를 교체:

```tsx
        body: JSON.stringify({ effect: user.nicknameEffect, glow: !user.nicknameGlow, particle: user.nicknameParticle }),
```

- [ ] **Step 3: `setParticle` 함수 추가**

`toggleGlow` 함수(라인 177-198) 바로 뒤에 추가:

```tsx
  async function setParticle(user: UserRow, particle: NicknameParticle) {
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${user.id}/nickname-effects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ effect: user.nicknameEffect, glow: user.nicknameGlow, particle }),
      });
      if (!res.ok) {
        if (res.status === 401) {
          onUnauthorized();
          return;
        }
        setError("파티클 변경에 실패했습니다");
        return;
      }
      await loadUsers();
    } catch {
      setError("파티클 변경에 실패했습니다");
    }
  }
```

- [ ] **Step 4: 드롭다운 JSX 추가**

효과 `<select>`/글로우 `<label>`이 있는 `<td>`(라인 317-339)에, 글로우 라벨 바로 뒤에 추가:

```tsx
                  <td>
                    <select
                      value={user.nicknameEffect}
                      onChange={(e) => setEffect(user, e.target.value as NicknameEffect)}
                    >
                      <option value="none">없음</option>
                      <option value="rainbow">레인보우</option>
                      <option value="shine">샤인</option>
                      <option value="hologram">홀로그램</option>
                      <option value="pulse">Pulse</option>
                      <option value="neon">네온사인</option>
                      <option value="chrome">크롬</option>
                    </select>
                    <label className={styles.effectLabel}>
                      <input
                        type="checkbox"
                        checked={user.nicknameGlow}
                        onChange={() => toggleGlow(user)}
                        disabled={user.nicknameEffect === "pulse" || user.nicknameEffect === "neon"}
                      />
                      글로우
                    </label>
                    <select
                      value={user.nicknameParticle}
                      onChange={(e) => setParticle(user, e.target.value as NicknameParticle)}
                    >
                      <option value="none">파티클 없음</option>
                      <option value="twinkle">반짝임</option>
                      <option value="rising">상승</option>
                      <option value="orbit">궤도</option>
                      <option value="snow">눈</option>
                    </select>
                  </td>
```

- [ ] **Step 5: 타입체크 + 빌드**

Run: `cd client && npx tsc -b && npm run build`
Expected: 에러 없음, 빌드 성공.

- [ ] **Step 6: 로컬에서 동기화 후 수동 확인**

Run: `npm run sync-public` (루트에서)

`http://localhost:2567/admin`에서 로그인 후, 유저 정보 페이지에서 파티클 드롭다운으로 실제 유저에게 지급→회수가 되는지, 로비/랭킹 등에서 즉시(새로고침 후) 반영되는지 확인.

- [ ] **Step 7: 커밋**

```bash
git add client/src/components/AdminUsers.tsx
git commit -m "관리자 페이지: 파티클 지급 드롭다운 추가"
```

---

## 최종 확인

모든 태스크 완료 후:

```bash
cd server && npm test && npm run build
cd ../client && npx tsc -b && npm run build
```

전부 그린이면 `superpowers:finishing-a-development-branch` 스킬로 넘어간다(이 프로젝트는 브랜치 없이 `main`에 직접 커밋하는 컨벤션이므로, 그 스킬의 "표준 3옵션" 메뉴는 건너뛰고 배포 여부만 사용자에게 확인).
