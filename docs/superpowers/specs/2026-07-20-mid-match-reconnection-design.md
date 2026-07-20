# 게임 진행 중 재접속(Reconnection) 설계

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:writing-plans to turn this spec into an implementation plan.

**Goal:** 게임 진행 중(`playing` phase)에 실수로 새로고침하거나 탭/창을 껐다 켰을 때, 20초 안에 돌아오면 원래 자리(팀/역할)로 자동 재접속해서 이어서 플레이할 수 있게 한다.

**Architecture:** Colyseus의 내장 재접속 메커니즘(`Room.allowReconnection` / `Client.reconnect`)을 사용한다. 서버는 게임 진행 중의 비의도적 연결 끊김(`onLeave`의 `consented === false`)에 한해 20초 유예를 주고, 그 안에 같은 세션이 재접속하면 자리를 그대로 유지한다. 클라이언트는 매 입장/재접속 성공마다 `room.reconnectionToken`을 `localStorage`에 저장해두고, 앱이 켜질 때 저장된 토큰이 있으면 모드 선택 화면을 건너뛰고 자동으로 재접속을 시도한다.

**Tech Stack:** 서버 Colyseus(`MatchRoom.ts`), 클라이언트 colyseus.js + React(`App.tsx`, `colyseus.ts`).

## Global Constraints

- 재접속 유예는 **`playing` phase에서 비의도적으로 연결이 끊긴 경우만** 적용한다. 로비(`lobby`) 단계나 명시적 "나가기"(`consented === true`)는 지금처럼 즉시 자리를 비운다 — 이번 스코프 아님.
- 유예 시간은 기본 **20초**, 테스트에서 줄여 쓸 수 있도록 `MatchRoomOptions`에 옵션으로 뺀다 (기존 `turnDurationMs`/`countdownTickMs`와 같은 패턴).
- 재접속 토큰은 **`localStorage`**에 저장한다 (`sessionStorage` 아님 — 탭을 완전히 닫았다 새로 열어도 살아남아야 하는 요구사항 때문).
- 재접속 성공 시 matchChat에 기존 입장 메시지와 동일한 문구(`"OO님이 입장했습니다"`)를 띄운다. 연결이 끊긴 시점에는 아무 메시지도 띄우지 않는다 — 유예가 끝나 최종적으로 제거될 때만 기존 `"OO님이 퇴장했습니다"` 메시지가 뜬다(이미 구현되어 있음, 변경 없음).
- 앱을 열었을 때 저장된 토큰이 있으면 **자동으로** 재접속을 시도한다(사용자가 "온라인" 버튼을 다시 누를 필요 없음).

## 서버 설계 (`server/src/rooms/MatchRoom.ts`)

### 새 상태/옵션

```ts
const DEFAULT_RECONNECT_GRACE_SECONDS = 20;

interface MatchRoomOptions {
  // ...기존 필드들
  reconnectGraceSeconds?: number;
}

export class MatchRoom extends Room<MatchState> {
  // ...기존 필드들
  private reconnectGraceSeconds = DEFAULT_RECONNECT_GRACE_SECONDS;
```

`onCreate`에서 `if (options.reconnectGraceSeconds) this.reconnectGraceSeconds = options.reconnectGraceSeconds;` 로 기존 `turnDurationMs`/`countdownTickMs`와 동일하게 처리한다.

### `onLeave` 변경

현재 시그니처는 `async onLeave(client: Client)`인데, Colyseus가 실제로는 `onLeave(client, consented)`로 호출해준다(내부 `_onLeave`가 `code === Protocol.WS_CLOSE_CONSENTED`를 두 번째 인자로 넘김 — 명시적으로 `client.leave()`/`room.leave()`를 호출한 경우만 `true`, 새로고침/탭 닫힘/네트워크 끊김은 `false`). 이 두 번째 인자를 받도록 시그니처를 바꾸고, `playing` phase + 비의도적 끊김일 때만 재접속을 기다린다:

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

  if (this.state.phase === "playing" && !consented) {
    try {
      await this.allowReconnection(client, this.reconnectGraceSeconds);
      // 제한 시간 안에 재접속 성공 — 자리/팀/절구 전부 그대로 유지되어 있으므로
      // (removePlayer를 아예 호출하지 않았음) 입장 메시지만 다시 띄운다.
      const player = this.state.players.get(client.sessionId);
      if (player) this.pushChat(this.state.matchChat, "", `${player.nickname}님이 입장했습니다`);
      return;
    } catch {
      // 제한 시간 초과 — 아래로 흘러서 기존 제거 로직을 그대로 탄다.
    }
  }

  this.removePlayer(client.sessionId);
  await this.setMetadata({ players: this.rosterForMetadata() });
}
```

`removePlayer`는 변경 없음 — 유예 중에는 아예 호출되지 않으므로 `this.state.players`/팀 슬롯/`playerUserIds`가 전부 그대로 남아있고, 다른 클라이언트들 화면(TeamRosterPanel 등)에는 그 사이 아무 변화도 보이지 않는다.

`recordEvent(leave)` 로깅은 지금 위치(연결이 끊기는 즉시) 그대로 둔다 — 관리자 모니터링 로그는 재접속 성공 여부와 무관하게 "연결이 끊긴 사실"을 그대로 남기는 게 맞고, 이 부분은 이번 스코프에서 건드리지 않는다.

### `allowReconnection`가 실패(reject)하는 경우

- 유예 시간 초과
- 그 사이 다른 이유로 방이 사라짐

두 경우 다 `try/catch`로 잡아서 기존 제거 흐름으로 자연스럽게 이어진다.

## 클라이언트 설계

### 토큰 저장/조회 (`client/src/colyseus.ts`)

```ts
const RECONNECT_TOKEN_KEY = "songpyeon:reconnectToken";

function storeReconnectToken(room: Room<unknown>) {
  if (room.reconnectionToken) localStorage.setItem(RECONNECT_TOKEN_KEY, room.reconnectionToken);
}

export function clearReconnectToken(): void {
  localStorage.removeItem(RECONNECT_TOKEN_KEY);
}

export function hasStoredReconnectToken(): boolean {
  return localStorage.getItem(RECONNECT_TOKEN_KEY) !== null;
}
```

`JoinSpec`에 새 variant 추가:

```ts
export type JoinSpec =
  | { type: "create"; teamCount: number; roomTitle: string }
  | { type: "joinById"; roomId: string }
  | { type: "reconnect" };
```

`connectToMatch`가 세 갈래를 처리하고, 성공한 모든 경로에서 새 토큰을 저장한다. `reconnect` 경로가 실패하면 못 쓰게 된 토큰을 지운다(다음 앱 실행 때 똑같이 실패하는 토큰으로 계속 재시도하지 않도록):

```ts
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

`leaveMatch()`에 `clearReconnectToken()` 호출을 추가한다(의도적으로 나갈 때는 재접속 대상이 아니므로).

### 앱 시작 시 자동 진입 (`client/src/App.tsx`)

`OnlineFlow`의 `joinSpec` 초기값과, `App`의 `mode` 초기값을 저장된 토큰 유무에 따라 결정한다:

```ts
// App
const [mode, setMode] = useState<Mode>(() => (hasStoredReconnectToken() ? "online" : "select"));

// OnlineFlow
const [joinSpec, setJoinSpec] = useState<JoinSpec | null>(() =>
  hasStoredReconnectToken() ? { type: "reconnect" } : null,
);
```

이러면 토큰이 있을 때 모드 선택 화면 없이 바로 `OnlineFlow`로 들어가고, 로그인 확인(`fetchMe`)을 거친 뒤(이미 로그인돼 있으면 즉시 통과) `joinSpec`이 이미 `"reconnect"`이므로 방 목록 없이 바로 `ConnectedOnlineFlow` → `useMatchRoom({type:"reconnect"})`로 이어진다.

로그인이 안 돼 있던 경우(세션 만료 등)에도 자연스럽게 동작한다 — `GoogleLoginScreen`/`NicknameEntry`를 먼저 통과시키고, 통과된 뒤에는 `joinSpec`이 이미 세팅돼 있으니 그대로 재접속을 시도한다.

`useMatchRoom`의 에러 메시지를 spec 종류에 따라 다르게 보여준다(재접속 실패는 "방이 꽉 찼다"는 기존 문구가 안 맞음):

```ts
setErrorMessage(
  spec.type === "reconnect" ? "재접속 시간이 지났어요" : "입장할 수 없어요 (방이 꽉 찼거나 이미 시작됐을 수 있어요)",
);
```

실패 화면의 "방 목록으로" 버튼은 그대로 `onExit` → `setJoinSpec(null)`을 타므로, 재접속 실패 시 자연스럽게 평소 방 목록 화면으로 떨어진다.

## 데이터 흐름 요약

1. 정상적으로 방에 입장/생성/재접속 성공 → `room.reconnectionToken`을 `localStorage`에 저장.
2. 게임 도중 새로고침/탭 닫힘 → WebSocket이 비정상 종료 → 서버 `onLeave(client, false)` → `playing` phase면 20초 대기(자리 그대로 유지, 아무 메시지 없음).
3-a. 20초 안에 앱이 다시 열림 → 저장된 토큰으로 자동 재접속 시도 → 성공 → 서버가 같은 세션으로 인식 → matchChat에 "OO님이 입장했습니다" → 클라이언트는 게임 화면으로 복귀(팀/역할/절구 그대로).
3-b. 20초 안에 못 돌아옴 → 서버가 기존 로직대로 자리 제거 + "OO님이 퇴장했습니다" → 다음에 앱을 열어도 재접속 시도는 실패(토큰 무효) → 토큰 삭제 → 평소 방 목록 화면.
4. 의도적으로 "나가기" 클릭 → 토큰 즉시 삭제 → 서버는 `consented=true`라 유예 없이 즉시 제거(기존 동작 그대로).

## 스코프 밖 (이번에 안 함)

- 로비(`lobby`) 단계 재접속 — 지금도 자유롭게 역할을 다시 고를 수 있어 잃을 게 없다는 기존 전제 유지.
- 연결이 끊긴 순간 다른 플레이어에게 별도 "연결 끊김" 알림 — 최종 결과(재입장 또는 퇴장)만 알림.
- 재접속 유예 중 턴 타이머/카운트다운을 멈추는 것 — 게임 흐름은 그대로 진행되고, 자리만 비워두지 않는다.

## 테스트 전략

- 서버: `server/src/rooms/MatchRoom.test.ts`에 기존 패턴(`@colyseus/testing`)으로 추가.
  - 연결 끊김 시뮬레이션: 클라이언트 쪽에서 `client.leave(false)` (비의도적 종료를 흉내).
  - 재접속 시뮬레이션: `colyseus.sdk.reconnect(token)` (`ColyseusTestServer`가 제공, `Client['reconnect']`와 동일 타입).
  - 검증 항목: (a) 유예 중엔 팀 슬롯/플레이어가 그대로 남아있음, (b) 유예 시간 안에 재접속하면 matchChat에 입장 메시지가 뜨고 자리가 그대로임, (c) 유예 시간을 넘기면 기존과 동일하게 제거+퇴장 메시지, (d) 로비 단계에서는 재접속 유예를 안 줌(즉시 제거), (e) 의도적 leave(`consented=true`)는 재접속 유예 없이 즉시 제거.
  - `reconnectGraceSeconds`를 짧게(예: 50ms) 넘겨서 테스트 속도 확보.
- 클라이언트: 이 프로젝트는 client 쪽 유닛 테스트가 없는 구조(서버만 TDD 대상, `CLAUDE.md` 참고) — `tsc -b && vite build` + `oxlint` 통과를 확인하고, 실제 브라우저로 골든 패스(새로고침 후 재접속 성공)와 실패 케이스(유예 시간 초과 후 재접속 실패)를 수동으로 확인한다.
