# 방 목록(공개방) + 로비 재접속 유예 설계

## 배경 / 목적

실제 EC2 배포로 친구들과 테스트하던 중 두 가지 문제가 드러났다:

1. **어느 큐에 들어와 있는지 모름**: 지금은 "온라인" 버튼을 누르면 `joinOrCreate("match")`로 아무
   열려있는 방에나 무작위로 꽂힌다. 4명이 동시에 접속하면 누가 어느 방에 들어갔는지 알 수 없고,
   방이 여러 개로 갈라지면(예: 3명은 방 A, 1명은 방 B) 서로 안 보이는데도 원인을 알 방법이 없다.
2. **로비 단계에 재접속 유예가 없음**: `server/src/rooms/MatchRoom.ts`의 `onLeave`가
   `this.state.phase === "playing"`일 때만 `allowReconnection()`을 시도한다. 모바일 네트워크는
   와이파이/LTE 전환, 화면 끄기 등으로 웹소켓이 순간적으로 끊기는 일이 흔한데, 로비(역할 선택
   대기) 단계에서 이런 순간 끊김이 발생하면 유예 없이 즉시 그 플레이어가 방에서 제거된다 —
   플레이어 본인은 (재연결이 되어) 정상이라고 착각하지만 다른 사람 화면에는 안 보이게 된다.
   실제 배포 서버 로그에서 `room ... has been disposed` / `reconnection token invalid or expired`
   에러가 반복 확인되어 재현됨.

## 해결 방향

**문제 1**: quick-join을 없애고 **방 목록(공개방) 화면**으로 대체한다. 누구나 방을 만들 수 있고,
만들어진 방은 목록에 실시간으로 노출되어 다른 사람이 골라서 들어갈 수 있다. 방 코드를 손으로
입력하거나 링크를 공유할 필요가 없다 — 목록에서 보고 클릭만 하면 됨.

**문제 2**: `onLeave`의 재접속 유예 조건에서 `phase === "playing"` 제한을 없애서, 로비 단계에서도
"게임 중" 단계와 동일하게 60초 유예를 준다.

## 화면 흐름

변경 전: `온라인` → `닉네임 입력` → *(자동으로 아무 방이나 join)* → `역할 선택`

변경 후: `온라인` → `닉네임 입력` → **`방 목록`(신규)** → `역할 선택`

- 방 목록 화면에 진입하면 `client.getAvailableRooms("match")`를 2초 간격으로 폴링해서 카드 목록을
  그린다. 각 카드: `"{방장 닉네임}의 방 (n/4)"`.
  - **주의**: "4명이 다 들어왔다"(`clients >= maxClients`)와 "게임이 실제로 시작됐다"(`room.locked`)는
    다른 상태다 — 역할을 아직 다 안 골랐으면 4명이 다 들어와 있어도 잠기지 않는다
    (`MatchRoom.maybeStartGame()`이 4개 역할 슬롯이 전부 찰 때만 `lock()`을 호출함). 그래서 두
    조건을 구분해서 표시한다:
    - `room.locked`이면 → "게임 중" 표시 + 입장 버튼 비활성화
    - 아직 안 잠겼지만 `clients >= maxClients`(사람은 다 찼는데 역할 선택 중)면 → "가득 참" 표시 +
      입장 버튼 비활성화 (어차피 Colyseus가 5번째 연결을 거부함)
    - 둘 다 아니면 → 평소처럼 "입장" 버튼 활성화
    목록에서 숨기지는 않는다 (사용자 결정: 어차피 못 들어가는 걸 굳이 숨기지 않아도 혼란 없음,
    2초마다 새로고침되니 방이 없어지면 자연히 사라짐).
  - 상단에 **"새 방 만들기"** 버튼 — 누르면 `client.create("match", { nickname })`으로 무조건 새
    방을 만들고 바로 역할 선택 화면으로 이동한다.
  - 카드의 "입장" 버튼 — `client.joinById(roomId, { nickname })`로 그 방에 들어가서 역할 선택
    화면으로 이동한다.
- 역할 선택 화면의 "나가기" 버튼은 지금처럼 완전히 앱을 나가는 게 아니라 **방 목록 화면으로
  돌아간다** (계속 다른 방을 고를 수 있어야 하므로) — 온라인 모드 자체를 나가는 것과는 별개.

## 서버 변경

`server/src/rooms/MatchRoom.ts`:

1. `onCreate(options)`에 방장 닉네임을 메타데이터로 저장 (방 목록 카드 표시용):

현재:
```ts
onCreate(options: MatchRoomOptions = {}) {
    if (options.turnDurationMs) this.turnDurationMs = options.turnDurationMs;
    ...
```

변경 후 (맨 앞에 메타데이터 설정 추가, `MatchRoomOptions`에 `nickname` 추가):
```ts
interface MatchRoomOptions {
  turnDurationMs?: number;
  nickname?: unknown;
}

...

onCreate(options: MatchRoomOptions = {}) {
    if (options.turnDurationMs) this.turnDurationMs = options.turnDurationMs;
    this.setMetadata({ hostNickname: sanitizeNickname(options.nickname) });
    ...
```

2. `onLeave`의 재접속 유예 조건에서 `phase === "playing"` 제한 제거:

현재:
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
```

변경 후:
```ts
async onLeave(client: Client, consented: boolean) {
    if (!consented) {
      try {
        await this.allowReconnection(client, RECONNECTION_GRACE_SECONDS);
        return;
      } catch {
        // grace period expired without a reconnect — fall through to removal.
      }
    }

    this.removePlayer(client.sessionId);
}
```

## 클라이언트 변경

- `client/src/colyseus.ts`: 지금의 `joinMatch()`(내부적으로 `joinOrCreate` 사용) 대신 방 목록
  화면에서 쓸 두 함수 추가 — 방 생성용, 방 입장용. 기존 재접속 토큰 저장/복원 로직(`saveReconnectionToken`
  등)은 두 경로 모두에서 동일하게 재사용한다.
- `client/src/components/RoomList.tsx`(신규): 목록 폴링 + 카드 렌더링 + "새 방 만들기" 버튼.
- `client/src/App.tsx`: `NicknameEntry` 다음 화면을 `RoomList`로 바꾸고, 방 선택/생성 완료 시점에
  기존 `ConnectedOnlineFlow`(역할 선택~게임)로 넘어가도록 흐름을 재구성한다. 역할 선택 화면의
  "나가기"가 `RoomList`로 돌아가도록 콜백을 연결한다.

## 스코프 제외

- 방 삭제/방장 위임 등 방 생명주기 관리 UI (방장이 나가도 방은 유지, 지금 로직 그대로)
- 비밀번호가 있는 비공개방 (전부 공개방)
- 방 목록 페이지네이션/검색 (친구 4명 규모 테스트라 불필요)
