# 게임 진행 중 재접속(Reconnection) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 게임 진행 중(`playing` phase)에 실수로 새로고침하거나 탭/창을 껐다 켰을 때, 20초 안에 돌아오면 원래 자리(팀/역할)로 자동 재접속해서 이어서 플레이할 수 있게 한다.

**Architecture:** Colyseus 내장 재접속 메커니즘(`Room.allowReconnection` / `Client.reconnect`)을 쓴다. 서버(`MatchRoom.ts`)는 게임 진행 중의 비의도적 연결 끊김(`onLeave`의 `consented === false`)에 한해 20초 유예를 주고, 그 안에 같은 세션이 재접속하면 자리를 그대로 유지한다. 클라이언트(`colyseus.ts`)는 입장/재접속 성공마다 `room.reconnectionToken`을 `localStorage`에 저장해두고, 앱이 켜질 때(`App.tsx`) 저장된 토큰이 있으면 모드 선택 화면을 건너뛰고 자동으로 재접속을 시도한다.

**Tech Stack:** 서버 Colyseus 0.16(`@colyseus/core`, `MatchRoom.ts`), 클라이언트 colyseus.js 0.16 + React(`App.tsx`, `colyseus.ts`, `useMatchRoom.ts`).

## Global Constraints

- 재접속 유예는 **`playing` phase에서 비의도적으로 연결이 끊긴 경우만** 적용한다 (`this.state.phase === "playing" && !consented`). 로비 단계나 명시적 "나가기"는 지금처럼 즉시 자리를 비운다.
- 유예 시간 기본값은 **20초**(`DEFAULT_RECONNECT_GRACE_SECONDS`), `MatchRoomOptions.reconnectGraceSeconds`로 테스트에서 줄여 쓸 수 있어야 한다(기존 `turnDurationMs`/`countdownTickMs`와 동일 패턴).
- 재접속 토큰은 **`localStorage`**에 저장한다(`sessionStorage` 아님).
- 재접속 성공 시 matchChat에 `"OO님이 입장했습니다"`(기존 입장 메시지와 동일 문구)를 띄운다. 연결이 끊긴 시점 자체에는 아무 메시지도 띄우지 않는다.
- 앱을 열었을 때 저장된 토큰이 있으면 모드 선택 화면 없이 자동으로 재접속을 시도한다.
- 참고 스펙: `docs/superpowers/specs/2026-07-20-mid-match-reconnection-design.md`

---

### Task 1: 서버 — MatchRoom 재접속 유예

**Files:**
- Modify: `server/src/rooms/MatchRoom.ts`
- Test: `server/src/rooms/MatchRoom.test.ts`

**Interfaces:**
- Produces: `MatchRoomOptions.reconnectGraceSeconds?: number` — Task 2/3(클라이언트)는 이 옵션 이름 자체를 참조하지 않지만, 클라이언트가 넘기는 join 옵션과 무관하게 서버 기본값(20초)으로 동작해야 한다.

- [ ] **Step 1: 실패하는 테스트 4개 작성**

`server/src/rooms/MatchRoom.test.ts`에서 기존 `test("a mid-match leave announces into matchChat instead of lobbyChat", ...)` 테스트 바로 다음에 아래 4개 테스트를 추가한다 (같은 `describe("MatchRoom", ...)` 블록 안, 파일 상단의 `ColyseusJsClient`/`connectAsUser`/`fillRolesAndStart`/`flush`/`waitUntil`은 이미 임포트/정의되어 있으므로 그대로 재사용):

```ts
  test(
    "a non-consented disconnect during play, reconnected within the grace period, keeps the same seat and announces it in matchChat",
    { timeout: 20000 },
    async () => {
      const { room, clients } = await fillRolesAndStart({ reconnectGraceSeconds: 2 });
      const [firstClient] = clients;
      const sessionId = firstClient.sessionId;
      const reconnectToken = firstClient.reconnectionToken;
      const nickname = room.state.players.get(sessionId)!.nickname;
      const matchChatCountBefore = room.state.matchChat.length;

      // consented=false — a raw connection close, the same thing a refresh
      // or closed tab looks like to the server (see colyseus.js's
      // Room.leave: consented sends a LEAVE_ROOM message, non-consented
      // just closes the socket).
      await firstClient.leave(false);
      await flush();

      // Still occupying its seat while the grace period is pending — no
      // removal has happened yet.
      expect(room.state.players.has(sessionId)).toBe(true);

      const port = (colyseus.server as unknown as { port: number }).port;
      const reconnected = await new ColyseusJsClient(`ws://127.0.0.1:${port}`).reconnect<MatchState>(
        reconnectToken,
      );
      await flush();

      expect(reconnected.sessionId).toBe(sessionId);
      expect(room.state.players.has(sessionId)).toBe(true);
      expect(room.state.matchChat).toHaveLength(matchChatCountBefore + 1);
      expect(room.state.matchChat[room.state.matchChat.length - 1].text).toBe(`${nickname}님이 입장했습니다`);

      await reconnected.leave();
    },
  );

  test(
    "a non-consented disconnect during play that is NOT reconnected within the grace period is removed like today",
    { timeout: 20000 },
    async () => {
      const { room, clients } = await fillRolesAndStart({ reconnectGraceSeconds: 0.05 });
      const [firstClient] = clients;
      const sessionId = firstClient.sessionId;
      const player = room.state.players.get(sessionId)!;
      const nickname = player.nickname;
      const team = room.state.teams.find((t) => t.id === player.teamId)!;

      await firstClient.leave(false);
      await waitUntil(() => !room.state.players.has(sessionId));

      expect(team.pigSessionId).not.toBe(sessionId);
      expect(team.rabbitSessionId).not.toBe(sessionId);
      expect(room.state.matchChat[room.state.matchChat.length - 1].text).toBe(`${nickname}님이 퇴장했습니다`);
    },
  );

  test("a non-consented disconnect during the lobby is removed immediately (no reconnection grace)", async () => {
    const room = await colyseus.createRoom<MatchState>("match", { reconnectGraceSeconds: 5 });
    const client = await connectAsUser(colyseus, room, "로비유저");
    await flush();
    const sessionId = client.sessionId;

    await client.leave(false);
    await flush();

    expect(room.state.players.has(sessionId)).toBe(false);
  });

  test("a deliberate (consented) leave during play is removed immediately, without reconnection grace", async () => {
    const { room, clients } = await fillRolesAndStart({ reconnectGraceSeconds: 5 });
    const [firstClient] = clients;
    const sessionId = firstClient.sessionId;

    await firstClient.leave(); // consented=true (the default)
    await flush();

    expect(room.state.players.has(sessionId)).toBe(false);
  });
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `npm test --workspace server -- MatchRoom.test.ts`
Expected: 새로 추가한 4개 테스트 모두 FAIL — `reconnectGraceSeconds`가 아직 존재하지 않아 `firstClient.leave(false)` 이후 바로 (즉시) 제거되므로 "그대로 남아있어야 한다"는 첫 두 테스트가 특히 확실히 깨짐. (뒤 2개 테스트는 지금 코드로도 우연히 통과할 수 있음 — 그래도 이번 변경 이후에도 계속 통과해야 하는 회귀 테스트이므로 그대로 둔다.)

- [ ] **Step 3: `MatchRoomOptions`와 필드에 `reconnectGraceSeconds` 추가**

`server/src/rooms/MatchRoom.ts`에서:

```ts
const DEFAULT_TURN_DURATION_MS = 4000;
const DEFAULT_COUNTDOWN_TICK_MS = 1000;
const COUNTDOWN_START_SECONDS = 3;
const MAX_CHAT_MESSAGES = 50;

interface MatchRoomOptions {
  turnDurationMs?: number;
  // Per-tick duration of the pre-game 3/2/1 countdown, not the countdown's
  // total length — always exactly COUNTDOWN_START_SECONDS ticks, so tests
  // can shrink this to run the countdown fast without changing what number
  // it starts at. See maybeStartGame's countdown methods.
  countdownTickMs?: number;
  teamCount?: unknown;
  roomTitle?: unknown;
}
```

를 다음으로 교체:

```ts
const DEFAULT_TURN_DURATION_MS = 4000;
const DEFAULT_COUNTDOWN_TICK_MS = 1000;
const COUNTDOWN_START_SECONDS = 3;
const MAX_CHAT_MESSAGES = 50;
const DEFAULT_RECONNECT_GRACE_SECONDS = 20;

interface MatchRoomOptions {
  turnDurationMs?: number;
  // Per-tick duration of the pre-game 3/2/1 countdown, not the countdown's
  // total length — always exactly COUNTDOWN_START_SECONDS ticks, so tests
  // can shrink this to run the countdown fast without changing what number
  // it starts at. See maybeStartGame's countdown methods.
  countdownTickMs?: number;
  teamCount?: unknown;
  roomTitle?: unknown;
  // Seconds to hold a disconnected player's seat open before freeing it for
  // good — only consulted for a non-consented disconnect during "playing"
  // (see onLeave). Overridable so tests can shrink it instead of waiting
  // out the real default.
  reconnectGraceSeconds?: number;
}
```

그리고:

```ts
  private turnDurationMs = DEFAULT_TURN_DURATION_MS;
  private countdownTickMs = DEFAULT_COUNTDOWN_TICK_MS;
  private countdownToken = 0;
```

를:

```ts
  private turnDurationMs = DEFAULT_TURN_DURATION_MS;
  private countdownTickMs = DEFAULT_COUNTDOWN_TICK_MS;
  private reconnectGraceSeconds = DEFAULT_RECONNECT_GRACE_SECONDS;
  private countdownToken = 0;
```

로 교체.

- [ ] **Step 4: `onCreate`에서 옵션 반영**

```ts
  async onCreate(options: MatchRoomOptions = {}) {
    if (options.turnDurationMs) this.turnDurationMs = options.turnDurationMs;
    if (options.countdownTickMs) this.countdownTickMs = options.countdownTickMs;
```

를:

```ts
  async onCreate(options: MatchRoomOptions = {}) {
    if (options.turnDurationMs) this.turnDurationMs = options.turnDurationMs;
    if (options.countdownTickMs) this.countdownTickMs = options.countdownTickMs;
    if (options.reconnectGraceSeconds) this.reconnectGraceSeconds = options.reconnectGraceSeconds;
```

로 교체.

- [ ] **Step 5: `onLeave` 재작성**

```ts
  async onLeave(client: Client) {
    // No reconnection grace: the client never persists a reconnection token
    // and never attempts to resume (see client/src/colyseus.ts) — a refresh,
    // closed tab, or dropped connection always lands back on the room list.
    // Granting a grace period here just left a phantom player occupying a
    // role/team slot (and the room looking occupied to others) for up to
    // RECONNECTION_GRACE_SECONDS with nothing that could ever reconnect
    // through it. Free the slot immediately instead.
    console.log(`[leave] session=${client.sessionId} ip=${client.auth?.ip}`);
    const leavingNickname = this.state.players.get(client.sessionId)?.nickname ?? "?";
    recordEvent({
      type: "leave",
      timestamp: Date.now(),
      nickname: leavingNickname,
      roomId: this.roomId,
      ip: String(client.auth?.ip ?? "unknown"),
      sessionId: client.sessionId,
    });
    this.removePlayer(client.sessionId);
    await this.setMetadata({ players: this.rosterForMetadata() });
  }
```

를:

```ts
  async onLeave(client: Client, consented: boolean) {
    console.log(`[leave] session=${client.sessionId} ip=${client.auth?.ip}`);
    const leavingNickname = this.state.players.get(client.sessionId)?.nickname ?? "?";
    recordEvent({
      type: "leave",
      timestamp: Date.now(),
      nickname: leavingNickname,
      roomId: this.roomId,
      ip: String(client.auth?.ip ?? "unknown"),
      sessionId: client.sessionId,
    });

    // A non-consented drop during an active match (refresh, closed tab,
    // network blip — anything that isn't an explicit "나가기" click) gets a
    // grace period to reconnect into the exact same seat instead of losing
    // it immediately. Lobby disconnects and deliberate leaves skip this
    // entirely and fall straight through to the removal below, same as
    // before this feature existed.
    if (this.state.phase === "playing" && !consented) {
      try {
        await this.allowReconnection(client, this.reconnectGraceSeconds);
        // Reconnected in time. removePlayer was never called, so the seat,
        // team assignment, and role are exactly as they were — just
        // announce the comeback the same way a fresh join would be.
        const player = this.state.players.get(client.sessionId);
        if (player) this.pushChat(this.state.matchChat, "", `${player.nickname}님이 입장했습니다`);
        return;
      } catch {
        // Grace period expired without a reconnect — fall through to the
        // normal removal below, same as any other leave.
      }
    }

    this.removePlayer(client.sessionId);
    await this.setMetadata({ players: this.rosterForMetadata() });
  }
```

- [ ] **Step 6: 테스트 실행해서 통과 확인**

Run: `npm test --workspace server -- MatchRoom.test.ts`
Expected: 전체 PASS (새 4개 포함).

- [ ] **Step 7: 서버 전체 테스트 + 타입체크**

Run: `npm test --workspace server && npm run build --workspace server`
Expected: 전체 PASS, 타입 에러 없음.

- [ ] **Step 8: 커밋**

```bash
git add server/src/rooms/MatchRoom.ts server/src/rooms/MatchRoom.test.ts
git commit -m "$(cat <<'EOF'
게임 진행 중 비의도적 연결 끊김에 20초 재접속 유예 추가

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: 클라이언트 — 재접속 토큰 저장 & JoinSpec "reconnect"

**Files:**
- Modify: `client/src/colyseus.ts`

**Interfaces:**
- Consumes: 없음 (Task 1과 독립적으로 진행 가능).
- Produces:
  - `export type JoinSpec = { type: "create"; teamCount: number; roomTitle: string } | { type: "joinById"; roomId: string } | { type: "reconnect" }` (기존 타입에 `"reconnect"` variant 추가)
  - `export function hasStoredReconnectToken(): boolean`
  - `export function clearReconnectToken(): void`
  - 이 세 개를 Task 3(`App.tsx`, `useMatchRoom.ts`)이 그대로 가져다 쓴다.

이 프로젝트는 client 쪽 유닛 테스트가 없는 구조(`CLAUDE.md` 참고, 서버 게임 로직만 TDD 대상) — 이 태스크의 "테스트"는 타입체크(`tsc -b`) + 빌드(`vite build`) + lint(`oxlint`) 통과 확인이다.

- [ ] **Step 1: `JoinSpec`에 `"reconnect"` variant 추가 + 토큰 저장/조회 헬퍼 추가**

`client/src/colyseus.ts`에서:

```ts
export type JoinSpec =
  | { type: "create"; teamCount: number; roomTitle: string }
  | { type: "joinById"; roomId: string };

// Cached at module scope (not component/ref scope) so React StrictMode's
// dev-only double-invoke of effects (mount -> cleanup -> mount) reuses the
// same in-flight/resolved join instead of opening a second real connection
// that briefly (but really) occupies a seat server-side before it's told
// to leave.
let roomPromise: Promise<Room<unknown>> | null = null;

// No reconnection-token persistence here on purpose — a refresh or dropped
// connection always lands back on the room list (see App.tsx's OnlineFlow),
// never a silent resume into whatever room you were last in. RoleSelect lets
// you freely change roles without leaving the room, so there's no "lost
// progress" a resume would need to protect against in the lobby; a genuine
// mid-match drop just means rejoining fresh from the room list.
// 세션 쿠키(httpOnly, 브라우저가 WebSocket 업그레이드 요청에 자동으로 실어 보냄)로 서버가
// 로그인 여부와 닉네임을 판단하므로, 더 이상 nickname을 옵션으로 넘길 필요가 없다
// (MatchRoom.onAuth/onJoin 참고).
async function connectToMatch<T>(spec: JoinSpec): Promise<Room<T>> {
  return spec.type === "create"
    ? await client.create<T>("match", { teamCount: spec.teamCount, roomTitle: spec.roomTitle })
    : await client.joinById<T>(spec.roomId);
}
```

를 다음으로 교체 (기존 "재접속 지원 없음" 코멘트는 이제 사실이 아니므로 제거하고, nickname 관련 코멘트는 그대로 살려서 `connectToMatch` 위로 옮김):

```ts
export type JoinSpec =
  | { type: "create"; teamCount: number; roomTitle: string }
  | { type: "joinById"; roomId: string }
  | { type: "reconnect" };

// 게임 진행 중 새로고침/탭 닫힘에서 자동 재접속하기 위해 저장해두는 토큰 — Colyseus가 방
// 입장/재접속에 성공할 때마다 내려주는 room.reconnectionToken을 그대로 들고 있다가, 다음에
// 앱이 열릴 때 이 토큰으로 client.reconnect()를 시도한다(App.tsx 참고). localStorage를 쓰는
// 이유는 sessionStorage와 달리 탭/창을 완전히 닫았다 새로 열어도 남아있어야 하기 때문 —
// 유예 시간이 지나거나 한 번 쓰이면 서버에서 자연히 무효화되므로(MatchRoom.ts의
// reconnectGraceSeconds) 오래 남아있어도 재접속 시도가 실패할 뿐 위험하지 않다.
const RECONNECT_TOKEN_KEY = "songpyeon:reconnectToken";

function storeReconnectToken(room: Room<unknown>) {
  if (room.reconnectionToken) localStorage.setItem(RECONNECT_TOKEN_KEY, room.reconnectionToken);
}

export function hasStoredReconnectToken(): boolean {
  return localStorage.getItem(RECONNECT_TOKEN_KEY) !== null;
}

export function clearReconnectToken(): void {
  localStorage.removeItem(RECONNECT_TOKEN_KEY);
}

// Cached at module scope (not component/ref scope) so React StrictMode's
// dev-only double-invoke of effects (mount -> cleanup -> mount) reuses the
// same in-flight/resolved join instead of opening a second real connection
// that briefly (but really) occupies a seat server-side before it's told
// to leave.
let roomPromise: Promise<Room<unknown>> | null = null;

// 세션 쿠키(httpOnly, 브라우저가 WebSocket 업그레이드 요청에 자동으로 실어 보냄)로 서버가
// 로그인 여부와 닉네임을 판단하므로, 더 이상 nickname을 옵션으로 넘길 필요가 없다
// (MatchRoom.onAuth/onJoin 참고).
async function connectToMatch<T>(spec: JoinSpec): Promise<Room<T>> {
  if (spec.type === "create") {
    const room = await client.create<T>("match", { teamCount: spec.teamCount, roomTitle: spec.roomTitle });
    storeReconnectToken(room);
    return room;
  }
  if (spec.type === "joinById") {
    const room = await client.joinById<T>(spec.roomId);
    storeReconnectToken(room);
    return room;
  }
  // reconnect
  const token = localStorage.getItem(RECONNECT_TOKEN_KEY);
  if (!token) throw new Error("재접속할 게임이 없어요.");
  try {
    const room = await client.reconnect<T>(token);
    storeReconnectToken(room);
    return room;
  } catch (err) {
    clearReconnectToken();
    throw err;
  }
}
```

- [ ] **Step 2: `leaveMatch`에서 토큰 정리**

```ts
export async function leaveMatch(): Promise<void> {
  const current = roomPromise;
  roomPromise = null;
  if (!current) return;
  const room = await current;
  await room.leave();
}
```

를:

```ts
export async function leaveMatch(): Promise<void> {
  const current = roomPromise;
  roomPromise = null;
  clearReconnectToken();
  if (!current) return;
  const room = await current;
  await room.leave();
}
```

로 교체.

- [ ] **Step 3: 타입체크 + 빌드 + lint**

Run: `npm run build --workspace client`
Expected: `tsc -b` + `vite build` 성공, 타입 에러 없음.

Run: `npm run lint --workspace client`
Expected: 에러 없음.

- [ ] **Step 4: 커밋**

```bash
git add client/src/colyseus.ts
git commit -m "$(cat <<'EOF'
재접속 토큰 저장 및 JoinSpec에 reconnect variant 추가

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: 클라이언트 — 앱 시작 시 자동 재접속 진입

**Files:**
- Modify: `client/src/game/useMatchRoom.ts`
- Modify: `client/src/App.tsx`

**Interfaces:**
- Consumes: Task 2가 만든 `hasStoredReconnectToken()`, `JoinSpec`의 `"reconnect"` variant.
- Produces: 없음(최상위 UI 진입점, 더 이상 소비하는 곳 없음).

Task 2와 마찬가지로 client 쪽 유닛 테스트는 없음 — 빌드/lint 통과 확인 + 아래 Step 5의 수동 브라우저 시나리오로 검증한다.

- [ ] **Step 1: `useMatchRoom`의 에러 메시지를 spec 종류에 따라 분기**

`client/src/game/useMatchRoom.ts`에서:

```ts
      .catch((err) => {
        if (disposed) return;
        console.error("failed to join room", err);
        setErrorMessage("입장할 수 없어요 (방이 꽉 찼거나 이미 시작됐을 수 있어요)");
        setStatus("error");
      });
```

를:

```ts
      .catch((err) => {
        if (disposed) return;
        console.error("failed to join room", err);
        setErrorMessage(
          spec.type === "reconnect"
            ? "재접속 시간이 지났어요"
            : "입장할 수 없어요 (방이 꽉 찼거나 이미 시작됐을 수 있어요)",
        );
        setStatus("error");
      });
```

로 교체.

- [ ] **Step 2: `App.tsx`에서 `hasStoredReconnectToken` 임포트**

```tsx
import type { JoinSpec } from "./colyseus";
```

를:

```tsx
import { hasStoredReconnectToken, type JoinSpec } from "./colyseus";
```

로 교체.

- [ ] **Step 3: `OnlineFlow`의 `joinSpec` 초기값을 토큰 유무로 결정**

```tsx
function OnlineFlow({ onExit }: { onExit: () => void }) {
  const [me, setMe] = useState<Profile | null | undefined>(undefined);
  const [joinSpec, setJoinSpec] = useState<JoinSpec | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
```

를:

```tsx
function OnlineFlow({ onExit }: { onExit: () => void }) {
  const [me, setMe] = useState<Profile | null | undefined>(undefined);
  // 저장된 재접속 토큰이 있으면 방 목록을 건너뛰고 곧장 재접속을 시도한다 — App 함수의 mode
  // 초기값과 짝을 이뤄서 동작한다(아래 참고). 로그인 확인(fetchMe)은 그대로 거치되, 통과된
  // 뒤에는 joinSpec이 이미 세팅돼 있으니 방 목록 없이 바로 ConnectedOnlineFlow로 들어간다.
  const [joinSpec, setJoinSpec] = useState<JoinSpec | null>(() =>
    hasStoredReconnectToken() ? { type: "reconnect" } : null,
  );
  const [loginError, setLoginError] = useState<string | null>(null);
```

로 교체.

- [ ] **Step 4: `App`의 `mode` 초기값을 토큰 유무로 결정**

```tsx
function App() {
  const [mode, setMode] = useState<Mode>("select");
```

를:

```tsx
function App() {
  // 게임 도중 새로고침/탭을 닫았다 다시 열었을 때 모드 선택 화면 없이 곧장 재접속을 시도하기
  // 위한 진입점 — 위 OnlineFlow의 joinSpec 초기값과 짝을 이룬다.
  const [mode, setMode] = useState<Mode>(() => (hasStoredReconnectToken() ? "online" : "select"));
```

로 교체.

- [ ] **Step 5: 타입체크 + 빌드 + lint**

Run: `npm run build --workspace client`
Expected: 성공, 타입 에러 없음.

Run: `npm run lint --workspace client`
Expected: 에러 없음.

- [ ] **Step 6: 수동 브라우저 검증**

로그인/구글 인증은 같은 오리진에서만 동작하므로(CLAUDE.md 참고) 2567 포트로 빌드본을 서빙해서 테스트한다.

```bash
npm run sync-public
npm run dev:server
```

1. 브라우저 두 개(또는 시크릿 창 하나 + 일반 창 하나)로 각각 `http://localhost:2567` 접속, 로그인.
2. 한쪽에서 방 만들기, 다른 쪽에서 입장. 양쪽 다 역할(돼지/토끼) 골라서 4자리를 채우거나, 1팀 방으로 만들어서 2명(돼지+토끼)만으로 매치를 시작.
3. 매치가 시작(3-2-1 카운트다운 이후 "playing")되면, 한쪽 탭에서 새로고침(F5).
   - **기대 결과:** 모드 선택 화면이나 방 목록이 뜨지 않고, 몇 초 안에 자동으로 같은 매치·같은 역할로 돌아옴. 상대방 화면에는 "OO님이 퇴장했습니다" 메시지가 뜨지 않고, 대신 재접속 성공 시점에 "OO님이 입장했습니다"가 매치 채팅에 새로 뜸.
4. 같은 탭에서 다시 새로고침하되, 이번엔 **20초 넘게 기다렸다가** 페이지를 다시 염(또는 브라우저 자체를 종료했다 재실행).
   - **기대 결과:** "재접속 시간이 지났어요" 화면이 뜨고 "방 목록으로" 버튼 클릭 시 정상적으로 방 목록으로 이동. 상대방 화면에는 20초가 지난 시점에 "OO님이 퇴장했습니다"가 뜸.
5. 정상적으로 "나가기" 버튼을 눌러 나간 뒤 브라우저를 새로고침 — 방 목록/모드 선택 화면이 정상적으로 뜨는지(자동 재접속이 걸리지 않는지) 확인.

- [ ] **Step 7: 커밋**

```bash
git add client/src/game/useMatchRoom.ts client/src/App.tsx
git commit -m "$(cat <<'EOF'
앱 시작 시 저장된 토큰으로 자동 재접속 시도

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```
