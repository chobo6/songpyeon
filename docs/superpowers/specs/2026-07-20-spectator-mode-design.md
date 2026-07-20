# 관전 모드 설계

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:writing-plans to turn this spec into an implementation plan.

**Goal:** 이미 시작된(진행 중인) 매치에 제3자가 관전자로 입장할 수 있게 한다. 화면에 관전자 수를 표시하고 클릭하면 닉네임 목록을 볼 수 있으며, 매치가 끝나 플레이어들이 대기실(재경기 로비)로 돌아갈 때 관전자는 자동으로 방 목록으로 돌아간다. 관전자 채팅에는 닉네임 뒤에 "(관전)"이 붙는다. 방을 만들 때 관전 허용 여부를 host가 선택할 수 있다(기본값: 허용).

**Architecture:** 서버는 실제 플레이어(`MatchState.players`)와 완전히 분리된 `MatchState.spectators` Map을 신설한다. `onJoin`은 방의 `phase`를 보고 로비 중이면 기존 플레이어 합류 로직을, 게임 진행 중이면(그리고 해당 방이 관전을 허용하면) 관전자 합류 로직을 탄다. Colyseus의 `maxClients` 기반 입장 차단이 `joinById`에도 프로토콜 레벨로 적용되기 때문에, `maxClients` 자체는 넉넉하게 잡고 "플레이어 자리가 실제로 다 찼는지"는 별도 필드로 직접 관리한다. 관전자가 로비로 강제로 끌려 들어가지 않도록, 매치 종료 후 재경기로 `phase`가 다시 `"lobby"`로 바뀌는 순간을 클라이언트가 감지해 관전자만 자동으로 방을 나가게 한다.

**Tech Stack:** 서버 Colyseus(`MatchRoom.ts`, `MatchState.ts`), 클라이언트 colyseus.js + React(`Game.tsx`, `RoomList.tsx`, `CreateRoomModal.tsx`, `colyseus.ts`).

## Global Constraints

- 관전은 **매치가 이미 시작된(`phase === "playing"`) 방에만** 적용된다. 로비 단계 입장은 지금과 완전히 동일(정상적으로 팀/역할을 고르는 플레이어로 합류).
- 방을 만들 때 관전 허용 여부를 선택할 수 있고 **기본값은 허용**이다.
- 관전 인원 상한은 두지 않는다(사실상 무제한).
- 관전자 입장/퇴장 시 매치 채팅에 안내 메시지를 **띄우지 않는다**.
- 관전자가 보낸 채팅 메시지는 matchChat에 표시되며, 닉네임 뒤에 **"(관전)"**이 붙는다.
- 매치가 끝나 재경기로 `phase`가 `"lobby"`로 돌아가면, 관전자는 **자동으로 방을 나가 방 목록 화면으로 돌아간다**(대기실 로비에 남지 않음).
- 화면 우측 상단에 관전자 수를 표시하고, 클릭하면 관전자 닉네임 목록을 모달로 보여준다.
- 관전자는 오늘 만든 재접속(reconnection) 유예 대상이 아니다 — 연결이 끊기면 그냥 다시 관전 입장하면 된다.

## 서버 설계

### `MatchState.ts` — 관전자 스키마 추가

```ts
export class SpectatorState extends Schema {
  @type("string") sessionId: string = "";
  @type("string") nickname: string = "";
}
```

`MatchState`에 필드 추가:

```ts
@type({ map: SpectatorState }) spectators = new MapSchema<SpectatorState>();
```

### `MatchRoom.ts` — 입장 흐름

**`onCreate`**: 방 생성 옵션에 `allowSpectators?: unknown` 추가(기본 `true`, `false`가 명시적으로 온 경우만 거부). `this.maxClients`를 지금처럼 `teamCount * 2`로 두지 않고, 관전자까지 여유롭게 받을 수 있도록 큰 상수(`MAX_CLIENTS_WITH_SPECTATORS = 1000`)로 설정한다. 대신 "플레이어 자리가 실제로 다 찼는지"는 새 필드 `this.playerCapacity = teamCount * 2`로 직접 관리한다. `allowSpectators`는 방 메타데이터에도 한 번 기록해(불변) 방 목록 API가 노출할 수 있게 한다.

**왜 `maxClients`를 그대로 못 쓰는가**: Colyseus는 `hasReachedMaxClients()`(현재 접속 인원 + 예약된 좌석 수 ≥ maxClients)를 `joinById`를 포함한 모든 입장 요청에서 체크한다. 이건 방 목록에 노출되는 `locked` 플래그(매치메이킹 쿼리·UI용 힌트일 뿐 실제 입장을 막지 않음)와는 별개의, 프로토콜 레벨의 진짜 차단이다. 지금처럼 `maxClients = teamCount * 2`로 두면 방이 꽉 찬 순간부터 관전자의 `joinById` 자체가 서버 응답 없이 거부된다 — `onJoin`에 아무리 관전 로직을 넣어도 그 코드에 도달하지 못한다.

**`onJoin`**:

```ts
async onJoin(client: Client, _options: MatchRoomOptions = {}) {
  if (this.state.players.has(client.sessionId) || this.state.spectators.has(client.sessionId)) return;

  if (this.state.phase === "lobby") {
    if (this.state.players.size >= this.playerCapacity) {
      throw new Error("방이 가득 찼습니다.");
    }
    // ...기존 플레이어 합류 로직 그대로...
    return;
  }

  // phase === "playing" — 관전자로 합류
  if (!this.allowSpectators) {
    throw new Error("이 방은 관전을 허용하지 않습니다.");
  }
  const spectator = new SpectatorState();
  spectator.sessionId = client.sessionId;
  spectator.nickname = client.auth?.nickname ?? "관전자";
  this.state.spectators.set(client.sessionId, spectator);
}
```

**`onLeave`**: 맨 앞에서 관전자인지 먼저 확인해 분기 — 관전자면 재접속 유예 없이 즉시 `spectators`에서 제거하고 끝(플레이어 쪽 로직·이벤트 로그와 완전히 별개 경로).

```ts
async onLeave(client: Client, consented: boolean) {
  if (this.state.spectators.has(client.sessionId)) {
    this.state.spectators.delete(client.sessionId);
    return;
  }
  // ...기존 플레이어 onLeave 로직 그대로(재접속 유예 포함)...
}
```

**`handleSendChat`**: 플레이어가 아니면 관전자인지 확인해서 matchChat에 `"닉네임 (관전)"`으로 기록.

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
    // 관전자는 게임 중(matchChat)에만 존재할 수 있음 — lobby로 넘어가면 클라이언트가
    // 자동으로 방을 나가므로 lobbyChat에 관전자가 메시지를 보낼 수 있는 경우 자체가 없다.
    this.pushChat(this.state.matchChat, `${spectator.nickname} (관전)`, text);
  }
}
```

**`handleRematch`**: 서버 쪽은 변경 없음(관전자를 강제로 내쫓는 처리는 클라이언트가 `phase` 전환을 감지해서 함 — 아래 클라이언트 설계 참고). `this.state.spectators`는 손대지 않아도 되는데, 어차피 각 관전자의 클라이언트가 스스로 `room.leave()`를 호출해 나가면서 서버 `onLeave`가 자연히 지워주기 때문.

### 방 목록(`/api/rooms`)이 보여주는 인원 수 보정

`maxClients`를 인위적으로 크게 잡았기 때문에, 지금처럼 Colyseus가 주는 `r.clients`/`r.maxClients`를 그대로 노출하면 방 목록에 "2/1000"처럼 엉뚱한 숫자가 뜬다. 방 메타데이터에 이미 있는 `players`(플레이어 로스터 배열)의 길이와, 새로 기록해둘 `playerCapacity`를 대신 사용한다.

`createServer.ts`의 `/api/rooms` 라우트:

```ts
const metadata = r.metadata as {
  hostNickname?: string;
  roomTitle?: string;
  players?: { sessionId: string; nickname: string }[];
  playerCapacity?: number;
  allowSpectators?: boolean;
} | undefined;
return {
  roomId: r.roomId,
  clients: metadata?.players?.length ?? r.clients,
  maxClients: metadata?.playerCapacity ?? r.maxClients,
  locked: r.locked,
  hostNickname: metadata?.hostNickname ?? "?",
  roomTitle: metadata?.roomTitle ?? "이름 없는 방",
  allowSpectators: metadata?.allowSpectators ?? true,
};
```

## 클라이언트 설계

### 방 만들기 (`CreateRoomModal.tsx`, `colyseus.ts`)

체크박스 "관전 허용"(기본 체크) 추가. `JoinSpec`의 `"create"` variant에 `allowSpectators: boolean` 추가, `client.create("match", { teamCount, roomTitle, allowSpectators })`로 전달.

### 방 목록 (`RoomList.tsx`, `colyseus.ts`)

`RoomListEntry`에 `allowSpectators: boolean` 추가. 버튼 로직:

```tsx
{room.locked && room.allowSpectators ? "관전하기" : room.locked ? "게임 중" : "입장"}
```

버튼은 `room.locked && !room.allowSpectators`일 때만 비활성화. 클릭 시 호출하는 함수는 지금과 동일한 `onJoinRoom(room.roomId)` — 플레이어로 들어갈지 관전자로 들어갈지는 서버가 그 시점의 `phase`를 보고 알아서 결정하므로, 클라이언트가 "이건 관전 입장이야"를 따로 표시해서 보낼 필요가 없다.

### 관전자 강제 퇴장 (`Game.tsx`)

```tsx
export function Game({ room, clockOffsetMs, onLeave, onExit }: {...}) {
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

  return (
    <>
      <BgmPlayer />
      {phase === "playing" && <SpectatorCountBadge room={room} />}
      {screen}
    </>
  );
}
```

### 진짜 관전자 화면 재사용 (`SpectatorScreen.tsx`)

기존 `SpectatorScreen`은 "탈락했거나 지금 내 팀 차례가 아닌 실제 참가자" 화면이었는데, `me`가 없는(=`players`에 없는) 진짜 관전자가 들어와도 지금 로직(`myTeam = teams.find(t => t.id === me?.teamId)` → `undefined` → `eliminated: false`)이 자연스럽게 맞아떨어져서 보드·팀 현황·채팅을 그대로 보여줄 수 있다. 유일하게 갈라져야 하는 지점은 매치 종료 시 "나가기" 버튼의 동작 — 실제 참가자에게는 "나가기"가 곧 "재경기 요청"이지만, 관전자는 재경기를 요청할 자격이 없으므로 그냥 나가야 한다.

```tsx
export function SpectatorScreen({
  room, activeTeam, eliminated, isSpectator, clockOffsetMs, onLeave,
}: { ...; isSpectator: boolean; ... }) {
  ...
  function handleLeaveClick() {
    if (matchOver && !isSpectator) {
      room.send("rematch");
      return;
    }
    onLeave();
  }
  ...
}
```

### 관전자 수 배지 + 모달 (`SpectatorCountBadge.tsx`, 신규)

`Game.tsx`에서 `phase === "playing"`일 때만 렌더링. 화면 우측 상단 고정 위치, `room.state.spectators.size`를 숫자로 표시. 클릭하면 `[...room.state.spectators.values()].map(s => s.nickname)`을 나열하는 모달을 띄운다(`RankingModal.tsx`와 같은 오버레이+카드 패턴 재사용).

### 관전자 채팅 표시

서버가 이미 `"닉네임 (관전)"`을 통짜 문자열로 `ChatMessage.nickname`에 넣어 보내므로, `ChatBox.tsx`는 **변경 없음** — 지금처럼 `m.nickname`을 그대로 렌더링하기만 하면 된다.

## 데이터 흐름 요약

1. 방장이 "관전 허용" 체크(기본 체크됨) 상태로 방 생성 → 서버가 메타데이터에 `allowSpectators` 기록.
2. 매치가 시작(`phase: "playing"`)되면 방 목록에서 그 방은 `locked: true`. `allowSpectators`가 true면 "관전하기" 버튼(활성), false면 "게임 중"(비활성).
3. 제3자가 "관전하기" 클릭 → `joinById` → 서버 `onJoin`이 `phase === "playing"`을 보고 `spectators`에 추가.
4. 관전자 화면에 보드/팀 현황/채팅 + 우측 상단 관전자 수 배지가 뜬다. 채팅을 보내면 `"닉네임 (관전)"`으로 표시.
5. 매치 종료 → 플레이어가 재경기 요청 → 서버가 `phase`를 `"lobby"`로 되돌림 → 관전자 클라이언트가 이 전환을 감지해 자동으로 `room.leave()` → 방 목록 화면으로 복귀. 플레이어들은 그대로 로비에 남아 재경기 준비.

## 스코프 밖 (이번에 안 함)

- 관전자 입장/퇴장 채팅 알림 — 관리자 페이지의 최근 입장/퇴장 로그(`admin/eventLog.ts`, `recordEvent`)에도
  동일하게 관전자는 기록하지 않는다. 실제 플레이어 접속 현황을 추적하기 위한 로그이므로, 관전자까지
  섞이면 오히려 신호가 흐려진다 — 필요해지면 별도 요청으로 다룬다.
- 관전자에 대한 재접속(reconnection) 유예 — 연결이 끊기면 그냥 다시 들어오면 됨
- 관전 인원 상한
- 방 목록에 관전자 수 노출(게임 화면 안에서만 보임)

## 테스트 전략

- 서버: `MatchRoom.test.ts`에 기존 패턴(`@colyseus/testing`, `connectAsUser`)으로 추가.
  - 로비 단계에서는 지금처럼 관전 없이 정상적으로 플레이어로 합류.
  - `phase: "playing"`일 때 관전 허용 방에 새 클라이언트가 `joinById`로 정상 입장해 `spectators`에 들어가는지.
  - `allowSpectators: false`인 방은 진행 중일 때 입장이 거부되는지.
  - 관전자가 보낸 채팅이 `"닉네임 (관전)"`으로 matchChat에 들어가는지, lobbyChat엔 안 들어가는지.
  - 관전자가 나가도(consented든 아니든) 즉시 `spectators`에서 제거되고, 팀/플레이어 쪽에는 아무 영향이 없는지.
  - `/api/rooms`가 노출하는 `clients`/`maxClients`가 관전자 수와 무관하게 실제 플레이어 수/정원만 반영하는지(→ `createServer.ts` 관련 로직은 HTTP 레벨이라 별도 통합 테스트 필요 시 검토).
- 클라이언트: 이 프로젝트는 client 쪽 유닛 테스트가 없는 구조 — `tsc -b && vite build` + `oxlint` 통과 확인 후, 실제 브라우저로 골든 패스(진행 중인 방에 관전 입장 → 배지/모달 확인 → 채팅 "(관전)" 표시 확인 → 매치 종료 후 재경기 시 자동으로 방 목록으로 돌아오는지)를 확인한다.
