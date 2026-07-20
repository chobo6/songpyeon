# 관전 모드 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 이미 시작된 매치에 제3자가 관전자로 입장할 수 있게 하고, 관전자 수 표시/닉네임 목록/관전자 채팅 표기/매치 종료 시 자동 퇴장/방 생성 시 관전 허용 여부 선택까지 구현한다.

**Architecture:** 서버는 실제 플레이어(`MatchState.players`)와 완전히 분리된 `MatchState.spectators` Map을 신설한다. Colyseus의 `maxClients` 기반 입장 차단이 `joinById`에도 프로토콜 레벨로 적용되므로, `maxClients` 자체는 넉넉하게 잡고 "플레이어 자리가 실제로 다 찼는지"는 새 필드 `playerCapacity`로 직접 관리한다. 매치 종료 후 재경기로 `phase`가 다시 `"lobby"`로 바뀌는 순간을 클라이언트가 감지해 관전자만 자동으로 방을 나가게 한다.

**Tech Stack:** 서버 Colyseus(`MatchRoom.ts`, `MatchState.ts`), 클라이언트 colyseus.js + React(`Game.tsx`, `RoomList.tsx`, `CreateRoomModal.tsx`, `colyseus.ts`).

## Global Constraints

- 관전은 **매치가 이미 시작된(`phase === "playing"`) 방에만** 적용된다. 로비 단계 입장은 지금과 완전히 동일.
- 방을 만들 때 관전 허용 여부를 선택할 수 있고 **기본값은 허용**이다.
- 관전 인원 상한은 두지 않는다.
- 관전자 입장/퇴장 시 매치 채팅과 관리자 이벤트 로그 어디에도 안내/기록을 남기지 않는다.
- 관전자가 보낸 채팅 메시지는 matchChat에 표시되며, 닉네임 뒤에 **"(관전)"**이 붙는다.
- 매치가 끝나 재경기로 `phase`가 `"lobby"`로 돌아가면, 관전자는 **자동으로 방을 나가 방 목록 화면으로 돌아간다**.
- 화면 우측 상단에 관전자 수를 표시하고, 클릭하면 관전자 닉네임 목록을 모달로 보여준다.
- 관전자는 재접속(reconnection) 유예 대상이 아니다.
- 참고 스펙: `docs/superpowers/specs/2026-07-20-spectator-mode-design.md`

---

### Task 1: 서버 — 관전자 스키마 + 입장/퇴장/채팅 분기

**Files:**
- Modify: `server/src/rooms/MatchState.ts`
- Modify: `server/src/rooms/MatchRoom.ts`
- Modify: `server/src/rooms/MatchRoom.test.ts`
- Modify: `client/src/game/matchTypes.ts`

**Interfaces:**
- Produces: `MatchState.spectators: MapSchema<SpectatorState>` (서버), `MatchState.spectators: Map<string, SpectatorState>` (클라이언트 타입), `SpectatorState { sessionId: string; nickname: string }` (양쪽), `MatchRoomOptions.allowSpectators?: unknown`. 이후 태스크(클라이언트 전부)가 `room.state.spectators`를 그대로 참조한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`server/src/rooms/MatchRoom.test.ts`에서 기존 테스트 두 개를 먼저 찾아 교체한다. 현재:

```ts
  test("a room in progress rejects a new connection attempt", async () => {
    const { room } = await fillRolesAndStart();

    await expect(connectAsUser(colyseus, room, "플레이어")).rejects.toThrow();
  });

  test("a room still rejects new connections after a player leaves (maxClients lock can be auto-unlocked by Colyseus)", async () => {
    const { room, clients } = await fillRolesAndStart();

    await clients[0].leave();
    await flush();

    await expect(connectAsUser(colyseus, room, "플레이어")).rejects.toThrow();
  });
```

이 두 테스트는 "진행 중인 방은 새 접속을 무조건 거부한다"는, 관전 기능이 정면으로 바꾸는 전제 위에 있다(관전 허용 방이면 이제 거부 대신 관전자로 합류해야 함). 아래로 교체:

```ts
  test("a room in progress with spectators disabled rejects a new connection attempt", async () => {
    const { room } = await fillRolesAndStart({ allowSpectators: false });

    await expect(connectAsUser(colyseus, room, "플레이어")).rejects.toThrow();
  });

  test("a room with spectators disabled still rejects new connections after a player leaves (maxClients lock can be auto-unlocked by Colyseus)", async () => {
    const { room, clients } = await fillRolesAndStart({ allowSpectators: false });

    await clients[0].leave();
    await flush();

    await expect(connectAsUser(colyseus, room, "플레이어")).rejects.toThrow();
  });
```

바로 다음 자리에 새 테스트들을 추가한다:

```ts
  test("a client joining an in-progress match becomes a spectator, not a player", async () => {
    const { room } = await fillRolesAndStart();
    const spectatorClient = await connectAsUser(colyseus, room, "관전자1");
    await flush();

    expect(room.state.spectators.has(spectatorClient.sessionId)).toBe(true);
    expect(room.state.spectators.get(spectatorClient.sessionId)?.nickname).toBe("관전자1");
    expect(room.state.players.has(spectatorClient.sessionId)).toBe(false);
  });

  test("a spectator joining after a player left does not backfill the vacated player slot", async () => {
    const { room, clients } = await fillRolesAndStart();
    const vacatedTeam = room.state.teams.find((t) => t.pigSessionId === clients[0].sessionId)!;

    await clients[0].leave();
    await flush();

    const spectatorClient = await connectAsUser(colyseus, room, "관전자1");
    await flush();

    expect(room.state.spectators.has(spectatorClient.sessionId)).toBe(true);
    expect(vacatedTeam.pigSessionId).toBe("");
  });

  test("a spectator leaving is removed immediately, without reconnection grace", async () => {
    const { room } = await fillRolesAndStart();
    const spectatorClient = await connectAsUser(colyseus, room, "관전자1");
    await flush();

    await spectatorClient.leave(false); // non-consented, same as a dropped connection
    await flush();

    expect(room.state.spectators.has(spectatorClient.sessionId)).toBe(false);
  });

  test("a spectator's chat message is tagged with (관전) and only appears in matchChat", async () => {
    const { room } = await fillRolesAndStart();
    const spectatorClient = await connectAsUser(colyseus, room, "관전자1");
    await flush();
    const lobbyChatCountBefore = room.state.lobbyChat.length;

    spectatorClient.send("sendChat", { text: "안녕하세요" });
    await flush();

    expect(room.state.matchChat[room.state.matchChat.length - 1].nickname).toBe("관전자1 (관전)");
    expect(room.state.matchChat[room.state.matchChat.length - 1].text).toBe("안녕하세요");
    expect(room.state.lobbyChat).toHaveLength(lobbyChatCountBefore);
  });

  test("the lobby still rejects a join once every player slot is taken", async () => {
    const room = await colyseus.createRoom<MatchState>("match", { teamCount: 1 });
    await connectAsUser(colyseus, room, "플레이어1");
    await connectAsUser(colyseus, room, "플레이어2");
    await flush();

    await expect(connectAsUser(colyseus, room, "플레이어3")).rejects.toThrow();
  });
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `npm test --workspace server -- MatchRoom.test.ts`
Expected: 새로 추가한 테스트들 FAIL(`spectators`가 아직 없어 `room.state.spectators`가 `undefined`라 타입/런타임 에러) — 그리고 관전 관련 옵션이 없으므로 재작성한 두 테스트는 `allowSpectators: false`를 무시한 채 "그냥 항상 거부"하던 기존 동작 그대로라 우연히 통과할 수 있음(그래도 다음 스텝 이후에도 계속 통과해야 하는 회귀 테스트로 남긴다).

- [ ] **Step 3: `MatchState.ts`에 `SpectatorState`/`spectators` 추가**

`server/src/rooms/MatchState.ts`에서:

```ts
export class ChatMessage extends Schema {
  @type("string") nickname: string = "";
  @type("string") text: string = "";
  @type("number") sentAt: number = 0;
}

export class MatchState extends Schema {
```

를 다음으로 교체:

```ts
export class ChatMessage extends Schema {
  @type("string") nickname: string = "";
  @type("string") text: string = "";
  @type("number") sentAt: number = 0;
}

export class SpectatorState extends Schema {
  @type("string") sessionId: string = "";
  @type("string") nickname: string = "";
}

export class MatchState extends Schema {
```

그리고:

```ts
  @type([ChatMessage]) lobbyChat = new ArraySchema<ChatMessage>();
  @type([ChatMessage]) matchChat = new ArraySchema<ChatMessage>();
}
```

를:

```ts
  @type([ChatMessage]) lobbyChat = new ArraySchema<ChatMessage>();
  @type([ChatMessage]) matchChat = new ArraySchema<ChatMessage>();
  // 실제 플레이어(players)와 완전히 분리된 맵 — 재경기 시 역할 초기화 로직이나
  // 방장 판정 등 기존 players 관련 코드를 하나도 안 건드리고 얹기 위함.
  @type({ map: SpectatorState }) spectators = new MapSchema<SpectatorState>();
}
```

- [ ] **Step 4: `matchTypes.ts`에 동일하게 미러링**

`client/src/game/matchTypes.ts`에서:

```ts
export interface ChatMessage {
  nickname: string;
  text: string;
  sentAt: number;
}

export interface MatchState {
  phase: Phase;
  countdownSecondsLeft: number;
  round: number;
  players: Map<string, PlayerState>;
  teams: TeamState[];
  activeTeamIndex: number;
  sequence: Color[];
  cursor: number;
  turnEndsAt: number;
  turnOutcome: TurnOutcome;
  lobbyChat: ChatMessage[];
  matchChat: ChatMessage[];
}
```

를:

```ts
export interface ChatMessage {
  nickname: string;
  text: string;
  sentAt: number;
}

export interface SpectatorState {
  sessionId: string;
  nickname: string;
}

export interface MatchState {
  phase: Phase;
  countdownSecondsLeft: number;
  round: number;
  players: Map<string, PlayerState>;
  teams: TeamState[];
  activeTeamIndex: number;
  sequence: Color[];
  cursor: number;
  turnEndsAt: number;
  turnOutcome: TurnOutcome;
  lobbyChat: ChatMessage[];
  matchChat: ChatMessage[];
  spectators: Map<string, SpectatorState>;
}
```

- [ ] **Step 5: `MatchRoom.ts` — import, 옵션, 필드**

```ts
import { MatchState, PlayerState, TeamState, ChatMessage } from "./MatchState";
```

를:

```ts
import { MatchState, PlayerState, TeamState, ChatMessage, SpectatorState } from "./MatchState";
```

로 교체.

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

를:

```ts
const DEFAULT_TURN_DURATION_MS = 4000;
const DEFAULT_COUNTDOWN_TICK_MS = 1000;
const COUNTDOWN_START_SECONDS = 3;
const MAX_CHAT_MESSAGES = 50;
const DEFAULT_RECONNECT_GRACE_SECONDS = 20;
// Colyseus rejects ANY join (joinOrCreate AND joinById) once
// clients.length + reservedSeats reaches maxClients — that check happens
// before onJoin ever runs, so maxClients can't be used to cap "player"
// seats only once spectators need to keep connecting past that point. Set
// generously high so a full room of players never blocks a spectator's
// joinById; the real player-seat limit is enforced by playerCapacity
// instead (see onJoin).
const MAX_CLIENTS_WITH_SPECTATORS = 1000;

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
  // Whether a client joining after the match has already started (phase
  // !== "lobby") is allowed to join as a spectator instead of being
  // rejected outright. Defaults to true — only an explicit `false` opts a
  // room out (see onCreate).
  allowSpectators?: unknown;
}
```

```ts
  private turnDurationMs = DEFAULT_TURN_DURATION_MS;
  private countdownTickMs = DEFAULT_COUNTDOWN_TICK_MS;
  private reconnectGraceSeconds = DEFAULT_RECONNECT_GRACE_SECONDS;
  private countdownToken = 0;
```

를:

```ts
  private turnDurationMs = DEFAULT_TURN_DURATION_MS;
  private countdownTickMs = DEFAULT_COUNTDOWN_TICK_MS;
  private reconnectGraceSeconds = DEFAULT_RECONNECT_GRACE_SECONDS;
  private allowSpectators = true;
  // Real player-seat cap (teamCount * 2) — replaces maxClients for that
  // purpose now that maxClients itself is inflated to admit spectators
  // (see MAX_CLIENTS_WITH_SPECTATORS). Set once in onCreate.
  private playerCapacity = 0;
  private countdownToken = 0;
```

- [ ] **Step 6: `onCreate` — 옵션 반영 + `maxClients`/`playerCapacity` 분리**

```ts
  async onCreate(options: MatchRoomOptions = {}) {
    if (options.turnDurationMs) this.turnDurationMs = options.turnDurationMs;
    if (options.countdownTickMs) this.countdownTickMs = options.countdownTickMs;
    if (options.reconnectGraceSeconds) this.reconnectGraceSeconds = options.reconnectGraceSeconds;
```

를:

```ts
  async onCreate(options: MatchRoomOptions = {}) {
    if (options.turnDurationMs) this.turnDurationMs = options.turnDurationMs;
    if (options.countdownTickMs) this.countdownTickMs = options.countdownTickMs;
    if (options.reconnectGraceSeconds) this.reconnectGraceSeconds = options.reconnectGraceSeconds;
    this.allowSpectators = options.allowSpectators !== false;
```

그리고:

```ts
    const teamCount = sanitizeTeamCount(options.teamCount);
    // 2 players (pig + rabbit) per team — must stay in sync with
    // maybeStartGame()'s readiness check and handleChooseRole()'s slot
    // search, both of which assume every team has exactly one pig and one
    // rabbit slot.
    this.maxClients = teamCount * 2;
```

를:

```ts
    const teamCount = sanitizeTeamCount(options.teamCount);
    // 2 players (pig + rabbit) per team — must stay in sync with
    // maybeStartGame()'s readiness check and handleChooseRole()'s slot
    // search, both of which assume every team has exactly one pig and one
    // rabbit slot.
    this.playerCapacity = teamCount * 2;
    this.maxClients = MAX_CLIENTS_WITH_SPECTATORS;
```

그리고 메타데이터에 `playerCapacity`/`allowSpectators`를 실어서 `/api/rooms`가 나중에 쓸 수 있게 한다:

```ts
    const roomTitle = sanitizeRoomTitle(options.roomTitle);
    await this.setMetadata({ roomTitle: roomTitle || "이름 없는 방" });
```

를:

```ts
    const roomTitle = sanitizeRoomTitle(options.roomTitle);
    await this.setMetadata({
      roomTitle: roomTitle || "이름 없는 방",
      playerCapacity: this.playerCapacity,
      allowSpectators: this.allowSpectators,
    });
```

- [ ] **Step 7: `onJoin` — 관전자 분기 + 로비 정원 체크**

```ts
  async onJoin(client: Client, _options: MatchRoomOptions = {}) {
    if (this.state.players.has(client.sessionId)) return;

    if (this.state.phase !== "lobby") {
      throw new Error("Match already in progress");
    }

    // The first player to actually join (not the one who called client.create())
```

를:

```ts
  async onJoin(client: Client, _options: MatchRoomOptions = {}) {
    if (this.state.players.has(client.sessionId) || this.state.spectators.has(client.sessionId)) return;

    if (this.state.phase !== "lobby") {
      if (!this.allowSpectators) {
        throw new Error("이 방은 관전을 허용하지 않습니다.");
      }
      const spectator = new SpectatorState();
      spectator.sessionId = client.sessionId;
      spectator.nickname = client.auth?.nickname ?? "관전자";
      this.state.spectators.set(client.sessionId, spectator);
      return;
    }

    // maxClients is now inflated to admit spectators (see
    // MAX_CLIENTS_WITH_SPECTATORS), so Colyseus's own seat-reservation check
    // no longer caps how many players can join the lobby — playerCapacity
    // does that job now.
    if (this.state.players.size >= this.playerCapacity) {
      throw new Error("방이 가득 찼습니다.");
    }

    // The first player to actually join (not the one who called client.create())
```

- [ ] **Step 8: `onLeave` — 관전자 조기 반환**

```ts
  async onLeave(client: Client, consented: boolean) {
    console.log(`[leave] session=${client.sessionId} ip=${client.auth?.ip}`);
```

를:

```ts
  async onLeave(client: Client, consented: boolean) {
    // 관전자는 재접속 유예도, 이벤트 로그도, 퇴장 채팅 안내도 없이 즉시 제거한다 —
    // 그냥 다시 관전 입장하면 되므로 플레이어 쪽 onLeave 로직과 완전히 분리해둔다.
    if (this.state.spectators.has(client.sessionId)) {
      this.state.spectators.delete(client.sessionId);
      return;
    }

    console.log(`[leave] session=${client.sessionId} ip=${client.auth?.ip}`);
```

- [ ] **Step 9: `handleSendChat` — 관전자 분기**

```ts
  private handleSendChat(client: Client, rawText: unknown) {
    const text = sanitizeChatText(rawText);
    if (!text) return;

    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const list = this.state.phase === "lobby" ? this.state.lobbyChat : this.state.matchChat;
    this.pushChat(list, player.nickname, text);
  }
```

를:

```ts
  private handleSendChat(client: Client, rawText: unknown) {
    const text = sanitizeChatText(rawText);
    if (!text) return;

    const player = this.state.players.get(client.sessionId);
    if (player) {
      const list = this.state.phase === "lobby" ? this.state.lobbyChat : this.state.matchChat;
      this.pushChat(list, player.nickname, text);
      return;
    }

    const spectator = this.state.spectators.get(client.sessionId);
    if (spectator) {
      // 관전자는 진행 중인 매치(phase !== "lobby")에만 존재할 수 있으므로
      // (onJoin 참고) 항상 matchChat으로 보낸다.
      this.pushChat(this.state.matchChat, `${spectator.nickname} (관전)`, text);
    }
  }
```

- [ ] **Step 10: 테스트 실행해서 통과 확인**

Run: `npm test --workspace server -- MatchRoom.test.ts`
Expected: 전체 PASS.

- [ ] **Step 11: 서버 전체 테스트 + 타입체크**

Run: `npm test --workspace server && npm run build --workspace server`
Expected: 전체 PASS, 타입 에러 없음. (`client/src/game/matchTypes.ts`는 서버 빌드와 무관하지만, 이 태스크에서 같이 수정했으니 `npm run build --workspace client`도 한 번 돌려서 타입 에러 없는지 확인.)

- [ ] **Step 12: 커밋**

```bash
git add server/src/rooms/MatchState.ts server/src/rooms/MatchRoom.ts server/src/rooms/MatchRoom.test.ts client/src/game/matchTypes.ts
git commit -m "$(cat <<'EOF'
진행 중인 매치에 관전자로 입장할 수 있는 기능 추가

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: 서버 — `/api/rooms` 응답 보정

**Files:**
- Modify: `server/src/createServer.ts`

**Interfaces:**
- Consumes: Task 1이 메타데이터에 실어둔 `playerCapacity: number`, `allowSpectators: boolean`, 기존 `players: {sessionId, nickname}[]`.
- Produces: `/api/rooms` 응답 각 항목에 `allowSpectators: boolean` 필드 추가, `clients`/`maxClients`가 실제 플레이어 수/정원을 반영(관전자·인플레이션된 서버 내부 maxClients와 무관). Task 4(클라이언트 방 목록)가 이 필드들을 그대로 소비한다.

이 라우트는 이 프로젝트에 기존 테스트가 없는 순수 HTTP 레이어(서버 쪽 TDD 대상은 룸 로직뿐 — `CLAUDE.md` 참고)라, 이 태스크는 타입체크 통과 확인 + Task 6 끝의 수동 브라우저 검증으로 확인한다.

- [ ] **Step 1: `/api/rooms` 응답 매핑 수정**

`server/src/createServer.ts`에서:

```ts
    const rooms = await matchMaker.query({ name: "match" });
    res.json(
      rooms.map((r) => {
        const metadata = r.metadata as { hostNickname?: string; roomTitle?: string } | undefined;
        return {
          roomId: r.roomId,
          clients: r.clients,
          maxClients: r.maxClients,
          locked: r.locked,
          hostNickname: metadata?.hostNickname ?? "?",
          roomTitle: metadata?.roomTitle ?? "이름 없는 방",
        };
      }),
    );
  });
```

를:

```ts
    const rooms = await matchMaker.query({ name: "match" });
    res.json(
      rooms.map((r) => {
        const metadata = r.metadata as
          | {
              hostNickname?: string;
              roomTitle?: string;
              players?: { sessionId: string; nickname: string }[];
              playerCapacity?: number;
              allowSpectators?: boolean;
            }
          | undefined;
        return {
          roomId: r.roomId,
          // maxClients는 관전자를 받기 위해 서버 내부적으로 크게 잡혀있다
          // (MatchRoom.ts의 MAX_CLIENTS_WITH_SPECTATORS) — 방 목록에는 그
          // 값이 아니라 실제 플레이어 수/정원만 보여야 "2/4"처럼 정확히 읽힌다.
          clients: metadata?.players?.length ?? r.clients,
          maxClients: metadata?.playerCapacity ?? r.maxClients,
          locked: r.locked,
          hostNickname: metadata?.hostNickname ?? "?",
          roomTitle: metadata?.roomTitle ?? "이름 없는 방",
          allowSpectators: metadata?.allowSpectators ?? true,
        };
      }),
    );
  });
```

- [ ] **Step 2: 타입체크**

Run: `npm run build --workspace server`
Expected: 타입 에러 없음.

- [ ] **Step 3: 커밋**

```bash
git add server/src/createServer.ts
git commit -m "$(cat <<'EOF'
방 목록 API에 관전 허용 여부를 노출하고 인원 수 표시를 실제 플레이어 기준으로 보정

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: 클라이언트 — 방 만들기 모달에 관전 허용 옵션

**Files:**
- Modify: `client/src/components/CreateRoomModal.tsx`
- Modify: `client/src/components/CreateRoomModal.module.css`
- Modify: `client/src/components/RoomList.tsx`
- Modify: `client/src/App.tsx`
- Modify: `client/src/colyseus.ts`

**Interfaces:**
- Consumes: 없음(Task 1/2와 독립적으로 진행 가능 — 서버가 아직 `allowSpectators`를 안 받아도 클라이언트가 그 옵션을 join 요청에 실어보내는 것 자체는 문제없이 동작함. 다만 기능이 실제로 서버에 반영되려면 Task 1이 먼저 배포돼 있어야 함).
- Produces: `JoinSpec`의 `"create"` variant에 `allowSpectators: boolean` 필드. Task 4는 이 태스크와 무관하게 별도로 `RoomListEntry`를 확장한다(consumes 없음).

client 쪽 유닛 테스트는 없음(CLAUDE.md 참고) — `tsc -b`/`vite build`/`oxlint` 통과로 검증.

- [ ] **Step 1: `CreateRoomModal.tsx` — 체크박스 상태 + UI + `onCreate` 시그니처**

```tsx
export function CreateRoomModal({
  onCreate,
  onClose,
}: {
  onCreate: (title: string, teamCount: number) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [teamCount, setTeamCount] = useState(2);
```

를:

```tsx
export function CreateRoomModal({
  onCreate,
  onClose,
}: {
  onCreate: (title: string, teamCount: number, allowSpectators: boolean) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [teamCount, setTeamCount] = useState(2);
  const [allowSpectators, setAllowSpectators] = useState(true);
```

```tsx
  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    onCreate(trimmed, teamCount);
  }
```

를:

```tsx
  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    onCreate(trimmed, teamCount, allowSpectators);
  }
```

```tsx
        <label className={styles.field}>
          <span>팀 수 (1~4)</span>
          <input
            className={styles.input}
            type="text"
            inputMode="numeric"
            maxLength={1}
            value={teamCount}
            onChange={(e) => handleTeamCountChange(e.target.value)}
            onFocus={(e) => e.target.select()}
          />
        </label>
        <div className={styles.actions}>
```

를:

```tsx
        <label className={styles.field}>
          <span>팀 수 (1~4)</span>
          <input
            className={styles.input}
            type="text"
            inputMode="numeric"
            maxLength={1}
            value={teamCount}
            onChange={(e) => handleTeamCountChange(e.target.value)}
            onFocus={(e) => e.target.select()}
          />
        </label>
        <label className={styles.checkboxField}>
          <input
            type="checkbox"
            checked={allowSpectators}
            onChange={(e) => setAllowSpectators(e.target.checked)}
          />
          <span>관전 허용</span>
        </label>
        <div className={styles.actions}>
```

- [ ] **Step 2: `CreateRoomModal.module.css` — 체크박스 줄 스타일**

```css
.field {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  font-size: 0.9rem;
  opacity: 0.9;
}
```

바로 다음 줄에 추가:

```css
.checkboxField {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.9rem;
  opacity: 0.9;
}
```

- [ ] **Step 3: `RoomList.tsx` — `onCreateRoom` 시그니처 확장**

```tsx
export function RoomList({
  onCreateRoom,
  onJoinRoom,
  onExit,
}: {
  onCreateRoom: (title: string, teamCount: number) => void;
  onJoinRoom: (roomId: string) => void;
  onExit: () => void;
}) {
```

를:

```tsx
export function RoomList({
  onCreateRoom,
  onJoinRoom,
  onExit,
}: {
  onCreateRoom: (title: string, teamCount: number, allowSpectators: boolean) => void;
  onJoinRoom: (roomId: string) => void;
  onExit: () => void;
}) {
```

```tsx
      {showCreateModal && (
        <CreateRoomModal
          onClose={() => setShowCreateModal(false)}
          onCreate={(title, teamCount) => {
            setShowCreateModal(false);
            onCreateRoom(title, teamCount);
          }}
        />
      )}
```

를:

```tsx
      {showCreateModal && (
        <CreateRoomModal
          onClose={() => setShowCreateModal(false)}
          onCreate={(title, teamCount, allowSpectators) => {
            setShowCreateModal(false);
            onCreateRoom(title, teamCount, allowSpectators);
          }}
        />
      )}
```

- [ ] **Step 4: `colyseus.ts` — `JoinSpec`의 `"create"`에 `allowSpectators` 추가**

```ts
export type JoinSpec =
  | { type: "create"; teamCount: number; roomTitle: string }
  | { type: "joinById"; roomId: string }
  | { type: "reconnect" };
```

를:

```ts
export type JoinSpec =
  | { type: "create"; teamCount: number; roomTitle: string; allowSpectators: boolean }
  | { type: "joinById"; roomId: string }
  | { type: "reconnect" };
```

그리고:

```ts
  if (spec.type === "create") {
    const room = await client.create<T>("match", { teamCount: spec.teamCount, roomTitle: spec.roomTitle });
    storeReconnectToken(room);
    return room;
  }
```

를:

```ts
  if (spec.type === "create") {
    const room = await client.create<T>("match", {
      teamCount: spec.teamCount,
      roomTitle: spec.roomTitle,
      allowSpectators: spec.allowSpectators,
    });
    storeReconnectToken(room);
    return room;
  }
```

- [ ] **Step 5: `App.tsx` — `onCreateRoom` 콜백에서 `JoinSpec` 구성**

```tsx
        onCreateRoom={(roomTitle, teamCount) => setJoinSpec({ type: "create", teamCount, roomTitle })}
```

를:

```tsx
        onCreateRoom={(roomTitle, teamCount, allowSpectators) =>
          setJoinSpec({ type: "create", teamCount, roomTitle, allowSpectators })
        }
```

- [ ] **Step 6: 빌드 + lint**

Run: `npm run build --workspace client`
Expected: 성공, 타입 에러 없음.

Run: `npm run lint --workspace client`
Expected: 에러 없음.

- [ ] **Step 7: 커밋**

```bash
git add client/src/components/CreateRoomModal.tsx client/src/components/CreateRoomModal.module.css client/src/components/RoomList.tsx client/src/App.tsx client/src/colyseus.ts
git commit -m "$(cat <<'EOF'
방 만들기 모달에 관전 허용 여부 선택 옵션 추가(기본 허용)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: 클라이언트 — 방 목록 "관전하기" 버튼

**Files:**
- Modify: `client/src/colyseus.ts`
- Modify: `client/src/components/RoomList.tsx`

**Interfaces:**
- Consumes: Task 2가 `/api/rooms`에 추가한 `allowSpectators: boolean` 필드.
- Produces: 없음(최종 UI).

- [ ] **Step 1: `RoomListEntry`에 `allowSpectators` 추가**

`client/src/colyseus.ts`에서:

```ts
export interface RoomListEntry {
  roomId: string;
  clients: number;
  maxClients: number;
  locked: boolean;
  hostNickname: string;
  roomTitle: string;
}
```

를:

```ts
export interface RoomListEntry {
  roomId: string;
  clients: number;
  maxClients: number;
  locked: boolean;
  hostNickname: string;
  roomTitle: string;
  allowSpectators: boolean;
}
```

- [ ] **Step 2: `RoomList.tsx` — 버튼 라벨/활성화 분기**

```tsx
              <button className={styles.joinButton} disabled={room.locked} onClick={() => onJoinRoom(room.roomId)}>
                {room.locked ? "게임 중" : "입장"}
              </button>
```

를:

```tsx
              <button
                className={styles.joinButton}
                disabled={room.locked && !room.allowSpectators}
                onClick={() => onJoinRoom(room.roomId)}
              >
                {room.locked ? (room.allowSpectators ? "관전하기" : "게임 중") : "입장"}
              </button>
```

`onJoinRoom`은 지금과 완전히 동일한 콜백 그대로 — 플레이어로 들어갈지 관전자로 들어갈지는 서버가 그 시점의 `phase`를 보고 정하므로, 클라이언트가 "이건 관전 입장이야"를 따로 표시해서 보낼 필요가 없다.

- [ ] **Step 3: 빌드 + lint**

Run: `npm run build --workspace client && npm run lint --workspace client`
Expected: 둘 다 성공.

- [ ] **Step 4: 커밋**

```bash
git add client/src/colyseus.ts client/src/components/RoomList.tsx
git commit -m "$(cat <<'EOF'
관전 허용 방이 진행 중일 때 방 목록에 관전하기 버튼 표시

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: 클라이언트 — 관전자 화면 재사용 + 매치 종료 시 자동 퇴장

**Files:**
- Modify: `client/src/components/Game.tsx`
- Modify: `client/src/components/SpectatorScreen.tsx`

**Interfaces:**
- Consumes: Task 1의 `room.state.spectators: Map<string, SpectatorState>`.
- Produces: `Game.tsx`가 계산하는 `isSpectator: boolean`을 `SpectatorScreen`에 prop으로 넘김 — Task 6이 같은 `Game.tsx` 파일을 이어서 수정하므로, 이 태스크가 끝난 뒤의 `Game.tsx` 최종 모습을 그대로 이어받는다(아래 Step 1 결과가 Task 6의 시작점).

- [ ] **Step 1: `Game.tsx` — 관전자 판별 + 자동 퇴장 effect + 로비 분기**

전체 파일을 아래로 교체(기존 import에 `useEffect` 추가됨):

```tsx
import { useEffect } from "react";
import type { Room } from "colyseus.js";
import type { MatchState } from "../game/matchTypes";
import { RoleSelect } from "./RoleSelect";
import { MyTurnScreen } from "./MyTurnScreen";
import { SpectatorScreen } from "./SpectatorScreen";
import { BgmPlayer } from "./BgmPlayer";

export function Game({
  room,
  clockOffsetMs,
  onLeave,
  onExit,
}: {
  room: Room<MatchState>;
  clockOffsetMs: number;
  onLeave: () => void;
  onExit: () => void;
}) {
  const { phase } = room.state;
  const isSpectator = room.state.spectators.has(room.sessionId);

  // 매치가 끝나 재경기 로비로 돌아가는 순간, 관전자는 그 로비(플레이어들끼리의 재경기
  // 대기실)에 남아있을 이유가 없다 — 자동으로 방을 나가 방 목록으로 돌아간다.
  useEffect(() => {
    if (isSpectator && phase === "lobby") {
      onLeave();
    }
  }, [isSpectator, phase, onLeave]);

  if (phase === "lobby") {
    // 관전자가 여기 도달하는 건 위 effect가 아직 반영되기 전의 찰나뿐이므로, 그 사이엔
    // 로비 화면을 보여줄 필요 없이 아무것도 렌더링하지 않는다.
    if (isSpectator) return null;
    return <RoleSelect room={room} onExit={onExit} />;
  }

  const me = room.state.players.get(room.sessionId);
  const activeTeam = room.state.teams[room.state.activeTeamIndex];
  // activeTeam can itself be eliminated once every team has been wiped out
  // (the server freezes turns at that point instead of ending the match) —
  // that team's own players fall through to SpectatorScreen too, since
  // there's no turn left for anyone to take.
  const isMyTeamActive = me?.teamId === activeTeam?.id && !activeTeam?.eliminated;

  let screen = null;
  if (me && activeTeam && isMyTeamActive) {
    screen = <MyTurnScreen room={room} me={me} clockOffsetMs={clockOffsetMs} />;
  } else if (activeTeam) {
    const myTeam = room.state.teams.find((t) => t.id === me?.teamId);
    screen = (
      <SpectatorScreen
        room={room}
        activeTeam={activeTeam}
        eliminated={myTeam?.eliminated ?? false}
        isSpectator={isSpectator}
        clockOffsetMs={clockOffsetMs}
        onLeave={onLeave}
      />
    );
  }

  // BgmPlayer stays at this fixed position in the tree across every
  // MyTurnScreen <-> SpectatorScreen switch (every turn), so React never
  // remounts it while phase stays "playing" — that's what keeps the BGM
  // from restarting each turn.
  return (
    <>
      <BgmPlayer />
      {screen}
    </>
  );
}
```

- [ ] **Step 2: `SpectatorScreen.tsx` — `isSpectator` prop으로 "나가기=재경기" 분기 제외**

```tsx
export function SpectatorScreen({
  room,
  activeTeam,
  eliminated,
  clockOffsetMs,
  onLeave,
}: {
  room: Room<MatchState>;
  activeTeam: TeamState;
  eliminated: boolean;
  clockOffsetMs: number;
  onLeave: () => void;
}) {
```

를:

```tsx
export function SpectatorScreen({
  room,
  activeTeam,
  eliminated,
  isSpectator,
  clockOffsetMs,
  onLeave,
}: {
  room: Room<MatchState>;
  activeTeam: TeamState;
  eliminated: boolean;
  isSpectator: boolean;
  clockOffsetMs: number;
  onLeave: () => void;
}) {
```

그리고:

```tsx
  function handleLeaveClick() {
    if (matchOver) {
      room.send("rematch");
      return;
    }
    onLeave();
  }
```

를:

```tsx
  function handleLeaveClick() {
    // 관전자는 재경기를 요청할 자격이 없다 — 매치가 끝나면(matchOver) 곧 Game.tsx의
    // 자동 퇴장 effect가 방을 나가게 하겠지만, 그 전에 직접 "나가기"를 누르는 경우에도
    // 그냥 나가야지 rematch를 보내면 안 된다.
    if (matchOver && !isSpectator) {
      room.send("rematch");
      return;
    }
    onLeave();
  }
```

- [ ] **Step 3: 빌드 + lint**

Run: `npm run build --workspace client && npm run lint --workspace client`
Expected: 둘 다 성공.

- [ ] **Step 4: 커밋**

```bash
git add client/src/components/Game.tsx client/src/components/SpectatorScreen.tsx
git commit -m "$(cat <<'EOF'
관전자 화면 재사용 및 매치 종료 시 관전자 자동 퇴장 처리

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: 클라이언트 — 관전자 수 배지 + 닉네임 목록 모달

**Files:**
- Create: `client/src/components/SpectatorCountBadge.tsx`
- Create: `client/src/components/SpectatorCountBadge.module.css`
- Modify: `client/src/components/Game.tsx`

**Interfaces:**
- Consumes: Task 1의 `room.state.spectators`, Task 5가 만든 `Game.tsx`의 현재 구조(위 Task 5 Step 1의 최종 코드).
- Produces: 없음(최종 UI).

- [ ] **Step 1: `SpectatorCountBadge.tsx` 작성**

```tsx
import { useState } from "react";
import type { Room } from "colyseus.js";
import type { MatchState } from "../game/matchTypes";
import styles from "./SpectatorCountBadge.module.css";

export function SpectatorCountBadge({ room }: { room: Room<MatchState> }) {
  const [showModal, setShowModal] = useState(false);
  const spectators = [...room.state.spectators.values()];

  return (
    <>
      <button className={styles.badge} onClick={() => setShowModal(true)}>
        👁 {spectators.length}
      </button>
      {showModal && (
        <div className={styles.overlay} onClick={() => setShowModal(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 className={styles.heading}>관전자 ({spectators.length}명)</h2>
            {spectators.length === 0 ? (
              <p className={styles.empty}>아직 관전자가 없어요</p>
            ) : (
              <ul className={styles.list}>
                {spectators.map((s) => (
                  <li key={s.sessionId} className={styles.row}>
                    {s.nickname}
                  </li>
                ))}
              </ul>
            )}
            <button className={styles.closeButton} onClick={() => setShowModal(false)}>
              닫기
            </button>
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: `SpectatorCountBadge.module.css` 작성**

```css
.badge {
  position: fixed;
  top: 0.75rem;
  right: 0.75rem;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.35rem 0.7rem;
  border-radius: 999px;
  border: none;
  cursor: pointer;
  background: rgba(0, 0, 0, 0.5);
  color: #fff;
  font-size: 0.85rem;
  font-weight: 700;
}

.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  box-sizing: border-box;
  z-index: 10;
}

.modal {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  width: 100%;
  max-width: 20rem;
  max-height: 80svh;
  padding: 1.5rem;
  border-radius: 0.8rem;
  background: #1f2937;
  color: #fff;
  box-sizing: border-box;
}

.heading {
  margin: 0;
  font-size: 1.3rem;
  font-weight: 800;
  text-align: center;
}

.empty {
  text-align: center;
  opacity: 0.8;
  font-size: 0.9rem;
}

.list {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin: 0;
  padding: 0;
  list-style: none;
  overflow-y: auto;
}

.row {
  padding: 0.5rem 0.75rem;
  border-radius: 0.5rem;
  background: rgba(255, 255, 255, 0.08);
  text-align: left;
}

.closeButton {
  padding: 0.6rem 1rem;
  font-size: 0.95rem;
  border-radius: 0.6rem;
  border: none;
  cursor: pointer;
  color: #fff;
  font-weight: 700;
  background: #363861;
}
```

- [ ] **Step 3: `Game.tsx`에 배지 마운트**

```tsx
import { useEffect } from "react";
import type { Room } from "colyseus.js";
import type { MatchState } from "../game/matchTypes";
import { RoleSelect } from "./RoleSelect";
import { MyTurnScreen } from "./MyTurnScreen";
import { SpectatorScreen } from "./SpectatorScreen";
import { BgmPlayer } from "./BgmPlayer";
```

를:

```tsx
import { useEffect } from "react";
import type { Room } from "colyseus.js";
import type { MatchState } from "../game/matchTypes";
import { RoleSelect } from "./RoleSelect";
import { MyTurnScreen } from "./MyTurnScreen";
import { SpectatorScreen } from "./SpectatorScreen";
import { SpectatorCountBadge } from "./SpectatorCountBadge";
import { BgmPlayer } from "./BgmPlayer";
```

그리고:

```tsx
  return (
    <>
      <BgmPlayer />
      {screen}
    </>
  );
}
```

를:

```tsx
  return (
    <>
      <BgmPlayer />
      {phase === "playing" && <SpectatorCountBadge room={room} />}
      {screen}
    </>
  );
}
```

- [ ] **Step 4: 빌드 + lint**

Run: `npm run build --workspace client && npm run lint --workspace client`
Expected: 둘 다 성공.

- [ ] **Step 5: 수동 브라우저 검증**

로그인/구글 인증은 같은 오리진에서만 동작하므로 2567 포트로 빌드본을 서빙해서 테스트한다.

```bash
npm run sync-public
npm run dev:server
```

1. 브라우저 두 개(또는 시크릿 창 하나 + 일반 창 하나)로 각각 `http://localhost:2567` 접속, 로그인.
2. 한쪽에서 "방 만들기" → 관전 허용 체크된 채로(기본값) 방 생성, 1팀 방으로 만들어서 돼지/토끼 역할까지 채워 매치를 시작.
3. **세 번째 브라우저(또 다른 계정)** 로 방 목록을 열어 그 방이 "관전하기" 버튼으로 뜨는지 확인, 클릭해서 입장.
   - 기대 결과: 보드/팀 현황/채팅이 보이는 관전 화면이 뜨고, 우측 상단에 "👁 1" 배지가 보임. 배지 클릭 시 관전자 닉네임 모달이 뜸.
4. 관전자 쪽에서 채팅 입력 → 기대 결과: 매치 채팅에 `"닉네임 (관전): 메시지"` 형태로 표시(닉네임 뒤에 "(관전)"이 붙어서 보임).
5. 매치를 끝까지 진행해 종료시킨 뒤, 플레이어 쪽에서 재경기를 요청(나가기 버튼) → 기대 결과: 관전자 화면이 자동으로 방 목록 화면으로 돌아감(아무것도 안 눌러도). 플레이어들은 그대로 로비(역할 선택 화면)에 남음.
6. 방 만들기 모달에서 "관전 허용" 체크를 끄고 방을 만든 뒤 매치를 시작 → 다른 계정으로 그 방을 보면 방 목록에 "게임 중"(비활성 버튼)으로 뜨는지 확인.

- [ ] **Step 6: 커밋**

```bash
git add client/src/components/SpectatorCountBadge.tsx client/src/components/SpectatorCountBadge.module.css client/src/components/Game.tsx
git commit -m "$(cat <<'EOF'
게임 화면에 관전자 수 배지와 닉네임 목록 모달 추가

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```
