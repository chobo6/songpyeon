# 닉네임 효과 확장 — 샤인 · 홀로그램 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 닉네임 효과에 샤인(빛 스캔)·홀로그램 2종을 추가하고, 그 과정에서 기존 `nickname_rainbow` boolean 컬럼을 `nickname_effect`("none"|"rainbow"|"shine"|"hologram") enum으로 승격해 레인보우/샤인/홀로그램의 배타성을 구조적으로 보장한다.

**Architecture:** DB 컬럼 하나(`nickname_rainbow` boolean → `nickname_effect` TEXT enum)를 갈아끼우고, 그 값이 흐르는 모든 계층(서버 DB/타입/라우트/Colyseus 실시간 상태, 클라이언트 타입/nicknameStyle 헬퍼/12개 컴포넌트)에서 필드명과 타입을 동일한 패턴으로 교체한다. 글로우는 지금처럼 독립 boolean 그대로 둔다. 샤인/홀로그램의 실제 시각 효과는 레인보우와 같은 `background-clip: text` + CSS 애니메이션 기법을 그대로 재사용한다.

**Tech Stack:** TypeScript, better-sqlite3, Colyseus/`@colyseus/schema`, React 19, Vitest.

## Global Constraints

- `nickname_effect`는 `"none" | "rainbow" | "shine" | "hologram"` 4값만 유효 — 그 외 문자열은 라우트에서 400으로 거부.
- 레인보우/샤인/홀로그램은 서로 배타적(enum이라 구조적으로 동시에 두 개일 수 없음). 글로우는 독립적으로 어떤 값과도 함께 켤 수 있다.
- 샤인의 베이스 색은 유저의 `nicknameColor`(CSS 변수 `--nickname-base-color`로 주입, 없으면 `#6fb1ff`). 홀로그램은 레인보우와 마찬가지로 `nicknameColor`를 무시하고 고정 파스텔 팔레트를 쓴다.
- `prefers-reduced-motion: reduce`에서는 샤인/홀로그램 둘 다 `animation-duration: 40s`로 느려져야 한다(레인보우 때와 동일 규칙) — 반드시 `.shine.shine`/`.hologram.hologram`(이중 클래스, 특이도 (0,2,0))로 작성해서 레인보우 때 겪었던 특이도 버그를 처음부터 피할 것.
- DB 마이그레이션 순서: `ALTER TABLE ADD COLUMN nickname_effect` 가드가 `user_version < 2` 백필 블록보다 반드시 먼저 실행돼야 한다.
- SQLite boolean 컬럼(`nickname_glow`)은 여전히 `sqliteBool()`로 명시 변환 — `nickname_effect`는 TEXT라 이 변환이 필요 없다.
- 클라이언트/서버는 별도 npm workspace라 공유 타입 패키지가 없다 — `NicknameEffect` 타입은 서버(`googleAuth.ts`, `MatchState.ts` 각각 로컬 정의)와 클라이언트(`nicknameStyle.ts`)에 손으로 동기화된 리터럴 유니온으로 존재한다(기존 `Phase`/`RoleChoice` 패턴과 동일).

---

### Task 1: 서버 DB 마이그레이션 + `googleAuth.ts` 데이터 계층

**Files:**
- Modify: `server/src/db/connection.ts:7-24`(CREATE TABLE), `:88-93`(ALTER 가드), `:101-105`(user_version 게이트)
- Modify: `server/src/auth/googleAuth.ts` (전체 — `nicknameRainbow` 관련 모든 지점)
- Test: `server/src/auth/googleAuth.test.ts` (기존 관련 테스트 갱신 + 신규)

**Interfaces:**
- Consumes: 없음(최하위 계층).
- Produces: `export type NicknameEffect = "none" | "rainbow" | "shine" | "hologram";`, `export const NICKNAME_EFFECTS: readonly NicknameEffect[]`, `export function setNicknameEffect(userId: number, effect: NicknameEffect, glow: boolean): void`. `UserProfile`/`AdminUserRow`/`RankingEntry` 타입의 `nicknameRainbow: boolean` → `nicknameEffect: NicknameEffect`.이후 모든 태스크가 이 타입과 함수를 그대로 가져다 쓴다.

- [ ] **Step 1: `connection.ts` 스키마 교체**

`CREATE TABLE IF NOT EXISTS users (...)`의 이 줄:
```sql
nickname_rainbow INTEGER NOT NULL DEFAULT 0,
```
을 아래로 교체:
```sql
nickname_effect TEXT NOT NULL DEFAULT 'none',
```

- [ ] **Step 2: 가드된 ALTER 추가**

기존 `if (!columns.includes("nickname_rainbow")) { ... }` 블록을 **삭제**하고, `if (!columns.includes("nickname_glow"))` 블록 뒤에 추가:

```ts
  if (!columns.includes("nickname_effect")) {
    db.exec(`ALTER TABLE users ADD COLUMN nickname_effect TEXT NOT NULL DEFAULT 'none'`);
  }
```

- [ ] **Step 3: 백필 + 옛 컬럼 제거 (user_version 게이트)**

기존:
```ts
  const schemaVersion = db.pragma("user_version", { simple: true }) as number;
  if (schemaVersion < 1) {
    db.exec(`UPDATE users SET created_at = datetime(created_at, '+9 hours')`);
    db.pragma("user_version = 1");
  }
```

아래로 교체(새 블록 추가, 기존 블록은 그대로 유지):

```ts
  const schemaVersion = db.pragma("user_version", { simple: true }) as number;
  if (schemaVersion < 1) {
    db.exec(`UPDATE users SET created_at = datetime(created_at, '+9 hours')`);
    db.pragma("user_version = 1");
  }
  if (schemaVersion < 2) {
    db.exec(`UPDATE users SET nickname_effect = 'rainbow' WHERE nickname_rainbow = 1`);
    db.exec(`ALTER TABLE users DROP COLUMN nickname_rainbow`);
    db.pragma("user_version = 2");
  }
```

이 블록은 Step 2에서 추가한 `ALTER TABLE ADD COLUMN nickname_effect` 가드보다 반드시 뒤(파일 순서상 아래)에 있어야 한다 — `nickname_rainbow`가 아직 컬럼으로 남아있는 채로 `nickname_effect`도 이미 존재해야 백필 UPDATE가 성립한다.

- [ ] **Step 4: `googleAuth.ts` — 타입 선언**

파일 상단(`import { db, sqliteBool } from "../db/connection";` 바로 뒤)에 추가:

```ts
export type NicknameEffect = "none" | "rainbow" | "shine" | "hologram";
export const NICKNAME_EFFECTS: readonly NicknameEffect[] = ["none", "rainbow", "shine", "hologram"];
```

- [ ] **Step 5: `UserProfile` 타입 + `getOrCreateUser`/`getUserById` 갱신**

`UserProfile` 타입의:
```ts
  nicknameRainbow: boolean;
  nicknameGlow: boolean;
```
을:
```ts
  nicknameEffect: NicknameEffect;
  nicknameGlow: boolean;
```
로 교체.

`getOrCreateUser`의 SELECT/변환 부분, 기존:
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
교체 후:
```ts
  const row = db
    .prepare(
      `SELECT id, nickname, banned_at AS bannedAt, nickname_color AS nicknameColor,
              max_round AS maxRound, pig_play_count AS pigPlayCount, rabbit_play_count AS rabbitPlayCount,
              game_money AS gameMoney, nickname_effect AS nicknameEffect, nickname_glow AS nicknameGlow
       FROM users WHERE google_sub = ?`,
    )
    .get(googleSub) as Omit<UserProfile, "nicknameGlow"> & { nicknameGlow: number };
  return { ...row, nicknameGlow: sqliteBool(row.nicknameGlow) };
```

`getUserById`도 동일한 패턴으로 교체 — SELECT의 `nickname_rainbow AS nicknameRainbow` → `nickname_effect AS nicknameEffect`, 반환 캐스팅에서 `nicknameRainbow` 관련 부분 제거(`nicknameGlow`만 변환).

- [ ] **Step 6: `AdminUserRow` 타입 + `listUsers` 갱신**

`AdminUserRow` 타입의 `nicknameRainbow: boolean;` → `nicknameEffect: NicknameEffect;`. `listUsers()`의 SELECT `nickname_rainbow AS nicknameRainbow` → `nickname_effect AS nicknameEffect`, 캐스팅/매핑에서 `nicknameRainbow` 변환 제거(`nicknameGlow`만 `sqliteBool` 유지).

- [ ] **Step 7: `setNicknameEffects` → `setNicknameEffect` 교체**

기존:
```ts
export type NicknameEffects = { rainbow: boolean; glow: boolean };

export function setNicknameEffects(userId: number, effects: NicknameEffects): void {
  db.prepare(`UPDATE users SET nickname_rainbow = ?, nickname_glow = ? WHERE id = ?`).run(
    effects.rainbow ? 1 : 0,
    effects.glow ? 1 : 0,
    userId,
  );
}
```
교체 후:
```ts
export function setNicknameEffect(userId: number, effect: NicknameEffect, glow: boolean): void {
  db.prepare(`UPDATE users SET nickname_effect = ?, nickname_glow = ? WHERE id = ?`).run(
    effect,
    glow ? 1 : 0,
    userId,
  );
}
```

- [ ] **Step 8: `RankingEntry` 타입 + `getTopRanking` 갱신**

같은 패턴 — `nicknameRainbow: boolean` → `nicknameEffect: NicknameEffect`, SELECT 별칭 교체, 캐스팅에서 `nicknameRainbow` 변환 제거.

- [ ] **Step 9: 테스트 갱신 — 기존 단언**

`googleAuth.test.ts` 상단 import에서 `setNicknameEffects`를 `setNicknameEffect`로 교체.

`getTopRanking` 관련 4곳(155, 165, 229-230, 261번 줄 부근)의 `nicknameRainbow: false, nicknameGlow: false`를 `nicknameEffect: "none", nicknameGlow: false`로 교체(261번 줄은 `nicknameColor: "#00ff00"`가 있는 케이스 — 그 줄은 그대로 두고 `nicknameRainbow`/`nicknameGlow` 부분만 바꿈).

`describe("setNicknameEffects", ...)` 블록 전체를 아래로 교체:

```ts
describe("setNicknameEffect", () => {
  beforeEach(() => {
    db.exec("DELETE FROM users");
  });

  test("sets effect and glow independently", () => {
    const user = getOrCreateUser("sub-effects-1", {});
    setNicknameEffect(user.id, "rainbow", false);

    const profile = getUserById(user.id);
    expect(profile?.nicknameEffect).toBe("rainbow");
    expect(profile?.nicknameGlow).toBe(false);
  });

  test("switches between effects (only one active at a time)", () => {
    const user = getOrCreateUser("sub-effects-2", {});
    setNicknameEffect(user.id, "rainbow", true);
    setNicknameEffect(user.id, "hologram", true);

    const profile = getUserById(user.id);
    expect(profile?.nicknameEffect).toBe("hologram");
    expect(profile?.nicknameGlow).toBe(true);
  });

  test("turns everything back to none/off", () => {
    const user = getOrCreateUser("sub-effects-3", {});
    setNicknameEffect(user.id, "shine", true);
    setNicknameEffect(user.id, "none", false);

    const profile = getUserById(user.id);
    expect(profile?.nicknameEffect).toBe("none");
    expect(profile?.nicknameGlow).toBe(false);
  });

  test("getUserById returns a real boolean for glow, not a 0/1 number", () => {
    const user = getOrCreateUser("sub-effects-4", {});
    setNicknameEffect(user.id, "shine", true);

    const profile = getUserById(user.id);
    expect(typeof profile?.nicknameGlow).toBe("boolean");
  });
});
```

- [ ] **Step 10: 테스트 실행**

Run: `cd server && npm test -- googleAuth`
Expected: 전부 PASS (기존 테스트 + 신규 4개).

- [ ] **Step 11: Commit**

```bash
git add server/src/db/connection.ts server/src/auth/googleAuth.ts server/src/auth/googleAuth.test.ts
git commit -m "닉네임 효과를 nickname_rainbow boolean에서 nickname_effect enum으로 교체"
```

---

### Task 2: 나머지 서버 데이터 계층 + 라우트

**Files:**
- Modify: `server/src/friends/friendships.ts` (`FriendListEntry`/`listFriends`, `ReceivedRequestEntry`/`listReceivedRequests`, `SentRequestEntry`/`listSentRequests`)
- Test: `server/src/friends/friendships.test.ts`
- Modify: `server/src/chat/directMessages.ts` (`DirectMessageEntry`/`getMessages`)
- Modify: `server/src/createServer.ts` (admin 라우트, 3개 auth 라우트, profile 라우트)

**Interfaces:**
- Consumes: Task 1의 `NicknameEffect`, `NICKNAME_EFFECTS`, `setNicknameEffect(userId, effect, glow)`, `UserProfile.nicknameEffect`(`./auth/googleAuth`에서 import).
- Produces: 없음(이 태스크가 만지는 함수들은 다른 서버 태스크가 소비하지 않음 — Task 3(Colyseus)은 `getUserById`(Task 1 산출물)만 씀).

- [ ] **Step 1: `friendships.ts` — 3개 타입 + 3개 함수**

`FriendListEntry` 타입의 `nicknameRainbow: boolean;` → `nicknameEffect: NicknameEffect;`(파일 상단에 `import type { NicknameEffect } from "../auth/googleAuth";` 추가). `listFriends()`의 SELECT `u.nickname_rainbow AS nicknameRainbow` → `u.nickname_effect AS nicknameEffect`, 캐스팅/매핑에서 `nicknameRainbow` 변환 제거(`nicknameGlow`만 `sqliteBool` 유지) — Task 1의 Step 5와 동일한 패턴.

`ReceivedRequestEntry`의 `fromNicknameRainbow: boolean;` → `fromNicknameEffect: NicknameEffect;`, `listReceivedRequests()`의 `u.nickname_rainbow AS fromNicknameRainbow` → `u.nickname_effect AS fromNicknameEffect`, 캐스팅에서 제거.

`SentRequestEntry`의 `toNicknameRainbow: boolean;` → `toNicknameEffect: NicknameEffect;`, `listSentRequests()`도 동일 패턴(`toNicknameRainbow` → `toNicknameEffect`).

- [ ] **Step 2: `friendships.test.ts` 갱신**

186-215번 줄 부근의 `listFriends` 테스트에서 `nicknameRainbow: false,`가 등장하는 2곳을 `nicknameEffect: "none",`로 교체.

- [ ] **Step 3: `directMessages.ts` 갱신**

`DirectMessageEntry`의 `senderNicknameRainbow: boolean;` → `senderNicknameEffect: NicknameEffect;`(상단에 `import type { NicknameEffect } from "../auth/googleAuth";` 추가). `getMessages()`의 SELECT `u.nickname_rainbow AS senderNicknameRainbow` → `u.nickname_effect AS senderNicknameEffect`, 캐스팅에서 `senderNicknameRainbow` 관련 부분 제거(`senderNicknameGlow`만 유지).

- [ ] **Step 4: 서버 타입체크**

Run: `cd server && npm run build`
Expected: 이 시점에 `createServer.ts`/`MatchRoom.ts` 등 아직 안 고친 소비처가 있어 에러가 날 수 있음 — Step 5~7에서 `createServer.ts`를 마저 고치면 이 태스크 범위 내에서는 해결됨(`MatchRoom.ts`/`MatchState.ts`는 Task 3에서 고치므로, 이 시점의 `tsc` 에러 중 `MatchRoom.ts`/`MatchState.ts` 관련은 정상 — Task 3 완료 후에 전체가 깨끗해짐).

- [ ] **Step 5: `createServer.ts` — admin 라우트**

파일 상단 import에서 `setNicknameEffects`를 `setNicknameEffect`로, 그리고 `NicknameEffect`, `NICKNAME_EFFECTS`를 추가로 import(`from "./auth/googleAuth"`).

`/api/admin/users/:id/nickname-effects` 라우트(270-283번 줄) 전체를 아래로 교체:

```ts
  app.post("/api/admin/users/:id/nickname-effects", requireAdmin, (req, res) => {
    const userId = Number(req.params.id);
    if (!Number.isInteger(userId)) {
      res.status(400).json({ error: "invalid id" });
      return;
    }
    const { effect, glow } = req.body as { effect?: unknown; glow?: unknown };
    if (typeof effect !== "string" || !NICKNAME_EFFECTS.includes(effect as NicknameEffect)) {
      res.status(400).json({ error: "effect는 'none'|'rainbow'|'shine'|'hologram' 중 하나여야 합니다." });
      return;
    }
    if (typeof glow !== "boolean") {
      res.status(400).json({ error: "glow는 boolean이어야 합니다." });
      return;
    }
    setNicknameEffect(userId, effect as NicknameEffect, glow);
    res.json({ ok: true });
  });
```

- [ ] **Step 6: `createServer.ts` — 3개 auth 라우트 + profile 라우트**

4곳 전부 같은 한 줄 교체 — `nicknameRainbow: user.nicknameRainbow,` → `nicknameEffect: user.nicknameEffect,`(3곳), `nicknameRainbow: user?.nicknameRainbow ?? false,` → `nicknameEffect: user?.nicknameEffect ?? "none",`(1곳, `/api/auth/nickname`):

- 363번 줄 (`/api/auth/google`)
- 391번 줄 (`/api/auth/me`)
- 428번 줄 (`/api/auth/nickname`, `?? false` → `?? "none"`)
- 744번 줄 (`/api/profile/:nickname`)

- [ ] **Step 7: 서버 타입체크 (Task 3 완료 전이라 MatchRoom/MatchState 에러는 남아있어도 됨)**

Run: `cd server && npm run build`
Expected: `server/src/rooms/MatchRoom.ts`/`MatchState.ts` 관련 에러만 남고 그 외(`createServer.ts`, `friendships.ts`, `directMessages.ts`, `googleAuth.ts`)는 깨끗함.

- [ ] **Step 8: 서버 테스트 실행**

Run: `cd server && npm test -- friendships`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add server/src/friends/friendships.ts server/src/friends/friendships.test.ts server/src/chat/directMessages.ts server/src/createServer.ts
git commit -m "친구/DM 데이터 계층과 서버 라우트를 nickname_effect로 교체"
```

---

### Task 3: Colyseus 실시간 상태 (`MatchState.ts` + `MatchRoom.ts`)

**Files:**
- Modify: `server/src/rooms/MatchState.ts` (`PlayerState`/`ChatMessage`/`SpectatorState`)
- Modify: `server/src/rooms/MatchRoom.ts` (`onAuth`, `onJoin` 2곳, `handleSendChat` 2곳, `pushChat`)
- Test: `server/src/rooms/MatchRoom.test.ts`

**Interfaces:**
- Consumes: Task 1의 `UserProfile.nicknameEffect`(`getUserById`가 반환하는 값, `client.auth`를 통해 `MatchRoom.ts`로 흘러들어옴).
- Produces: `PlayerState`/`ChatMessage`/`SpectatorState`(Colyseus Schema)의 `nicknameEffect: NicknameEffect` 필드 — Task 5(`matchTypes.ts`)가 이 필드명/타입을 그대로 가져다 쓴다.

- [ ] **Step 1: `MatchState.ts` — 타입 선언 + 3개 클래스**

파일 상단(`export type Phase = ...` 옆)에 추가:

```ts
export type NicknameEffect = "none" | "rainbow" | "shine" | "hologram";
```

`PlayerState`/`ChatMessage`/`SpectatorState` 세 클래스 전부에서:
```ts
  @type("boolean") nicknameRainbow: boolean = false;
```
을:
```ts
  @type("string") nicknameEffect: NicknameEffect = "none";
```
로 교체(3곳).

- [ ] **Step 2: `MatchRoom.ts` — `onAuth`**

기존:
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
교체 후:
```ts
    return {
      ip: context.ip,
      userId: user.id,
      nickname: user.nickname,
      nicknameColor: user.nicknameColor ?? "",
      nicknameEffect: user.nicknameEffect,
      nicknameGlow: user.nicknameGlow,
    };
```

- [ ] **Step 3: `MatchRoom.ts` — `onJoin` (관전자/플레이어 분기)**

관전자 분기, 기존:
```ts
      spectator.nicknameRainbow = client.auth?.nicknameRainbow ?? false;
```
교체 후:
```ts
      spectator.nicknameEffect = client.auth?.nicknameEffect ?? "none";
```

플레이어 분기, 기존:
```ts
    player.nicknameRainbow = client.auth?.nicknameRainbow ?? false;
```
교체 후:
```ts
    player.nicknameEffect = client.auth?.nicknameEffect ?? "none";
```

- [ ] **Step 4: `MatchRoom.ts` — `pushChat` 시그니처 + 본문**

기존:
```ts
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
```
교체 후:
```ts
  private pushChat(
    list: ArraySchema<ChatMessage>,
    nickname: string,
    text: string,
    nicknameColor: string = "",
    nicknameEffect: NicknameEffect = "none",
    nicknameGlow: boolean = false,
  ) {
    const message = new ChatMessage();
    message.nickname = nickname;
    message.nicknameColor = nicknameColor;
    message.nicknameEffect = nicknameEffect;
    message.nicknameGlow = nicknameGlow;
    message.text = text;
```

`MatchState.ts`에서 export하는 `NicknameEffect`를 이 파일 상단 import에 추가(`import { ..., type NicknameEffect } from "./MatchState";` — 기존 import 문에 이미 `MatchState`에서 여러 타입을 가져오고 있으므로 그 목록에 추가).

- [ ] **Step 5: `MatchRoom.ts` — `handleSendChat` 2개 호출부**

플레이어 분기, 기존:
```ts
      this.pushChat(list, player.nickname, text, player.nicknameColor, player.nicknameRainbow, player.nicknameGlow);
```
교체 후:
```ts
      this.pushChat(list, player.nickname, text, player.nicknameColor, player.nicknameEffect, player.nicknameGlow);
```

관전자 분기, 기존:
```ts
      this.pushChat(
        this.state.matchChat,
        `${spectator.nickname} (관전)`,
        text,
        spectator.nicknameColor,
        spectator.nicknameRainbow,
        spectator.nicknameGlow,
      );
```
교체 후:
```ts
      this.pushChat(
        this.state.matchChat,
        `${spectator.nickname} (관전)`,
        text,
        spectator.nicknameColor,
        spectator.nicknameEffect,
        spectator.nicknameGlow,
      );
```

- [ ] **Step 6: 서버 타입체크**

Run: `cd server && npm run build`
Expected: 전체 에러 없이 통과(Task 1/2와 합쳐 서버 쪽은 이제 완전히 깨끗함).

- [ ] **Step 7: `MatchRoom.test.ts` 갱신**

`connectAsUser` 헬퍼(99-122번 줄)의 시그니처와 본문, 기존:
```ts
async function connectAsUser(
  colyseus: ColyseusTestServer,
  room: ServerRoom<MatchState>,
  nickname: string,
  nicknameColor?: string,
  nicknameEffects?: { rainbow?: boolean; glow?: boolean },
) {
  testUserCounter += 1;
  const user = getOrCreateUser(`test-google-sub-${testUserCounter}`, {});
  setNickname(user.id, nickname);
  if (nicknameColor) setNicknameColor(user.id, nicknameColor);
  if (nicknameEffects) {
    setNicknameEffects(user.id, {
      rainbow: nicknameEffects.rainbow ?? false,
      glow: nicknameEffects.glow ?? false,
    });
  }
```
교체 후:
```ts
async function connectAsUser(
  colyseus: ColyseusTestServer,
  room: ServerRoom<MatchState>,
  nickname: string,
  nicknameColor?: string,
  nicknameEffects?: { effect?: NicknameEffect; glow?: boolean },
) {
  testUserCounter += 1;
  const user = getOrCreateUser(`test-google-sub-${testUserCounter}`, {});
  setNickname(user.id, nickname);
  if (nicknameColor) setNicknameColor(user.id, nicknameColor);
  if (nicknameEffects) {
    setNicknameEffect(user.id, nicknameEffects.effect ?? "none", nicknameEffects.glow ?? false);
  }
```

(이 파일의 import 문에서 `setNicknameEffects`를 `setNicknameEffect`로, `NicknameEffect` 타입을 추가로 import.)

`describe("nickname rainbow/glow propagation", ...)` 블록(1433-1463번 줄)을 아래로 교체:

```ts
  describe("nickname effect/glow propagation", () => {
    test("a player with rainbow effect and glow enabled has it reflected in PlayerState", async () => {
      const room = await colyseus.createRoom<MatchState>("match");
      const client = await connectAsUser(colyseus, room, "레인보우돼지", undefined, { effect: "rainbow", glow: true });
      await flush();

      const player = room.state.players.get(client.sessionId);
      expect(player?.nicknameEffect).toBe("rainbow");
      expect(player?.nicknameGlow).toBe(true);
    });

    test("a player with neither enabled has effect 'none' and glow false, not undefined", async () => {
      const room = await colyseus.createRoom<MatchState>("match");
      const client = await connectAsUser(colyseus, room, "평범플레이어");
      await flush();

      const player = room.state.players.get(client.sessionId);
      expect(player?.nicknameEffect).toBe("none");
      expect(player?.nicknameGlow).toBe(false);
    });

    test("a chat message from a rainbow/glow player carries the same flags", async () => {
      const room = await colyseus.createRoom<MatchState>("match");
      const client = await connectAsUser(colyseus, room, "채팅효과", undefined, { effect: "rainbow", glow: false });
      client.send("sendChat", { text: "안녕" });
      await flush();

      const message = room.state.lobbyChat.find((m) => m.text === "안녕");
      expect(message?.nicknameEffect).toBe("rainbow");
      expect(message?.nicknameGlow).toBe(false);
    });

    test("a player with the shine effect has it reflected in PlayerState", async () => {
      const room = await colyseus.createRoom<MatchState>("match");
      const client = await connectAsUser(colyseus, room, "샤인유저", undefined, { effect: "shine" });
      await flush();

      const player = room.state.players.get(client.sessionId);
      expect(player?.nicknameEffect).toBe("shine");
    });
  });
```

- [ ] **Step 8: 테스트 실행**

Run: `cd server && npm test -- MatchRoom`
Expected: PASS (기존 3개 + 신규 1개, 총 4개).

- [ ] **Step 9: 전체 서버 테스트 실행**

Run: `cd server && npm test`
Expected: 전부 PASS.

- [ ] **Step 10: Commit**

```bash
git add server/src/rooms/MatchState.ts server/src/rooms/MatchRoom.ts server/src/rooms/MatchRoom.test.ts
git commit -m "Colyseus 실시간 상태(PlayerState/ChatMessage/SpectatorState)를 nickname_effect로 교체"
```

---

### Task 4: 클라이언트 `nicknameStyle()` + CSS (샤인·홀로그램 실제 구현)

**Files:**
- Modify: `client/src/game/nicknameStyle.ts` (전체 교체)
- Modify: `client/src/game/nicknameStyle.module.css` (샤인/홀로그램 CSS 추가)

**Interfaces:**
- Consumes: 없음(클라이언트 쪽 최하위 계층 — 자체적으로 `NicknameEffect` 타입을 정의함).
- Produces: `export type NicknameEffect = "none" | "rainbow" | "shine" | "hologram";`, `export function nicknameStyle(color, effect: NicknameEffect | undefined, glow: boolean | undefined): { className: string; style: CSSProperties }`. Task 5(`matchTypes.ts`가 이 타입을 import)와 Task 6(모든 컴포넌트가 이 함수의 새 두 번째 인자를 씀)이 이걸 소비한다.

- [ ] **Step 1: `nicknameStyle.ts` 전체 교체**

```ts
import type { CSSProperties } from "react";
import styles from "./nicknameStyle.module.css";

export type NicknameEffect = "none" | "rainbow" | "shine" | "hologram";

const DEFAULT_GLOW_COLOR = "#ffffff";
const DEFAULT_SHINE_BASE_COLOR = "#6fb1ff";

const EFFECT_CLASSNAME: Record<Exclude<NicknameEffect, "none">, string> = {
  rainbow: styles.rainbow,
  shine: styles.shine,
  hologram: styles.hologram,
};

// 닉네임을 렌더링하는 모든 화면이 공통으로 쓰는 스타일 계산기. 레인보우/샤인/홀로그램은
// 서로 배타적(닉네임의 "기본 색"을 정의하는 효과라 동시에 켤 수 없음 — nicknameEffect가
// 이미 하나의 값만 가지므로 구조적으로 보장됨). 글로우는 독립적으로 켤 수 있는 text-shadow.
export function nicknameStyle(
  color: string | null | undefined,
  effect: NicknameEffect | undefined,
  glow: boolean | undefined,
): { className: string; style: CSSProperties } {
  const style: CSSProperties = {};

  if (glow) {
    const glowColor = effect && effect !== "none" ? DEFAULT_GLOW_COLOR : color || DEFAULT_GLOW_COLOR;
    style.textShadow = `0 0 6px ${glowColor}, 0 0 16px ${glowColor}`;
  }

  if (effect === "shine") {
    // 샤인은 "그 사람 색 위에" 빛이 지나가는 효과라 레인보우/홀로그램과 달리 고정
    // 팔레트가 아님 — CSS 변수로 베이스 색을 주입한다(CSSProperties엔 커스텀
    // 프로퍼티 타입이 없어 캐스팅이 필요).
    (style as CSSProperties & Record<string, string>)["--nickname-base-color"] = color || DEFAULT_SHINE_BASE_COLOR;
  }

  if (effect && effect !== "none") {
    return { className: EFFECT_CLASSNAME[effect], style };
  }

  if (color) {
    style.color = color;
  }
  return { className: "", style };
}
```

- [ ] **Step 2: `nicknameStyle.module.css`에 샤인/홀로그램 추가**

기존 `.rainbow.rainbow { ... }` 블록과 그 `@keyframes`/`@media (prefers-reduced-motion: reduce)` 블록은 그대로 두고, 파일 끝에 추가:

```css
/* 샤인 — .shine.shine인 이유는 .rainbow.rainbow와 동일(위 주석 참고): 이 클래스도
   pendingName/rosterName처럼 자기 background를 쓰는 클래스와 나란히 적용되므로 같은
   특이도 트릭이 필요하다. */
.shine.shine {
  background: linear-gradient(
    100deg,
    var(--nickname-base-color, #6fb1ff) 0%,
    var(--nickname-base-color, #6fb1ff) 42%,
    #ffffff 50%,
    var(--nickname-base-color, #6fb1ff) 58%,
    var(--nickname-base-color, #6fb1ff) 100%
  );
  background-size: 220% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  -webkit-text-fill-color: transparent;
  animation: shine-sweep 2.6s ease-in-out infinite;
}

@keyframes shine-sweep {
  from {
    background-position: 140% 0;
  }
  to {
    background-position: -140% 0;
  }
}

/* 홀로그램 — 레인보우처럼 nicknameColor 무시, 고정 파스텔 팔레트 + 밝기/채도 출렁임 */
.hologram.hologram {
  background: linear-gradient(115deg, #ff9ecb, #ffd59e, #e6ff9e, #9effc4, #9ee7ff, #c9a4ff, #ff9ecb);
  background-size: 320% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  -webkit-text-fill-color: transparent;
  animation:
    holo-shift 6s linear infinite,
    holo-shimmer 2.2s ease-in-out infinite;
}

@keyframes holo-shift {
  from {
    background-position: 0% 0;
  }
  to {
    background-position: -320% 0;
  }
}

@keyframes holo-shimmer {
  0%,
  100% {
    filter: brightness(1) saturate(1);
  }
  50% {
    filter: brightness(1.3) saturate(1.35);
  }
}

@media (prefers-reduced-motion: reduce) {
  .shine.shine,
  .hologram.hologram {
    animation-duration: 40s;
  }
}
```

- [ ] **Step 3: 클라이언트 타입체크**

Run: `cd client && npm run build`
Expected: `tsc -b`가 이 시점에는 아직 `nicknameStyle()`을 3개 인자로 호출하는 기존 컴포넌트들과 타입이 안 맞아 에러가 남 — 이건 정상(Task 5/6에서 그 호출부들을 고치면 해결됨). 이 태스크 자체의 검증은 `nicknameStyle.ts`/`nicknameStyle.module.css` 파일 자체에 문법 에러가 없는지만 확인하는 것으로 충분 — Vite/tsc가 이 두 파일 자체를 파싱하는 데는 문제없어야 한다(에러 메시지가 이 두 파일이 아니라 다른 컴포넌트 파일들을 가리키는지 확인).

- [ ] **Step 4: Commit**

```bash
git add client/src/game/nicknameStyle.ts client/src/game/nicknameStyle.module.css
git commit -m "nicknameStyle에 샤인/홀로그램 효과 구현 추가"
```

---

### Task 5: 클라이언트 타입 계층

**Files:**
- Modify: `client/src/game/matchTypes.ts` (`PlayerState`/`ChatMessage`/`SpectatorState`)
- Modify: `client/src/game/auth.ts` (`Profile`)
- Modify: `client/src/game/profile.ts` (`PublicProfile`)
- Modify: `client/src/game/friends.ts` (`FriendListEntry` 등 3개 타입)
- Modify: `client/src/game/directMessageToChatMessage.ts`
- Modify: `client/src/colyseus.ts` (`RoomListEntry`류 타입)

**Interfaces:**
- Consumes: Task 4의 `NicknameEffect`(`./nicknameStyle`에서 import).
- Produces: 위 6개 파일의 모든 관련 타입이 `nicknameEffect: NicknameEffect`(또는 `fromNicknameEffect`/`toNicknameEffect`/`senderNicknameEffect`)를 갖는다. Task 6이 이 타입들을 그대로 소비한다.

- [ ] **Step 1: `matchTypes.ts`**

파일 상단에 추가:
```ts
import type { NicknameEffect } from "./nicknameStyle";
```

`PlayerState`/`ChatMessage`/`SpectatorState` 세 interface 전부에서 `nicknameRainbow: boolean;` → `nicknameEffect: NicknameEffect;`(3곳).

- [ ] **Step 2: `auth.ts`**

`Profile` 타입의 `nicknameRainbow: boolean;` → `nicknameEffect: NicknameEffect;`(상단에 `import type { NicknameEffect } from "./nicknameStyle";` 추가).

- [ ] **Step 3: `profile.ts`**

`PublicProfile` 타입의 `nicknameRainbow: boolean;` → `nicknameEffect: NicknameEffect;`(같은 import 추가).

- [ ] **Step 4: `friends.ts`**

`FriendListEntry`류 3개 타입(친구 목록/받은 요청/보낸 요청)의 `nicknameRainbow`/`fromNicknameRainbow`/`toNicknameRainbow` 필드를 각각 `nicknameEffect`/`fromNicknameEffect`/`toNicknameEffect`로 교체(같은 import 추가).

- [ ] **Step 5: `directMessageToChatMessage.ts`**

`m.senderNicknameRainbow` → `m.senderNicknameEffect`, 결과 객체의 `nicknameRainbow: m.senderNicknameRainbow,` → `nicknameEffect: m.senderNicknameEffect,`.

- [ ] **Step 6: `colyseus.ts`**

`RoomListEntry`류 타입의 `nicknameRainbow: boolean;` → `nicknameEffect: NicknameEffect;`(같은 import 추가).

- [ ] **Step 7: 클라이언트 타입체크**

Run: `cd client && npm run build`
Expected: 이 시점에도 아직 컴포넌트(Task 6 대상)들이 옛 필드명/3-인자 호출을 쓰고 있어 에러 남음 — 정상. 에러 목록이 Task 6에서 다룰 컴포넌트 파일들만 가리키는지 확인.

- [ ] **Step 8: Commit**

```bash
git add client/src/game/matchTypes.ts client/src/game/auth.ts client/src/game/profile.ts client/src/game/friends.ts client/src/game/directMessageToChatMessage.ts client/src/colyseus.ts
git commit -m "클라이언트 타입 계층을 nicknameEffect로 교체"
```

---

### Task 6: 클라이언트 컴포넌트 배선

**Files:**
- Modify: `client/src/App.tsx`
- Modify: `client/src/components/RoomList.tsx`
- Modify: `client/src/components/ProfileModal.tsx`
- Modify: `client/src/components/ChatBox.tsx`
- Modify: `client/src/components/FriendsModal.tsx`
- Modify: `client/src/components/RankingModal.tsx`
- Modify: `client/src/components/SpectatorCountBadge.tsx`
- Modify: `client/src/components/TeamRosterPanel.tsx`
- Modify: `client/src/components/RoleSelect.tsx`

**Interfaces:**
- Consumes: Task 4의 `nicknameStyle(color, effect, glow)`(새 두 번째 인자), Task 5의 모든 타입(`Profile.nicknameEffect` 등).
- Produces: 없음(최종 소비 지점 — UI 렌더링).

- [ ] **Step 1: `App.tsx`**

`OnlineFlow`의 `<RoomList>` 호출부, 기존:
```tsx
        nicknameRainbow={me.nicknameRainbow}
```
교체 후:
```tsx
        nicknameEffect={me.nicknameEffect}
```

- [ ] **Step 2: `RoomList.tsx`**

props 구조 분해와 타입 선언에서 `nicknameRainbow` → `nicknameEffect: NicknameEffect`(상단에 `import type { NicknameEffect } from "../game/nicknameStyle";` 추가 — 이미 `import { nicknameStyle } from "../game/nicknameStyle";`가 있으므로 같은 줄에 `type NicknameEffect`도 추가). 기존:
```ts
  nicknameColor,
  nicknameRainbow,
  nicknameGlow,
```
과
```ts
  nicknameColor: string | null;
  nicknameRainbow: boolean;
  nicknameGlow: boolean;
```
을 각각 `nicknameEffect`/`nicknameEffect: NicknameEffect;`로 교체.

`nicknameStyle()` 호출부, 기존:
```ts
  const nicknameEffect = nicknameStyle(nicknameColor, nicknameRainbow, nicknameGlow);
```
교체 후(변수명 `nicknameEffect`는 prop명과 충돌하므로 `effect`로 변경):
```ts
  const effect = nicknameStyle(nicknameColor, nicknameEffect, nicknameGlow);
```
이 변수를 쓰는 아래쪽 렌더 부분(`${styles.profileNickname} ${nicknameEffect.className}` 등)의 `nicknameEffect.className`/`nicknameEffect.style`도 `effect.className`/`effect.style`로 같이 바꿀 것(변수명 변경에 따른 참조 갱신).

- [ ] **Step 3: `ProfileModal.tsx`**

기존:
```ts
    ? nicknameStyle(profile.nicknameColor, profile.nicknameRainbow, profile.nicknameGlow)
```
교체 후:
```ts
    ? nicknameStyle(profile.nicknameColor, profile.nicknameEffect, profile.nicknameGlow)
```

- [ ] **Step 4: `ChatBox.tsx`**

기존:
```ts
          const effect = nicknameStyle(m.nicknameColor, m.nicknameRainbow, m.nicknameGlow);
```
교체 후:
```ts
          const effect = nicknameStyle(m.nicknameColor, m.nicknameEffect, m.nicknameGlow);
```

- [ ] **Step 5: `FriendsModal.tsx`**

기존:
```ts
              const effect = nicknameStyle(f.nicknameColor, f.nicknameRainbow, f.nicknameGlow);
```
교체 후:
```ts
              const effect = nicknameStyle(f.nicknameColor, f.nicknameEffect, f.nicknameGlow);
```

- [ ] **Step 6: `RankingModal.tsx`**

기존:
```ts
              const effect = nicknameStyle(entry.nicknameColor, entry.nicknameRainbow, entry.nicknameGlow);
```
교체 후:
```ts
              const effect = nicknameStyle(entry.nicknameColor, entry.nicknameEffect, entry.nicknameGlow);
```

- [ ] **Step 7: `SpectatorCountBadge.tsx`**

기존:
```ts
                  const effect = nicknameStyle(s.nicknameColor, s.nicknameRainbow, s.nicknameGlow);
```
교체 후:
```ts
                  const effect = nicknameStyle(s.nicknameColor, s.nicknameEffect, s.nicknameGlow);
```

- [ ] **Step 8: `TeamRosterPanel.tsx`**

내부 `Seat` 컴포넌트의 props, 기존:
```ts
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
```
교체 후(상단에 `import type { NicknameEffect } from "../game/nicknameStyle";` 추가):
```ts
function Seat({
  nickname,
  nicknameColor,
  nicknameEffect,
  nicknameGlow,
  roleIcon,
}: {
  nickname: string | undefined;
  nicknameColor: string | undefined;
  nicknameEffect: NicknameEffect | undefined;
  nicknameGlow: boolean | undefined;
  roleIcon: string;
}) {
  const effect = nicknameStyle(nicknameColor, nicknameEffect, nicknameGlow);
```

`TeamRosterPanel` 본문의 2개 `<Seat>` 호출부, 기존:
```tsx
              nicknameRainbow={players.get(team.pigSessionId)?.nicknameRainbow}
```
과
```tsx
              nicknameRainbow={players.get(team.rabbitSessionId)?.nicknameRainbow}
```
을 각각:
```tsx
              nicknameEffect={players.get(team.pigSessionId)?.nicknameEffect}
```
```tsx
              nicknameEffect={players.get(team.rabbitSessionId)?.nicknameEffect}
```
로 교체.

- [ ] **Step 9: `RoleSelect.tsx`**

헬퍼 함수, 기존:
```ts
  function nicknameRainbowFor(sessionId: string): boolean {
    return sessionId ? (room.state.players.get(sessionId)?.nicknameRainbow ?? false) : false;
  }
```
교체 후:
```ts
  function nicknameEffectFor(sessionId: string): NicknameEffect {
    return sessionId ? (room.state.players.get(sessionId)?.nicknameEffect ?? "none") : "none";
  }
```

파일 상단 import에 `NicknameEffect` 타입 추가(이미 `import { nicknameStyle } from "../game/nicknameStyle";`가 있으므로 같은 줄에 `type NicknameEffect`도 추가).

대기 목록 렌더 부분, 기존:
```ts
                const effect = nicknameStyle(p.nicknameColor, p.nicknameRainbow, p.nicknameGlow);
```
교체 후:
```ts
                const effect = nicknameStyle(p.nicknameColor, p.nicknameEffect, p.nicknameGlow);
```

로스터 렌더 부분, 기존:
```ts
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
```
교체 후:
```ts
          const pigEffect = nicknameStyle(
            nicknameColorFor(team.pigSessionId),
            nicknameEffectFor(team.pigSessionId),
            nicknameGlowFor(team.pigSessionId),
          );
          const rabbitEffect = nicknameStyle(
            nicknameColorFor(team.rabbitSessionId),
            nicknameEffectFor(team.rabbitSessionId),
            nicknameGlowFor(team.rabbitSessionId),
          );
```

- [ ] **Step 10: 클라이언트 타입체크**

Run: `cd client && npm run build`
Expected: `tsc -b && vite build` 에러 없이 통과(Task 4/5/6이 합쳐져 클라이언트 전체가 이제 깨끗함).

- [ ] **Step 11: Commit**

```bash
git add client/src/App.tsx client/src/components/RoomList.tsx client/src/components/ProfileModal.tsx client/src/components/ChatBox.tsx client/src/components/FriendsModal.tsx client/src/components/RankingModal.tsx client/src/components/SpectatorCountBadge.tsx client/src/components/TeamRosterPanel.tsx client/src/components/RoleSelect.tsx
git commit -m "닉네임을 렌더링하는 모든 화면을 nicknameEffect로 교체"
```

---

### Task 7: 관리자 UI (`AdminUsers.tsx`) + 전체 수동 검증

**Files:**
- Modify: `client/src/components/AdminUsers.tsx`

**Interfaces:**
- Consumes: Task 4의 `NicknameEffect`(`../game/nicknameStyle`). 서버 라우트는 Task 2에서 이미 `{effect, glow}` 바디를 받도록 바뀌어 있음.
- Produces: 없음(최종 UI).

- [ ] **Step 1: `UserRow` 타입**

기존:
```ts
  nicknameRainbow: boolean;
  nicknameGlow: boolean;
```
교체 후(상단에 `import type { NicknameEffect } from "../game/nicknameStyle";` 추가):
```ts
  nicknameEffect: NicknameEffect;
  nicknameGlow: boolean;
```

- [ ] **Step 2: `toggleEffect` → `setEffect` + `toggleGlow` 분리**

기존:
```ts
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
```

(이 아래 에러 처리 부분은 그대로 유지 — `if (!res.ok) { ... }` 등.) 이 함수를 지우고 아래 2개로 교체:

```ts
  async function setEffect(user: UserRow, effect: NicknameEffect) {
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${user.id}/nickname-effects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ effect, glow: user.nicknameGlow }),
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

  async function toggleGlow(user: UserRow) {
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${user.id}/nickname-effects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ effect: user.nicknameEffect, glow: !user.nicknameGlow }),
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

(위 두 함수의 에러 처리 부분은 지우기 전의 `toggleEffect`와 100% 동일 — 로직 변경 없이 함수를 2개로 쪼갠 것뿐이다.)

- [ ] **Step 3: 렌더 — 체크박스 2개 → select + 체크박스 1개**

기존:
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
교체 후:
```tsx
                  <td>
                    <select value={user.nicknameEffect} onChange={(e) => setEffect(user, e.target.value as NicknameEffect)}>
                      <option value="none">없음</option>
                      <option value="rainbow">레인보우</option>
                      <option value="shine">샤인</option>
                      <option value="hologram">홀로그램</option>
                    </select>
                    <label className={styles.effectLabel}>
                      <input type="checkbox" checked={user.nicknameGlow} onChange={() => toggleGlow(user)} />
                      글로우
                    </label>
                  </td>
```

- [ ] **Step 4: 클라이언트 타입체크**

Run: `cd client && npm run build`
Expected: 에러 없이 통과.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/AdminUsers.tsx
git commit -m "관리자 UI의 닉네임 효과 선택을 체크박스 2개에서 4택 select로 교체"
```

- [ ] **Step 6: 전체 서버 테스트 재실행 (최종 확인)**

Run: `cd server && npm test`
Expected: 전부 PASS.

- [ ] **Step 7: Playwright로 실제 화면 검증**

`npm run sync-public` → `cd server && npm run dev`(포트 2567). DB에 테스트 유저를 만들고(`google_sub`/`nickname` 지정, `game_money`는 불필요) 세션 쿠키를 서명해 브라우저에 주입하는, 이 프로젝트에서 계속 써온 방식 그대로:

1. `/admin`에 관리자 비밀번호로 로그인(또는 DB에서 직접 `setNicknameEffect(userId, "shine", false)`/`"hologram"`을 호출해 미리 지정) 후 관리자 유저 목록에서 방금 만든 테스트 유저의 효과를 select로 "샤인"으로 바꾸고 저장.
2. 그 유저로 세션 쿠키를 만들어 로비에 접속, 본인 닉네임(로비 하단 프로필바)에 샤인 애니메이션이 보이는지 확인.
3. 같은 유저를 관리자 UI에서 "홀로그램"으로 바꾸고 새로고침 후 다시 확인(레인보우 옵션이 목록에서 사라지지 않고 select로 셋 중 하나만 선택되는지 — 배타성이 UI에서도 보장되는지).
4. 관전자 목록/대기실 "역할 선택 중" 목록 중 한 곳 이상에서도(다른 세션으로 접속해 관전자로 들어가거나, 방을 만들어 대기실 화면 확인) 같은 효과가 반영되는지 확인.
5. Playwright의 `page.emulateMedia({ reducedMotion: "reduce" })`로 샤인/홀로그램 둘 다 `animation-duration`이 40s로 바뀌는지 컴퓨티드 스타일로 확인(레인보우 때 썼던 것과 동일한 검증 방식).
6. 테스트 유저 DB에서 정리, 브라우저 탭 닫기, 개발 서버 종료 후 `netstat`으로 포트 2567이 실제로 비었는지 확인.

## Self-Review Notes

- **Spec coverage**: 스펙의 A(데이터 계층/enum+마이그레이션) → Task 1. B(nicknameStyle/CSS) → Task 4. C(관리자 UI) → Task 7. D(라우트) → Task 2. E(Colyseus) → Task 3. F(기계적 클라이언트/서버 나머지 전파) → Task 2(친구/DM)/Task 5(타입)/Task 6(컴포넌트). 스펙의 모든 섹션이 커버됨.
- **Placeholder scan**: 없음 — 모든 단계에 실제 코드/명령어.
- **Type consistency**: `NicknameEffect`(Task 1 서버, Task 3 MatchState 로컬 정의, Task 4 클라이언트)의 리터럴 유니온이 4곳 모두 `"none" | "rainbow" | "shine" | "hologram"`로 동일. `setNicknameEffect(userId, effect, glow)` 시그니처가 Task 1(정의)과 Task 2(라우트 호출)/Task 7(MatchRoom.test.ts 호출) 전부 일치. `nicknameStyle(color, effect, glow)` 인자 순서가 Task 4(정의)부터 Task 6의 9개 호출부까지 전부 일치.
- **태스크 순서**: Task 2(서버 라우트/친구/DM)는 Task 1(타입/함수) 없이 시작 불가, Task 3(Colyseus)은 Task 1의 `UserProfile.nicknameEffect`에 의존, Task 5(클라 타입)는 Task 4(`nicknameStyle`의 `NicknameEffect` export)에 의존, Task 6은 Task 4+5 둘 다 필요, Task 7은 Task 2(라우트)+Task 4(타입) 필요 — 순서대로 실행하면 의존성이 항상 먼저 충족됨.
