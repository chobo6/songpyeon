# 재접속 정합성 + 뒤로가기 버튼 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 온라인 모드에서 새로고침해도 같은 세션으로 복구되게 하고, 로비에서 연결이 끊긴 자리는 즉시 비우며, 매치메이킹 대기/로비 화면에 모드 선택으로 돌아가는 버튼을 추가한다.

**Architecture:** 클라이언트는 `room.reconnectionToken`을 `sessionStorage`에 저장해두고 재접속을 먼저 시도한 뒤 실패하면 기존 매치메이킹으로 폴백한다. 서버는 `onLeave`를 게임 단계로 분기해서, 플레이 중(`playing`)에는 기존 60초 재접속 유예를 유지하고 로비(`lobby`)에서는 유예 없이 즉시 플레이어와 팀 슬롯을 정리한다. 새 "나가기" 버튼은 기존 `leaveMatch()`를 재사용해 정상 종료(consented) 흐름을 타므로 서버 쪽 추가 분기가 필요 없다.

**Tech Stack:** Colyseus 0.16 (`colyseus`/`colyseus.js`), React 19, Vitest, `@colyseus/testing`

## Global Constraints

- 서버 권위형 원칙 유지 — 클라이언트에서 게임 판정 로직을 복제하지 않는다 (이번 작업은 세션/연결 관리만 다룸, 게임 판정과 무관).
- 탈락 후 관전 화면(`SpectatorScreen`)의 기존 "나가기"(→ `leaveAndRejoin`, 즉시 재입장) 로직은 변경하지 않는다. 이번에 추가하는 새 "나가기" 버튼(→ 모드 선택 화면)과는 별개 기능이다.
- 실제 플레이 중(`MyTurnScreen`, 그리고 `SpectatorScreen`의 `eliminated === false` 분기 — 즉 내 팀이 아직 살아있는 동안)에는 나가기/뒤로가기 버튼을 노출하지 않는다.
- 로비 중 새로고침이 "정확히 같은 방으로 복귀"함을 보장하지 않는다 — 사용자가 확인하고 받아들인 트레이드오프. 유예 없이 즉시 정리하는 것이 맞는 동작이다.
- `client/src/colyseus.ts`의 `roomPromise` 모듈 스코프 캐싱(React StrictMode 이중 호출 대응)은 그대로 유지한다 — 이 패턴을 깨지 말 것.

---

### Task 1: 서버 — 로비 즉시 정리 + 플레이 중 재접속 유지

**Files:**
- Modify: `server/src/rooms/MatchRoom.ts:58-69` (`onLeave`)
- Test: `server/src/rooms/MatchRoom.test.ts`

**Interfaces:**
- Consumes: 기존 `this.state.players` (`MapSchema<PlayerState>`), `this.state.teams` (`ArraySchema<TeamState>`, 각 `id`/`pigSessionId`/`rabbitSessionId`/필드는 `server/src/rooms/MatchState.ts` 참고), `this.state.phase` (`"lobby" | "playing"`), `this.allowReconnection(client, seconds)` (Colyseus `Room` 내장 메서드).
- Produces: `private removePlayer(sessionId: string): void` — 이후 태스크에서는 쓰이지 않지만, 이 태스크 안에서 `onLeave`의 모든 삭제 경로가 이 메서드 하나로 통일된다.

현재 코드([MatchRoom.ts:58-69](../../../server/src/rooms/MatchRoom.ts)):

```ts
  async onLeave(client: Client, consented: boolean) {
    if (consented) {
      this.state.players.delete(client.sessionId);
      return;
    }

    try {
      await this.allowReconnection(client, RECONNECTION_GRACE_SECONDS);
    } catch {
      this.state.players.delete(client.sessionId);
    }
  }
```

- [ ] **Step 1: 실패하는 테스트 작성**

`server/src/rooms/MatchRoom.test.ts`의 `test("a dropped connection keeps the match running, and reconnecting restores the player's seat", ...)` 테스트 바로 다음(138번째 줄 근처, 해당 테스트가 끝나는 `});` 뒤)에 아래 두 테스트를 추가한다:

```ts
  test("a dropped connection during the lobby is removed immediately, freeing the role slot", async () => {
    const room = await colyseus.createRoom<MatchState>("match");
    const client = await colyseus.connectTo(room);
    client.send("chooseRole", { role: "pig" });
    await flush();

    const sessionId = client.sessionId;
    expect(room.state.players.has(sessionId)).toBe(true);
    expect(room.state.teams[0].pigSessionId).toBe(sessionId);

    await client.leave(false); // simulated drop, not a deliberate leave
    await flush();

    expect(room.state.phase).toBe("lobby");
    expect(room.state.players.has(sessionId)).toBe(false);
    expect(room.state.teams[0].pigSessionId).toBe("");
  });

  test("leaving the lobby deliberately after choosing a role frees that role slot immediately", async () => {
    const room = await colyseus.createRoom<MatchState>("match");
    const client = await colyseus.connectTo(room);
    client.send("chooseRole", { role: "rabbit" });
    await flush();

    expect(room.state.teams[0].rabbitSessionId).toBe(client.sessionId);

    await client.leave(); // deliberate leave (the new back button), not a drop
    await flush();

    expect(room.state.players.has(client.sessionId)).toBe(false);
    expect(room.state.teams[0].rabbitSessionId).toBe("");
  });
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `cd server && npm test -- MatchRoom.test.ts`
Expected: 위 두 개의 새 테스트가 FAIL (기존 `onLeave`는 로비에서도 60초 유예를 걸기 때문에, `flush()` 직후엔 아직 `state.players.has(sessionId)`가 `true`로 남아있어 `toBe(false)` 단언이 실패함).

- [ ] **Step 3: `onLeave` 구현 수정**

`server/src/rooms/MatchRoom.ts:58-69`을 아래로 교체:

```ts
  async onLeave(client: Client, consented: boolean) {
    if (this.state.phase === "playing" && !consented) {
      try {
        await this.allowReconnection(client, RECONNECTION_GRACE_SECONDS);
        return;
      } catch {
        // grace period expired without a reconnect — fall through to removal.
      }
    }

    this.removePlayer(client.sessionId);
  }

  private removePlayer(sessionId: string) {
    const player = this.state.players.get(sessionId);
    if (!player) return;

    if (player.role !== "") {
      const team = this.state.teams.find((t) => t.id === player.teamId);
      if (team?.pigSessionId === sessionId) team.pigSessionId = "";
      if (team?.rabbitSessionId === sessionId) team.rabbitSessionId = "";
    }

    this.state.players.delete(sessionId);
  }
```

- [ ] **Step 4: 전체 테스트 실행해서 통과 확인**

Run: `cd server && npm test`
Expected: 모든 테스트 PASS — 새로 추가한 2개 포함, 기존 "a dropped connection keeps the match running..." 테스트(플레이 중 재접속)도 그대로 통과해야 함(이 테스트는 `fillRolesAndStart()`로 `phase: "playing"` 상태에서 검증하므로 로비 분기와 무관).

- [ ] **Step 5: 타입체크**

Run: `cd server && npm run build`
Expected: 에러 없음.

- [ ] **Step 6: 커밋**

```bash
git add server/src/rooms/MatchRoom.ts server/src/rooms/MatchRoom.test.ts
git commit -m "로비에서 연결 끊긴 플레이어는 재접속 유예 없이 즉시 정리"
```

---

### Task 2: 클라이언트 — 재접속 토큰 저장 + `cancelAndExit`

**Files:**
- Modify: `client/src/colyseus.ts`
- Modify: `client/src/game/useMatchRoom.ts`

**Interfaces:**
- Consumes: `colyseus.js`의 `Client#reconnect<T>(token: string): Promise<Room<T>>`, `Room#reconnectionToken: string` (둘 다 `node_modules/colyseus.js/lib/Client.d.ts`, `lib/Room.d.ts`에서 확인됨). 브라우저 전역 `sessionStorage`.
- Produces: `useMatchRoom()`이 반환하는 객체에 `cancelAndExit(): Promise<void>` 추가 (기존 `leaveAndRejoin`은 그대로 유지 — Task 3에서 둘 다 쓰임).

현재 코드(`client/src/colyseus.ts`, 전체):

```ts
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

- [ ] **Step 1: `colyseus.ts`에 재접속 토큰 저장/사용 로직 추가**

전체를 아래로 교체:

```ts
import { Client, type Room } from "colyseus.js";

const endpoint = import.meta.env.VITE_SERVER_URL ?? "ws://localhost:2567";
const RECONNECTION_TOKEN_KEY = "songpyeon:reconnectionToken";

export const client = new Client(endpoint);

// Cached at module scope (not component/ref scope) so React StrictMode's
// dev-only double-invoke of effects (mount -> cleanup -> mount) reuses the
// same in-flight/resolved join instead of opening a second real connection
// that briefly (but really) occupies a seat server-side before it's told
// to leave.
let roomPromise: Promise<Room<unknown>> | null = null;

function saveReconnectionToken(token: string) {
  sessionStorage.setItem(RECONNECTION_TOKEN_KEY, token);
}

function clearReconnectionToken() {
  sessionStorage.removeItem(RECONNECTION_TOKEN_KEY);
}

// Tries to resume the previous session (survives a page refresh mid-match)
// before falling back to normal matchmaking. A saved token can fail to
// redeem (grace period expired, room gone) — that's expected whenever the
// player was in the lobby (see server/src/rooms/MatchRoom.ts's onLeave,
// which gives no reconnection grace during "lobby"), so the fallback path
// is the common case there, not an error.
async function connectToMatch<T>(): Promise<Room<T>> {
  const savedToken = sessionStorage.getItem(RECONNECTION_TOKEN_KEY);
  if (savedToken) {
    try {
      const room = await client.reconnect<T>(savedToken);
      saveReconnectionToken(room.reconnectionToken);
      return room;
    } catch {
      clearReconnectionToken();
    }
  }

  const room = await client.joinOrCreate<T>("match");
  saveReconnectionToken(room.reconnectionToken);
  return room;
}

export function joinMatch<T>(): Promise<Room<T>> {
  if (!roomPromise) {
    roomPromise = connectToMatch<T>() as Promise<Room<unknown>>;
  }
  return roomPromise as Promise<Room<T>>;
}

// Leaves the currently cached match (if any), clears the cache and the
// saved reconnection token, so the next joinMatch() call actually opens a
// fresh connection instead of returning the (now-left) stale room or
// trying to reconnect into a match we just deliberately left.
export async function leaveMatch(): Promise<void> {
  const current = roomPromise;
  roomPromise = null;
  clearReconnectionToken();
  if (!current) return;
  const room = await current;
  await room.leave();
}
```

- [ ] **Step 2: `useMatchRoom.ts`에 `cancelAndExit` 추가**

`client/src/game/useMatchRoom.ts`의 `leaveAndRejoin` 함수(44-53번째 줄) 바로 뒤, `return` 문 앞에 추가:

```ts
  // Leaves without rejoining — used by the new back/exit buttons (connecting
  // screen, lobby) to return to mode select. Unlike leaveAndRejoin, this does
  // NOT bump `generation`, so no new join is triggered; the caller unmounts
  // this hook right after by switching App's mode away from "online".
  async function cancelAndExit() {
    try {
      await leaveMatch();
    } catch (err) {
      console.error("failed to leave match", err);
    }
  }
```

그리고 `return { room, status, leaveAndRejoin };`을 `return { room, status, leaveAndRejoin, cancelAndExit };`로 변경.

- [ ] **Step 3: 타입체크 + 린트**

Run: `cd client && npx tsc -b && npm run lint`
Expected: 에러 없음.

- [ ] **Step 4: 수동 확인 (재접속)**

1. `npm run dev`로 서버+클라이언트 실행.
2. 브라우저 탭 4개로 접속해서 역할 4개 다 고르고 게임을 `playing` 상태로 만든다.
3. 그 중 한 탭에서 새로고침(F5).
4. 확인: 새로고침한 탭이 **같은 매치**로 돌아오고(다른 3명과 같은 라운드/시퀀스 상태 공유), 역할/팀도 새로고침 전과 동일해야 한다. 브라우저 개발자 도구 Application 탭에서 `sessionStorage`에 `songpyeon:reconnectionToken` 키가 있는지도 확인.

- [ ] **Step 5: 커밋**

```bash
git add client/src/colyseus.ts client/src/game/useMatchRoom.ts
git commit -m "새로고침 시 같은 매치로 재접속하도록 reconnectionToken 저장"
```

---

### Task 3: 클라이언트 — 뒤로가기 버튼 (연결 중 화면 + 로비)

**Files:**
- Modify: `client/src/App.tsx`
- Modify: `client/src/components/Game.tsx`
- Modify: `client/src/components/RoleSelect.tsx`
- Modify: `client/src/components/RoleSelect.module.css`
- Modify: `client/src/App.css`

**Interfaces:**
- Consumes: Task 2에서 추가한 `useMatchRoom()`의 `cancelAndExit(): Promise<void>`.
- Produces: 없음 (최종 UI 계층).

- [ ] **Step 1: `App.tsx` — `OnlineFlow`에 `onExit` 연결**

현재 코드(`client/src/App.tsx`, 전체):

```tsx
import { useState } from "react";
import { useMatchRoom } from "./game/useMatchRoom";
import { Game } from "./components/Game";
import { ModeSelect } from "./components/ModeSelect";
import { SoloRoleSelect } from "./components/SoloRoleSelect";
import { SoloPlayScreen } from "./components/SoloPlayScreen";
import type { Role } from "./game/colors";
import "./App.css";

type Mode = "select" | "online" | "offline";

function OnlineFlow() {
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

function OfflineFlow({ onExit }: { onExit: () => void }) {
  const [role, setRole] = useState<Role | null>(null);

  if (!role) {
    return <SoloRoleSelect onChoose={setRole} onBack={onExit} />;
  }

  return <SoloPlayScreen role={role} onExit={onExit} />;
}

function App() {
  const [mode, setMode] = useState<Mode>("select");

  if (mode === "online") return <OnlineFlow />;
  if (mode === "offline") return <OfflineFlow onExit={() => setMode("select")} />;

  return <ModeSelect onSelectOnline={() => setMode("online")} onSelectOffline={() => setMode("offline")} />;
}

export default App;
```

`OnlineFlow`와 `App`을 아래로 교체 (다른 부분은 그대로):

```tsx
function OnlineFlow({ onExit }: { onExit: () => void }) {
  const { room, status, leaveAndRejoin, cancelAndExit } = useMatchRoom();

  async function handleExit() {
    await cancelAndExit();
    onExit();
  }

  if (status !== "connected" || !room) {
    return (
      <main className="connecting">
        <h1>송편 만들기</h1>
        <p>server connection: {status}</p>
        <button onClick={handleExit}>나가기</button>
      </main>
    );
  }

  return <Game room={room} onLeave={leaveAndRejoin} onExit={handleExit} />;
}
```

```tsx
function App() {
  const [mode, setMode] = useState<Mode>("select");

  if (mode === "online") return <OnlineFlow onExit={() => setMode("select")} />;
  if (mode === "offline") return <OfflineFlow onExit={() => setMode("select")} />;

  return <ModeSelect onSelectOnline={() => setMode("online")} onSelectOffline={() => setMode("offline")} />;
}
```

- [ ] **Step 2: `App.css` — 연결 중 화면의 나가기 버튼 스타일**

`client/src/App.css`의 `.connecting` 규칙 뒤에 추가:

```css
.connecting button {
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

- [ ] **Step 3: `Game.tsx` — `onExit`을 로비(`RoleSelect`)에만 전달**

현재 코드(`client/src/components/Game.tsx`, 전체):

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
  // activeTeam can itself be eliminated once every team has been wiped out
  // (the server freezes turns at that point instead of ending the match) —
  // that team's own players fall through to SpectatorScreen too, since
  // there's no turn left for anyone to take.
  const isMyTeamActive = me?.teamId === activeTeam?.id && !activeTeam?.eliminated;

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

전체를 아래로 교체 (변경점: 함수 시그니처에 `onExit` 추가, `RoleSelect`에 전달하는 줄만 변경 — 나머지는 동일):

```tsx
import type { Room } from "colyseus.js";
import type { MatchState } from "../game/matchTypes";
import { RoleSelect } from "./RoleSelect";
import { MyTurnScreen } from "./MyTurnScreen";
import { SpectatorScreen } from "./SpectatorScreen";

export function Game({
  room,
  onLeave,
  onExit,
}: {
  room: Room<MatchState>;
  onLeave: () => void;
  onExit: () => void;
}) {
  const { phase } = room.state;

  if (phase === "lobby") return <RoleSelect room={room} onExit={onExit} />;

  const me = room.state.players.get(room.sessionId);
  const activeTeam = room.state.teams[room.state.activeTeamIndex];
  // activeTeam can itself be eliminated once every team has been wiped out
  // (the server freezes turns at that point instead of ending the match) —
  // that team's own players fall through to SpectatorScreen too, since
  // there's no turn left for anyone to take.
  const isMyTeamActive = me?.teamId === activeTeam?.id && !activeTeam?.eliminated;

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

**주의: `onExit`은 `MyTurnScreen`과 `SpectatorScreen`에는 전달하지 않는다** (Global Constraints — 플레이 중엔 나가기 버튼 없음, 관전 화면은 기존 `onLeave`만 사용).

- [ ] **Step 4: `RoleSelect.tsx` — `onExit` prop + 나가기 버튼**

현재 코드(`client/src/components/RoleSelect.tsx`, 전체):

```tsx
import type { Room } from "colyseus.js";
import type { MatchState } from "../game/matchTypes";
import type { Role } from "../game/colors";
import styles from "./RoleSelect.module.css";

export function RoleSelect({ room }: { room: Room<MatchState> }) {
  const me = room.state.players.get(room.sessionId);
  const myRole = me?.role;

  const teams = room.state.teams;
  const pigCount = teams.filter((t) => t.pigSessionId !== "").length;
  const rabbitCount = teams.filter((t) => t.rabbitSessionId !== "").length;
  const teamCount = teams.length;

  function choose(role: Role) {
    room.send("chooseRole", { role });
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <h1 className={styles.title}>송편 만들기</h1>
      </div>
      {myRole ? (
        <p className={styles.waiting}>{myRole === "pig" ? "돼지" : "토끼"} 역할로 대기 중...</p>
      ) : (
        <div className={styles.choices}>
          <button className={`${styles.roleButton} ${styles.pigButton}`} onClick={() => choose("pig")}>
            <img
              className={styles.roleIcon}
              src="/game-assets/ui/thanksgiving_room_start_player_pig.png"
              alt=""
            />
            <span>돼지</span>
          </button>
          <button className={`${styles.roleButton} ${styles.rabbitButton}`} onClick={() => choose("rabbit")}>
            <img
              className={styles.roleIcon}
              src="/game-assets/ui/thanksgiving_room_start_player_rabbit.png"
              alt=""
            />
            <span>토끼</span>
          </button>
        </div>
      )}
      <p className={styles.status}>
        돼지 {pigCount}/{teamCount} · 토끼 {rabbitCount}/{teamCount}
      </p>
    </div>
  );
}
```

전체를 아래로 교체:

```tsx
import type { Room } from "colyseus.js";
import type { MatchState } from "../game/matchTypes";
import type { Role } from "../game/colors";
import styles from "./RoleSelect.module.css";

export function RoleSelect({ room, onExit }: { room: Room<MatchState>; onExit: () => void }) {
  const me = room.state.players.get(room.sessionId);
  const myRole = me?.role;

  const teams = room.state.teams;
  const pigCount = teams.filter((t) => t.pigSessionId !== "").length;
  const rabbitCount = teams.filter((t) => t.rabbitSessionId !== "").length;
  const teamCount = teams.length;

  function choose(role: Role) {
    room.send("chooseRole", { role });
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <h1 className={styles.title}>송편 만들기</h1>
      </div>
      {myRole ? (
        <p className={styles.waiting}>{myRole === "pig" ? "돼지" : "토끼"} 역할로 대기 중...</p>
      ) : (
        <div className={styles.choices}>
          <button className={`${styles.roleButton} ${styles.pigButton}`} onClick={() => choose("pig")}>
            <img
              className={styles.roleIcon}
              src="/game-assets/ui/thanksgiving_room_start_player_pig.png"
              alt=""
            />
            <span>돼지</span>
          </button>
          <button className={`${styles.roleButton} ${styles.rabbitButton}`} onClick={() => choose("rabbit")}>
            <img
              className={styles.roleIcon}
              src="/game-assets/ui/thanksgiving_room_start_player_rabbit.png"
              alt=""
            />
            <span>토끼</span>
          </button>
        </div>
      )}
      <p className={styles.status}>
        돼지 {pigCount}/{teamCount} · 토끼 {rabbitCount}/{teamCount}
      </p>
      <button className={styles.leaveButton} onClick={onExit}>
        나가기
      </button>
    </div>
  );
}
```

- [ ] **Step 5: `RoleSelect.module.css` — `.leaveButton` 스타일 추가**

`client/src/components/RoleSelect.module.css` 끝에 추가 (`PlayingScreen.module.css`의 `.leaveButton`과 동일한 스타일):

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

- [ ] **Step 6: 타입체크 + 린트**

Run: `cd client && npx tsc -b && npm run lint`
Expected: 에러 없음.

- [ ] **Step 7: 수동 확인 (Playwright, `docs/superpowers/specs/2026-07-14-reconnection-and-exit-design.md`의 테스트 계획 시나리오)**

`npm run dev`로 서버+클라이언트 띄우고 브라우저로 확인:

1. **연결 중 화면에서 나가기**: 탭 하나만 열어 "온라인" 선택 → "연결 중" 화면(아직 3명 안 옴)에서 "나가기" 클릭 → 모드 선택 화면으로 돌아가는지 확인.
2. **로비에서 나가기**: 다시 "온라인" 선택 → 역할 고르기 전이나 후에 "나가기" 클릭 → 모드 선택 화면으로 돌아가는지, 서버 쪽에서 그 자리가 바로 비는지(다른 탭에서 대기 인원 수 확인) 확인.
3. **플레이 중엔 나가기 버튼 없음**: 탭 4개로 게임을 시작해서 `MyTurnScreen`/상대팀 턴 대기 화면(`SpectatorScreen`, 탈락 전) 모두에서 나가기 버튼이 안 보이는지 확인.
4. **탈락 후 기존 나가기(재입장) 그대로 동작**: 한 팀을 탈락시켜서 관전 화면의 기존 "나가기" 버튼이 여전히 재입장으로 동작하는지 확인 (이번 작업으로 안 건드렸어야 함).

- [ ] **Step 8: 커밋**

```bash
git add client/src/App.tsx client/src/App.css client/src/components/Game.tsx client/src/components/RoleSelect.tsx client/src/components/RoleSelect.module.css
git commit -m "연결 중 화면과 로비에 뒤로가기 버튼 추가"
```
