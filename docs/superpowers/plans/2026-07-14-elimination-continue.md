# 탈락/게임 지속 흐름 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 팀이 탈락해도 매치를 강제 종료하지 않고, 생존 팀은 계속 라운드를 이어가며, 탈락한 팀은 관전하거나 "나가기"를 눌러 새 매치 큐로 돌아갈 수 있게 한다.

**Architecture:** 서버는 이미 탈락한 팀을 순환에서 건너뛰는 로직(`nextActiveTeamIndex`)을 갖고 있으므로, 남은 1개 팀만 존재할 때 강제로 `phase = "finished"`로 보내던 코드를 제거하기만 하면 자동으로 "생존 팀이 계속 턴을 받는" 동작이 된다. 클라이언트는 이미 "내 팀이 활성 팀이 아니면 관전 화면"으로 라우팅하므로, 탈락한 팀은 별도 라우팅 변경 없이 관전 화면으로 간다 — 그 화면에 조건부 안내 문구와 "나가기" 버튼만 추가하면 된다. "나가기"는 방을 완전히 떠난 뒤 새 매치에 재참가하는 클라이언트 측 캐시 무효화가 필요하다.

**Tech Stack:** Colyseus (server, ESM) + Colyseus.js (client) + React 19 + Vite, vitest (server tests only, `pool: "forks"`).

## Global Constraints

- server는 `"type": "module"` 필수 (CJS/ESM 이중 로드 방지) — 이번 작업은 기존 파일만 수정하므로 해당 없음, 새 파일 생성 시 주의.
- `server/vitest.config.ts`는 `pool: "forks"`를 유지해야 함 (실제 네트워크 소켓을 쓰는 룸 테스트와 워커 스레드 풀 상성 문제).
- 룸 통합 테스트에서 `room.waitForNextPatch()`로 기다리지 말 것 — `flush()`(짧은 `setTimeout` 기반) 패턴을 그대로 재사용한다 (`server/src/rooms/MatchRoom.test.ts`에 이미 정의됨).
- client: `joinMatch()`의 module-scope 캐싱(`roomPromise`)은 React StrictMode의 effect 이중 실행 대응 장치다 — 이번 작업에서 캐시를 무효화하는 `leaveMatch()`를 추가하지만, 이중 마운트 자체에 대한 방어는 깨면 안 된다.
- client는 자동화 테스트가 없다 (lint만 있음) — 클라이언트 변경은 `npm run dev`로 수동 확인한다.
- 핵심 게임 로직은 순수 함수 + 동명 `*.test.ts` 패턴을 유지한다.

---

## Task 1: 팀 탈락 시 강제 종료 로직 제거 (서버)

**Files:**
- Modify: `server/src/rooms/MatchRoom.ts` (import 목록, `advanceToNextTurn()`, `maybeStartGame()`)
- Modify: `server/src/rooms/MatchState.ts` (`Phase` 타입, `winnerTeamId` 필드)
- Modify: `server/src/game/rotation.ts` (`winningTeam` 삭제)
- Modify: `server/src/game/rotation.test.ts` (`winningTeam` 관련 describe 블록 삭제)
- Test: `server/src/rooms/MatchRoom.test.ts` (새 테스트 추가)

**Interfaces:**
- Consumes: 기존 `nextActiveTeamIndex(teams: TeamStatus[], currentIndex: number): number` (변경 없음, `server/src/game/rotation.ts`)
- Produces: `MatchState.phase`는 이제 `"lobby" | "playing"`만 존재 (`"finished"` 제거). `MatchState`에 `winnerTeamId` 필드 없음.

- [ ] **Step 1: `rotation.test.ts`에서 `winningTeam` 관련 테스트를 지운 상태로 실행해 실패를 확인한다 (아직 함수가 안 지워졌으니 실제로는 그냥 통과함 — 이 스텝은 다음 스텝에서 함수를 지운 뒤 컴파일 에러가 안 나는지 확인하는 사전 준비 단계)**

`server/src/game/rotation.test.ts` 전체를 아래로 교체한다 (`winningTeam` describe 블록 삭제, import에서도 제거):

```typescript
import { describe, expect, test } from "vitest";
import { nextActiveTeamIndex, type TeamStatus } from "./rotation";

describe("nextActiveTeamIndex", () => {
  test("advances to the next team", () => {
    const teams: TeamStatus[] = [{ id: "a", eliminated: false }, { id: "b", eliminated: false }];
    expect(nextActiveTeamIndex(teams, 0)).toBe(1);
  });

  test("wraps back to the first team", () => {
    const teams: TeamStatus[] = [{ id: "a", eliminated: false }, { id: "b", eliminated: false }];
    expect(nextActiveTeamIndex(teams, 1)).toBe(0);
  });

  test("skips an eliminated team", () => {
    const teams: TeamStatus[] = [
      { id: "a", eliminated: false },
      { id: "b", eliminated: true },
      { id: "c", eliminated: false },
    ];
    expect(nextActiveTeamIndex(teams, 0)).toBe(2);
  });

  test("skips an eliminated team while wrapping", () => {
    const teams: TeamStatus[] = [
      { id: "a", eliminated: true },
      { id: "b", eliminated: false },
      { id: "c", eliminated: false },
    ];
    expect(nextActiveTeamIndex(teams, 2)).toBe(1);
  });
});
```

- [ ] **Step 2: `rotation.ts`에서 `winningTeam` 함수를 삭제한다**

`server/src/game/rotation.ts` 전체를 아래로 교체한다:

```typescript
export interface TeamStatus {
  id: string;
  eliminated: boolean;
}

export function nextActiveTeamIndex(teams: TeamStatus[], currentIndex: number): number {
  for (let step = 1; step <= teams.length; step++) {
    const index = (currentIndex + step) % teams.length;
    if (!teams[index].eliminated) return index;
  }
  return currentIndex;
}
```

- [ ] **Step 3: 삭제한 함수를 참조하던 곳이 있는지 확인한다**

Run: `cd server && npx tsc --noEmit`
Expected: `MatchRoom.ts`에서 `winningTeam` import 관련 에러가 남 (다음 스텝에서 고침). 다른 곳에서의 참조는 없어야 한다.

- [ ] **Step 4: `MatchState.ts`에서 `"finished"` phase와 `winnerTeamId` 필드를 제거한다**

`server/src/rooms/MatchState.ts`의 아래 두 줄을:

```typescript
export type Phase = "lobby" | "playing" | "finished";
```

이렇게 바꾸고:

```typescript
export type Phase = "lobby" | "playing";
```

`MatchState` 클래스에서 아래 줄을 삭제한다:

```typescript
  @type("string") winnerTeamId: string = "";
```

- [ ] **Step 5: `MatchRoom.ts`에서 강제 종료 블록을 제거한다**

`server/src/rooms/MatchRoom.ts`의 import 줄:

```typescript
import { nextActiveTeamIndex, winningTeam, type TeamStatus } from "../game/rotation";
```

을 아래로 바꾼다:

```typescript
import { nextActiveTeamIndex, type TeamStatus } from "../game/rotation";
```

`advanceToNextTurn()` 메서드 전체를 아래로 교체한다 (승자 판정 블록 삭제):

```typescript
  private advanceToNextTurn() {
    const teamsSnapshot: TeamStatus[] = this.state.teams.map((t) => ({
      id: t.id,
      eliminated: t.eliminated,
    }));

    this.turnsThisRound++;
    const aliveCount = teamsSnapshot.filter((t) => !t.eliminated).length;
    if (this.turnsThisRound >= aliveCount) {
      this.state.round++;
      this.turnsThisRound = 0;
    }

    this.state.activeTeamIndex = nextActiveTeamIndex(teamsSnapshot, this.state.activeTeamIndex);
    this.startTurn();
  }
```

- [ ] **Step 6: 타입체크로 컴파일 에러가 없는지 확인한다**

Run: `cd server && npx tsc --noEmit`
Expected: 에러 없이 종료.

- [ ] **Step 7: 생존 팀이 탈락 후에도 계속 턴을 받는지 확인하는 테스트를 추가한다**

`server/src/rooms/MatchRoom.test.ts`의 `describe("MatchRoom", ...)` 블록 안, 마지막 테스트("a dropped connection...") 뒤에 아래 테스트를 추가한다. 파일 상단 `actingClientFor` 함수 정의 바로 아래에 헬퍼 함수 하나를 추가한다:

```typescript
  async function completeActiveTurn(room: ServerRoom<MatchState>, clients: ClientRoom<MatchState>[]) {
    while (room.state.cursor < room.state.sequence.length - 1) {
      const { dueColor, actingClient } = actingClientFor(room, clients);
      actingClient.send("pressButton", { color: dueColor });
      await flush();
    }
    const { dueColor, actingClient } = actingClientFor(room, clients);
    actingClient.send("pressButton", { color: dueColor });
    await flush();
  }
```

그리고 테스트를 추가한다:

```typescript
  test("the surviving team keeps receiving turns after the other team is eliminated", async () => {
    const { room, clients } = await fillRolesAndStart({ turnDurationMs: SHORT_TURN_MS });
    const teamAId = room.state.teams[0].id;
    const teamBId = room.state.teams[1].id;

    // drive turns: complete team A's turns correctly, deliberately fail team
    // B's turns (wrong button) until B's 5 mortars are gone.
    while (!room.state.teams.find((t) => t.id === teamBId)!.eliminated) {
      const activeId = room.state.teams[room.state.activeTeamIndex].id;
      if (activeId === teamAId) {
        await completeActiveTurn(room, clients);
      } else {
        const { dueColor, actingClient } = actingClientFor(room, clients);
        const wrongColor = ALL_COLORS.find((c) => c !== dueColor)!;
        actingClient.send("pressButton", { color: wrongColor });
        await flush();
        await wait(SHORT_TURN_MS + 200);
      }
    }

    // team B is eliminated but the match keeps going, unlike before.
    expect(room.state.phase).toBe("playing");
    expect(room.state.teams.find((t) => t.id === teamAId)!.eliminated).toBe(false);
    expect(room.state.teams[room.state.activeTeamIndex].id).toBe(teamAId);

    // the surviving team keeps receiving turns indefinitely.
    const roundBeforeExtraTurn = room.state.round;
    await completeActiveTurn(room, clients);

    expect(room.state.phase).toBe("playing");
    expect(room.state.teams[room.state.activeTeamIndex].id).toBe(teamAId);
    expect(room.state.round).toBeGreaterThan(roundBeforeExtraTurn);
  });
```

- [ ] **Step 8: 테스트를 실행해 통과를 확인한다**

Run: `cd server && npm test`
Expected: 모든 테스트 통과 (기존 테스트 포함, 새 테스트 포함).

- [ ] **Step 9: 커밋**

```bash
cd server
git add src/rooms/MatchRoom.ts src/rooms/MatchState.ts src/game/rotation.ts src/game/rotation.test.ts src/rooms/MatchRoom.test.ts
git commit -m "$(cat <<'EOF'
팀 탈락 시 매치를 강제 종료하지 않고 생존 팀이 계속 진행하도록 변경

nextActiveTeamIndex가 이미 탈락 팀을 건너뛰므로, 마지막 1팀만 남았을 때
phase를 finished로 강제 전환하던 코드만 제거하면 생존 팀이 계속 턴을
받는다. finished phase와 winnerTeamId, winningTeam()은 더 이상 쓰이지
않아 함께 제거.
EOF
)"
```

---

## Task 2: 진행 중인 방에 새 접속 거부 (서버)

**Files:**
- Modify: `server/src/rooms/MatchRoom.ts` (`onJoin()`, `maybeStartGame()`)
- Test: `server/src/rooms/MatchRoom.test.ts` (새 테스트 추가)

**Interfaces:**
- Consumes: Task 1에서 정리된 `MatchRoom` 클래스.
- Produces: `phase !== "lobby"`인 방에 새로 접속하려는 클라이언트는 join이 거부됨(예외 발생). `maybeStartGame()` 실행 후 `this.maxClients`는 그 시점의 접속자 수로 고정됨.

**배경:** 탈락한 팀원이 "나가기"를 누르면 `players` 맵에서 즉시 삭제되어 방의 접속자 수가 `maxClients`(4) 미만으로 떨어진다. 이 상태를 막지 않으면, 전혀 관계없는 새 플레이어가 `joinOrCreate("match")`를 호출했을 때 Colyseus 매치메이킹이 이 진행 중인 방을 "자리 있음"으로 보고 매칭시켜버릴 수 있다. 두 겹으로 막는다: (1) `maxClients`를 낮춰서애초에 매치메이킹 후보에서 제외, (2) `onJoin`에서 phase 체크로 직접 접근(`joinById` 등)도 방어.

- [ ] **Step 1: `onJoin`에 phase 가드를 추가하는 실패 테스트를 먼저 작성한다**

`server/src/rooms/MatchRoom.test.ts`의 Task 1에서 추가한 테스트 뒤에 아래 테스트를 추가한다:

```typescript
  test("a room in progress rejects a new connection attempt", async () => {
    const { room } = await fillRolesAndStart();

    await expect(colyseus.connectTo(room)).rejects.toThrow();
  });
```

- [ ] **Step 2: 테스트를 실행해 실패를 확인한다**

Run: `cd server && npm test -- -t "rejects a new connection"`
Expected: FAIL (지금은 `onJoin`이 아무 접속이나 받아주므로 reject되지 않음).

- [ ] **Step 3: `onJoin`에 phase 가드를 추가한다**

`server/src/rooms/MatchRoom.ts`의 `onJoin` 메서드를:

```typescript
  onJoin(client: Client) {
    if (this.state.players.has(client.sessionId)) return;

    const player = new PlayerState();
    player.sessionId = client.sessionId;
    this.state.players.set(client.sessionId, player);
  }
```

아래로 교체한다:

```typescript
  onJoin(client: Client) {
    if (this.state.players.has(client.sessionId)) return;

    if (this.state.phase !== "lobby") {
      throw new Error("Match already in progress");
    }

    const player = new PlayerState();
    player.sessionId = client.sessionId;
    this.state.players.set(client.sessionId, player);
  }
```

(Colyseus는 `onJoin` 안에서 던진 예외를 잡아 접속을 거부하고, 접속을 시도한 클라이언트 쪽의 join promise를 reject시킨다 — `@colyseus/core`의 `Room._onJoin`이 `onJoin` 호출을 try/catch로 감싸고 재throw하는 방식으로 동작함.)

- [ ] **Step 4: 테스트를 실행해 통과를 확인한다**

Run: `cd server && npm test -- -t "rejects a new connection"`
Expected: PASS

- [ ] **Step 5: `maybeStartGame()`에서 `maxClients`를 낮춘다**

`server/src/rooms/MatchRoom.ts`의 `maybeStartGame()`을:

```typescript
  private maybeStartGame() {
    const ready = this.state.teams.every((t) => t.pigSessionId !== "" && t.rabbitSessionId !== "");
    if (!ready) return;

    this.state.phase = "playing";
    this.state.round = 1;
    this.state.activeTeamIndex = 0;
    this.turnsThisRound = 0;
    this.startTurn();
  }
```

아래로 교체한다:

```typescript
  private maybeStartGame() {
    const ready = this.state.teams.every((t) => t.pigSessionId !== "" && t.rabbitSessionId !== "");
    if (!ready) return;

    this.state.phase = "playing";
    this.maxClients = this.clients.length;
    this.state.round = 1;
    this.state.activeTeamIndex = 0;
    this.turnsThisRound = 0;
    this.startTurn();
  }
```

- [ ] **Step 6: 전체 서버 테스트 스위트를 실행해 회귀가 없는지 확인한다**

Run: `cd server && npm test`
Expected: 모든 테스트 통과.

- [ ] **Step 7: 커밋**

```bash
cd server
git add src/rooms/MatchRoom.ts src/rooms/MatchRoom.test.ts
git commit -m "$(cat <<'EOF'
진행 중인 방에 새 플레이어가 실수로 매칭되지 않도록 방어

탈락한 팀원이 나가면 접속자 수가 maxClients 밑으로 떨어져, 관계없는
새 joinOrCreate 호출이 이 방에 매칭될 수 있었다. maxClients를 게임
시작 시점 접속자 수로 고정하고, onJoin에서도 phase 가드로 이중 방어.
EOF
)"
```

---

## Task 3: 클라이언트 - 방을 나가고 새 매치에 재참가하는 기능 추가

**Files:**
- Modify: `client/src/colyseus.ts` (`leaveMatch()` 추가)
- Modify: `client/src/game/useMatchRoom.ts` (`leaveAndRejoin()` 노출)

**Interfaces:**
- Consumes: 기존 `joinMatch<T>(): Promise<Room<T>>` (`client/src/colyseus.ts`)
- Produces: `leaveMatch(): Promise<void>` (`client/src/colyseus.ts`) — 현재 캐시된 room을 나가고 캐시를 비운다. `useMatchRoom()`이 반환하는 객체에 `leaveAndRejoin: () => Promise<void>` 추가.

- [ ] **Step 1: `colyseus.ts`에 `leaveMatch()`를 추가한다**

`client/src/colyseus.ts` 전체를 아래로 교체한다:

```typescript
import { Client, type Room } from "colyseus.js";

const endpoint = import.meta.env.VITE_SERVER_URL ?? "ws://localhost:2567";

export const client = new Client(endpoint);

// Cached at module scope (not component/ref scope) so React StrictMode's
// dev-only double-invoke of effects (mount -> cleanup -> mount) reuses the
// same in-flight/resolved join instead of opening a second real connection
// that briefly (but really) occupies a seat server-side before it's told
// to leave.
let roomPromise: Promise<Room<unknown>> | null = null;

export function joinMatch<T>(): Promise<Room<T>> {
  if (!roomPromise) {
    roomPromise = client.joinOrCreate<T>("match") as Promise<Room<unknown>>;
  }
  return roomPromise as Promise<Room<T>>;
}

// Leaves the currently cached match (if any) and clears the cache, so the
// next joinMatch() call actually opens a fresh connection instead of
// returning the (now-left) stale room.
export async function leaveMatch(): Promise<void> {
  const current = roomPromise;
  roomPromise = null;
  if (!current) return;
  const room = await current;
  await room.leave();
}
```

- [ ] **Step 2: `useMatchRoom.ts`를 `leaveAndRejoin()`을 노출하도록 리팩터한다**

`client/src/game/useMatchRoom.ts` 전체를 아래로 교체한다:

```typescript
import { useEffect, useReducer, useState } from "react";
import type { Room } from "colyseus.js";
import { joinMatch, leaveMatch } from "../colyseus";
import type { MatchState } from "./matchTypes";

export type ConnectionStatus = "connecting" | "connected" | "error";

export function useMatchRoom() {
  const [room, setRoom] = useState<Room<MatchState> | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [generation, setGeneration] = useState(0);
  const [, forceRender] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    let disposed = false;
    // joinOrCreate() resolving only means the room handshake finished — the
    // initial full state arrives via a separate patch shortly after, so we
    // wait for the first onStateChange before trusting room.state is populated.
    let hasReceivedState = false;

    joinMatch<MatchState>()
      .then((joined) => {
        if (disposed) return;
        joined.onStateChange(() => {
          if (!hasReceivedState) {
            hasReceivedState = true;
            setRoom(joined);
            setStatus("connected");
          } else {
            forceRender();
          }
        });
      })
      .catch((err) => {
        console.error("failed to join room", err);
        setStatus("error");
      });

    return () => {
      disposed = true;
    };
  }, [generation]);

  async function leaveAndRejoin() {
    setStatus("connecting");
    setRoom(null);
    await leaveMatch();
    setGeneration((g) => g + 1);
  }

  return { room, status, leaveAndRejoin };
}
```

- [ ] **Step 3: 클라이언트 타입체크로 컴파일 에러가 없는지 확인한다**

Run: `cd client && npx tsc -b`
Expected: 에러 없이 종료. (이 시점에는 아직 `App.tsx`/`Game.tsx`가 `leaveAndRejoin`을 쓰지 않으므로 미사용 변수 경고는 없음 — 훅이 반환하기만 하고 아직 아무도 안 받아써도 에러 아님.)

- [ ] **Step 4: 커밋**

```bash
cd client
git add src/colyseus.ts src/game/useMatchRoom.ts
git commit -m "$(cat <<'EOF'
클라이언트에 방을 나가고 새 매치에 재참가하는 기능 추가

joinMatch()의 module-scope 캐시는 StrictMode 이중 마운트 방어용으로
계속 두되, leaveMatch()로 명시적으로 무효화할 수 있게 하고
useMatchRoom()에 leaveAndRejoin()을 노출.
EOF
)"
```

---

## Task 4: 클라이언트 타입 동기화 (`finished`/`winnerTeamId` 제거)

**Files:**
- Modify: `client/src/game/matchTypes.ts`

**Interfaces:**
- Consumes: 없음 (타입 정의만).
- Produces: `Phase = "lobby" | "playing"`. `MatchState`에 `winnerTeamId` 없음.

- [ ] **Step 1: `matchTypes.ts`에서 서버 스키마 변경사항을 반영한다**

`client/src/game/matchTypes.ts`의 아래 줄:

```typescript
export type Phase = "lobby" | "playing" | "finished";
```

을 아래로 바꾼다:

```typescript
export type Phase = "lobby" | "playing";
```

`MatchState` 인터페이스에서 아래 줄을 삭제한다:

```typescript
  winnerTeamId: string;
```

- [ ] **Step 2: 커밋**

```bash
cd client
git add src/game/matchTypes.ts
git commit -m "$(cat <<'EOF'
클라이언트 MatchState 타입을 서버 스키마 변경에 맞춰 동기화

finished phase와 winnerTeamId 제거 (server/src/rooms/MatchState.ts와
수기 동기화 — client/CLAUDE.md 참고).
EOF
)"
```

(다음 태스크에서 `WinnerScreen`을 지우기 전까지는 `client/src/components/WinnerScreen.tsx`가 존재하지 않는 `winnerTeamId`를 참조하는 상태라 `tsc -b`가 실패한다 — 정상이다, Task 6에서 해소된다. 이 태스크 자체는 타입 정의 변경만이라 별도 빌드 확인 없이 다음으로 진행.)

---

## Task 5: 관전 화면에 탈락 안내 + 나가기 버튼 추가

**Files:**
- Modify: `client/src/components/SpectatorScreen.tsx`
- Modify: `client/src/components/PlayingScreen.module.css`

**Interfaces:**
- Consumes: `TeamState`, `MatchState` (`client/src/game/matchTypes.ts`, Task 4에서 갱신됨)
- Produces: `SpectatorScreen`이 `eliminated: boolean`, `onLeave: () => void` prop을 받는다 (Task 6에서 `Game.tsx`가 이 prop들을 전달).

- [ ] **Step 1: `SpectatorScreen.tsx`에 조건부 안내와 나가기 버튼을 추가한다**

`client/src/components/SpectatorScreen.tsx` 전체를 아래로 교체한다:

```tsx
import type { Room } from "colyseus.js";
import type { MatchState, TeamState } from "../game/matchTypes";
import { SequenceBoard } from "./SequenceBoard";
import { TeamStatusBar } from "./TeamStatusBar";
import styles from "./PlayingScreen.module.css";

export function SpectatorScreen({
  room,
  activeTeam,
  eliminated,
  onLeave,
}: {
  room: Room<MatchState>;
  activeTeam: TeamState;
  eliminated: boolean;
  onLeave: () => void;
}) {
  const { sequence, cursor, round, teams } = room.state;

  return (
    <div className={styles.wrap}>
      <p className={styles.round}>ROUND {round}</p>
      <TeamStatusBar teams={teams} activeTeamId={activeTeam.id} />
      {eliminated ? (
        <>
          <p className={styles.spectating}>
            당신의 팀은 탈락했습니다. {activeTeam.id} 팀이 계속 플레이 중입니다.
          </p>
          <button className={styles.leaveButton} onClick={onLeave}>
            나가기
          </button>
        </>
      ) : (
        <p className={styles.spectating}>{activeTeam.id} 팀의 차례입니다</p>
      )}
      <div className={styles.boardArea}>
        <SequenceBoard sequence={sequence} cursor={cursor} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: `leaveButton` 스타일을 추가한다**

`client/src/components/PlayingScreen.module.css`의 끝에 아래를 추가한다:

```css
.leaveButton {
  padding: 0.6rem 1.5rem;
  font-size: 0.95rem;
  border-radius: 0.6rem;
  border: none;
  cursor: pointer;
  color: #fff;
  font-weight: 700;
  background: linear-gradient(135deg, #6b7280, #374151);
}
```

- [ ] **Step 3: 커밋**

```bash
cd client
git add src/components/SpectatorScreen.tsx src/components/PlayingScreen.module.css
git commit -m "$(cat <<'EOF'
탈락한 팀에게 안내 문구와 나가기 버튼 표시

내 팀이 탈락한 경우와 단순히 상대 턴을 기다리는 경우를 구분해서
문구를 다르게 보여주고, 탈락한 경우에만 나가기 버튼을 노출한다.
EOF
)"
```

(이 태스크 시점에는 아직 `Game.tsx`가 새 prop을 안 넘겨서 `tsc -b`가 실패한다 — Task 6에서 해소.)

---

## Task 6: `finished` 분기 제거, prop 연결, `WinnerScreen` 삭제

**Files:**
- Modify: `client/src/components/Game.tsx`
- Modify: `client/src/App.tsx`
- Delete: `client/src/components/WinnerScreen.tsx`
- Delete: `client/src/components/WinnerScreen.module.css`

**Interfaces:**
- Consumes: `useMatchRoom()`의 `leaveAndRejoin` (Task 3), `SpectatorScreen`의 `eliminated`/`onLeave` prop (Task 5).
- Produces: 없음 (최상위 조립 지점).

- [ ] **Step 1: `Game.tsx`에서 `finished` 분기를 제거하고 새 prop을 연결한다**

`client/src/components/Game.tsx` 전체를 아래로 교체한다:

```tsx
import type { Room } from "colyseus.js";
import type { MatchState } from "../game/matchTypes";
import { RoleSelect } from "./RoleSelect";
import { MyTurnScreen } from "./MyTurnScreen";
import { SpectatorScreen } from "./SpectatorScreen";

export function Game({ room, onLeave }: { room: Room<MatchState>; onLeave: () => void }) {
  const { phase } = room.state;

  if (phase === "lobby") return <RoleSelect room={room} />;

  const me = room.state.players.get(room.sessionId);
  const activeTeam = room.state.teams[room.state.activeTeamIndex];
  const isMyTeamActive = me?.teamId === activeTeam?.id;

  if (me && activeTeam && isMyTeamActive) {
    return <MyTurnScreen room={room} me={me} activeTeam={activeTeam} />;
  }
  if (activeTeam) {
    const myTeam = room.state.teams.find((t) => t.id === me?.teamId);
    return (
      <SpectatorScreen
        room={room}
        activeTeam={activeTeam}
        eliminated={myTeam?.eliminated ?? false}
        onLeave={onLeave}
      />
    );
  }
  return null;
}
```

- [ ] **Step 2: `App.tsx`에서 `leaveAndRejoin`을 `Game`으로 전달한다**

`client/src/App.tsx` 전체를 아래로 교체한다:

```tsx
import { useMatchRoom } from "./game/useMatchRoom";
import { Game } from "./components/Game";
import "./App.css";

function App() {
  const { room, status, leaveAndRejoin } = useMatchRoom();

  if (status !== "connected" || !room) {
    return (
      <main className="connecting">
        <h1>송편 만들기</h1>
        <p>server connection: {status}</p>
      </main>
    );
  }

  return <Game room={room} onLeave={leaveAndRejoin} />;
}

export default App;
```

- [ ] **Step 3: `WinnerScreen`을 삭제한다**

```bash
cd client
rm src/components/WinnerScreen.tsx src/components/WinnerScreen.module.css
```

- [ ] **Step 4: 타입체크와 빌드로 확인한다**

Run: `cd client && npx tsc -b`
Expected: 에러 없이 종료.

Run: `cd client && npm run lint`
Expected: 에러 없이 종료.

- [ ] **Step 5: 개발 서버로 수동 확인한다**

Run (루트에서): `npm run dev`

브라우저 탭 4개를 열고 (`http://localhost:5173`), 각각 역할을 골라 게임을 시작한다. 한 팀이 절구 5개를 다 잃을 때까지 일부러 틀린 버튼을 눌러본다.

확인 항목:
1. 탈락한 팀 쪽 두 탭에 "당신의 팀은 탈락했습니다. team-N 팀이 계속 플레이 중입니다." 문구와 "나가기" 버튼이 뜨는지
2. 생존 팀 쪽 두 탭은 계속 라운드를 이어가는지 (탈락 이후에도 자기 턴이 계속 돌아오는지, ROUND 숫자가 계속 올라가는지)
3. 탈락한 팀에서 "나가기"를 누르면 잠시 "server connection: connecting" 화면을 거쳐 새 매치의 역할 선택 화면(`돼지`/`토끼` 버튼)으로 돌아가는지
4. "나가기" 이후 새 탭을 하나 더 열어 `joinOrCreate`를 시도했을 때, 아직 진행 중인 이전 방이 아니라 새 방(또는 새 대기열)에 들어가는지 — 서버 로그에 "Match already in progress"로 거부된 시도가 없는지 (있으면 매치메이킹이 옛 방을 후보로 고르지 않는다는 뜻이므로 정상. 이 로그 자체가 안 보여야 정상 케이스)

- [ ] **Step 6: 커밋**

```bash
cd client
git add src/components/Game.tsx src/App.tsx
git rm src/components/WinnerScreen.tsx src/components/WinnerScreen.module.css
git commit -m "$(cat <<'EOF'
finished phase와 WinnerScreen 제거, 나가기 버튼 배선 완료

게임이 더 이상 강제 종료되지 않으므로 WinnerScreen은 도달 불가능한
코드가 되어 삭제. App -> Game -> SpectatorScreen으로 leaveAndRejoin을
연결해 탈락한 팀이 실제로 나갈 수 있게 마무리.
EOF
)"
```

---

## Self-Review Notes

- **Spec coverage:** 요구사항 1(탈락해도 매치 지속) → Task 1. 요구사항 2(탈락 팀 관전/나가기) → Task 3, 5, 6. 요구사항 3(생존 팀엔 나가기 버튼 없음) → Task 5에서 `MyTurnScreen`은 건드리지 않음, `SpectatorScreen`에도 `eliminated`일 때만 버튼 노출. 요구사항 4(승리 화면 제거) → Task 6. 스펙의 "새 접속 방지" 안전장치 → Task 2. 모두 커버됨.
- **Placeholder scan:** 없음 — 모든 스텝에 실제 코드/명령어 포함.
- **Type consistency:** `leaveAndRejoin`(Task 3에서 정의) → `onLeave` prop명으로 `App.tsx`(Task 6)에서 `Game`에 전달, `Game.tsx`가 다시 `onLeave`로 `SpectatorScreen`(Task 5에서 정의한 prop명과 일치)에 전달. `eliminated` prop명도 Task 5/6에서 일치. `leaveMatch()`(Task 3)가 `useMatchRoom.ts`에서 import하는 이름과 일치.
