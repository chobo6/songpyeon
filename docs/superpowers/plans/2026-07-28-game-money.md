# 게임머니 시스템 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 온라인 매치에서 한 팀이 자기 차례(턴)를 성공적으로 완료할 때마다, 그 팀의 두 플레이어(돼지+토끼) 각각에게 "10원 × 그 방의 팀 수"만큼 게임머니를 지급하고, 로비 화면에 누적액을 보여준다.

**Architecture:** 기존 `pig_play_count`/`rabbit_play_count`/`max_round`와 완전히 같은 패턴 — DB 컬럼 하나, 지급 함수 하나(`addGameMoney`), `MatchRoom.ts`의 턴 성공 확정 지점에서 즉시 동기 DB 쓰기, 로그인 관련 3개 라우트와 로비 화면에 필드 추가.

**Tech Stack:** Node.js/TypeScript, better-sqlite3(동기 DB), Colyseus, React, vitest.

## Global Constraints

- 지급 시점: 팀이 **한 차례(턴)**를 성공적으로 완료하는 순간 (`turnOutcome`이 `"success"`로 확정되는 지점).
- 지급액 공식: `10 × 그 방의 팀 수` (팀 수는 `room.state.teams.length`, 1~4). 1팀=10원, 2팀=20원, 3팀=30원, 4팀=40원.
- 지급 대상: 성공한 턴의 팀 소속 두 플레이어(돼지, 토끼) **각각**에게 같은 금액 — 반씩 나누지 않음.
- 관전자는 팀 로스터에 없어 자동 제외. 혼자 연습 모드는 서버 API를 안 타므로 대상 아님(이 스코프에서 손댈 코드 없음).
- 이번 스코프는 적립만 — 상점/교환/차감 기능 없음.
- 표시 위치: 로비 화면(`RoomList.tsx`) 하단 프로필바에 네 번째 줄로 추가.
- 새 DB 컬럼은 `CREATE TABLE`(신규 DB)과 `ALTER TABLE ADD COLUMN` 가드(기존 DB 마이그레이션) 양쪽에 추가.
- 참고 스펙 문서: `docs/superpowers/specs/2026-07-28-game-money-design.md`

---

### Task 1: DB 컬럼 + 지급 함수 (`addGameMoney`)

**Files:**
- Modify: `server/src/db/connection.ts`
- Modify: `server/src/auth/googleAuth.ts`
- Test: `server/src/auth/googleAuth.test.ts`

**Interfaces:**
- Produces: `UserProfile.gameMoney: number` (기존 타입에 필드 추가), `addGameMoney(userId: number, amount: number): void` — 이후 Task 2가 `MatchRoom.ts`에서 이 함수를 호출한다.

- [ ] **Step 1: `connection.ts`에 `game_money` 컬럼 추가**

`server/src/db/connection.ts`의 `CREATE TABLE IF NOT EXISTS users` 블록에서 기존:

```sql
      pig_play_count INTEGER NOT NULL DEFAULT 0,
      rabbit_play_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours'))
```

변경:

```sql
      pig_play_count INTEGER NOT NULL DEFAULT 0,
      rabbit_play_count INTEGER NOT NULL DEFAULT 0,
      game_money INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours'))
```

같은 파일의 `ALTER TABLE ADD COLUMN` 가드 블록에서 기존:

```ts
  if (!columns.includes("rabbit_play_count")) {
    db.exec(`ALTER TABLE users ADD COLUMN rabbit_play_count INTEGER NOT NULL DEFAULT 0`);
  }
```

바로 다음 줄에 추가:

```ts
  if (!columns.includes("game_money")) {
    db.exec(`ALTER TABLE users ADD COLUMN game_money INTEGER NOT NULL DEFAULT 0`);
  }
```

- [ ] **Step 2: `googleAuth.ts`의 `UserProfile` 타입에 필드 추가**

기존:

```ts
export type UserProfile = {
  id: number;
  nickname: string | null;
  bannedAt: string | null;
  nicknameColor: string | null;
  maxRound: number;
  pigPlayCount: number;
  rabbitPlayCount: number;
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
};
```

- [ ] **Step 3: `getOrCreateUser`와 `getUserById`의 SELECT문에 `game_money` 추가**

`getOrCreateUser`의 반환 SELECT문, 기존:

```ts
  return db
    .prepare(
      `SELECT id, nickname, banned_at AS bannedAt, nickname_color AS nicknameColor,
              max_round AS maxRound, pig_play_count AS pigPlayCount, rabbit_play_count AS rabbitPlayCount
       FROM users WHERE google_sub = ?`,
    )
    .get(googleSub) as UserProfile;
```

변경:

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

`getUserById` 전체, 기존:

```ts
export function getUserById(userId: number): UserProfile | undefined {
  return db
    .prepare(
      `SELECT id, nickname, banned_at AS bannedAt, nickname_color AS nicknameColor,
              max_round AS maxRound, pig_play_count AS pigPlayCount, rabbit_play_count AS rabbitPlayCount
       FROM users WHERE id = ?`,
    )
    .get(userId) as UserProfile | undefined;
}
```

변경:

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

- [ ] **Step 4: `addGameMoney` 함수 추가**

`recordRolePlayed` 함수 바로 뒤에 추가:

```ts
// 팀이 자기 차례(턴)를 성공적으로 완료할 때마다 호출된다(MatchRoom.ts의
// handlePressButton, turnOutcome이 "success"로 확정되는 지점). amount는
// 호출부에서 이미 "10 × 팀 수"로 계산해서 넘겨준다 — 여기서는 그냥 누적만 한다.
export function addGameMoney(userId: number, amount: number): void {
  db.prepare(`UPDATE users SET game_money = game_money + ? WHERE id = ?`).run(amount, userId);
}
```

- [ ] **Step 5: 실패하는 테스트 작성**

`server/src/auth/googleAuth.test.ts`에서 `describe("recordRolePlayed", ...)` 블록 바로 뒤(그리고 `describe("getTopRanking", ...)` 앞)에 추가:

```ts
describe("addGameMoney", () => {
  beforeEach(() => {
    db.exec("DELETE FROM users");
  });

  test("increases game_money by the given amount for a fresh user", () => {
    const user = getOrCreateUser("sub-money-1", {});
    addGameMoney(user.id, 20);

    expect(getUserById(user.id)).toMatchObject({ gameMoney: 20 });
  });

  test("accumulates across multiple calls", () => {
    const user = getOrCreateUser("sub-money-2", {});
    addGameMoney(user.id, 10);
    addGameMoney(user.id, 30);

    expect(getUserById(user.id)).toMatchObject({ gameMoney: 40 });
  });
});
```

파일 상단의 `./googleAuth` import 문, 기존:

```ts
import {
  adminSetNickname,
  getOrCreateUser,
  getTopRanking,
  getUserById,
  listUsers,
  recordRolePlayed,
  recordRoundAchievement,
  setNickname,
  setNicknameColor,
  setUserBanned,
  touchLastLogin,
} from "./googleAuth";
```

변경(`addGameMoney` 추가):

```ts
import {
  addGameMoney,
  adminSetNickname,
  getOrCreateUser,
  getTopRanking,
  getUserById,
  listUsers,
  recordRolePlayed,
  recordRoundAchievement,
  setNickname,
  setNicknameColor,
  setUserBanned,
  touchLastLogin,
} from "./googleAuth";
```

- [ ] **Step 6: 테스트 실행 (실패 확인)**

Run: `cd server && npx vitest run src/auth/googleAuth.test.ts`
Expected: FAIL — `addGameMoney`가 아직 없어서 import/컴파일 에러.

- [ ] **Step 7: 위 Step 1~4의 구현이 이미 되어 있으므로, 테스트 다시 실행**

Run: `cd server && npx vitest run src/auth/googleAuth.test.ts`
Expected: PASS (새 2개 테스트 포함, 기존 테스트도 전부 그대로 PASS)

- [ ] **Step 8: 타입체크**

Run: `cd server && npm run build`
Expected: 에러 없음 (tsc --noEmit)

- [ ] **Step 9: 커밋**

```bash
git add server/src/db/connection.ts server/src/auth/googleAuth.ts server/src/auth/googleAuth.test.ts
git commit -m "게임머니 컬럼과 적립 함수(addGameMoney) 추가"
```

---

### Task 2: `MatchRoom.ts` — 턴 성공 시 게임머니 지급

**Files:**
- Modify: `server/src/rooms/MatchRoom.ts`
- Test: `server/src/rooms/MatchRoom.test.ts`

**Interfaces:**
- Consumes: Task 1의 `addGameMoney(userId: number, amount: number): void` (from `../auth/googleAuth`).
- Produces: 없음(이 기능의 서버 로직은 여기서 완결). Task 3은 이 값을 읽어서 보여주기만 한다.

- [ ] **Step 1: import에 `addGameMoney` 추가**

`server/src/rooms/MatchRoom.ts` 상단, 기존:

```ts
import { getUserById, recordRolePlayed, recordRoundAchievement } from "../auth/googleAuth";
```

변경:

```ts
import { addGameMoney, getUserById, recordRolePlayed, recordRoundAchievement } from "../auth/googleAuth";
```

- [ ] **Step 2: `creditTurnSuccess` 메서드 추가**

`creditRound` 메서드(`server/src/rooms/MatchRoom.ts`에서 `private creditRound(team: TeamState, round: number) { ... }`로 정의된 메서드) 바로 뒤에 추가:

```ts
  // 팀이 자기 차례(턴)를 성공적으로 완료할 때마다 호출 — 팀 소속 두 플레이어
  // (돼지, 토끼) 각각에게 "10원 × 이 방의 팀 수"를 지급한다. creditRound와
  // 동일한 이유로 playerUserIds에 없으면(빈 슬롯) 조용히 건너뛴다.
  private creditTurnSuccess(team: TeamState) {
    const reward = 10 * this.state.teams.length;
    for (const sessionId of [team.pigSessionId, team.rabbitSessionId]) {
      const userId = this.playerUserIds.get(sessionId);
      if (userId) addGameMoney(userId, reward);
    }
  }
```

- [ ] **Step 3: 턴 성공 확정 지점에서 호출**

`handlePressButton` 안, `turnOutcome`을 `"success"`로 설정하는 블록(현재):

```ts
    this.state.cursor = result.nextCursor;
    activeTeam.combo += 1;
    if (result.complete) {
      this.turnDecided = true;
      this.state.turnOutcome = "success";
      // Same deferral as the fail path above: wait for the already-scheduled
      // 4s timer (onTurnTimerExpired) to advance, so the success state stays
      // on screen for the rest of the turn instead of the next turn's fresh
      // state overwriting it on the very next tick.
    }
  }
```

변경(마지막 줄 `this.creditTurnSuccess(activeTeam);` 추가):

```ts
    this.state.cursor = result.nextCursor;
    activeTeam.combo += 1;
    if (result.complete) {
      this.turnDecided = true;
      this.state.turnOutcome = "success";
      // Same deferral as the fail path above: wait for the already-scheduled
      // 4s timer (onTurnTimerExpired) to advance, so the success state stays
      // on screen for the rest of the turn instead of the next turn's fresh
      // state overwriting it on the very next tick.
      this.creditTurnSuccess(activeTeam);
    }
  }
```

- [ ] **Step 4: 실패하는 테스트 작성 (2팀 기본 배율)**

`server/src/rooms/MatchRoom.test.ts`에서 기존 `"eliminated and surviving players each get their max_round recorded"` 테스트 바로 뒤에 새 `test(...)` 블록을 추가한다 (같은 `describe("MatchRoom", ...)` 블록 안, 같은 들여쓰기 레벨):

```ts
  test(
    "a successful turn credits game_money to both team members, scaled by team count",
    { timeout: 30000 },
    async () => {
      const { room, clients } = await fillRolesAndStart({ turnDurationMs: PRESS_HEAVY_TURN_MS });
      // fillRolesAndStart는 항상 2팀(플레이어0/1이 첫 팀, 2/3이 둘째 팀)으로 방을 만든다
      // — teamCount 옵션을 안 줬을 때의 기본값이 2이기 때문(연결된 다른 테스트
      // "onCreate defaults to 2 teams for a missing or out-of-range teamCount" 참고).
      const activeTeam = room.state.teams[room.state.activeTeamIndex];
      const pigNickname = room.state.players.get(activeTeam.pigSessionId)!.nickname;
      const rabbitNickname = room.state.players.get(activeTeam.rabbitSessionId)!.nickname;

      const gameMoneyOf = (nickname: string) =>
        (db.prepare(`SELECT game_money FROM users WHERE nickname = ?`).get(nickname) as { game_money: number })
          .game_money;

      expect(gameMoneyOf(pigNickname)).toBe(0);
      expect(gameMoneyOf(rabbitNickname)).toBe(0);

      await completeActiveTurn(room, clients, PRESS_HEAVY_TURN_MS);

      // 2팀 방이므로 10 × 2 = 20원.
      expect(gameMoneyOf(pigNickname)).toBe(20);
      expect(gameMoneyOf(rabbitNickname)).toBe(20);
    },
  );

  test("a successful turn in a 1-team room pays no multiplier (10 won)", async () => {
    const room = await colyseus.createRoom<MatchState>("match", {
      teamCount: 1,
      turnDurationMs: PRESS_HEAVY_TURN_MS,
      countdownTickMs: COUNTDOWN_TICK_MS,
      bonusItemRng: NEVER_BONUS_RNG,
    });
    const clients: ClientRoom<MatchState>[] = [];
    for (const [i, role] of (["pig", "rabbit"] as const).entries()) {
      const client = await connectAsUser(colyseus, room, `외팀${i}`);
      client.send("chooseRole", { role });
      clients.push(client);
    }
    await flush();
    await waitForCountdown();

    const gameMoneyOf = (nickname: string) =>
      (db.prepare(`SELECT game_money FROM users WHERE nickname = ?`).get(nickname) as { game_money: number })
        .game_money;

    await completeActiveTurn(room, clients, PRESS_HEAVY_TURN_MS);

    expect(gameMoneyOf("외팀0")).toBe(10);
    expect(gameMoneyOf("외팀1")).toBe(10);
  });
```

- [ ] **Step 5: 테스트 실행 (실패 확인)**

Run: `cd server && npx vitest run src/rooms/MatchRoom.test.ts -t "game_money"`
Expected: FAIL — 이 시점엔 아직 Step 1~3 변경 전이라면 `game_money`가 0인 채로 남아 실패. (Step 1~3을 이미 적용했다면 이 스텝은 건너뛰고 바로 Step 6으로 — TDD 순서를 엄격히 지키고 싶다면 Step 1~3을 임시로 되돌린 뒤 이 스텝을 실행해 실패를 확인하고 다시 적용해도 된다.)

- [ ] **Step 6: 테스트 실행 (통과 확인)**

Run: `cd server && npx vitest run src/rooms/MatchRoom.test.ts`
Expected: PASS — 새로 추가한 2개 테스트 포함, 기존 전체 테스트도 그대로 PASS. (이 파일은 실제 타이머를 쓰는 통합 테스트라 전체 실행에 수 분 걸릴 수 있음 — 정상.)

- [ ] **Step 7: 타입체크**

Run: `cd server && npm run build`
Expected: 에러 없음

- [ ] **Step 8: 커밋**

```bash
git add server/src/rooms/MatchRoom.ts server/src/rooms/MatchRoom.test.ts
git commit -m "턴 성공 시 게임머니 지급 로직 추가"
```

---

### Task 3: API 응답 + 로비 화면 표시

**Files:**
- Modify: `server/src/createServer.ts`
- Modify: `client/src/game/auth.ts`
- Modify: `client/src/App.tsx`
- Modify: `client/src/components/RoomList.tsx`

**Interfaces:**
- Consumes: Task 1의 `UserProfile.gameMoney`(서버), Task 2의 실제 적립 로직(브라우저 검증 때 사용).
- Produces: `Profile.gameMoney: number`(클라이언트 타입), `RoomList`의 새 prop `gameMoney: number`.

- [ ] **Step 1: `createServer.ts`의 3개 라우트에 `gameMoney` 추가**

`POST /api/auth/google` 라우트 안, 기존:

```ts
      res.json({
        id: user.id,
        nickname: user.nickname,
        maxRound: user.maxRound,
        pigPlayCount: user.pigPlayCount,
        rabbitPlayCount: user.rabbitPlayCount,
      });
```

변경:

```ts
      res.json({
        id: user.id,
        nickname: user.nickname,
        maxRound: user.maxRound,
        pigPlayCount: user.pigPlayCount,
        rabbitPlayCount: user.rabbitPlayCount,
        gameMoney: user.gameMoney,
      });
```

`GET /api/auth/me` 라우트 안, 기존:

```ts
    res.json(
      user
        ? {
            id: user.id,
            nickname: user.nickname,
            maxRound: user.maxRound,
            pigPlayCount: user.pigPlayCount,
            rabbitPlayCount: user.rabbitPlayCount,
          }
        : null,
    );
```

변경:

```ts
    res.json(
      user
        ? {
            id: user.id,
            nickname: user.nickname,
            maxRound: user.maxRound,
            pigPlayCount: user.pigPlayCount,
            rabbitPlayCount: user.rabbitPlayCount,
            gameMoney: user.gameMoney,
          }
        : null,
    );
```

`POST /api/auth/nickname` 라우트 안, 기존:

```ts
    res.json({
      id: userId,
      nickname: user?.nickname ?? null,
      maxRound: user?.maxRound ?? 0,
      pigPlayCount: user?.pigPlayCount ?? 0,
      rabbitPlayCount: user?.rabbitPlayCount ?? 0,
    });
```

변경:

```ts
    res.json({
      id: userId,
      nickname: user?.nickname ?? null,
      maxRound: user?.maxRound ?? 0,
      pigPlayCount: user?.pigPlayCount ?? 0,
      rabbitPlayCount: user?.rabbitPlayCount ?? 0,
      gameMoney: user?.gameMoney ?? 0,
    });
```

- [ ] **Step 2: 서버 타입체크**

Run: `cd server && npm run build`
Expected: 에러 없음

- [ ] **Step 3: `client/src/game/auth.ts`의 `Profile` 타입에 필드 추가**

기존:

```ts
export type Profile = {
  id: number;
  nickname: string | null;
  maxRound: number;
  pigPlayCount: number;
  rabbitPlayCount: number;
};
```

변경:

```ts
export type Profile = {
  id: number;
  nickname: string | null;
  maxRound: number;
  pigPlayCount: number;
  rabbitPlayCount: number;
  gameMoney: number;
};
```

- [ ] **Step 4: `client/src/App.tsx`의 `<RoomList>` 호출에 prop 추가**

기존:

```tsx
      <RoomList
        nickname={me.nickname}
        maxRound={me.maxRound}
        pigPlayCount={me.pigPlayCount}
        rabbitPlayCount={me.rabbitPlayCount}
        onCreateRoom={(roomTitle, teamCount, allowSpectators, itemsEnabled) =>
```

변경:

```tsx
      <RoomList
        nickname={me.nickname}
        maxRound={me.maxRound}
        pigPlayCount={me.pigPlayCount}
        rabbitPlayCount={me.rabbitPlayCount}
        gameMoney={me.gameMoney}
        onCreateRoom={(roomTitle, teamCount, allowSpectators, itemsEnabled) =>
```

- [ ] **Step 5: `client/src/components/RoomList.tsx`의 props 타입/destructuring에 `gameMoney` 추가**

기존:

```tsx
export function RoomList({
  nickname,
  maxRound,
  pigPlayCount,
  rabbitPlayCount,
  onCreateRoom,
  onJoinRoom,
  onExit,
}: {
  nickname: string;
  maxRound: number;
  pigPlayCount: number;
  rabbitPlayCount: number;
  onCreateRoom: (title: string, teamCount: number, allowSpectators: boolean, itemsEnabled: boolean) => void;
  onJoinRoom: (roomId: string) => void;
  onExit: () => void;
}) {
```

변경:

```tsx
export function RoomList({
  nickname,
  maxRound,
  pigPlayCount,
  rabbitPlayCount,
  gameMoney,
  onCreateRoom,
  onJoinRoom,
  onExit,
}: {
  nickname: string;
  maxRound: number;
  pigPlayCount: number;
  rabbitPlayCount: number;
  gameMoney: number;
  onCreateRoom: (title: string, teamCount: number, allowSpectators: boolean, itemsEnabled: boolean) => void;
  onJoinRoom: (roomId: string) => void;
  onExit: () => void;
}) {
```

- [ ] **Step 6: 프로필바 JSX에 네 번째 줄 추가**

기존:

```tsx
      <div className={styles.profileBar}>
        <span className={styles.profileNickname}>{nickname}</span>
        <span className={styles.profileStat}>
          🐷 {pigPlayCount}판 🐰 {rabbitPlayCount}판
        </span>
        <span className={styles.profileStat}>최고 {maxRound}라운드</span>
      </div>
```

변경:

```tsx
      <div className={styles.profileBar}>
        <span className={styles.profileNickname}>{nickname}</span>
        <span className={styles.profileStat}>
          🐷 {pigPlayCount}판 🐰 {rabbitPlayCount}판
        </span>
        <span className={styles.profileStat}>최고 {maxRound}라운드</span>
        <span className={styles.profileStat}>💰 {gameMoney}원</span>
      </div>
```

- [ ] **Step 7: 클라이언트 빌드 + server/public 동기화**

Run (프로젝트 루트에서): `npm run sync-public`
Expected: 타입 에러 없이 빌드 성공, `server/public` 갱신 완료 메시지.

- [ ] **Step 8: 브라우저로 실제 검증**

1. `cd server && npm run dev` (또는 이미 떠 있으면 재시작)
2. 서버가 이미 로컬에 있는 테스트 계정 2개(또는 새로 만든 계정 2개)로 온라인 방을 만든다 — 팀 수 2로 설정.
3. 두 계정 다 로그인해서 방에 들어가 역할을 채우고 매치를 시작, 턴을 하나 성공시킨다.
4. 로비로 돌아와 두 계정 모두 프로필바 네 번째 줄에 "💰 20원"이 보이는지 확인.
5. 팀 수 1로 새 방을 만들어 같은 과정을 반복 — "💰 10원"이 보이는지 확인(배율 없음).
6. 확인이 끝나면 테스트용으로 만든 계정은 DB에서 정리한다.

Expected: 두 시나리오 모두 화면에 정확한 금액이 표시됨.

- [ ] **Step 9: 커밋**

```bash
git add server/src/createServer.ts client/src/game/auth.ts client/src/App.tsx client/src/components/RoomList.tsx
git commit -m "게임머니 API 응답 및 로비 화면 표시 추가"
```
