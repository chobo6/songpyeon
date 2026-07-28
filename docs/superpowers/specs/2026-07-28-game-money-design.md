# 게임머니 시스템 설계

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:writing-plans to turn this spec into an implementation plan.

**Goal:** 온라인 매치에서 한 팀이 자기 차례의 시퀀스를 성공적으로 완료할 때마다, 그 팀의 두 플레이어(돼지+토끼) 각각에게 게임머니를 지급한다. 지급액은 10원에 방의 팀 수(1~4)를 곱한 값이다. 이번 스코프는 적립만 — 사용처(상점/교환)는 없다.

**Architecture:** 기존 `pig_play_count`/`rabbit_play_count`/`max_round`와 완전히 동일한 패턴을 그대로 따른다 — `users` 테이블에 컬럼 하나(`game_money`) 추가, `server/src/auth/googleAuth.ts`에 지급 함수 하나(`addGameMoney`) 추가, `UserProfile` 타입과 두 SELECT문(`getOrCreateUser`, `getUserById`)에 필드 추가. 지급 트리거는 `MatchRoom.ts`의 `handlePressButton`에서 턴이 성공(`turnOutcome = "success"`)으로 확정되는 바로 그 지점 — `creditRound`/`recordRolePlayed`와 같은 방식으로 `activeTeam.pigSessionId`/`rabbitSessionId`를 `this.playerUserIds`로 유저ID를 찾아 즉시 DB에 반영한다. 이미 이 프로젝트에 있는 "그 순간 즉시 동기 DB 쓰기" 패턴을 그대로 재사용하므로 새로운 아키텍처 개념이 없다.

## Global Constraints

- 지급 시점: 한 팀이 **한 차례(턴)**를 성공적으로 완료하는 순간(`MatchRoom.ts`의 `attemptPress` 결과로 `result.complete`가 true가 되어 `turnOutcome = "success"`로 확정되는 지점, 현재 `server/src/rooms/MatchRoom.ts:820-829`).
- 지급액 공식: `10 × 그 방의 팀 수` (팀 수는 `this.state.teams.length` — 방 생성 시 정한 1~4팀 값과 항상 같음). 1팀=10원, 2팀=20원, 3팀=30원, 4팀=40원.
- 지급 대상: 성공한 턴의 팀 소속 두 플레이어(돼지 역할, 토끼 역할) **각각**에게 같은 금액을 지급 — 반씩 나누지 않는다.
- 관전자는 팀 로스터에 없으므로 자동으로 제외된다. 별도 체크 불필요.
- 혼자 연습 모드(`useSoloMatch.ts`)는 서버 API를 전혀 타지 않는 완전 클라이언트 로직이라 게임머니 적립 대상이 아니다 — 이 스코프에서 손댈 코드가 없다.
- 이번 스코프는 적립만 구현한다. 상점/교환/차감 기능은 없다.
- 표시 위치: 로비 화면(`RoomList.tsx`) 하단 프로필바에 기존 두 줄(닉네임 / 판수 / 최고라운드) 다음 네 번째 줄로 추가.
- 새 DB 컬럼은 기존 컬럼들과 같은 이중 정의 패턴을 따른다 — `CREATE TABLE`(신규 DB용)과 `ALTER TABLE ADD COLUMN` 가드(기존 DB 마이그레이션용) 양쪽에 추가.

## `server/src/db/connection.ts` 변경

`CREATE TABLE users` 블록의 `rabbit_play_count` 다음 줄에 추가:

```sql
      rabbit_play_count INTEGER NOT NULL DEFAULT 0,
      game_money INTEGER NOT NULL DEFAULT 0,
```

`ALTER TABLE ADD COLUMN` 가드 블록의 `rabbit_play_count` 체크 다음에 추가:

```ts
  if (!columns.includes("game_money")) {
    db.exec(`ALTER TABLE users ADD COLUMN game_money INTEGER NOT NULL DEFAULT 0`);
  }
```

## `server/src/auth/googleAuth.ts` 변경

`UserProfile` 타입에 필드 추가:

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

`getOrCreateUser`의 반환 SELECT문 변경:

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

`getUserById`의 SELECT문도 동일하게 변경:

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

`recordRolePlayed` 함수 바로 뒤에 새 함수 추가:

```ts
// 팀이 자기 차례(턴)를 성공적으로 완료할 때마다 호출된다(MatchRoom.ts의
// handlePressButton, turnOutcome이 "success"로 확정되는 지점). amount는
// 호출부에서 이미 "10 × 팀 수"로 계산해서 넘겨준다 — 여기서는 그냥 누적만 한다.
export function addGameMoney(userId: number, amount: number): void {
  db.prepare(`UPDATE users SET game_money = game_money + ? WHERE id = ?`).run(amount, userId);
}
```

## `server/src/rooms/MatchRoom.ts` 변경

import 문 변경 (기존, 파일 19번째 줄 부근):

```ts
import { getUserById, recordRolePlayed, recordRoundAchievement } from "../auth/googleAuth";
```

변경:

```ts
import { addGameMoney, getUserById, recordRolePlayed, recordRoundAchievement } from "../auth/googleAuth";
```

`handlePressButton`에서 턴 성공이 확정되는 지점 (기존, 현재 820-829줄):

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

변경:

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

`creditRound` 메서드(현재 860-865줄) 바로 뒤에 새 private 메서드 추가 — 완전히 같은 lookup 패턴:

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

## `server/src/createServer.ts` 변경

세 라우트 모두 응답 JSON에 `gameMoney: user.gameMoney`를 추가한다(기존 `pigPlayCount`/`rabbitPlayCount`를 넣던 자리 바로 다음).

`POST /api/auth/google` (현재 342-348줄):

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

`GET /api/auth/me` (현재 364-374줄):

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

`POST /api/auth/nickname` (현재 399-405줄):

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

## 클라이언트

### `client/src/game/auth.ts` 변경

`Profile` 타입에 필드 추가 (현재 57-63줄):

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

### `client/src/App.tsx` 변경

`<RoomList>` 호출에 prop 추가 (현재 122-126줄):

```tsx
      <RoomList
        nickname={me.nickname}
        maxRound={me.maxRound}
        pigPlayCount={me.pigPlayCount}
        rabbitPlayCount={me.rabbitPlayCount}
        gameMoney={me.gameMoney}
```

### `client/src/components/RoomList.tsx` 변경

컴포넌트 props 타입과 destructuring에 `gameMoney: number` 추가 (기존 `pigPlayCount`/`rabbitPlayCount` 바로 다음 줄):

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

`profileBar` JSX, 기존:

```tsx
      <div className={styles.profileBar}>
        <span className={styles.profileNickname}>{nickname}</span>
        <span className={styles.profileStat}>
          🐷 {pigPlayCount}판 🐰 {rabbitPlayCount}판
        </span>
        <span className={styles.profileStat}>최고 {maxRound}라운드</span>
      </div>
```

변경 (네 번째 줄 추가):

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

### `client/src/components/RoomList.module.css`

`.profileBar`는 이미 `flex-direction: column`이라 줄이 하나 늘어도 레이아웃 변경 불필요 — 다만 4줄이 들어가면서 `20svh` 안에서 줄어들 수 있으니, 구현 후 브라우저로 실제 높이가 잘리지 않는지 확인한다(잘리면 `.profileBar`의 `height`를 살짝 올리거나 `.profileStat` 폰트 크기를 줄인다 — 정확한 값은 실제 화면을 보고 결정).

## 테스트

- **서버**: `server/src/auth/googleAuth.test.ts`에 `describe("addGameMoney", ...)` 블록 추가 — (1) 0원인 유저에게 지급하면 정확히 그 금액만큼 증가, (2) 같은 유저에게 두 번 지급하면 누적(첫 지급 금액 + 두 번째 지급 금액)되는지 두 가지 케이스. 기존 `recordRolePlayed` 테스트 블록과 같은 스타일.
- **클라이언트**: 테스트 프레임워크 없음. 브라우저로 실제 검증 — 온라인 매치를 만들어(팀 수를 2팀 등으로 설정) 실제로 턴을 하나 성공시킨 뒤, 로비로 돌아와 두 플레이어 계정 모두 프로필바에 정확한 금액(10 × 팀 수)만큼 늘어났는지 확인. 팀 수 1일 때(배율 없음)도 별도로 확인.
