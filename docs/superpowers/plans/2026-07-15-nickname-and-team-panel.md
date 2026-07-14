# 임시 닉네임 + 하단 팀 로스터 패널 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 온라인 접속 시 임시 닉네임을 입력받아 대기실과 플레이 화면에서 서로 구분할 수 있게 하고, 플레이 화면 하단을 "내 턴이면 버튼판, 남의 턴이면 팀 로스터(닉네임+절구)"로 전환한다.

**Architecture:** 닉네임은 계정이 아니라 `sessionStorage`(탭 유지 동안만)에 저장되는 임시 문자열이다. 서버 접속(`joinOrCreate`) 시 join option으로 전달되고, `PlayerState.nickname`에 저장되어 다른 플레이어에게도 동기화된다. 화면 쪽은 기존 `MyTurnScreen`/`SpectatorScreen` 분기를 그대로 활용 — `SpectatorScreen`이 원래 없던 하단 패널(`TeamRosterPanel`)을 새로 갖는다.

**Tech Stack:** Colyseus 0.16, React 19, Vitest

## Global Constraints

- 닉네임은 계정/인증이 아니다 — 서버에 영구 저장하지 않고, 검증도 trim+길이 제한+기본값 정도만 한다 (부적절 단어 필터링 등은 범위 밖).
- 채팅은 이번 범위에서 완전히 제외한다.
- `TeamRosterPanel`의 카드 테두리 색, 닉네임 글자색 등 세부 스타일은 신경 쓰지 않는다 — 기본 돼지/토끼 이미지(`thanksgiving_room_start_player_pig.png`/`_rabbit.png`, 이미 `RoleSelect.tsx`에서 쓰는 것과 동일)만 사용.
- 닉네임 최대 길이 10자, 앞뒤 공백 제거, 빈 값이면 서버에서 기본값("플레이어")으로 대체 — 클라이언트 쪽 10자 제한은 UX용이고 서버 쪽 제한이 실제 방어선.
- `TeamStatusBar` 컴포넌트는 이번 작업으로 완전히 안 쓰이게 되므로 삭제한다 (죽은 코드 남기지 않음).
- 재접속(`client.reconnect()`) 경로는 기존 `PlayerState`를 그대로 복구하므로 닉네임을 다시 보낼 필요 없음 — `connectToMatch()`의 reconnect 분기는 건드리지 않는다.

---

### Task 1: 서버 — PlayerState에 nickname 추가 + onJoin에서 검증/저장

**Files:**
- Create: `server/src/game/nickname.ts`
- Test: `server/src/game/nickname.test.ts`
- Modify: `server/src/rooms/MatchState.ts`
- Modify: `server/src/rooms/MatchRoom.ts:57-67` (`onJoin`)
- Test: `server/src/rooms/MatchRoom.test.ts`

**Interfaces:**
- Produces: `sanitizeNickname(input: unknown): string` — trim, 10자 제한, 빈 값/문자열 아님이면 "플레이어" 기본값.
- Produces: `PlayerState.nickname: string` (Colyseus 동기화 필드, 이후 태스크에서 클라이언트가 읽음).

- [ ] **Step 1: 실패하는 테스트 작성 (`sanitizeNickname`)**

`server/src/game/nickname.test.ts` 새로 작성:

```ts
import { describe, expect, test } from "vitest";
import { sanitizeNickname } from "./nickname";

describe("sanitizeNickname", () => {
  test("trims surrounding whitespace", () => {
    expect(sanitizeNickname("  홍길동  ")).toBe("홍길동");
  });

  test("clamps to 10 characters", () => {
    expect(sanitizeNickname("가나다라마바사아자차카타파하")).toBe("가나다라마바사아자차");
  });

  test("falls back to default when empty or whitespace-only", () => {
    expect(sanitizeNickname("")).toBe("플레이어");
    expect(sanitizeNickname("   ")).toBe("플레이어");
  });

  test("falls back to default when input isn't a string", () => {
    expect(sanitizeNickname(undefined)).toBe("플레이어");
    expect(sanitizeNickname(42)).toBe("플레이어");
    expect(sanitizeNickname(null)).toBe("플레이어");
  });
});
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `cd server && npm test -- nickname.test.ts`
Expected: FAIL — `Cannot find module './nickname'`.

- [ ] **Step 3: `sanitizeNickname` 구현**

`server/src/game/nickname.ts` 새로 작성:

```ts
const MAX_NICKNAME_LENGTH = 10;
const DEFAULT_NICKNAME = "플레이어";

// Nickname is a per-session display label, not an account — no persistence,
// no uniqueness check. This is the only real trust boundary for it (the
// client's own length limit is UX only), so keep it defensive: anything
// that isn't a usable non-empty string collapses to the default.
export function sanitizeNickname(input: unknown): string {
  if (typeof input !== "string") return DEFAULT_NICKNAME;
  const trimmed = input.trim().slice(0, MAX_NICKNAME_LENGTH);
  return trimmed || DEFAULT_NICKNAME;
}
```

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `cd server && npm test -- nickname.test.ts`
Expected: PASS (5/5).

- [ ] **Step 5: `PlayerState`에 `nickname` 필드 추가**

`server/src/rooms/MatchState.ts`의 `PlayerState` 클래스를 아래로 교체:

```ts
export class PlayerState extends Schema {
  @type("string") sessionId: string = "";
  @type("string") nickname: string = "";
  @type("string") role: RoleChoice = "";
  @type("string") teamId: string = "";
}
```

- [ ] **Step 6: `onJoin`에서 닉네임 옵션을 읽어서 저장**

`server/src/rooms/MatchRoom.ts` 상단 import에 추가:

```ts
import { sanitizeNickname } from "../game/nickname";
```

`server/src/rooms/MatchRoom.ts:57-67`의 `onJoin`을 아래로 교체:

```ts
  onJoin(client: Client, options: { nickname?: unknown } = {}) {
    if (this.state.players.has(client.sessionId)) return;

    if (this.state.phase !== "lobby") {
      throw new Error("Match already in progress");
    }

    const player = new PlayerState();
    player.sessionId = client.sessionId;
    player.nickname = sanitizeNickname(options.nickname);
    this.state.players.set(client.sessionId, player);
  }
```

- [ ] **Step 7: 서버 테스트에 닉네임 케이스 추가**

`server/src/rooms/MatchRoom.test.ts`의 `test("game starts once both teams have a pig and a rabbit", ...)` 테스트 바로 다음에 추가:

```ts
  test("onJoin stores a sanitized nickname from join options", async () => {
    const room = await colyseus.createRoom<MatchState>("match");
    const clean = await colyseus.connectTo(room, { nickname: "  둘리  " });
    const dirty = await colyseus.connectTo(room, { nickname: 12345 });

    expect(room.state.players.get(clean.sessionId)?.nickname).toBe("둘리");
    expect(room.state.players.get(dirty.sessionId)?.nickname).toBe("플레이어");
  });
```

- [ ] **Step 8: 전체 서버 테스트 실행해서 통과 확인**

Run: `cd server && npm test`
Expected: 모든 테스트 PASS (기존 테스트 포함, `nickname` 필드 추가가 기존 로직에 영향 없어야 함).

- [ ] **Step 9: 타입체크**

Run: `cd server && npm run build`
Expected: 에러 없음.

- [ ] **Step 10: 커밋**

```bash
git add server/src/game/nickname.ts server/src/game/nickname.test.ts server/src/rooms/MatchState.ts server/src/rooms/MatchRoom.ts server/src/rooms/MatchRoom.test.ts
git commit -m "PlayerState에 닉네임 필드 추가, onJoin에서 검증/저장"
```

---

### Task 2: 클라이언트 — 접속 경로에 닉네임 전달 + sessionStorage 헬퍼

**Files:**
- Create: `client/src/game/nickname.ts`
- Modify: `client/src/game/matchTypes.ts`
- Modify: `client/src/colyseus.ts`
- Modify: `client/src/game/useMatchRoom.ts`

**Interfaces:**
- Consumes: Task 1의 서버 `PlayerState.nickname` (동기화되어 `room.state.players`로 들어옴).
- Produces: `client/src/game/nickname.ts`의 `getSavedNickname(): string`, `saveNickname(nickname: string): void` — 이후 태스크(NicknameEntry)에서 씀.
- Produces: `useMatchRoom(nickname: string)` — 시그니처 변경, 이후 태스크(App.tsx)에서 씀.

- [ ] **Step 1: `matchTypes.ts`에 `nickname` 미러링**

`client/src/game/matchTypes.ts`의 `PlayerState` 인터페이스를 아래로 교체:

```ts
export interface PlayerState {
  sessionId: string;
  nickname: string;
  role: RoleChoice;
  teamId: string;
}
```

- [ ] **Step 2: 닉네임 sessionStorage 헬퍼 작성**

`client/src/game/nickname.ts` 새로 작성 (`client/src/colyseus.ts`의 재접속 토큰과 동일한 방어적 패턴 — storage 접근이 막힌 환경에서도 앱이 죽지 않게):

```ts
const NICKNAME_KEY = "songpyeon:nickname";

export function getSavedNickname(): string {
  try {
    return sessionStorage.getItem(NICKNAME_KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveNickname(nickname: string): void {
  try {
    sessionStorage.setItem(NICKNAME_KEY, nickname);
  } catch {
    // best-effort — next visit this tab just won't have it prefilled.
  }
}
```

- [ ] **Step 3: `colyseus.ts`가 닉네임을 받아 join option으로 전달**

`client/src/colyseus.ts`에서 `connectToMatch`와 `joinMatch`를 아래로 교체 (다른 함수는 그대로):

```ts
async function connectToMatch<T>(nickname: string): Promise<Room<T>> {
  const savedToken = getSavedReconnectionToken();
  if (savedToken) {
    try {
      const room = await client.reconnect<T>(savedToken);
      saveReconnectionToken(room.reconnectionToken);
      return room;
    } catch {
      clearReconnectionToken();
    }
  }

  const room = await client.joinOrCreate<T>("match", { nickname });
  saveReconnectionToken(room.reconnectionToken);
  return room;
}

export function joinMatch<T>(nickname: string): Promise<Room<T>> {
  if (!roomPromise) {
    roomPromise = connectToMatch<T>(nickname) as Promise<Room<unknown>>;
  }
  return roomPromise as Promise<Room<T>>;
}
```

- [ ] **Step 4: `useMatchRoom`이 닉네임을 받아 `joinMatch`에 전달**

`client/src/game/useMatchRoom.ts`를 아래로 교체 (`leaveAndRejoin`/`cancelAndExit`는 그대로, 시그니처와 effect만 변경):

```ts
import { useEffect, useReducer, useState } from "react";
import type { Room } from "colyseus.js";
import { joinMatch, leaveMatch } from "../colyseus";
import type { MatchState } from "./matchTypes";

export type ConnectionStatus = "connecting" | "connected" | "error";

export function useMatchRoom(nickname: string) {
  const [room, setRoom] = useState<Room<MatchState> | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [generation, setGeneration] = useState(0);
  const [, forceRender] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    let disposed = false;
    let hasReceivedState = false;

    joinMatch<MatchState>(nickname)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generation]);

  async function leaveAndRejoin() {
    setStatus("connecting");
    setRoom(null);
    try {
      await leaveMatch();
    } catch (err) {
      console.error("failed to leave match", err);
    }
    setGeneration((g) => g + 1);
  }

  async function cancelAndExit() {
    try {
      await leaveMatch();
    } catch (err) {
      console.error("failed to leave match", err);
    }
  }

  return { room, status, leaveAndRejoin, cancelAndExit };
}
```

`nickname`을 effect의 의존성 배열에 일부러 넣지 않는다 — 기존 `generation`과 같은 이유(re-run 트리거는 `leaveAndRejoin`의 `setGeneration`만): 이 훅을 쓰는 컴포넌트는 고정된 닉네임 하나로 마운트되고, `leaveAndRejoin`으로 재입장할 때도 같은 닉네임을 재사용하면 된다.

- [ ] **Step 5: 타입체크 + 린트**

Run: `cd client && npx tsc -b && npm run lint`
Expected: 에러 없음 (단, `App.tsx`가 아직 `useMatchRoom()`을 인자 없이 호출하고 있어서 타입 에러가 날 것 — Task 3에서 고침. 이 태스크에서는 `client/src/App.tsx` 관련 에러가 나는 게 정상이니, `App.tsx`를 제외한 나머지 파일에 에러가 없는지로 판단할 것).

- [ ] **Step 6: 커밋**

```bash
git add client/src/game/matchTypes.ts client/src/game/nickname.ts client/src/colyseus.ts client/src/game/useMatchRoom.ts
git commit -m "클라이언트 접속 경로에 닉네임 전달 + sessionStorage 헬퍼 추가"
```

(이 시점에는 `client/src/App.tsx`가 아직 `useMatchRoom()`을 옛 시그니처로 호출 중이라 `npx tsc -b`가 전체적으로는 실패한다 — Task 3에서 바로 고치므로, 이 커밋은 Task 3 커밋과 묶어서 봐야 그린 상태가 된다는 점을 다음 태스크 담당자에게 알릴 것.)

---

### Task 3: 클라이언트 — NicknameEntry 화면 + App.tsx 연결

**Files:**
- Create: `client/src/components/NicknameEntry.tsx`
- Create: `client/src/components/NicknameEntry.module.css`
- Modify: `client/src/App.tsx`

**Interfaces:**
- Consumes: Task 2의 `useMatchRoom(nickname)`, `getSavedNickname()`, `saveNickname()`.
- Produces: `NicknameEntry({ onSubmit }: { onSubmit: (nickname: string) => void })`.

- [ ] **Step 1: `NicknameEntry` 컴포넌트 작성**

`client/src/components/NicknameEntry.tsx` 새로 작성:

```tsx
import { useState } from "react";
import { getSavedNickname, saveNickname } from "../game/nickname";
import styles from "./NicknameEntry.module.css";

const MAX_NICKNAME_LENGTH = 10;

export function NicknameEntry({ onSubmit }: { onSubmit: (nickname: string) => void }) {
  const [value, setValue] = useState(() => getSavedNickname());

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = value.trim().slice(0, MAX_NICKNAME_LENGTH);
    if (!trimmed) return;
    saveNickname(trimmed);
    onSubmit(trimmed);
  }

  return (
    <form className={styles.wrap} onSubmit={handleSubmit}>
      <h1 className={styles.title}>송편 만들기</h1>
      <p className={styles.hint}>이번 판에서 쓸 닉네임을 입력하세요</p>
      <input
        className={styles.input}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        maxLength={MAX_NICKNAME_LENGTH}
        placeholder="닉네임"
        autoFocus
      />
      <button className={styles.submit} type="submit" disabled={!value.trim()}>
        확인
      </button>
    </form>
  );
}
```

- [ ] **Step 2: 스타일 작성**

`client/src/components/NicknameEntry.module.css` 새로 작성 (기존 `ModeSelect.module.css`/`RoleSelect.module.css`의 톤과 맞춤 — 흰 글자, 어두운 배경 위):

```css
.wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  color: #fff;
  text-align: center;
  flex: 1;
  justify-content: center;
  padding: 1.5rem;
  box-sizing: border-box;
}

.title {
  margin: 0;
  font-size: 2rem;
  font-weight: 800;
  letter-spacing: 0.02em;
}

.hint {
  opacity: 0.8;
  font-size: 0.95rem;
  margin: 0 0 0.5rem;
}

.input {
  width: 100%;
  max-width: 16rem;
  padding: 0.75rem 1rem;
  border-radius: 0.6rem;
  border: none;
  font-size: 1.1rem;
  text-align: center;
  box-sizing: border-box;
}

.submit {
  padding: 0.6rem 2rem;
  font-size: 1rem;
  border-radius: 0.6rem;
  border: none;
  cursor: pointer;
  color: #fff;
  font-weight: 700;
  background: linear-gradient(135deg, #f2994a, #e5484d);
}

.submit:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
```

- [ ] **Step 3: `App.tsx`에서 `OnlineFlow`를 닉네임 게이트로 감싸기**

`client/src/App.tsx` 전체를 아래로 교체:

```tsx
import { useState } from "react";
import { useMatchRoom } from "./game/useMatchRoom";
import { Game } from "./components/Game";
import { ModeSelect } from "./components/ModeSelect";
import { NicknameEntry } from "./components/NicknameEntry";
import { SoloRoleSelect } from "./components/SoloRoleSelect";
import { SoloPlayScreen } from "./components/SoloPlayScreen";
import type { Role } from "./game/colors";
import "./App.css";

type Mode = "select" | "online" | "offline";

function ConnectedOnlineFlow({ nickname, onExit }: { nickname: string; onExit: () => void }) {
  const { room, status, leaveAndRejoin, cancelAndExit } = useMatchRoom(nickname);

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

function OnlineFlow({ onExit }: { onExit: () => void }) {
  const [nickname, setNickname] = useState<string | null>(null);

  if (!nickname) {
    return <NicknameEntry onSubmit={setNickname} />;
  }

  return <ConnectedOnlineFlow nickname={nickname} onExit={onExit} />;
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

  if (mode === "online") return <OnlineFlow onExit={() => setMode("select")} />;
  if (mode === "offline") return <OfflineFlow onExit={() => setMode("select")} />;

  return <ModeSelect onSelectOnline={() => setMode("online")} onSelectOffline={() => setMode("offline")} />;
}

export default App;
```

**주의**: `NicknameEntry`는 서버에 전혀 접속하지 않은 상태에서 뜬다(`useMatchRoom`은 닉네임이 확정된 뒤 `ConnectedOnlineFlow`가 마운트되어야 호출됨) — "온라인을 실제로 고르기 전까진 서버에 접속 안 함" 기존 원칙이 "닉네임까지 입력하기 전까진"으로 한 단계 늦춰질 뿐, 깨지지 않는다.

- [ ] **Step 4: 타입체크 + 린트**

Run: `cd client && npx tsc -b && npm run lint`
Expected: 에러 없음 (Task 2에서 남겨뒀던 `App.tsx` 관련 에러가 이제 해소되어야 함).

- [ ] **Step 5: 수동 확인**

`npm run dev`로 서버+클라이언트 실행 후 브라우저로: "온라인" 클릭 → 닉네임 입력 화면이 뜨는지, 빈 채로 제출 버튼이 비활성화되는지, 10자 넘게 입력이 안 되는지, 제출 후 대기실로 넘어가는지 확인. 대기실에서 "나가기" 후 다시 "온라인"을 누르면 방금 입력한 닉네임이 입력창에 미리 채워지는지 확인.

- [ ] **Step 6: 커밋**

```bash
git add client/src/components/NicknameEntry.tsx client/src/components/NicknameEntry.module.css client/src/App.tsx
git commit -m "닉네임 입력 화면 추가, 온라인 접속 전에 거치도록 연결"
```

---

### Task 4: 클라이언트 — 대기실(RoleSelect)에 닉네임 표시

**Files:**
- Modify: `client/src/components/RoleSelect.tsx`
- Modify: `client/src/components/RoleSelect.module.css`

**Interfaces:**
- Consumes: `room.state.players`(Task 1에서 동기화되는 `nickname` 필드 포함), `room.state.teams`.

- [ ] **Step 1: `RoleSelect.tsx`에서 팀별 닉네임 표시로 교체**

`client/src/components/RoleSelect.tsx`를 아래로 교체:

```tsx
import type { Room } from "colyseus.js";
import type { MatchState } from "../game/matchTypes";
import type { Role } from "../game/colors";
import styles from "./RoleSelect.module.css";

export function RoleSelect({ room, onExit }: { room: Room<MatchState>; onExit: () => void }) {
  const me = room.state.players.get(room.sessionId);
  const myRole = me?.role;
  const teams = room.state.teams;

  function choose(role: Role) {
    room.send("chooseRole", { role });
  }

  function nicknameFor(sessionId: string): string {
    return sessionId ? (room.state.players.get(sessionId)?.nickname ?? "?") : "대기 중";
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
      <div className={styles.roster}>
        {teams.map((team) => (
          <div key={team.id} className={styles.rosterTeam}>
            <span className={styles.rosterName}>{nicknameFor(team.pigSessionId)}</span>
            <span className={styles.rosterSep}>·</span>
            <span className={styles.rosterName}>{nicknameFor(team.rabbitSessionId)}</span>
          </div>
        ))}
      </div>
      <button className={styles.leaveButton} onClick={onExit}>
        나가기
      </button>
    </div>
  );
}
```

- [ ] **Step 2: 스타일 추가**

`client/src/components/RoleSelect.module.css`의 `.status` 규칙을 아래로 교체 (같은 자리, 이름만 `.roster*`로):

```css
.roster {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  opacity: 0.85;
  font-size: 0.9rem;
  padding-bottom: 2rem;
}

.rosterTeam {
  display: flex;
  justify-content: center;
  gap: 0.5rem;
}

.rosterName {
  min-width: 3.5rem;
}

.rosterSep {
  opacity: 0.5;
}
```

- [ ] **Step 3: 타입체크 + 린트**

Run: `cd client && npx tsc -b && npm run lint`
Expected: 에러 없음.

- [ ] **Step 4: 수동 확인**

4개 탭으로 온라인 접속(서로 다른 닉네임 입력) → 역할을 하나씩 고를 때마다 대기실에 그 닉네임이 뜨는지, 아직 안 고른 자리는 "대기 중"으로 뜨는지 확인.

- [ ] **Step 5: 커밋**

```bash
git add client/src/components/RoleSelect.tsx client/src/components/RoleSelect.module.css
git commit -m "대기실에 팀별 돼지/토끼 자리 닉네임 표시"
```

---

### Task 5: 클라이언트 — TeamRosterPanel 신규 + 하단 패널 전환 (TeamStatusBar 삭제)

**Files:**
- Create: `client/src/components/bottomPanelBackground.module.css`
- Create: `client/src/components/TeamRosterPanel.tsx`
- Create: `client/src/components/TeamRosterPanel.module.css`
- Modify: `client/src/components/ButtonPanel.tsx`
- Modify: `client/src/components/ButtonPanel.module.css`
- Modify: `client/src/components/MyTurnScreen.tsx`
- Modify: `client/src/components/SpectatorScreen.tsx`
- Modify: `client/src/components/Game.tsx`
- Delete: `client/src/components/TeamStatusBar.tsx`
- Delete: `client/src/components/TeamStatusBar.module.css`

**Global constraint reminder**: `client/tsconfig.app.json` has `noUnusedParameters: true` AND `noUnusedLocals: true` — a destructured prop that's accepted but never read (even if its caller still passes it) fails `tsc -b`. Step 5 below removes `activeTeam` from both `MyTurnScreen`'s signature and its call site in `Game.tsx` for exactly this reason — don't "leave it for compatibility."

**Interfaces:**
- Produces: `client/src/components/bottomPanelBackground.module.css`의 `.panelBg` — `ButtonPanel`과 `TeamRosterPanel` 둘 다 이 클래스로 하단 나무틀 배경을 공유.
- Produces: `TeamRosterPanel({ teams, players }: { teams: TeamState[]; players: Map<string, PlayerState> })`.

- [ ] **Step 1: 공유 배경 CSS를 `ButtonPanel.module.css`에서 분리**

`client/src/components/ButtonPanel.module.css`에서 `.panelBg` 규칙(파일 맨 위, 주석 포함)을 통째로 잘라내서 새 파일 `client/src/components/bottomPanelBackground.module.css`로 옮긴다:

```css
/* The original app's game.xml lays a full-width "container" panel across
   the bottom of the screen (ImageView, match_parent, scaleType fitXY),
   capped by a "container_top" strip where it meets the sequence board
   above — not a box hugging just the buttons. This wrapper reproduces that:
   full-bleed background, with content centered on top of it. Shared by
   ButtonPanel (my turn) and TeamRosterPanel (spectating), which swap in the
   same screen position so the background must not visibly change between
   them. */
.panelBg {
  width: 100%;
  margin-top: 1.5rem;
  padding: 1.75rem 1rem 1.5rem;
  box-sizing: border-box;
  background-image:
    url("/game-assets/ui/thanksgiving_room_container_top.webp"),
    url("/game-assets/ui/thanksgiving_room_container.png");
  background-position: top center, top center;
  background-size: 100% auto, 100% 100%;
  background-repeat: no-repeat, no-repeat;
}
```

`client/src/components/ButtonPanel.module.css`에서는 이 블록을 지우고 (다음 규칙인 `.panel`부터 파일이 이어지도록), 파일 맨 위에 남는 건 `.panel` 규칙부터다.

- [ ] **Step 2: `ButtonPanel.tsx`가 공유 배경 클래스를 쓰도록 수정**

`client/src/components/ButtonPanel.tsx` 상단 import에 추가:

```tsx
import panelBg from "./bottomPanelBackground.module.css";
```

`<div className={styles.panelBg}>`로 되어 있는 부분을 `<div className={panelBg.panelBg}>`로 교체 (컴포넌트의 나머지 부분은 그대로).

- [ ] **Step 3: `TeamRosterPanel` 컴포넌트 작성**

`client/src/components/TeamRosterPanel.tsx` 새로 작성:

```tsx
import type { PlayerState, TeamState } from "../game/matchTypes";
import panelBg from "./bottomPanelBackground.module.css";
import styles from "./TeamRosterPanel.module.css";

const MAX_MORTARS = 5;

function Seat({
  nickname,
  roleIcon,
}: {
  nickname: string | undefined;
  roleIcon: string;
}) {
  return (
    <div className={styles.seat}>
      <img className={styles.seatIcon} src={roleIcon} alt="" />
      <span className={styles.seatName}>{nickname ?? "-"}</span>
    </div>
  );
}

export function TeamRosterPanel({
  teams,
  players,
}: {
  teams: TeamState[];
  players: Map<string, PlayerState>;
}) {
  return (
    <div className={panelBg.panelBg}>
      <div className={styles.roster}>
        {teams.map((team) => (
          <div key={team.id} className={styles.column}>
            <Seat
              nickname={players.get(team.pigSessionId)?.nickname}
              roleIcon="/game-assets/ui/thanksgiving_room_start_player_pig.png"
            />
            <Seat
              nickname={players.get(team.rabbitSessionId)?.nickname}
              roleIcon="/game-assets/ui/thanksgiving_room_start_player_rabbit.png"
            />
            {team.eliminated ? (
              <span className={styles.eliminated}>탈락</span>
            ) : (
              <div className={styles.mortars}>
                {Array.from({ length: MAX_MORTARS }, (_, i) => (
                  <img
                    key={i}
                    className={styles.heart}
                    alt=""
                    src={
                      i < team.mortars
                        ? "/game-assets/ui/thanksgiving_room_heart.png"
                        : "/game-assets/ui/thanksgiving_room_heart_off.png"
                    }
                  />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: `TeamRosterPanel` 스타일 작성**

`client/src/components/TeamRosterPanel.module.css` 새로 작성:

```css
.roster {
  display: flex;
  justify-content: center;
  gap: 2rem;
}

.column {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
}

.seat {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.3rem;
}

.seatIcon {
  width: 3.4rem;
  height: 3.4rem;
  border-radius: 999px;
}

.seatName {
  font-size: 0.85rem;
  font-weight: 700;
  color: #fff;
  max-width: 5rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mortars {
  display: flex;
  gap: 0.15rem;
}

.heart {
  width: 0.85rem;
  aspect-ratio: 54 / 70;
}

.eliminated {
  font-size: 0.85rem;
  color: #fff;
  opacity: 0.6;
  text-decoration: line-through;
}
```

- [ ] **Step 5: `MyTurnScreen`에서 `TeamStatusBar` 제거 (+ 이제 안 쓰는 `activeTeam` prop도 제거)**

`client/src/components/MyTurnScreen.tsx`를 아래로 교체:

```tsx
import type { Room } from "colyseus.js";
import type { MatchState, PlayerState } from "../game/matchTypes";
import type { Color } from "../game/colors";
import { SequenceBoard } from "./SequenceBoard";
import { ButtonPanel } from "./ButtonPanel";
import { TurnOutcomeBanner } from "./TurnOutcomeBanner";
import { TimerBar } from "./TimerBar";
import styles from "./PlayingScreen.module.css";

export function MyTurnScreen({ room, me }: { room: Room<MatchState>; me: PlayerState }) {
  const { sequence, cursor, turnOutcome, round, turnEndsAt } = room.state;
  const disabled = turnOutcome !== "pending";

  function press(color: Color) {
    room.send("pressButton", { color });
  }

  return (
    <div className={styles.wrap}>
      <p className={styles.round}>ROUND {round}</p>
      <TimerBar turnEndsAt={turnEndsAt} />
      <p className={styles.myTurn}>내 차례! ({me.role === "pig" ? "돼지" : "토끼"})</p>
      <div className={styles.boardArea}>
        <SequenceBoard sequence={sequence} cursor={cursor} />
        <TurnOutcomeBanner outcome={turnOutcome} />
      </div>
      <ButtonPanel role={me.role as "pig" | "rabbit"} disabled={disabled} onPress={press} />
    </div>
  );
}
```

`activeTeam`은 이 컴포넌트 안에서 더 이상 안 쓰인다 — `client/tsconfig.app.json`의 `noUnusedParameters`/`noUnusedLocals`가 켜져 있어서 시그니처에 남겨두면 그 자체로 빌드가 깨진다. 대신 prop을 완전히 지우고, 호출부인 `Game.tsx`도 이 다음 스텝에서 맞춰 고친다.

- [ ] **Step 5-1: `Game.tsx`에서 `MyTurnScreen` 호출부 업데이트**

`client/src/components/Game.tsx:28-30`의 `<MyTurnScreen room={room} me={me} activeTeam={activeTeam} />`를
`<MyTurnScreen room={room} me={me} />`로 교체 (다른 부분은 그대로 — `activeTeam` 변수 자체는
`isMyTeamActive` 계산과 `SpectatorScreen` 호출에 계속 쓰이므로 `Game.tsx`의 나머지 로직은 안 건드림).

- [ ] **Step 6: `SpectatorScreen`에서 `TeamStatusBar`를 `TeamRosterPanel`로 교체**

`client/src/components/SpectatorScreen.tsx`를 아래로 교체:

```tsx
import type { Room } from "colyseus.js";
import type { MatchState, TeamState } from "../game/matchTypes";
import { SequenceBoard } from "./SequenceBoard";
import { TeamRosterPanel } from "./TeamRosterPanel";
import { TimerBar } from "./TimerBar";
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
  const { sequence, cursor, round, teams, turnEndsAt, players } = room.state;

  return (
    <div className={styles.wrap}>
      <p className={styles.round}>ROUND {round}</p>
      <TimerBar turnEndsAt={turnEndsAt} />
      {eliminated ? (
        <>
          <p className={styles.spectating}>
            {activeTeam.eliminated
              ? "모든 팀이 탈락했습니다."
              : `당신의 팀은 탈락했습니다. ${activeTeam.id} 팀이 계속 플레이 중입니다.`}
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
      <TeamRosterPanel teams={teams} players={players} />
    </div>
  );
}
```

- [ ] **Step 7: `TeamStatusBar` 삭제**

```bash
git rm client/src/components/TeamStatusBar.tsx client/src/components/TeamStatusBar.module.css
```

- [ ] **Step 8: 타입체크 + 린트**

Run: `cd client && npx tsc -b && npm run lint`
Expected: 에러 없음. (`TeamStatusBar`를 참조하는 곳이 하나라도 남아있으면 여기서 잡힌다.)

- [ ] **Step 9: 수동 확인**

4개 탭으로 게임을 시작(서로 다른 닉네임) → 내 턴일 때 하단에 버튼판이 뜨는지, 남의 턴일 때 하단에 두 팀의 돼지/토끼 자리 닉네임 + 절구가 뜨는지, 버튼판↔로스터 전환 시 배경이 안 튀는지 확인. 한 팀을 탈락시켜서 탈락 후 관전 화면에서도 로스터가 정상 표시되는지 확인.

- [ ] **Step 10: 커밋**

```bash
git add client/src/components/bottomPanelBackground.module.css client/src/components/TeamRosterPanel.tsx client/src/components/TeamRosterPanel.module.css client/src/components/ButtonPanel.tsx client/src/components/ButtonPanel.module.css client/src/components/MyTurnScreen.tsx client/src/components/SpectatorScreen.tsx client/src/components/Game.tsx
git commit -m "플레이 화면 하단을 내 턴/남의 턴에 따라 버튼판↔팀 로스터로 전환"
```
