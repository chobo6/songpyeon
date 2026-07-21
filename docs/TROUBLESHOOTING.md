# 트러블슈팅 기록

> 개발 중 발생한 주요 버그와 해결 과정을 기록한 문서입니다.

---

## #1 @colyseus/testing 룸 테스트가 vitest에서 알 수 없는 IPC 에러로 실패

### 증상

`@colyseus/testing`의 `boot()`/`createRoom()`을 쓰는 룸 통합 테스트가 vitest에서 실행하면 항상 이런 에러로 죽음:

```
TypeError: The first argument must be of type string or an instance of Buffer, ArrayBuffer, ...
  at Buffer.from
  at deserialize ...tinypool/dist/index.js
```

같은 코드를 vitest 없이 `tsx script.mjs`로 직접 실행하면 정상 동작(또는 다른, 더 명확한 에러)이 나옴 — vitest의 워커/포크 프로세스 IPC 리포팅 자체가 실제 원인을 감싸서 죽이고 있었음.

### 원인 분석

두 가지가 겹친 문제였음.

**1) dual-package hazard**: server 패키지가 `"type": "commonjs"`였는데, `colyseus`/`@colyseus/core`는 CJS 경로로 로드되고 `@colyseus/testing`은 내부적으로 ESM 빌드를 통해 `@colyseus/core`를 로드함. Node가 이 둘을 **서로 다른 모듈 인스턴스**로 취급하면서, `@colyseus/core`의 모듈 레벨 `matchMaker` 싱글턴(룸 정의를 들고 있음)이 두 벌 생김. `gameServer.define("match", MatchRoom)`으로 등록한 룸이 `@colyseus/testing`이 조회하는 쪽에서는 안 보여서 `"room name not defined"` 에러가 남 — 이걸 vitest 없이 순수 `tsx` 스크립트로 실행해서 진단함.

**2) vitest 자체 버그**: 위 문제를 ESM 전환으로 고친 뒤에도, vitest `^2.1.0`(실제 설치 2.1.9)이 Node 24.12.0 + 포크 프로세스 조합에서 IPC 직렬화 버그가 있었음.

### 해결

1. server 패키지를 `"type": "module"`로 전환, `tsconfig.json`을 `module: "ESNext"` / `moduleResolution: "Bundler"`로 변경 (소스는 이미 `import`/`export` 문법이라 코드 수정은 불필요).
2. vitest를 `^4.1.0`으로 업그레이드.
3. `server/vitest.config.ts`에 `pool: "forks"` 설정 (dual-package hazard와는 별개로, 실제 네트워크 소켓을 쓰는 테스트는 워커 스레드보다 포크가 안전함).

### 관련 파일
- `server/package.json` — `type: module`, vitest 버전
- `server/tsconfig.json` — module/moduleResolution
- `server/vitest.config.ts` — pool 설정
- `server/src/index.ts`, `server/src/createServer.ts` — ESM 전환에 맞춰 `Server.listen()` 방식으로 통일

---

## #2 룸 통합 테스트에서 연속 버튼 입력 시 자체 턴 타이머와 경합해 타임아웃

### 증상

`server/src/rooms/MatchRoom.test.ts`에서 18개 버튼을 연속으로 누르는 테스트가 vitest 기본 타임아웃(5000ms)을 넘겨 실패.

### 원인 분석

`colyseus.createRoom(...)`가 반환하는 `room`은 **서버 사이드 Room 인스턴스 그 자체**임 (`ColyseusTestServer.createRoom` → `matchMaker.createRoom` → `getLocalRoomById`). 클라이언트 동기화 사본이 아니라 라이브 메모리라서, 매 프레스마다 `room.waitForNextPatch()`로 기다릴 필요가 없는데도 그렇게 짜여 있었음. `waitForNextPatch()`는 Colyseus의 (스로틀링된) 패치 브로드캐스트 주기를 기다리는 것이라, 18번 반복하면 누적 지연이 테스트용 짧은 턴 시간(500ms)을 넘어버려서 턴이 자체 타이머로 먼저 끝나버리고, 그 다음 프레스들이 새 턴/새 시퀀스를 상대로 계속 어긋나는 상태가 됨.

### 해결

`waitForNextPatch()` 대신 `onMessage` 핸들러가 처리될 정도의 짧은 `setTimeout` 기반 `flush()`로 교체. 서버 상태는 직접 읽으므로 패치 브로드캐스트를 기다릴 이유가 애초에 없었음.

### 관련 파일
- `server/src/rooms/MatchRoom.test.ts`

---

## #3 클라이언트 첫 렌더에서 `room.state.players`가 `undefined`라 크래시

### 증상

4개 브라우저 탭으로 실제 접속 테스트 시, `Game` 컴포넌트가 `Cannot read properties of undefined (reading 'get')` 에러로 크래시. React 에러 바운더리가 없어서 트리 전체가 사라지고, 이후 어떤 버튼도 다시 나타나지 않음.

### 원인 분석

`client.joinOrCreate("match")` 프로미스가 resolve된 시점은 룸 입장 핸드셰이크가 끝났다는 의미일 뿐, `room.state`의 필드가 전부 디코딩됐다는 보장이 아님. 초기 전체 상태는 별도 패치로 조금 뒤에 도착함. `useMatchRoom.ts`가 `.then()` 콜백 안에서 곧바로 `setRoom(joined)` + `setStatus("connected")`를 호출해 `Game`을 렌더링했는데, 이 시점에 `room.state.phase`는 `undefined`(아직 "lobby" 문자열이 아님), `room.state.players`도 아직 비어있는 게 아니라 **존재 자체가 안 된 상태**였음.

`Game.tsx`에서 `console.log`로 직접 찍어서 확인:
```
DEBUG Game render {phase: undefined, hasState: true, hasPlayers: false, sessionId: ...}
```

### 해결

`joinOrCreate()` resolve 직후가 아니라, **첫 `onStateChange` 콜백을 받은 뒤에야** `status`를 `"connected"`로 바꾸도록 훅을 수정. 그 전까지는 연결 중 화면을 유지.

```typescript
// client/src/game/useMatchRoom.ts
joined.onStateChange(() => {
  if (!hasReceivedState) {
    hasReceivedState = true;
    setRoom(joined);
    setStatus("connected");
  } else {
    forceRender();
  }
});
```

### 관련 파일
- `client/src/game/useMatchRoom.ts`

---

## #4 React StrictMode의 개발 모드 이중 연결로 `maxClients` 방이 조기 마감, 플레이어가 다른 방으로 분산

### 증상

4개 브라우저 탭으로 순차 접속 + 역할 선택까지 마쳤는데도 게임이 시작되지 않음. 각 플레이어 화면에 보이는 "돼지 N/2 · 토끼 N/2" 카운트가 서로 일치하지 않음 (어떤 탭은 "돼지 2/2", 다른 탭은 "돼지 0/2"). 서버 로그로 확인해보니 같은 4개 탭인데 방(room)이 두 개 생성되어 있었음.

### 원인 분석

React 18/19의 `<StrictMode>`는 개발 모드에서 effect를 "마운트 → 클린업 → 재마운트"로 이중 실행함. `useMatchRoom.ts`의 `useEffect`가 매번 `client.joinOrCreate("match")`를 새로 호출하고 있었는데:

1. 첫 번째(가짜) effect가 `joinOrCreate()`를 호출 — 네트워크 요청이 실제로 서버에 도달해 좌석 하나를 (짧게) 점유함.
2. 클린업이 거의 즉시 실행되며 `disposed = true`로 표시하지만, 이건 **비동기 콜백 안에서만** 체크되는 플래그라 이미 서버로 나간 join 요청 자체를 취소하지는 못함.
3. `joinOrCreate()`가 나중에 resolve되면 `disposed`를 보고 `.leave()`를 호출하긴 하지만, 그 사이 서버는 이미 이 클라이언트를 정식으로 받아들인 뒤였음.
4. 두 번째(진짜) effect가 또 `joinOrCreate()`를 호출해 사실상 탭 하나당 최대 2개의 실제 연결 시도가 발생.

`maxClients: 4`인 방에서 4개 탭 × (많으면) 2번 연결 = 최대 8번의 연결 시도가 거의 동시에 몰리면서, 방 하나가 (가짜+진짜가 섞여) 4석을 먼저 채워버리고 남은 탭은 새 방으로 밀려남.

이건 프로덕션 빌드에서는 발생하지 않는 현상(StrictMode는 dev 전용 이중 호출)이지만, 실제로 `npm run dev`로 여러 탭을 켜서 수동 테스트할 때도 그대로 재현되므로 테스트 스크립트만 우회하지 않고 근본적으로 고침.

### 해결

join 프로미스를 **컴포넌트/ref가 아니라 모듈 스코프**에 캐싱해서, StrictMode의 두 effect 호출이 같은(이미 진행 중이거나 완료된) 연결을 공유하도록 함:

```typescript
// client/src/colyseus.ts
let roomPromise: Promise<Room<unknown>> | null = null;

export function joinMatch<T>(): Promise<Room<T>> {
  if (!roomPromise) {
    roomPromise = client.joinOrCreate<T>("match") as Promise<Room<unknown>>;
  }
  return roomPromise as Promise<Room<T>>;
}
```

`useMatchRoom.ts`는 이제 `client.joinOrCreate(...)` 대신 `joinMatch()`를 호출하고, 클린업에서 더 이상 `.leave()`를 호출하지 않음(가짜 언마운트 때 진짜 연결을 끊어버리는 걸 방지).

### 관련 파일
- `client/src/colyseus.ts`
- `client/src/game/useMatchRoom.ts`

---

## #5 팀 탈락 후에도 매치를 계속 진행하게 바꾸자, 모든 팀이 탈락하면 유령 턴이 무한 생성됨

### 증상

한 팀이 탈락해도 매치를 끝내지 않고 생존 팀이 계속 진행하도록 바꾼 뒤(§`docs/superpowers/specs/2026-07-14-elimination-continue-design.md`), 브라우저에서 4개 탭을 전부 방치해 양 팀이 동시에 탈락하는 상황을 재현했더니 서버가 죽은 방에 계속 새 턴을 생성하며 멈추지 않음.

### 원인 분석

`rotation.ts`의 `nextActiveTeamIndex(teams, currentIndex)`는 건너뛸 수 있는(탈락하지 않은) 팀을 순회해서 찾는데, **모든 팀이 탈락하면 아무것도 못 찾고 `currentIndex`를 그대로 반환**하는 폴백이 있음. `MatchRoom.ts`의 `advanceToNextTurn()`은 이 반환값을 확인 없이 항상 `this.startTurn()`을 호출했기 때문에, 이미 전멸한 방에서도 4초 타이머 → `onTurnTimerExpired` → `advanceToNextTurn` → 다시 `startTurn`이 무한 반복됨 (매번 새 랜덤 시퀀스를 만들며 CPU를 계속 소모).

### 해결

`advanceToNextTurn()`에서 `nextActiveTeamIndex`가 반환한 인덱스의 팀이 이미 탈락 상태면 `startTurn()`을 호출하지 않고 그대로 멈추도록 가드 추가. 회귀 테스트는 `turnEndsAt`(오직 `startTurn()`에서만 갱신됨)이 더 이상 바뀌지 않는지로 검증 — `cursor`/`turnOutcome`은 매 턴 리셋되는 값이라 "멈춤"과 "계속 도는데 우연히 같은 값" 상태를 구분하지 못함.

### 관련 파일
- `server/src/rooms/MatchRoom.ts` — `advanceToNextTurn()`
- `server/src/rooms/MatchRoom.test.ts` — "the room freezes once every team is eliminated" 테스트

---

## #6 "나가기" 클릭 직후 재입장이 방금 나간 그 방에 다시 매칭되어 에러 화면에 멈춤

### 증상

탈락한 팀이 "나가기" 버튼을 누르면 방을 나가고 새 매치에 재참가해야 하는데, 실제로는 클라이언트가 `"server connection: error"` 화면에 멈춤. 콘솔에는 `ServerError: Match already in progress`.

### 원인 분석

게임 시작 시 `this.maxClients = this.clients.length`로 방을 "꽉 찬 것"처럼 보이게 해서 `joinOrCreate` 매치메이킹 후보에서 제외시켰는데, 이건 Colyseus 내부적으로 **`maxClients` 도달로 인한 암묵적 잠금**일 뿐이었음. `@colyseus/core`의 `_decrementClientCount`는 클라이언트가 나가면 `#_maxClientsReached && !_lockedExplicitly`일 때 자동으로 `unlock()`을 호출함 — 즉 탈락자가 나가는 바로 그 순간 방이 다시 매치메이킹 풀에 노출됨. 이 타이밍에 클라이언트가 곧바로 `joinMatch()`(새 `joinOrCreate`)를 호출하면 방금 나간 그 방에 재매칭되고, `onJoin`의 `phase !== "lobby"` 가드에 거부당해 join이 실패함.

### 해결

`maybeStartGame()`에서 `this.lock()`을 명시적으로 호출. 인자 없이 호출하면 `_lockedExplicitly = true`로 표시되어 위 자동 unlock 로직(`!_lockedExplicitly` 조건)을 타지 않게 됨 — `maxClients`는 `joinById` 같은 직접 접근에 대한 2차 방어로 남겨둠.

### 관련 파일
- `server/src/rooms/MatchRoom.ts` — `maybeStartGame()`
- `server/src/rooms/MatchRoom.test.ts` — "joinOrCreate matchmaking does not route a fresh client..." 테스트

---

## #7 `display:flex` 부모 안의 버튼 그리드가 점처럼 작게 렌더링됨

### 증상

`ButtonPanel`을 단색 원 대신 캐릭터 토큰 이미지로 바꾸면서 `.panel`에 `display:grid; grid-template-columns: repeat(N, 1fr)`을 쓰고 각 버튼에 `width: 100%`를 줬는데, 브라우저에서 실제로 보면 버튼이 의도한 크기(약 5rem)가 아니라 점처럼 작게 나옴.

### 원인 분석

`.panel`의 부모(`PlayingScreen.module.css`의 `.wrap`)가 `display:flex; flex-direction:column; align-items:center`임. flex의 cross-axis(`align-items:center`)에서는 자식이 기본적으로 **shrink-to-fit**되므로, `.panel`에 `max-width`만 있고 명시적 `width`가 없으면 grid 자체가 "정해진 너비"를 못 받고, `1fr` 컬럼들이 콘텐츠 기준 최소 크기로 쪼그라듦. 버튼의 `width:100%`는 "쪼그라든 컬럼의 100%"라서 결과적으로 아주 작아짐.

### 해결

`.panel`에 `width: 100%`를 `max-width`와 함께 명시. flex 자식에게 실제로 채울 너비를 줘야 grid의 `1fr` 트랙이 의도대로 분배됨.

### 관련 파일
- `client/src/components/ButtonPanel.module.css`

---

## #8 로비 재접속 유예를 추가하자, 게임 시작 시 방 정원이 실제 연결 수보다 낮게 영구 고정됨

### 증상

방 목록에서 실사용 중 "홍바들의 방"이 "1/3 게임중"으로 멈춘 채 아무도 못 들어오는 상태로 보고됨.

### 원인 분석

`maybeStartGame()`이 게임 시작 시 `this.maxClients = this.clients.length`로 그 순간의 실제 연결 수를
방 정원으로 고정하는 코드가 있었음. 원래는 4명이 역할을 다 고른 시점엔 `this.clients.length`가 항상
4였기 때문에(로비 단계 연결 끊김은 즉시 제거였으므로) 문제가 없었음. 그런데 같은 세션에서 로비
단계에도 재접속 유예(60초)를 추가하면서 전제가 깨짐: 역할 슬롯은 채워져 있어도(`sessionId` 기준)
그 세션이 유예 중이면 `room.clients`엔 안 잡히므로, "역할 4개는 다 찼지만 실제 연결은 3개뿐인" 순간에
게임이 시작되면 정원이 3으로 영구 고정됨.

### 해결

회귀 테스트로 정확한 재현 시나리오(역할을 고른 플레이어 하나가 드롭 후 유예 중일 때 4번째 역할이
채워지는 상황)를 먼저 작성해서 실패 확인(`maxClients`가 3으로 잘못 고정됨) → `this.maxClients` 재대입
라인 자체를 제거. 애초에 `maxClients`는 클래스 필드로 고정값 4(또는 `teamCount*2`)를 이미 갖고 있었고,
새 연결을 실제로 막는 건 `this.lock()`이라 재대입이 처음부터 불필요했음.

### 관련 파일
- `server/src/rooms/MatchRoom.ts` — `maybeStartGame()`
- `server/src/rooms/MatchRoom.test.ts` — "starting the game locks maxClients at 4 even if a role-holder is mid-grace" 테스트

---

## #9 LAN 모바일 테스트용 로컬 설정 파일이 Docker 프로덕션 빌드에 그대로 유출됨

### 증상

AWS EC2에 처음 배포한 이미지를 실제 브라우저로 열었더니 온라인 모드에서 매치메이킹이
`ERR_CONNECTION_REFUSED`로 실패. 콘솔에 `ws://192.168.x.x:2567`(로컬 개발 PC의 LAN IP)로 연결
시도한 흔적이 찍혀 있었음.

### 원인 분석

`client/.env.local`은 같은 공유기의 모바일 기기에서 개발 서버로 접속할 때 쓰라고 만들어둔, git에는
안 올라가는 로컬 전용 파일(`VITE_SERVER_URL=ws://192.168.x.x:2567`)이었음. `.dockerignore`가
`.env`/`.env.*`만 걸러내고 있었는데, Docker의 무시 패턴 매칭은 `.gitignore`처럼 하위 폴더까지
자동으로 재귀 적용되지 않고 컨텍스트 루트 기준으로만 매치됨 — `client/.env.local`처럼 하위 폴더에
있는 파일은 안 걸러짐. 그래서 `COPY client/ client/`가 이 파일을 그대로 빌드 컨텍스트에 포함시켰고,
Vite가 빌드 시점에 이걸 읽어서 LAN IP를 프로덕션 번들에 문자열로 박아버림 — 원래 의도했던
`window.location` 기반 자동 주소 유추 로직을 완전히 무시하고.

### 해결

`.dockerignore`에 `**/.env`/`**/.env.*`(재귀 매칭되는 형태)를 추가. 실제 빌드된 번들을 다시 grep해서
LAN IP가 완전히 사라졌는지, 그리고 `window.location` 기반 코드가 그 자리에 들어갔는지까지 확인.

### 관련 파일
- `.dockerignore`

---

## #10 저장된 재접속 토큰이 방 목록에서의 명시적 선택("새 방 만들기"/"입장")보다 우선 적용됨

### 증상

코드 리뷰(`code-review` 스킬) 과정에서 발견 — 실사용 버그로 보고되기 전에 정적 분석으로 먼저 잡음.

### 원인 분석

`connectToMatch(spec)`이 호출될 때마다 저장된 재접속 토큰이 있으면 `spec`(사용자가 방금 고른
"새 방 만들기"/"이 방 입장하기")보다 **항상 먼저** 그 토큰으로 재접속을 시도했음. 로비 단계에도
재접속 유예(60초)가 생기면서, 새로고침으로 방 목록에 돌아온 사용자가 명시적으로 다른 방을 골라도
여전히 유효한 옛 토큰이 있으면 그 선택을 조용히 무시하고 예전 방으로 되돌아가는 상황이 됐음.

### 해결

"재접속 시도"를 `JoinSpec`의 세 번째 케이스(`{ type: "resume" }`)로 완전히 분리해서, 닉네임 입력
직후 **딱 한 번만** 자동으로 시도하고(방 목록이 뜨기 전에), 그 이후 방 목록에서 하는 모든 명시적
선택은 토큰 확인 없이 항상 그대로 실행되도록 구조 변경. (이후 세션에서 "새로고침해도 항상 방
목록으로" 요청에 따라 이 재접속 자동 시도 자체를 완전히 제거함 — `client/src/colyseus.ts` 참고.)

### 관련 파일
- `client/src/colyseus.ts`
- `client/src/App.tsx`

---

## #11 `npm run dev`로 로컬에서 두 창을 띄우면 한쪽에서 만든 방이 다른 창의 방 목록에 안 뜸

### 증상

`npm run dev`(client 5173, server 2567 별도 포트)로 로컬 테스트 중, 한 창에서 방을 만들어도 다른
창의 방 목록엔 "열려있는 방이 없어요"만 표시됨. 콘솔에는
`Access to fetch at '.../api/rooms' ... blocked by CORS policy` 에러.

### 원인 분석

`GET /api/rooms`(방 목록 조회, `createServer.ts`)는 순수 Express 라우트라 CORS 헤더가 없었음.
client(5173)와 server(2567)는 dev 모드에서 서로 다른 origin이라, `fetch`로 이 엔드포인트를 부르면
브라우저가 응답 자체는 받아오면서도 origin이 안 맞아 JS에서 못 읽게 막음 — 그래서 `listRooms()`가
매번 실패하고 방 목록이 빈 채로 남음. (`client/.env.local`로 LAN IP를 쓰는 모바일 테스트 환경도
당연히 같은 문제.) Colyseus 자체 매치메이킹(`client.create()`/`joinById()`)은 WebSocket 기반이라
CORS 대상이 아니라서 이 문제를 안 겪었고, 그래서 방 생성/입장 자체는 되는데 목록 조회만 실패하는
걸로 나타남. 프로덕션(Caddy 뒤 단일 origin)에선 애초에 cross-origin이 아니라 드러나지 않았음.

### 해결

`/api/rooms` 응답에 `Access-Control-Allow-Origin: *` 헤더 추가. 인증 없는 공개 방 목록이라
와일드카드로 열어도 문제없음.

### 관련 파일
- `server/src/createServer.ts`

---

## #12 멀티플레이에서 턴 타이머가 실제 턴 종료 시점과 어긋나 보임("밀린다"/"끊긴다")

### 증상

여러 명이 온라인으로 같이 할 때 턴 타이머 게이지가 실제 턴이 끝나는 시점과 안 맞아 보이고,
움직임도 매끄럽지 않다는 사용자 리포트. 혼자 연습 모드에서는 이런 문제가 없었음.

### 원인 분석

`TimerBar`는 서버가 보낸 절대 타임스탬프 `turnEndsAt`에서 클라이언트의 `Date.now()`를 빼서 남은
시간을 계산함(`remaining = turnEndsAt - now`). 이 계산은 클라이언트 기기의 시스템 시계가 서버(AWS
EC2, 시간 동기화됨)와 정확히 같다고 가정하는데, 실제로는 폰마다 시계가 몇 초씩 어긋나는 일이
흔함 — 클라이언트 시계가 서버보다 빠르면 게이지가 실제보다 먼저 0에 도달하고(타이머가 너무 빨리
끊기는 것처럼 보임), 느리면 서버는 이미 턴을 끝냈는데 게이지가 계속 남아있는 것처럼 보임(밀리는
것처럼 보임). 솔로 모드(`useSoloMatch.ts`)는 `turnEndsAt`도 같은 기기의 `Date.now()`로 만들기
때문에 이 오차 자체가 발생할 수 없음 — 두 모드의 차이가 원인을 좁히는 데 결정적 단서였음.

### 해결

`ping`/`pong` 메시지 왕복을 5회 보내 각각의 왕복시간(RTT)으로 시계 오차를 추정하고, 중앙값을
`clockOffsetMs`로 사용해서 `TimerBar`가 `now + clockOffsetMs`를 서버 기준 "현재 시각"으로 쓰게
바꿈(`client/src/game/clockSync.ts`, `useMatchRoom.ts`). Playwright로 클라이언트 시계를 실제로
±3~4초 어긋나게 만든 뒤, 추정된 오차가 그 어긋남을 ms 단위로 정확히 상쇄하는지, 그리고 턴 시작
직후 게이지가 정상적으로 꽉 차 보이는지 실제 화면에서 확인.

### 관련 파일
- `client/src/game/clockSync.ts`
- `client/src/game/useMatchRoom.ts`
- `client/src/components/TimerBar.tsx`
- `server/src/rooms/MatchRoom.ts`

---

## #13 관전 화면 채팅창이 메시지가 쌓이면 내부 스크롤 대신 페이지 전체가 늘어남

### 증상

`SpectatorScreen`의 채팅(`ChatBox`의 `fill` variant)이 메시지 몇 개일 때는 남는 공간을 잘 채우다가,
메시지가 많이 쌓이면 채팅창 자체가 계속 커지면서 페이지 전체가 세로로 늘어남 — `.list`에
`overflow-y: auto`가 있는데도 스크롤바 대신 페이지 스크롤이 생김.

### 원인 분석

두 군데가 겹친 문제였음. (1) flex 자식은 기본값이 `min-height: auto`라 **내용물보다 작아지길
거부**하는데, `ChatBox.module.css`의 `.fill .list`(`flex:1; height:auto`)와 `PlayingScreen.module.css`의
`.wrap`에 `min-height: 0`이 빠져 있어서, 메시지가 늘어나 `.list`가 원래 배정받은 flex 공간보다 커지려
하면 부모가 그걸 그대로 받아들여 커져버림. (2) 설령 그 체인을 다 고쳐도, `client/src/index.css`의
`#root`가 `min-height: 100svh`(바닥값)만 갖고 있어서 애초에 하위 체인에 나눠줄 "확정된 크기 예산"이
없었음 — `min-height`는 flex 배분 계산에서 "정해진 크기"로 취급되지 않아 자식들의 `flex:1`이 의미
있는 공간을 못 받음.

`.content`(`PlayingScreen.module.css`)는 이미 같은 이유로 `min-height: 0`이 있었는데(주석에도 명시),
`.wrap`과 `ChatBox`의 `.fill .list`만 빠뜨린 상태였음 — 체인 중 한 곳이라도 빠지면 전체가 무효화됨.

### 해결

1. `client/src/index.css`의 `#root`: `min-height: 100svh` → `height: 100svh`로 변경(고정 크기로).
2. `PlayingScreen.module.css`의 `.wrap`, `ChatBox.module.css`의 `.fill .list`에 `min-height: 0` 추가.

60개 더미 메시지를 `ChatBox`에 임시로 렌더링하는 디버그 라우트를 만들어 Playwright 스크린샷으로
단계별 검증(수정 전/중간 단계/최종)한 뒤 디버그 코드는 원복. `#root`를 `height`로 바꾸는 게 다른
화면(로비/솔로 연습 등, `fill` 변형을 안 쓰는 화면들)에 회귀를 안 일으키는지도 스크린샷으로 확인 —
그 화면들은 애초에 `min-height:0`이 없어서 `#root` 높이 고정 여부와 무관하게 원래도 내용이 넘치면
그냥 페이지가 늘어나는 동작이라 그대로였음(영향 없음).

### 관련 파일
- `client/src/index.css`
- `client/src/components/PlayingScreen.module.css`
- `client/src/components/ChatBox.module.css`

---

## #14 새로고침/탭 닫기 후에도 방에 유령 플레이어가 최대 60초간 남아있음

### 증상

새로고침하거나 탭을 닫아도 실제로는 아무도 없는 방이 다른 사람 화면(방 목록/팀 로스터)에는 여전히
자리를 차지하고 있는 것처럼 보임 — 방이 꽉 찬 것처럼 보이거나 "게임 중"으로 멈춰 보임.

### 원인 분석

`MatchRoom.onLeave`가 비정상 종료(`consented === false`, 새로고침/탭 닫기/네트워크 드롭 전부 여기
해당)일 때 `this.allowReconnection(client, 60)`을 걸어 60초간 자리를 비워두지 않았음. 이건 원래
"모바일 네트워크가 잠깐 끊겼다 붙는" 상황을 위해 만든 기능이었는데, **클라이언트가 재접속 토큰을
아예 저장하지 않도록 이미 바뀐 상태**(`client/src/colyseus.ts`의 "No reconnection-token persistence
here on purpose" 주석 참고 — "재접속 자동복귀 완전 제거" 사용자 피드백으로 예전에 삭제됨)라, 서버가
60초를 벌어줘도 그 시간 안에 실제로 재접속을 시도하는 코드 경로 자체가 없음. 즉 이 유예 기간은
클라이언트가 절대 쓸 수 없는데 부작용(유령 점유)만 남기고 있었음 — 클라이언트 쪽 절반만 먼저
제거되고 서버 쪽이 안 맞춰진 상태였던 것.

### 해결

`onLeave`에서 유예 없이 항상 즉시 `removePlayer()` 호출하도록 변경(`consented` 여부와 무관). 이
유예 기능을 검증하던 서버 통합 테스트 2개(`colyseus.sdk.reconnect()`로 실제 재접속하는 시나리오)를
"드롭 즉시 슬롯이 비는지" 검증하는 테스트로 다시 작성했고, 더 이상 존재할 수 없는 시나리오("게임
시작 시점에 role은 찼는데 유예 중이라 실제 연결 수가 모자란 경우")를 검증하던 테스트 1개는 통째로
삭제(그 상황 자체가 불가능해졌으므로).

### 관련 파일
- `server/src/rooms/MatchRoom.ts` — `onLeave()`
- `server/src/rooms/MatchRoom.test.ts`

---

## #15 모바일 화면에서 관전 화면 채팅창이 거의 안 보일 정도로 눌림

### 증상

PC(또는 세로로 긴 뷰포트)에서는 채팅 메시지가 여러 줄 잘 보이는데, 실제 폰 화면(뷰포트 세로 길이가
짧음)에서는 채팅 목록이 한 줄도 채 안 보일 만큼 눌려서 렌더링됨. #13에서 고친 "채팅창이 페이지를
늘리는" 문제와는 다른 문제 — 스크롤은 이미 정상 동작하지만, 스크롤 영역 자체에 배정되는 공간이
너무 작음.

### 원인 분석

`SpectatorScreen`의 세로 레이아웃에서 `SequenceBoard`(항상 4줄 고정 높이, 뷰포트 크기와 무관하게
약 220px)와 `TeamRosterPanel`(팀당 아이콘+이름+절구, 팀 수만큼) 등 **고정 크기 요소들이 뷰포트
높이와 무관하게 항상 같은 절대 픽셀 크기**를 차지함. 데스크톱처럼 뷰포트가 넉넉하면 이 고정 요소들을
제외한 "남는 공간"(채팅이 `flex:1`로 채우는 공간)이 충분하지만, 뷰포트 세로 길이가 짧은 폰에서는 같은
고정 요소들이 전체 높이에서 훨씬 큰 비중을 차지해서 채팅에 남는 공간이 거의 0에 가까워짐 —
`todo.md`에 이미 "기기별 미디어 쿼리 적용 안 함"으로 남아있던 갭이 실제로 드러난 사례.

`ChatBox` fill/`SpectatorScreen` 레이아웃을 실제 폰 없이 재현하려고 `SequenceBoard`/`ChatBox`/
`TeamRosterPanel`을 그대로 조립한 임시 디버그 라우트를 만들어 375×667(iPhone SE급)에서 Playwright
스크린샷으로 확인 — 채팅 목록이 한 줄도 안 보일 정도로 눌린 게 실제로 재현됨.

### 해결

`@media (max-height: 750px)`로 짧은 뷰포트를 겨냥해 고정 크기 요소들을 줄임: `SequenceBoard.module.css`의
`--token-width`(2.1rem→1.5rem)/`--row-gap`(0.75rem→0.45rem)/padding, `PlayingScreen.module.css`의
`.content`의 gap/padding. 375×667과 360×640에서 채팅이 여러 줄 보이도록 확인, 480×900(데스크톱 급)에서는
미디어 쿼리가 발동하지 않아 기존 크기 그대로인 것도 스크린샷으로 재확인(회귀 없음).

### 관련 파일
- `client/src/components/SequenceBoard.module.css`
- `client/src/components/PlayingScreen.module.css`

---

## #16 내 턴 화면에서 팀원이 누르는 버튼 소리가 안 들림

### 증상

`ButtonPanel`의 클릭 사운드(#색상별 매핑, `docs/TROUBLESHOOTING.md`보단 이전 세션 커밋 참고)는
버튼을 직접 누른 사람 화면에서만 재생됨 — 같은 팀 턴을 같이 보고 있는 팀원이 자기 색 버튼을 누를
때 나는 소리는 상대방 화면에서는 전혀 안 들림. 협동 릴레이가 핵심인 게임인데 팀원의 타이밍을 소리로
느낄 수 없었음.

### 원인 분석

기존 클릭 사운드는 `ButtonPanel`의 `onPointerDown`/`onClick` 핸들러 안에서 **로컬로, 서버 응답을
기다리지 않고 즉시** 재생되는 구조라 — 이건 버튼을 누른 사람 화면에서 지연 없는 피드백을 주기 위한
의도된 설계였지만, 정확히 그 이유로 "내가 안 누른 버튼"의 소리를 재생할 방법이 없었음(다른
클라이언트의 로컬 이벤트라 이쪽에서는 아예 발생하지 않음). 유일하게 모두에게 동기화되는 정보는
서버가 브로드캐스트하는 `MatchState.cursor`(커서가 성공적으로 한 칸씩 전진)뿐.

### 해결

버튼별 로컬 클릭 사운드는 그대로 두고(#색상별 매핑은 이미 검증되어 있었음), **`cursor`가 전진할
때마다 방금 소비된 색을 역산해서** 그 색의 사운드를 재생하는 훅(`client/src/game/
useSequencePressSound.ts`)을 추가 — `sequence[이전 cursor .. 새 cursor)` 구간을 순회하며 색을
읽음. `MyTurnScreen`에서는 `excludeRole`로 내 역할 색은 건너뛰어(이미 로컬에서 즉시 들었으므로 중복
재생 방지) 팀원 색만 재생, `SpectatorScreen`에서는 제외 없이 관전 중인 팀의 모든 프레스를 재생.
민트의 "연속 4개 순환" 로직(`click1~4.mp3`)도 카운터 상태 없이 `sequence`에서 해당 인덱스까지
연속된 mint 개수를 거꾸로 세어 derive하도록 만들어서, 프레스 당사자의 로컬 재생과 팀원의 반응형
재생이 항상 같은 결과를 내도록 함(별도 상태를 두 곳에서 따로 관리하지 않음).

실제 2개 브라우저 탭(돼지+토끼)으로 온라인 방을 만들어 검증: 돼지가 정답 버튼을 누르면 토끼 탭의
네트워크 로그에 정확히 그 색의 mp3 요청이 1번만 찍히고, 돼지 자신의 탭에도 중복 없이 1번만 찍힘을
확인. (4초 턴 타이머 때문에 수동 테스트가 계속 실패해서 `DEFAULT_TURN_DURATION_MS`를 30초로 임시로
올려서 검증한 뒤 원복 — `tsx watch`가 이 리포에서 파일 변경 시 재시작하다가 Windows에서 이전 프로세스가
포트를 즉시 안 놓아 `EADDRINUSE`로 재시작이 실패하는 경우가 있음(재시도 후 결국 성공하긴 하나 몇 초
지연됨) — 이 창에서 서버 쪽 파일을 고칠 땐 재시작이 실제로 완료됐는지 `netstat`으로 리스닝 PID가
바뀌었는지 확인하고 테스트할 것, 아니면 예전 코드로 계속 테스트하게 됨.)

### 관련 파일
- `client/src/game/useSequencePressSound.ts` (신규)
- `client/src/game/clickSound.ts` (신규 — `ButtonPanel`에 있던 색상별 사운드 매핑을 공용 모듈로 추출)
- `client/src/game/colors.ts` — `colorRole()` 추가(서버 `server/src/game/colors.ts`와 동일 로직, 수동 동기화)
- `client/src/components/ButtonPanel.tsx`
- `client/src/components/MyTurnScreen.tsx`
- `client/src/components/SpectatorScreen.tsx`

---

## #17 매치 종료 화면("모든 팀이 탈락했습니다")의 채팅창이 관전 중 채팅보다 훨씬 눌림

### 증상

같은 `ChatBox`(`fill` variant), 같은 `SpectatorScreen`인데 매치가 완전히 끝난 화면("모든 팀이
탈락했습니다" + "나가기" 버튼이 뜨는 상태)에서는 채팅이 평소 관전 중(진행 팀 있음)보다 훨씬 적게
보임. 짧은 모바일 뷰포트에서는 #15로 고친 뒤에도 3~4줄밖에 안 보임.

### 원인 분석

`eliminated` 분기가 평소 관전 화면에는 없는 문구(`<p>`)와 "나가기" `<button>`을 추가로 렌더링하는데,
이 둘이 `.content`의 `flex:1` 예산을 SequenceBoard와 함께 나눠 가지면서 채팅의 몫이 그만큼 줄어듦.
평소 관전 화면보다 소비 요소가 하나(버튼) 더 많은 게 누적된 것.

디버깅 중 **별도의 진짜 버그**도 하나 발견: `.leaveButton`/`.spectating`을 짧은 뷰포트에서 작게
만들려고 `@media (max-height: 750px)` 블록을 `PlayingScreen.module.css` 파일 **앞쪽**(`.content`
정의 바로 뒤)에 추가했는데, 실제로는 전혀 적용되지 않았음 — CSS는 특정도(specificity)가 같으면
**소스 순서가 나중인 규칙이 이긴다**는 원칙이 미디어 쿼리 조건 충족 여부와 무관하게 그대로 적용되므로,
파일 뒤쪽에 있는 `.leaveButton`/`.spectating`의 **조건 없는** 기본 규칙이 앞쪽의 미디어 쿼리 규칙을
덮어써버림. `getComputedStyle()`로 실제 적용된 padding/font-size 값을 확인해서 발견 — 화면만 봐서는
"안 줄어드네?" 정도로만 보이고 원인을 알기 어려움.

### 해결

1. 미디어 쿼리 오버라이드는 **오버라이드할 기본 규칙보다 파일에서 뒤에** 와야 함 — `.leaveButton`/
   `.spectating`용 `@media` 블록을 그 클래스들의 기본 정의 뒤로 옮김(`.content`용 블록은 원래도
   `.content` 기본 정의 뒤에 있어서 문제 없었음).
2. 매치가 완전히 끝나면(`matchOver`) 더 이상 진행되지 않는 정지된 시퀀스 보드를 보여줄 이유가
   없으므로 `SequenceBoard`(및 `.boardArea`) 자체를 렌더링하지 않도록 변경 — 채팅에 그 공간을
   통째로 돌려줌. 폰 뷰포트(375×667)에서 메시지 10개가 스크롤 없이 다 보이는 것까지 스크린샷으로
   확인.

### 관련 파일
- `client/src/components/PlayingScreen.module.css`
- `client/src/components/SpectatorScreen.tsx`

---

## #18 EC2 재시작 후 앱은 떠 있는데 새 주소로 HTTPS 접속이 안 됨

### 증상

EC2 인스턴스를 재시작(퍼블릭 IP가 바뀜)한 뒤 새 IP 기반 nip.io 주소(`https://<새IP 하이픈형>.nip.io`)로
접속하면 응답이 없거나 인증서 에러가 남. `docker ps`로 보면 `songpyeon`/`caddy` 컨테이너 둘 다
`--restart unless-stopped`로 이미 자동으로 다시 떠 있어서 "컨테이너는 정상인데 왜 안 되지" 상태가 됨.

### 원인 분석

nip.io는 IP를 호스트네임 안에 그대로 박아넣는 서비스라(`52-79-109-203.nip.io` = IP
`52.79.109.203`), EC2가 재시작되어 퍼블릭 IP가 바뀌면 접속해야 할 도메인 문자열 자체가 통째로
바뀜. 컨테이너 재시작은 자동이지만 **Caddy 설정 파일은 자동으로 안 바뀜** —
`/home/ec2-user/caddy/Caddyfile`(호스트에서 컨테이너로 bind mount됨, `docker inspect caddy`로 확인
가능)에 예전 IP 기반 호스트네임이 사이트 블록 헤더로 그대로 박혀있어서, Caddy가 자동 HTTPS 인증서를
새 호스트네임 앞으로 발급받지 않음(설정에 없는 도메인이니까).

### 해결

1. SSH로 접속해 `/home/ec2-user/caddy/Caddyfile`을 새 IP 기반 호스트네임으로 갱신.
2. `docker restart caddy` — 재시작되면서 Caddyfile을 다시 읽고, 자동으로 Let's Encrypt에 새
   인증서를 요청함(`docker logs caddy`에서 `certificate obtained successfully` 로그로 확인, 보통
   몇 초 안에 끝남).
3. 새 주소로 브라우저 접속 확인.

`songpyeon` 컨테이너 자체는 도메인과 무관(내부 도커 네트워크로만 통신)이라 이 절차와 무관하게 항상
자동 복구됨 — 이 문제는 순전히 Caddy/도메인 쪽.

### 관련 파일
- EC2 인스턴스의 `/home/ec2-user/caddy/Caddyfile` (레포 밖, 직접 SSH로만 수정 가능)

---

## #19 iOS에서 동시/연타 버튼 입력이 씹힘 (진행 중 — 씹힘 자체는 실기기 검증 대기, 줌 이슈는 시도 6으로 해결)

### 증상

돼지 역할에서 빨강/주황/노랑 버튼과 보라 버튼을 동시에 누르는 게 이 게임의 핵심 조작(§4.1 `[색상,
보라]` 쌍)인데, iOS에서 몇 번은 정상 인식되다가 어느 순간 보라만 인식이 안 됨. 빠르게 연타("타다다닥")
할 때도 두세 개는 맞다가 바로 씹힘.

### 원인 분석 (확정 아님 — 실기기 재현 불가라 근거 기반 추정)

이전 조사(§iOS 씹힘 1차, `docs/todo.md` 참고)에서는 캡처된 사례가 실제 오답이었어서 "오답+4초 잠금을
씹힘으로 오인"으로 잠정 결론났었음. 이후 사용자가 여러 친구를 통해 재검증하며 훨씬 구체적인 패턴을
확인:

1. **사파리뿐 아니라 iOS Chrome/Naver 브라우저에서도 동일 재현** — iOS는 애플 정책상 모든 브라우저가
   자체 엔진이 아니라 WebKit을 강제로 씀. 즉 Safari 고유 버그가 아니라 **WebKit 공통 레이어의 문제**라는
   뜻 — Chrome/네이버 고유 로직 쪽 원인은 배제 가능.
2. **같은 줄(bottom row)에 있는 노랑/주황 + 보라 조합**에서 유독 잘 씹힘 — 두 손가락이 수평으로
   벌어지는 모양은 iOS의 "두 손가락 가로 스와이프/핀치" 제스처 인식과 겹칠 여지가 큼.
3. **연타 시 두세 번은 되다가 씹힘** — 항상 재현되는 확정적 버그가 아니라 타이밍에 따라 갈리는
   레이스 컨디션에 가까움.

이 패턴들을 근거로 원인 후보를 우선순위대로 정리:

- **(유력) Pointer Events가 WebKit 멀티터치에서 Touch Events보다 신뢰도가 낮음**: `ButtonPanel.tsx`가
  `onPointerDown`(React Pointer Events)을 쓰고 있었음. Pointer Events는 손가락마다 개별 이벤트로
  쪼개져 디스패치되는 반면, `TouchEvent`는 현재 활성 터치 전체를 한 이벤트의 배열로 통째로 넘겨줌 —
  WebKit의 Pointer Events 구현이 동시 다중 포인터 추적에서 덜 성숙하다고 알려져 있어, 두 번째
  포인터의 이벤트가 내부적으로 유실될 여지가 TouchEvent보다 큼. "몇 번은 되다가 씹힘"이라는 비결정적
  패턴과 잘 맞음.
- **(보조) 버튼 사이 빈 공간에 `touch-action`이 없음**: `.button`에는 `touch-action: none`이 있지만
  버튼 사이 여백과 `.empty`(빈 슬롯)에는 없어서(기본값 `auto`), 두 터치 중 하나가 경계에서 살짝
  벗어나면 iOS가 그 터치를 제스처로 해석해 DOM에 안 넘길 수 있음. 아직 미적용.
- **(보조, 약함) `:active` 눌림 시 `scale(0.93)` 트랜지션(0.1s)** 중 연타가 겹치면 그 순간 히트박스가
  살짝 줄어든 상태일 수 있음. 아직 미적용.
- **(배제) 엣지 스와이프 뒤로가기 제스처**: 보라 버튼 위치를 계산해보면 화면 오른쪽 끝에서 충분히
  떨어져 있어(약 100px+) iOS 엣지 제스처 인식 영역(보통 20px 이내)에 안 걸림.
- **(배제) 800ms 터치-클릭 중복 방지 로직**: `touchstart`는 이 로직과 무관하게 항상 `onPress`를
  호출하고, dedupe는 뒤따라오는 합성 `click`만 걸러내는 용도라 정당한 연속 입력 누락으로 이어지진
  않음.

### 시도 1 (효과 없음 확인됨)

가장 유력해 보였던 후보부터 적용: `ButtonPanel.tsx`를 `onPointerDown`(Pointer Events) →
`onTouchStart`(raw Touch Events)로 전환. `handleTouchStart`가 이제 `pointerType` 체크 없이 바로
동작(touchstart는 애초에 터치에서만 발생하므로 불필요해짐), 기존 dedupe 로직(`touchHandledAtRef`,
`TOUCH_DEDUPE_WINDOW_MS`)은 그대로 유지 — 트리거 이벤트만 바뀌고 나머지 구조는 동일. 배포 후 실사용자
재검증 결과 **효과 없음** — 증상 동일. 게다가 추가 정보 확보: **같은 버튼(토끼 민트)을 빠르게
연타할 때도 씹힘** — 이건 "서로 다른 두 버튼 동시입력 시 WebKit 멀티터치 처리가 불안정하다"는 원래
가설로는 설명이 안 되는 패턴이라(같은 요소 반복 탭은 멀티터치 추적과 무관), 가설을 재검토함.

### 원인 재분석

두 증상(다른 버튼 동시입력 씹힘 / 같은 버튼 연타 씹힘)을 동시에 설명하려면 "동시입력" 자체보다
**"짧은 시간 안의 연속 입력"** 쪽에 공통점이 있음. `ButtonPanel.tsx`가 탭마다 동기적으로 하는 일:
(1) React state 업데이트로 인한 `SequenceBoard` 전체 리렌더(토큰 18~30개), (2) **탭마다 `new
Audio(src)`로 새 오디오 엘리먼트를 매번 새로 생성**해서 재생, (3) WebSocket 메시지 전송, (4)
`:active`에서 `transform: scale(0.93)` + `0.1s` 트랜지션. 특히 (2)는 반복될수록 누적되는 실제
메인스레드 작업이라, 연타 중 메인스레드가 밀린 타이밍에 물리적 터치가 들어오면 iOS가 터치 디스패치를
지연/드롭할 수 있음 — 이게 "몇 개는 되다가 갑자기 안 되는" 패턴과 버튼이 같든 다르든 상관없이
적용되는 설명. (4)는 민트 연타(같은 버튼 반복)에 더 직접적으로 걸림 — 트랜지션 도중 버튼의 실제
렌더링 크기가 살짝 작아진 상태라, 그 순간 재탭하면 히트 영역이 미세하게 좁아짐.

### 시도 2 (부분 개선, 부족 — 2026-07-17 재검증 결과)

1. **오디오 풀링**: `game/clickSound.ts`가 이제 색상/사운드별로 `HTMLAudioElement`를 하나씩만 만들어
   재사용(`audioPool` Map). 재생 중인 걸 다시 트리거하면 `currentTime = 0`으로 되감아 재시작 — 겹쳐
   재생하진 않지만(1초 미만 효과음이라 문제 없음), 탭마다 새 엘리먼트를 만들던 작업을 없앰.
2. **`:active` 트랜지션 제거**: `ButtonPanel.module.css`의 `.button`에서 `transform`을 트랜지션
   대상에서 뺌(순간 전환, 애니메이션 없음) — `filter`만 계속 트랜지션. 눌림 시각 효과 자체는 남지만
   연타 중 "히트박스가 일시적으로 작아진 상태"인 프레임이 없어짐.

실사용자 재검증 결과: "조금 개선된 느낌은 있지만 여전히 진행이 어려울 정도로 씹히고 딜레이도 있음".
방향(메인스레드 작업량 축소)은 맞다는 신호로 판단 — "씹힘"과 "딜레이"가 함께 보고된 것도 단순 드롭이
아니라 입력 처리가 밀리는 성능 문제에 가깝다는 걸 뒷받침함(드롭이면 딜레이 없이 그냥 안 눌리는
쪽에 가까울 것). 같은 방향으로 더 진행.

### 시도 3 (2026-07-17, 렌더링 비용 축소 — 검증 대기)

시도 1/2가 놓친 부분: colyseus는 스키마 state를 **in-place로 mutate**하고, 클라이언트는 매 patch마다
`forceRender()`로 전체 트리를 강제로 리렌더함(`useMatchRoom.ts` — 참조가 안 바뀌니 React가 자동으로
변경을 못 감지해서 수동으로 리렌더를 걸어야 함). 즉 **버튼 하나 누를 때마다 화면 전체가 처음부터 다시
그려지고 있었음** — `SequenceBoard`는 메모이제이션이 전혀 없어서 시퀀스가 18~30개짜리여도 매 프레스마다
토큰 전부를 새로 만들고(각각 `filter: drop-shadow` 재계산 포함) 새로 diff했음, 실제로 바뀌는 건 보통
토큰 1~2개(막 완료된 것, 커서가 옮겨간 것)뿐인데도. 적용한 변경:

1. **`SequenceBoard`의 토큰을 `React.memo`로 분리**: `sequence`/`cursor` 객체가 아니라 토큰별로 실제
   파생되는 원시값(`color`/`isDone`/`isMissed`/`showCursor`/`isLastInRow`)을 prop으로 받게 해서, 이
   값들이 안 바뀐 토큰(프레스당 대부분)은 리렌더 자체를 건너뜀.
2. **완료된(`done`) 토큰의 `filter: drop-shadow` 제거**: opacity로 이미 흐려지므로 그림자는 불필요 —
   iOS Safari에서 `filter`는 페인트 비용이 특히 비싼 축. 메모이제이션 이후엔 "완료로 전환되는 그
   순간"에만 의미 있지만 그마저도 없앰.
3. **`ButtonPanel`도 `React.memo`로 감쌈** — 단 이게 실제로 효과를 보려면 `onPress`가 매 렌더마다
   새 함수면 안 됨. `MyTurnScreen.tsx`의 `press`와 `useSoloMatch.ts`의 `press`를 `useCallback`으로
   고정(`useSoloMatch`의 `press`는 ref/setState setter만 참조해서 의존성 배열이 완전히 빈 배열로
   가능 — 원래도 재생성될 이유가 없던 함수였음).
4. **오디오 재생을 `onPress`(네트워크 전송) 다음 순서로**: 원래는 사운드 재생 후 `onPress`를 불렀는데,
   순서를 바꿔서 실제 입력 신호가 오디오 API 어떤 지연에도 절대 안 밀리게 함(`setTimeout`으로
   비동기 지연시키는 방식은 iOS의 오토플레이 정책상 유저 제스처 콜스택 밖에서 호출되는 `play()`가
   차단될 위험이 있어서 배제 — 순서만 바꾸는 쪽을 택함).

데스크탑에서 회귀 확인: 정답 프레스 시 토큰이 정상적으로 done 처리됨, 오답 시 놓친 토큰 강조 표시(#17
관련 기능)도 메모이제이션 이후 정상 동작 확인(30초로 늘린 타이머로 스크린샷 검증). 콘솔 에러 없음.
이 환경엔 iOS 기기가 없어 실제 개선 체감은 여전히 사용자 쪽 재검증 필요.

### 시도 3 재검증 결과 — 토끼는 많이 해소, 돼지는 여전함 → 원인을 더 좁힘 (2026-07-17)

실사용자 재검증: **토끼 민트 연타는 많이 해소**됐지만, **돼지 `[색상,보라]`를 빠른 속도로 치면
여전히 진행이 안 됨**. 이 비대칭이 결정적인 단서:

- 민트 연타 = **같은 버튼**을 반복해서 누름 → 리렌더 비용 축소(시도 3)가 직접 적용되는 케이스, 실제로
  개선됨.
- 돼지 `[색상,보라]` = **서로 다른 두 버튼**(예: 노랑↔보라) 사이를 손가락이 빠르게 오가야 함.

리렌더 비용 축소는 두 케이스 모두에 똑같이 적용됐어야 하는데 돼지만 안 나아졌다는 건, 남은 원인이
렌더링이 아니라 **"버튼 사이를 이동하는 동작" 자체**에 있다는 뜻 — 최초 원인 분석(#19)에서 후보로만
남겨두고 실제로 적용은 안 했던 항목과 정확히 일치함.

### 시도 4 (2026-07-17, 배포 완료 — 검증 대기)

`ButtonPanel.module.css`의 `touch-action: none`이 지금까지 **버튼 개별 요소에만** 걸려있고, 버튼
사이 여백과 `.empty`(빈 슬롯)는 기본값 `auto`였음. 노랑→보라처럼 빠르게 움직이면 그 경로의 빈 공간을
손가락이 스치는 순간이 생기는데, 그 찰나를 iOS가 "팬/스와이프 시도"로 해석해 두 번째 터치를 가로챌
여지가 있음. 게다가 최근 사용자 요청으로 버튼 사이 간격을 넓힌 것(돼지의 주황-보라 간격 25.25%→30.25%
등)이 이 빈 공간을 오히려 더 넓혀놔서 문제를 악화시켰을 가능성도 있음.

`touch-action: none`을 개별 버튼이 아니라 **`.panel`(버튼 그리드 전체 컨테이너)에** 걸어서, 버튼
사이 여백을 지나가도 iOS 제스처 인식이 아예 개입 못 하게 확장. `.empty`에도 명시적으로 중복 적용(상위
`.panel`만으로 충분하지만, 나중에 구조가 바뀌어도 깨지지 않도록). `.panelBg`(버튼 패널과
`TeamRosterPanel`이 공유하는 바깥 배경 래퍼)는 건드리지 않음 — 범위를 실제 버튼 그리드로만 한정.

안드로이드 영향 검토: `touch-action`은 표준 속성이라 안드로이드에서도 동일하게 지원되고, 이 프로젝트의
안드로이드 씹힘 문제도 원래 이 속성(버튼 단위)으로 해결한 전례가 있음 — 이번 변경은 같은 방식을 범위만
넓힌 것이라 회귀 위험 낮음. 이 속성이 막는 건 팬/스크롤/핀치줌/더블탭줌인데 핀치줌/더블탭줌은 이미
전역으로 꺼져있고, 버튼 패널 자체가 스크롤될 필요도 없는 영역.

데스크탑에서 `.panel`의 `getComputedStyle().touchAction`이 실제로 `"none"`인 것, 마우스 클릭 경로
회귀 없는 것 확인. 실기기 없어 실제 효과는 사용자 쪽 재검증 필요.

### 시도 4 재검증 결과 — 여전함 → 실기기 터치 로그로 전환, 실제 데이터 확보 (2026-07-17)

시도 4까지도 효과 없음 확인 후, 더 이상의 추측 대신 화면 상단(정확히는 하단 패널 바로 위 — 아래
"재사용 가능한 진단 오버레이" 참고)에 `touchstart`/`touchend`/`touchcancel`을 실시간으로 찍는 임시
오버레이(`TouchDebugOverlay.tsx`)를 붙여 실제 아이폰(신호 약함, 1칸)에서 로그를 받음. 확인된 것:

1. **손가락 두 개를 동시에 쓰고 있음** — `start(보라) → start(노랑, 83ms 뒤) → end(보라) → end(노랑)`처럼
   한쪽이 안 끝난 채 다른 쪽이 시작되는 패턴이 실제로 있음. 의도된 사용법(양손가락으로 색상+보라를
   거의 동시에)으로 보임 — 이 자체는 버그 신호가 아님.
2. **`disabled`가 "따라잡는" 순간이 로그에 잡힘**: 47ms 간격으로 찍힌 두 터치 중 앞선 것(`red`)은
   아직 `disabled`가 아니고 뒤이은 것(`purple`)은 이미 `disabled`로 나온 사례 발견 — 서버가 턴 실패를
   이미 확정했는데 클라이언트가 그 사실을 화면(disabled)에 반영하기까지의 왕복 시간 동안 터치가
   들어오면, 서버(`handlePressButton`의 `if (this.turnDecided) return`)가 아무 신호 없이 조용히
   무시함. 터치 자체는 정상 발생했는데 아무 반응이 없어서 "씹힘"으로 느껴지는 케이스로 추정.
3. **보라 버튼이 좌표 1px 차이로 두 번 눌리는 사례**: `start→end→(244ms)→start→end` 형태로 실제
   시간 간격이 있는 완전한 두 세트 — 소프트웨어가 이벤트를 중복 발생시킨 게 아니라 물리적으로
   두 번 닿았다는 뜻. `touchcancel`을 추가로 로깅해도 안 찍힘 — 다만 이게 "손가락이 안 떨어졌는데
   센서가 놓쳤다 재획득"을 배제하는 증거는 아님(센서 트래킹 드롭은 `cancel` 없이 그냥 정상적인
   end/start로 보고될 수 있음) — 이 경로로는 원인을 더 좁히지 못함, 보류.
4. **아이폰에서만(사파리/크롬/네이버 공통, iOS는 전부 WebKit) 게임 중 시퀀스보드가 가끔 확대(줌인)되는
   현상 발견** — 별개 이슈지만 같은 조사 중 발견. 원인: 뷰포트 메타의 `user-scalable=no`는 핀치줌은
   막아도 iOS 버전에 따라 더블탭 줌까지 확실히 막아주진 않음 — 버튼들은 이미 `touch-action`으로
   막혀있지만 시퀀스보드 영역엔 전혀 안 걸려있어서, 빠른 연타 중 보드 쪽을 스치면 그 영역만 기본
   더블탭줌 제스처가 살아있었음.

### 시도 5 (2026-07-17, 배포 완료) — 시퀀스보드 줌인 수정 (별개 이슈)

`client/src/index.css`의 `html`에 `touch-action: manipulation` 전역 추가. `none`이 아니라
`manipulation`을 쓴 이유: 채팅 메시지 목록(`ChatBox`의 `.list`, `overflow-y: auto`)이 네이티브 터치
스크롤에 의존하는데 `none`은 스크롤까지 다 막아버림 — `manipulation`은 팬(스크롤)은 허용하고
핀치줌/더블탭줌만 막음. 버튼 씹힘 원인 자체와는 별개 이슈(줌은 사용성 문제, 씹힘은 입력 유실
문제)라 분리해서 기록.

### 시도 5 재검증 결과 — 오히려 악화, `manipulation`의 실제 정의를 잘못 이해했음 (2026-07-17)

배포 후 사용자 재확인 결과 **더 나빠짐**: 더블클릭 한 번만으로도 줌이 걸리고, 범위도 시퀀스보드가
아니라 메인화면/버튼패널을 포함한 화면 전체로 넓어짐.

원인: `touch-action: manipulation`은 `pan-x pan-y pinch-zoom`의 별칭 — 더블탭줌만 비활성화할 뿐
**핀치줌은 명시적으로 허용**한다(MDN 확인). "줌을 막는 값"이라고 잘못 이해하고 적용한 게 실수 —
`html`(모든 요소의 조상)에 이걸 걸면서 페이지 전체에 "핀치줌 사용 가능"이라는 신호를 준 셈이 됨.

버튼패널까지 영향받은 이유는 핀치가 **두 손가락** 제스처이기 때문으로 추정: `.button`/`.panel`은
`touch-action: none`이라 그 위에 닿은 손가락 하나는 막히지만, 핀치의 나머지 손가락이 버튼 사이 여백
바깥(여전히 `html`의 허용치가 적용되는 영역)에 닿으면 그쪽 권한으로 제스처 전체가 진행될 수 있음 —
자식의 `none`이 조상의 명시적 허용을 완전히 상쇄하지 못하는 케이스.

### 시도 6 (2026-07-17, 배포 완료) — `pinch-zoom` 자체를 허용하지 않는 값으로 교체

`html`의 `touch-action`을 `manipulation` → `pan-x pan-y`로 변경. `pinch-zoom` 키워드를 아예 안 써서
핀치줌 권한 자체를 부여하지 않음 — 나열되지 않은 제스처는 기본적으로 비활성화되므로 더블탭줌도 계속
막힘. `pan-x pan-y`는 채팅 스크롤에 필요한 단일 손가락 팬(스크롤)만 남겨둠. 버튼/`.panel`의
`touch-action: none`은 그대로 유지 — 조상(`html`)이 더 이상 핀치줌을 허용하지 않으므로 자식의 `none`이
온전히 유효해짐.

### 새 단서 — 카카오톡 인앱브라우저에서는 씹힘이 재현 안 됨 (2026-07-17)

사용자 보고: 카카오톡 채팅방에 링크를 올려서 카톡 인앱브라우저로 실행하면 씹힘 현상이 없음.

먼저 확인한 사실: **엔진 차이가 아님.** 애플 앱스토어 심사 가이드라인 2.5.6("웹을 브라우징하는 앱은
반드시 WebKit 프레임워크를 써야 한다")에 따라 iOS에서는 크롬/네이버/카카오톡 인앱브라우저 전부
Safari와 동일한 WebKit(WKWebView) 위에서 동작함 — EU는 iOS 17.4부터 예외(BrowserEngineKit)가
생겼지만 한국엔 적용 안 됨. 즉 JS/렌더링 엔진 자체는 완전히 동일하고, 이 차이로 씹힘 유무가
갈리는 걸 설명할 수 없음.

유력한 설명: **호스트 앱이 WKWebView 위에 얹는 네이티브 UI 제스처 인식기(gesture recognizer)의
차이.** 사파리(앱)는 WKWebView를 감싸는 자기 자신의 크롬을 갖고 있고 그 위에 엣지 스와이프
뒤로가기, 탭 전환 스와이프, 당겨서 새로고침 같은 시스템 레벨 제스처 인식기를 여러 개 얹어둠 — 이런
인식기들이 웹페이지 콘텐츠와 같은 터치를 두고 경쟁하면서, "이게 스크롤/스와이프 시도인지" 판단하는
지연이나 취소가 생길 수 있음. 반면 카카오톡 인앱브라우저는 채팅창 안에서 뜨는 훨씬 얇은 래퍼(상단바에
닫기/공유 버튼 정도)라 그런 경쟁 제스처 인식기 자체가 없거나 훨씬 적을 가능성이 큼 — 호스트 네이티브
앱이 WKWebView의 뷰 계층과 설정을 직접 통제하기 때문에 가능한 차이.

이게 맞다면 지금까지의 모든 시도(touch-action, 오디오 풀링, 리렌더 비용 축소)는 전부 **웹페이지가
통제 가능한 레이어**에서만 작업한 것이고, 남은 씹힘의 실제 원인은 **웹페이지 바깥, 브라우저 앱 자체의
네이티브 제스처 처리 레이어**에 있을 가능성이 있음 — 이 레벨은 우리 쪽 웹 코드로 직접 고칠 수 없는
영역. 확정된 결론은 아니고(카카오톡 쪽을 직접 디버깅할 방법이 없어 근거는 정황 증거 수준), 다음
방향으로 참고할 것:
- 현실적 우회책으로 "게임 링크는 카카오톡 채팅방에 올려서 인앱으로 플레이"를 임시 권장할 수 있음.
- §시도 4 재검증 결과 #2에서 발견한 "서버가 늦은 입력을 조용히 무시"하는 부분은 이 새 단서와 무관하게
  여전히 별도로 손볼 가치가 있음(웹페이지 레이어에서 통제 가능한 유일한 남은 레버).

### 관련 파일
- `client/src/components/ButtonPanel.tsx`
- `client/src/components/ButtonPanel.module.css`
- `client/src/game/clickSound.ts`
- `client/src/components/SequenceBoard.tsx`
- `client/src/components/SequenceBoard.module.css`
- `client/src/components/MyTurnScreen.tsx`
- `client/src/game/useSoloMatch.ts`
- `client/src/index.css`

---

## #20 재사용 가능한 진단 오버레이 — 화면에 실시간 터치 로그 찍기 (기법 기록용)

실기기(특히 iOS)에서만 재현되는 입력 문제는 원격 디버깅 도구 없이는 눈으로 볼 방법이 없음 —
`TouchDebugOverlay.tsx`(#19 시도 4 재검증 과정에서 만들었다가 검증 끝나고 삭제함)로 실제 화면에
로그를 찍어서 데이터를 받은 게 유용했음. 나중에 비슷한 상황(터치/포인터 입력 관련 실기기 버그)이
또 생기면 아래 설계를 그대로 재사용하면 됨:

- **어디에 뜨게 할지가 은근히 중요함**: 처음엔 화면 맨 위(`top: 0`)에 고정했는데, 시퀀스보드를
  가려서 정작 봐야 할 게임 화면을 못 보는 상태로 테스트하게 됨. **하단 버튼/로스터 패널**
  (`ButtonPanel.tsx`/`TeamRosterPanel.tsx`가 공유하는 `bottomPanelBackground.module.css`)이
  모든 플레이 화면에 공통으로 존재하는 유일한 앵커라, 그 바로 위(`bottom: <패널 top까지 거리>px`)에
  띄우면 온라인 관전 화면의 채팅이 뜨는 자리와 비슷한 위치가 되어 보드를 안 가림. CSS 모듈
  클래스명이 이 프로젝트 빌드에서 원래 이름을 접두사로 유지하므로(`_panelBg_1ug12_9`처럼)
  `document.querySelector('[class*="panelBg"]')`로 임시 코드에선 충분히 안정적으로 찾을 수 있음.
  패널이 없는 화면(닉네임/방목록)에서는 `bottom: 0`으로 폴백.
- **위치는 한 번만 재지 말고 주기적으로(예: 300ms interval) 다시 측정**: 화면 전환마다 패널이
  붙었다 떨어지고, 라운드가 올라가면 보드 줄 수가 늘어나 패널 위치 자체가 내려가기도 함.
- **로그 갱신은 React state가 아니라 ref로 DOM(`textContent`)을 직접 조작**: 이 오버레이 자체가
  리렌더를 유발하면, 지금 측정하려는 "리렌더/입력 지연" 문제를 오버레이가 스스로 왜곡시킬 수 있음.
- **`pointerEvents: "none"`을 컨테이너에 필수로 걸 것**: 오버레이가 항상 최상위 z-index라, 이게
  없으면 실제 게임 조작(버튼 탭)을 오버레이가 가로채버림.
- **`touchstart`/`touchend`뿐 아니라 `touchcancel`도 같이 로깅**: 어떤 상황이 시스템에 의해 취소된
  건지, 정상 종료된 건지 구분하려면 필요(다만 #19에서 확인했듯 `cancel`이 안 찍힌다고 "터치 센서가
  접촉을 놓쳤다 재획득"까지 배제되는 건 아님 — 그 경우도 그냥 정상적인 end/start로 보고될 수 있음,
  기대치를 낮춰서 참고할 것).
- **`document.elementFromPoint(x, y)`로 그 좌표에 실제로 뭐가 있었는지까지 같이 찍을 것**: 좌표만
  찍으면 "저기가 무슨 버튼이었는지" 나중에 스크린샷과 대조해야 해서 불편함 — 타겟 정보(버튼
  aria-label, disabled 여부)까지 한 줄에 있으면 로그만 보고도 바로 해석 가능.
- **끝나면 반드시 삭제**: 모든 접속자(테스트 참여자 아닌 사람 포함)에게 다 보이는 화면이라 오래
  켜둘 게 아님.

### 관련 파일 (과거 구현, 지금은 삭제됨 — 필요하면 이 커밋 이력에서 복원)
- `client/src/components/TouchDebugOverlay.tsx`
- `client/src/App.tsx`

---

## #21 이미 한 판 이상 진행한 방에서 재대결하면 가끔 목숨이 1개로 시작하거나 시작하자마자 끝남

### 증상

한 방에서 매치를 한 판 이상 끝내고 "나가기"(재대결)로 이어서 플레이하다 보면, 가끔 팀이 목숨(절구)
5개가 아니라 1개로 새 매치를 시작하거나, 심하면 시작하자마자 즉시 탈락해버림. 재현 조건이 뚜렷하지
않고 "가끔씩"만 발생.

### 원인 (확정, 회귀 테스트로 재현·검증함)

`MatchRoom.ts`의 턴 종료는 두 경로가 있음:
1. **자연 타임아웃**: `startTurn()`이 예약한 `clock.setTimeout`이 실제로 발동해서
   `onTurnTimerExpired()`가 실행.
2. **오답 프레스로 즉시 판정**: `handlePressButton()`이 오답을 받으면 그 자리에서 바로 목숨을
   깎고 `turnOutcome = "fail"`을 세팅하지만, **다음 턴으로의 실제 전환(hand-off)은 일부러 미룸** —
   그 턴이 원래 갖고 있던 4초 타이머(`startTurn()`이 이미 예약해둔 그 `clock.setTimeout`)가 만료될
   때까지는 화면에 "틀렸습니다" 상태를 그대로 보여주기 위해서(§#17 관련). 즉 오답으로 매치의 마지막
   목숨이 깎여 `isMatchOver()`가 이미 `true`가 된 시점에도, 그 턴의 원래 타이머는 **아직 안 끝난 채
   살아있음**.

이 상태에서 클라이언트가 "나가기"(관전 화면에서 `matchOver`일 때 자동으로 `rematch` 메시지 전송,
`SpectatorScreen.tsx`의 `handleLeaveClick`)를 보내면 `handleRematch()`가 실행되어 팀 목숨을
`STARTING_MORTARS`(5)로, `activeTeamIndex`를 0으로, `turnDecided`를 `false`로 리셋하고 `phase`를
`"lobby"`로 되돌림. **그런데 위 1번 경로의, 아직 살아있는 옛 타이머를 무효화하는 처리가
빠져있었음.** 새 턴이 시작될 때마다 `startTurn()`은 `turnToken`을 증가시켜서 이전 타이머의 콜백이
`if (token === this.turnToken)` 체크에 걸려 스스로 무력화되게 하는데, `handleRematch()`는 이
`turnToken`을 건드리지 않았음.

그 결과: 리셋 직후 아직 "lobby"에서 다음 매치를 위해 역할을 고르는 동안, 그 옛 타이머가 (원래
예정된 시각에) 실제로 발동함 → `onTurnTimerExpired()`가 실행됨 → `turnDecided`가 `handleRematch()`
때문에 이미 `false`로 리셋돼 있으므로 "아직 결정 안 된 턴이 타임아웃됐다"고 오인 →
`applyMortarLoss(teams[0])`을 호출해 **방금 5로 리셋한 팀의 목숨을 조용히 다시 깎음(5→4)**, 이어서
`advanceToNextTurn()`까지 호출해 `phase`가 여전히 `"lobby"`인 상태에서 유령 턴을 새로 시작시킴 —
이 유령 턴도 아무도 누르지 않으므로 결국 자기 타임아웃으로 또 한 번 목숨을 깎고, 그 다음 유령 턴을
또 예약하는 식으로 **사람들이 역할을 다 고르기 전까지 계속 이어질 수 있음**. 실제로 매치가
`maybeStartGame()`으로 진짜 시작될 즈음엔 이미 목숨이 몇 개 깎여있거나(가끔 1개로 시작), 심하면
0(탈락)까지 떨어져 있어서 시작하자마자 끝나는 것처럼 보임.

"가끔씩"만 재현되는 이유: 이 문제는 **매치가 오답 프레스로 끝났을 때만** 발생함(자연 타임아웃으로
끝났을 때는 그 타이머 자체가 "방금 발동한 그 타이머"라 애초에 살아있는 옛 타이머가 없음 —
`advanceToNextTurn()`이 모든 팀 탈락을 감지하고 그냈로 멈추는 게 전부). 게다가 오답으로 끝나도, 그
턴의 원래 4초가 다 지나기 전에 "나가기"를 눌러야만(=재대결 시점과 옛 타이머 만료 시점 사이에 아직
남은 시간이 있어야만) 재현됨 — 자연스럽게 사람에 따라, 클릭 타이밍에 따라 갈림.

### 수정

`handleRematch()` 맨 앞에 `this.turnToken++`를 추가 — `startTurn()`이 매 턴마다 이전 타이머를
무효화하는 것과 똑같은 방식으로, 재대결 리셋도 그 시점에 살아있는 모든 이전 타이머를 무효화하게
함. 최소 변경 한 줄로 근본 원인을 제거.

### 회귀 테스트

`server/src/rooms/MatchRoom.test.ts`에 `"a rematch sent right after the deciding press doesn't let
the just-ended match's still-pending turn timer drain mortars in the new lobby"` 추가 — 1팀 방에서
오답으로 4번 연속 목숨을 깎아 마지막 목숨(1)까지 남긴 뒤, **5번째(마지막) 오답 프레스 직후 원래
타이머가 끝나길 기다리지 않고 바로 `rematch`를 보내** 옛 타이머가 아직 살아있는 상태를 재현. 수정
전엔 재대결 직후 목숨이 5로 정상 리셋됐다가, 옛 턴의 원래 타이머가 발동하는 시점(대략
`turnDurationMs` 뒤)에 5→4로 조용히 다시 깎이는 게 안정적으로(3회 연속) 재현됐음 — 수정 후엔
안정적으로 통과.

### 관련 파일
- `server/src/rooms/MatchRoom.ts`
- `server/src/rooms/MatchRoom.test.ts`

---

## #22 팀이 3개 이상인 방에서, 내 팀만 탈락한 순간 "모든 팀이 탈락했습니다"로 잘못 표시되고 나가기가 안 먹힘

### 증상

팀 3개 이상인 방에서 오답으로 내 팀이 막 탈락한 직후(다른 팀은 아직 생존 중) 잠깐 "모든 팀이
탈락했습니다" 문구가 뜨고, 이 상태에서 "나가기"를 눌러도 반응이 없음.

### 원인

`SpectatorScreen.tsx`가 매치 전체 종료 여부(`matchOver`)를 `activeTeam.eliminated`로 판정하고
있었음 — `activeTeam`은 "현재 턴인 팀"인데, #21에서 확인했듯 오답으로 팀이 탈락해도 실제 턴 전환은
그 턴의 원래 4초 타이머가 끝날 때까지 미뤄짐. 즉 **내 팀이 방금 오답으로 탈락한 바로 그 순간엔,
`activeTeam`이 여전히(아직 전환 안 됐으니) 방금 탈락한 내 팀 자신**이라 `activeTeam.eliminated`가
`true`가 되어버림 — 다른 팀이 몇이나 남아있든 상관없이. `handleLeaveClick`은 `matchOver`가 true면
`onLeave()` 대신 `room.send("rematch")`를 보내는데, 서버의 `handleRematch()`는 진짜
`isMatchOver()`(전체 팀 탈락)일 때만 반응하므로 이 잘못된 시점의 rematch는 조용히 무시됨 — 상태
오염은 없지만(#21과 달리 서버 쪽은 정상) 사용자 입장에선 "나가기가 안 먹힌다"로 보임.

### 수정

`matchOver`를 `activeTeam.eliminated` 대신 `teams.every((t) => t.eliminated)`로 계산 — 서버의
`isMatchOver()`와 동일한 기준. `SpectatorScreen`은 이미 `room.state`에서 `teams`를 구조분해해서
갖고 있었으므로 추가 prop 없이 수정 가능.

### 관련 파일
- `client/src/components/SpectatorScreen.tsx`

---

## #23 온라인 채팅에 한글을 입력하면 가끔 글자 순서가 거꾸로 뒤집힘 ("안녕하세요" → "요세하녕안")

### 증상

온라인 모드(로비 또는 관전 화면)에서 한글로 채팅을 치면, 가끔 입력한 순서와 반대로 뒤집혀서
전송됨. 영어/숫자에서는 보고되지 않았고, 오프라인(솔로) 모드에는 애초에 채팅이 없어서 재현 불가 —
온라인에서만 발생.

### 원인

`ChatBox.tsx`의 메시지 입력창은 지극히 평범한 React 컨트롤드 인풋(`value={draft}` +
`onChange`)이라 그 자체엔 문제가 없음. 문제는 **얼마나 자주 리렌더되는가**였음:

- `useMatchRoom.ts`가 colyseus의 모든 상태 패치(`onStateChange`)마다 `forceRender()`를 호출해서
  `Game` 트리 전체를 강제로 다시 그림 — 본인이 치는 채팅과 전혀 무관한 변화(다른 플레이어의 버튼
  입력, 턴 종료, 팀 상태 변화 등)에도 매번 트리거됨.
- `ChatBox`는 메모이제이션이 안 되어 있어서 이 강제 리렌더가 있을 때마다 같이 다시 그려졌고, 그
  안의 `<input>`도 매번 다시 그려짐.
- React는 컨트롤드 `<input>`의 `value`를 **값이 실제로 바뀌었는지와 무관하게 커밋마다 DOM
  `.value` 프로퍼티에 다시 씀**(내부적으로 DOM이 React 모르게 어긋나는 걸 막기 위한 방어 동작).
  평범한 영어 타이핑 한 글자는 원자적(atomic) 삽입이라 이 재동기화가 끼어들어도 별 문제가 없지만,
  **한글은 IME가 자모를 조합해서 한 음절을 완성하는 중간 과정 자체가 여러 단계의 DOM 값 갱신으로
  이루어짐** — 이 조합이 진행되는 도중에 리렌더가 끼어들어 커서 위치가 흐트러지면, 다음 조합
  글자가 끝이 아니라 맨 앞에 삽입되는 식으로 어긋날 수 있음. 매 글자가 이런 식으로 계속 앞에
  붙으면 결과적으로 전체 문자열이 거꾸로 뒤집힌 것처럼 보임 — 정확히 보고된 증상과 일치.

### 수정

`ChatBox`를 `React.memo`로 감싸서, 본인 타이핑과 무관한 리렌더가 이 컴포넌트까지 전파되지 않게
막음. 다만 첫 시도에서 진짜 버그를 하나 더 만들었음 — 자세한 경위는 아래 "삽질 기록" 참고. 최종
구현:

1. `ChatBox`에 커스텀 비교 함수(`chatPropsEqual`)를 넣은 `memo()` 적용.
2. 비교 기준은 `messages` 배열 자체가 아니라, 호출부(`RoleSelect.tsx`/`SpectatorScreen.tsx`)가
   **자신의 렌더 시점에 미리 계산해서 넘겨주는 원시값(primitive)** `messageCount`(길이)와
   `lastMessageAt`(가장 최근 메시지의 `sentAt`) 두 개.
3. 두 화면의 `sendChat` 함수를 `useCallback(..., [room])`으로 고정 — 매 렌더마다 새로 만들어지는
   함수 참조는 `onSend` prop 비교를 항상 실패시켜 메모이제이션을 무력화하므로.

### 삽질 기록 — 첫 시도가 메시지 자체를 안 보이게 만듦

처음엔 `messages` 배열을 직접 비교하는 커스텀 comparator를 짰음(`messages.length`와 마지막 원소의
참조를 비교). 로컬에서 두 탭(P1/P2)으로 검증하던 중, **같은 탭에서 두 번째로 보낸 메시지가 화면에
영영 안 뜨는** 새 버그를 발견 — 첫 메시지는 우연히 떴는데(입력창에 타이핑하면서 생긴 `draft`
state 갱신이 마침 서버 왕복 이후에 일어나 얻어걸림), 두 번째부터는 그 어떤 리렌더도 안 일어남.

원인: `lobbyChat`/`matchChat`은 colyseus가 **제자리(in-place)로 mutate**하는 배열이라(`useMatchRoom.ts`의
`forceRender()`가 애초에 존재하는 이유와 동일한 특성 — CLAUDE.md Gotchas 참고), `React.memo`가
비교 시점에 들고 있는 "이전 props"와 "새 props"의 `messages` 필드는 사실 **같은 배열 객체를
가리키는 같은 참조**임. 비교 함수 안에서 `prev.messages.length`와 `next.messages.length`를 읽으면
결국 같은(이미 최신 상태로 바뀐) 객체의 길이를 두 번 읽는 꼴이라 **항상 같다고 나옴** — 배열이
실제로 몇 번을 바뀌어도 절대로 "달라졌다"고 감지가 안 됨. 서버 쪽 데이터는 항상 정상이었음(재현
중 실제로 두 번째 메시지가 로비 이력에 정상적으로 남아있었던 것으로 확인) — 순수하게 클라이언트
리렌더 억제 버그였음.

교훈: colyseus의 in-place mutation과 `React.memo`/커스텀 comparator를 같이 쓸 땐, **비교 대상
자체(mutable 배열)를 comparator 안에서 다시 읽으면 안 되고**, 호출부가 렌더 시점에 미리 뽑아낸
원시값만 비교해야 함 — `SequenceBoard`의 `Token` 서브컴포넌트가 이미 쓰고 있던 패턴(원시값 파생
후 전달)과 동일한 이유.

### 검증

로컬 두 탭(P1 방 생성 + P2 입장)으로 확인:
- P2가 메시지를 연속으로 두 번 보내고, P1 탭은 전혀 건드리지 않은 채 채팅 목록을 확인 → 두 메시지
  모두 정상적으로 순서대로 도착(수정 전엔 두 번째부터 영영 안 보임).
- P1이 채팅 입력창에 초안을 입력해두고, 그 사이 P2가 역할을 여러 번 바꿔서(채팅과 무관한 상태
  변화) 여러 번의 강제 리렌더를 유발 → P1의 초안 텍스트가 그대로 유지됨(리렌더가 실제로 억제되고
  있다는 뜻 — 이 부분이 원래 목표였던 IME 리렌더 간섭 차단의 대리 검증).
- 진짜 한글 IME 조합 이벤트 자체는 Playwright로 재현이 어려워(자동화 타이핑은 완성된 문자열을
  한 번에 넣거나 개별 keydown으로 보내지, 실제 브라우저의 IME 조합 시퀀스를 만들지 않음) 직접
  재현 검증은 못 했음 — 실기기(친구들)에서 재발 여부 확인 필요.

### 관련 파일
- `client/src/components/ChatBox.tsx`
- `client/src/components/RoleSelect.tsx`
- `client/src/components/SpectatorScreen.tsx`

---

## #24 `/code-review` 전체 점검(8관점 병렬 에이전트 + 검증)으로 찾은 버그 9건 수정

미푸시 커밋 58개(사실상 프로젝트 전체)를 대상으로 `/code-review` 스킬을 돌려 8개 관점(정확성 3 +
재사용/단순화/효율성 + 아키텍처 깊이 + 컨벤션) 병렬 에이전트로 후보를 찾고, 각 후보를 실제 코드
추적으로 재검증한 뒤 우선순위 상위 10건 중 9건(호스트 닉네임 미갱신 1건 제외)을 수정. 발견 방식
자체가 재사용 가치가 있어 기법만 별도로 기록: 8개 파인더 에이전트(각자 최대 6개 후보, file/line/
summary/failure_scenario 형식)를 병렬로 띄운 뒤, 후보를 유사 위치별로 묶어 소수의 검증 에이전트에
"실제 코드를 읽고 CONFIRMED/PLAUSIBLE/REFUTED로 판정"시키는 2단계 구조 — 파인더 8개는 재현율
우선(느슨하게 후보를 많이 냄), 검증 단계에서 실제 코드 대조로 걸러냄.

### 1. 라운드 중간에 한 팀이 탈락하면 라운드가 조기에 올라감 (3팀 이상 방)

**원인**: `advanceToNextTurn()`이 `turnsThisRound`를 그 turn 시점에 **막 재계산한** `aliveCount`와
비교했음 — 방금 탈락한 팀이 그 계산에서 즉시 빠지면서, 아직 이번 라운드 턴을 안 받은 다른 생존
팀이 있어도 `turnsThisRound >= aliveCount`가 조기에 참이 됨.

**수정**: `teamsAliveAtRoundStart` 필드를 추가해 라운드 시작 시점에 고정 — `maybeStartGame()`에서
초기화하고, 라운드가 실제로 넘어갈 때만 다음 라운드용으로 재계산. 비교 기준을 이 고정값으로 교체.

**회귀 테스트**: `MatchRoom.test.ts`에 3팀 방에서 team2를 목숨 1개로 세팅 → team1 성공 → team2
오답으로 탈락(아직 team3는 이번 라운드 턴 전) → 이 시점 `round`가 여전히 1이고 다음 차례가 team3인지
확인 → team3 성공 후에야 `round`가 2로 넘어가는지 확인하는 테스트 추가. 수정 전 실패, 수정 후 통과
확인.

### 2. 터치 중복방지 맵이 색상당 슬롯 1개뿐이라 빠른 연속 실제 터치 시 프레스가 서버로 3번 전송될 수 있음

**원인**: `touchHandledAtRef`가 `Map<Color, number>`(색상당 타임스탬프 1개)였음. 같은 버튼에 대한
두 번의 실제 터치(민트 연타 패턴)가 들어오면 두 번째 터치가 첫 번째의 슬롯을 덮어씀. 이후 지연
발생한 두 개의 합성 click 이벤트 중 첫 번째가 그 유일한 슬롯을 delete-on-consume으로 소비해버려서,
두 번째 click은 매칭되는 항목을 못 찾고 dedupe를 그냥 통과 — 실제 입력은 2번인데 서버로는 3번
전송됨.

**수정**: `Map<Color, number[]>`(색상당 타임스탬프 배열)로 교체 — 매 touchstart가 자기 항목을
큐에 추가하고, 매 click이 자기 몫 하나만(전체가 아니라) 소비. touchstart 시점에 오래된(윈도우
밖) 항목도 같이 정리해서 배열이 무한정 안 커지게 함.

### 3. 민트 연타 사운드 스트릭이 턴 경계를 못 넘어가서 팀원/관전자와 다른 소리를 들을 수 있음

**원인**: `mintStreakRef`가 "마지막 비민트 프레스 이후 연속 민트 횟수"를 로컬에서만 추적하는데,
턴이 바뀌어도 리셋 안 됨 — 같은 팀이 연속으로 턴을 받으면(생존 팀 등, `ButtonPanel`이 언마운트
안 됨) 이전 턴 끝의 스트릭이 다음 턴 시퀀스에 그대로 이어짐. 반면 `useSequencePressSound`(팀원/
관전자가 듣는 소리)는 매번 실제 `sequence`/`cursor`에서 새로 계산 — 두 알고리즘이 독립적이라
어긋날 수 있음.

**수정**: `disabled` prop이 `true → false`로 전환(=새 턴 시작, `MyTurnScreen`의 `turnOutcome`이
`"pending"`으로 리셋되는 시점과 일치)될 때 `mintStreakRef.current = 0`으로 리셋하는 `useEffect` 추가.

### 4. 채팅 자동 스크롤이 50개 메시지 넘으면 멈춤

`docs/TROUBLESHOOTING.md` #23에서 memo comparator만 `lastMessageAt` 기준으로 고치고, 자동 스크롤
`useEffect`의 의존성 배열은 여전히 `messages.length`로 남겨뒀던 걸 놓침 — 50개 캡 이후로는
`.length`가 영원히 고정이라 새 메시지가 와도(memo는 정상적으로 리렌더하지만) 스크롤은 안 내려감.
`useEffect` 의존성을 `lastMessageAt`으로 교체.

### 5. `generateSequence(1, rng)`가 요청한 길이(1)보다 긴 배열(2)을 반환

**원인**: 돼지 조각(`generatePigFragment`)과 토끼 페어 조각(`generateRabbitPairFragment`)이 항상
길이 2, 민트런도 최소 길이 2(`MINT_RUN_LENGTHS = [2,4,6]`)라 — 이 함수가 만들 수 있는 조각 중
길이 1은 아예 없음. `remaining`이 1이 되는 순간(홀수 `totalLength`) 어떤 조각을 골라도 오버슈트.
실제로는 `sequenceLengthForRound`가 항상 6의 배수(짝수)만 반환해서 프로덕션에서는 절대 안
터지지만, 순수 함수 자체의 계약(정확히 요청한 길이 반환, `sequence.test.ts`가 검증) 위반.

**수정**: `totalLength`가 홀수면 즉시 에러를 던지도록 가드 추가 — 조용히 오버슈트하는 대신 잘못된
입력임을 명시적으로 실패시킴. 회귀 테스트 추가(`generateSequence(1, ...)`/`generateSequence(17,
...)`가 던지는지 확인).

### 6. 턴 결과(성공/실패) 효과음이 오디오 풀링 없이 매번 새 `Audio()` 생성

`TurnOutcomeBanner.tsx`가 `clickSound.ts`의 `audioPool` 패턴을 안 쓰고 매 턴 결과마다
`new Audio()`를 새로 만들었음 — `clickSound.ts`가 바로 이 비용(iOS 메인스레드 작업, 터치
반응성 저하) 때문에 풀링을 도입했다고 명시한 지점과 정확히 같은 타이밍(턴 경계, 버튼
활성/비활성 전환 순간)에 그 비용을 다시 지불하고 있었음. `clickSound.ts`의 `playSrc` 헬퍼를
export해서 재사용하도록 교체.

### 7. `MatchRoom.handlePressButton`이 매 프레스마다 시퀀스 전체를 복사

`Array.from(this.state.sequence)`로 최대 48개짜리 배열을 매 버튼 입력마다 복사했는데,
`attemptPress`는 인덱스 접근과 길이만 씀 — 둘 다 colyseus `ArraySchema`가 복사 없이 그대로
지원. 타입 전용 캐스트(`as unknown as Color[]`)로 교체해 런타임 복사 제거.

### 8. `TeamRosterPanel`이 메모이제이션 안 되어 있어 무관한 상태 변화에도 매번 리렌더

형제 컴포넌트(`SequenceBoard`의 `Token`, `ButtonPanel`, `ChatBox`)는 다 메모이제이션됐는데 이것만
빠져있었음 — `forceRender()`가 모든 colyseus 패치(커서 이동 등, 팀/로스터와 무관한 것 포함)마다
전체 트리를 리렌더시키는 구조라, 매번 mortar 아이콘 배열 재할당 + DOM 재diff가 낭비됨.

`teams`가 colyseus ArraySchema로 제자리 mutate되므로(#23에서 배운 함정과 동일), 기본 `React.memo`
얕은 비교로는 절대 리렌더를 못 감지하고 영구히 멈춰버림 — `id`/`pigSessionId`/`rabbitSessionId`/
`mortars`/`eliminated` 필드를 팀별로 직접 비교하는 커스텀 comparator로 메모이제이션. `players`
Map은 비교에서 제외(이 패널은 "playing" 단계에서만 렌더되는데, 그땐 `onJoin`이 새 입장을 막고
기존 세션의 닉네임도 안 바뀌므로 — 좌석에 표시되는 닉네임이 바뀌는 유일한 경우는 팀의
pigSessionId/rabbitSessionId 자체가 바뀌는 것뿐이고, 그건 이미 비교 대상).

### 9. 옛 턴 타이머 무효화 로직(`turnToken++`)이 두 곳에 손으로 복붙되어 있었음 (아키텍처)

`startTurn()`과 `handleRematch()` 둘 다 "진행 중인 턴 타이머를 무효화한다"는 같은 패턴을 각자
`this.turnToken++`로 직접 구현 — #21이 바로 이 무효화를 빠뜨려서 난 버그였는데, 공유 헬퍼가 없어
다음에 또 다른 전환(예: 강제 몰수패)이 같은 처리를 빠뜨리기 쉬운 구조였음. `invalidateInFlightTurn()`
private 메서드로 추출해 두 곳 다 이걸 호출하도록 변경 — 동작은 동일, 앞으로 실수로 빠뜨릴 여지만
줄임.

### 검증

서버: 신규/기존 테스트 79개 전체 통과(`generateSequence` 홀수 가드 테스트 1개, 3팀 라운드 조기
증가 회귀 테스트 1개 추가), `tsc --noEmit` 통과. 클라이언트: `tsc -b`/`oxlint` 통과, 로컬에서 4명
(2팀) 실제 매치를 라운드 6(전멸)까지 진행하며 라운드 증가·로스터 갱신·탈락 표시·채팅 동기화가
전부 정상 동작하고 콘솔 에러가 없는 것을 확인(터치 dedupe/민트 스트릭은 실제 iOS 터치 이벤트를
자동화로 재현할 수 없어 로직 추적으로만 검증 — 실기기 재확인 필요).

### 관련 파일
- `server/src/rooms/MatchRoom.ts`
- `server/src/rooms/MatchRoom.test.ts`
- `server/src/game/sequence.ts`
- `server/src/game/sequence.test.ts`
- `client/src/components/ButtonPanel.tsx`
- `client/src/components/ChatBox.tsx`
- `client/src/components/TurnOutcomeBanner.tsx`
- `client/src/components/TeamRosterPanel.tsx`

---

## #25 민트 버튼 연타(스팸) 방어 — 온라인 매치에만 적용, 계측용 임시 도구는 재사용 설계만 기록 후 삭제

### 배경

친구 중 한 명이 폰에 키보드/매크로 앱을 연결해 버튼 위치에 키를 매핑, 손가락 한계보다 빠르게
연타하는 방식으로 플레이한다는 걸 알게 됨(밴은 불가 — 친구라서). 웹에는 "키보드가 연결돼
있는지" 감지하는 API가 없고(WebHID는 사용자 권한 필요+iOS Safari 미지원, Keyboard API는
레이아웃 조회용, Gamepad API는 무관), 애초에 이런 부정행위는 OS 레벨 키 리매핑으로 합성
터치/클릭을 만들어내는 방식이라 JS 이벤트만 봐서는 손가락 입력과 구분 자체가 불가능함. 그래서
탐지 대신 **타이밍 임계값으로 너무 빠른 입력을 그냥 막아버리는** 방향으로 결정.

### 결정 사항

- **민트 버튼(토끼)에 한정** — 이 게임에서 같은 버튼을 반복해서 눌러야 하는 유일한 패턴이 민트 런
  (`mintRun`, `server/src/game/fragments.ts`)이라, 손가락 재입력 속도의 한계가 가장 잘 드러나는
  자리이기 때문. 다른 색은 건드리지 않음.
- **모든 프레스에 적용**(턴의 첫 프레스만이 아니라) — `SequenceBoard.tsx`가 전체 시퀀스를 미리
  보여주므로 숙련자가 뒷부분을 미리 계획해 빠르게 누르는 것도 이론상 가능하지만, 더 공격적인
  쪽을 선택(사용자 확인).
- **임계값 50ms** — 연구 기반 수치가 아니라, 아래에서 설명하는 임시 계측 도구로 사용자가 직접
  터치/z·x키 연타 속도를 재보고 정한 값. `server/src/game/mintSpamGuard.ts`의
  `MINT_SPAM_THRESHOLD_MS`.
- **씹힘 방식은 완전 무시** — 절구 감점이나 오답 판정 없이 그냥 `return`(상태 변화도, 클라이언트
  메시지도, 관리자 이벤트 로그도 없음). 손가락으로 누른 게 그냥 안 눌린 것과 동일하게 보임.
- **직전 프레스 시각은 색 무관, 씹힌 시도 포함 매번 갱신** — 연타가 임계값보다 빠르게 계속되면
  그 다음 시도도 계속 직전(씹힌) 시도를 기준으로 재판정되어 스스로 계속 막히는 자기-차단 구조.

### 왜 온라인 매치(`MatchRoom.ts`)에만 있고 혼자 연습 모드엔 없는지

처음엔 클라이언트 쪽 `useSoloMatch.ts`(혼자 연습 모드)에도 서버와 동일한 로직을
`client/src/game/mintSpamGuard.ts`로 수동 이식해서 넣어봤음(`soloEngine.ts`가 서버 게임 로직을
클라이언트에 미러링해두는 것과 같은 패턴). 브라우저로 실제 확인도 했고(6연속 민트 연타 중
1개만 통과, 나머지는 자기-차단으로 계속 씹힘) 정상 동작했음.

하지만 목적을 다시 생각해보면 **부정행위는 온라인 매치에서만 문제가 됨** — 혼자 연습 모드는
서버를 아예 거치지 않는 로컬 전용 로직(`soloEngine.ts`)이라 다른 사람과 경쟁하는 자리가 아니고,
여기서 빠르게 누른다고 누구에게도 피해가 안 감. 그래서 최종적으로 **온라인 매치의 서버 코드
(`server/src/rooms/MatchRoom.ts`)에만 가드를 남기고**, 혼자 연습 모드 쪽 이식은 되돌림 —
`useSoloMatch.ts`에서 관련 코드 제거, `client/src/game/mintSpamGuard.ts`(클라이언트 사본)는
완전히 삭제. 서버 쪽 `server/src/game/mintSpamGuard.ts`/`server/src/rooms/MatchRoom.ts`의 가드는
그대로 유지됨 — 지금 실제로 배포되는 코드는 이것 하나뿐.

### 삭제된 임시 계측 도구 — 나중에 비슷한 걸 또 만들 상황이 오면 재사용

50ms 임계값을 직접 정하기 위해, 혼자 연습 모드 진입 화면에 임시 버튼으로 진입하는 계측 전용
화면을 만들었었음(`ReactionTimeTest.tsx`) — 민트 버튼 하나만 뜨는 화면에서 터치/키보드 z·x키로
연타하면 직전 입력과의 간격(ms)을 바로 아래에 보여주고, 최근 20개 평균도 계산. 나중엔 여기에도
위 가드를 그대로 적용해서 50ms 미만 입력이 "⛔ 씹힘 (Nms — 50ms 미만)"으로 표시되게 만들어서
실제 게임과 동일한 체감을 여기서도 확인할 수 있게 했었음.

이 도구는 실제 게임 화면에 반영할 계획이 없는 순수 계측용이라 사용자 요청으로 완전히 삭제함
(온라인에만 가드를 남기기로 한 결정과 같은 이유 — 실제 배포 코드엔 필요 없음). 한 번도 git에
커밋된 적이 없어서 커밋 이력으로 복원이 안 됨 — 나중에 또 필요하면 아래 전체 코드를 그대로
복사해서 쓰면 됨.

**`client/src/components/ReactionTimeTest.tsx` (최종 버전 — 가드 적용 포함):**

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { COLOR_TOKEN } from "../game/colors";
import { isSpammedMintPress } from "../game/mintSpamGuard"; // 삭제됨 — 재사용 시
  // server/src/game/mintSpamGuard.ts를 client/src/game/mintSpamGuard.ts로 그대로 복사
import styles from "./ReactionTimeTest.module.css";

const HISTORY_LIMIT = 20;

export function ReactionTimeTest({ onBack }: { onBack: () => void }) {
  const [lastIntervalMs, setLastIntervalMs] = useState<number | null>(null);
  const [history, setHistory] = useState<number[]>([]);
  const [blockedIntervalMs, setBlockedIntervalMs] = useState<number | null>(null);
  const lastPressAtRef = useRef<number | null>(null);

  const handlePress = useCallback(() => {
    const now = Date.now();
    const previous = lastPressAtRef.current;
    lastPressAtRef.current = now;
    if (previous === null) return;

    const interval = now - previous;
    if (isSpammedMintPress("mint", interval)) {
      setBlockedIntervalMs(interval);
      return;
    }

    setBlockedIntervalMs(null);
    setLastIntervalMs(interval);
    setHistory((prev) => [interval, ...prev].slice(0, HISTORY_LIMIT));
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const key = e.key.toLowerCase();
      if (key === "z" || key === "x") handlePress();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handlePress]);

  function handleTouchStart(e: React.TouchEvent) {
    e.preventDefault();
    handlePress();
  }

  function handleReset() {
    lastPressAtRef.current = null;
    setLastIntervalMs(null);
    setHistory([]);
    setBlockedIntervalMs(null);
  }

  const average =
    history.length > 0 ? Math.round(history.reduce((sum, ms) => sum + ms, 0) / history.length) : null;

  return (
    <div className={styles.wrap}>
      <h1 className={styles.title}>입력 속도 테스트 (임시)</h1>
      <p className={styles.hint}>화면을 연타하거나 키보드 z / x 키를 연타해보세요 — 누른 간격(ms)을 잽니다</p>

      <button
        type="button"
        className={styles.button}
        onTouchStart={handleTouchStart}
        onClick={handlePress}
        style={{ backgroundImage: `url(${COLOR_TOKEN.mint})` }}
        aria-label="mint"
      />

      <div className={styles.status}>
        {blockedIntervalMs !== null ? (
          <p className={styles.result}>⛔ 씹힘 ({blockedIntervalMs}ms — 50ms 미만)</p>
        ) : lastIntervalMs !== null ? (
          <p className={styles.result}>간격: {lastIntervalMs}ms</p>
        ) : (
          <p className={styles.result}>버튼을 눌러 시작하세요</p>
        )}
        {average !== null && (
          <p className={styles.average}>
            평균 {average}ms ({history.length}회)
          </p>
        )}
      </div>

      {history.length > 0 && (
        <div className={styles.history}>
          <p className={styles.historyLabel}>최근 기록 (ms, 최신순)</p>
          <div className={styles.historyList}>
            {history.map((ms, i) => (
              <span key={i} className={styles.historyItem}>
                {ms}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className={styles.actions}>
        <button className={styles.backLink} onClick={handleReset}>
          기록 초기화
        </button>
        <button className={styles.backLink} onClick={onBack}>
          ← 뒤로
        </button>
      </div>
    </div>
  );
}
```

**`client/src/components/ReactionTimeTest.module.css`:**

```css
.wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  color: #fff;
  text-align: center;
  flex: 1;
  padding: 1.5rem;
  box-sizing: border-box;
}

.title {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 800;
}

.hint {
  margin: 0;
  opacity: 0.75;
  font-size: 0.9rem;
}

.button {
  width: 9rem;
  height: 9rem;
  border-radius: 999px;
  border: none;
  cursor: pointer;
  background-color: #1b3a37;
  background-size: cover;
  background-position: center;
  margin: 1.5rem 0;
  transition: transform 0.05s ease;
}

.button:active {
  transform: scale(0.94);
}

.status {
  min-height: 3.5rem;
}

.result {
  margin: 0;
  font-size: 1.3rem;
  font-weight: 700;
}

.average {
  margin: 0.3rem 0 0;
  font-size: 0.9rem;
  opacity: 0.75;
}

.history {
  width: 100%;
  max-width: 22rem;
}

.historyLabel {
  margin: 0 0 0.4rem;
  font-size: 0.8rem;
  opacity: 0.7;
}

.historyList {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  justify-content: center;
}

.historyItem {
  padding: 0.2rem 0.6rem;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.1);
  font-size: 0.85rem;
}

.actions {
  display: flex;
  gap: 1rem;
  margin-top: 1rem;
}

.backLink {
  background: none;
  border: none;
  color: #fff;
  opacity: 0.75;
  font-size: 0.9rem;
  cursor: pointer;
}

.backLink:hover {
  opacity: 1;
}
```

**진입 지점 wiring** (`SoloRoleSelect.tsx`/`App.tsx`에 있던 것 — 지금은 제거됨): `SoloRoleSelect`가
`onOpenReactionTest: () => void` prop을 받아 역할 선택 버튼들 아래에 "반응속도 테스트 (임시)"
버튼을 하나 더 렌더링했고, `App.tsx`의 `OfflineFlow`가 `showReactionTest` state로 그 버튼 클릭 시
`<ReactionTimeTest onBack={...} />`를 역할 선택 화면 대신 렌더링하도록 분기했음. 재사용 시 이
두 파일에 각각 prop 하나, state 하나, 분기 하나만 다시 추가하면 됨(둘 다 몇 줄 안 됨, 이 문서를
읽는 사람이 직접 짜도 충분히 간단한 수준이라 diff는 따로 안 남김).

### 관련 파일
- `server/src/game/mintSpamGuard.ts`, `server/src/game/mintSpamGuard.test.ts` (당시 실제 배포되던 가드 — **이후
  `inputSpamGuard.ts`/`inputSpamGuard.test.ts`로 이름이 바뀌고 돼지 4색까지 대상이 넓어짐, 아래 참고**)
- `server/src/rooms/MatchRoom.ts`, `server/src/rooms/MatchRoom.test.ts`
- `client/src/game/useSoloMatch.ts` (가드 이식했다가 되돌림)
- `client/src/components/ReactionTimeTest.tsx`, `.module.css` (과거 구현, 지금은 삭제됨 — 위 코드로 복원)
- `client/src/components/SoloRoleSelect.tsx`, `client/src/App.tsx` (진입점 wiring도 제거됨)

### 업데이트 (2026-07-21) — 돼지까지 확장, 파일명 변경

민트에 한정됐던 가드를 돼지 4색(빨강/주황/노랑/보라)까지 넓힘. 돼지 조각(`[색상, 보라]`)은 같은 색이 연속으로
나오는 구조 자체가 없어서(민트 런과 달리) "같은 버튼 연타"가 아니라 "색이 바뀌었는데도 인식·반응하기엔 너무
빠른 입력"을 잡는 용도 — 그래서 민트(35ms)보다 훨씬 타이트한 `PIG_SPAM_THRESHOLD_MS = 5`를 씀. 더 이상
"민트 전용"이 아니라서 파일도 `server/src/game/mintSpamGuard.ts` → `inputSpamGuard.ts`로, 함수도
`isSpammedMintPress(color, ms)` → `isSpammedPress(color, ms)`(내부에서 `color === "mint"`면 민트 임계값,
`colorRole(color) === "pig"`면 돼지 임계값 적용)로 이름을 바꿈. 위 코드 예시(계측용 도구, 강제 퇴장 관련 등)의
`isSpammedMintPress`/`mintSpamGuard.ts` 표기는 당시 기준 그대로 남겨둠 — 재사용할 땐 이 업데이트를 반영해서
`isSpammedPress`/`inputSpamGuard.ts`로 옮겨 쓸 것.

### 관련 파일 (2026-07-21 이후 실제 배포되는 가드)
- `server/src/game/inputSpamGuard.ts`, `server/src/game/inputSpamGuard.test.ts`
- `server/src/rooms/MatchRoom.ts`

---

## #26 관리자 페이지 입장/퇴장 로그에 닉네임 "?"인 유령 퇴장이 찍힘 — onAuth는 통과했지만 onJoin이 거절한 세션

### 증상

관리자 페이지의 입장/퇴장 로그에 대응하는 "입장" 기록 없이 뜬금없이 닉네임 "?"인 "퇴장" 기록만 남는 경우가
있었음. 방이 꽉 찼을 때 들어오려던 사람, 관전 비허용 방에 관전하려던 사람들이 이걸 유발함.

### 원인 (확정, `node_modules/@colyseus/core/build/Room.js`의 `_onJoin` 확인)

Colyseus는 `onAuth`가 성공한 뒤 `onJoin`을 호출하는데, `onJoin`이 그 안에서 로직상 이유로(방이 꽉 참,
관전 비허용 등) `throw`하면 `_onJoin`의 catch 블록이 뒷정리로 `this._onLeave(client, ...)`를 호출해서
우리 `onLeave`가 실행된다. 문제는 이 시점에 그 세션은 `state.players`(또는 `state.spectators`)에 **한
번도 등록된 적이 없다**는 것 — `onJoin`이 `state.players.set(...)`에 도달하기 전에 이미 throw했기
때문. 그래서 `MatchRoom.ts`의 옛 `onLeave`가 `this.state.players.get(client.sessionId)?.nickname ??
"?"`로 닉네임을 못 찾아 "?"를 기록했음. 즉 **"입장 시도 자체가 거절된 상황"이 로그에는 "퇴장"으로 잘못
기록되는 것** — 실제 "입장" 로그는 아예 안 남고(`state.players.set` 전에 throw했으므로 join 이벤트 기록
코드에도 도달 못 함), "퇴장(닉네임 ?)"만 남아서 더 헷갈리게 보였음.

### 수정

`onLeave` 맨 위(관전자 분기 바로 다음)에 가드 추가: `if (!this.state.players.has(client.sessionId))
return;` — 이 세션이 `state.players`에 등록된 적이 없으면(=진짜 퇴장이 아니라 onJoin 뒷정리로 불린
것) 아무 것도 기록하지 않고 조용히 무시. 이 가드는 나중에 유저 밴 기능의 재접속 우회 수정(`#28`)에서도
그대로 재활용됨(재귀 호출된 `onLeave`를 끊어주는 역할).

### 검증

`server/src/rooms/MatchRoom.test.ts`에 "방이 꽉 찬 상태에서 입장 거절당해도 관리자 로그에 '퇴장' 이벤트가
안 남는지" 회귀 테스트 추가.

### 관련 파일
- `server/src/rooms/MatchRoom.ts`, `server/src/rooms/MatchRoom.test.ts`

---

## #27 Docker 재배포 시 볼륨을 named volume으로 잘못 잡아 실제 DB 대신 빈 DB를 보게 됨 + 뒤이은 세션 계정 뒤섞임

### 증상

관리자 밴 기능 배포 중, 컨테이너 교체 직후 "DB가 다 날아갔다"는 보고. 실제로는 유저 174명이 있어야 하는데
새 컨테이너가 완전히 텅 빈 스키마로 시작한 것처럼 보임. 곧이어 별개로 "닉네임이 다 꼬여있다"(A라는
닉네임 계정에 로그인했는데 실제로는 B의 계정 데이터가 보임)는 보고도 들어옴.

### 원인 (확정)

**1차 원인 — 볼륨 종류 혼동:** 이 프로젝트는 SQLite DB를 EC2 호스트의 `/home/ec2-user/songpyeon-data/`
디렉토리에 **바인드 마운트**(`-v /home/ec2-user/songpyeon-data:/app/server/data`)해서 영속시킨다
(`docs/superpowers/plans/2026-07-19-google-login.md`에 원래 설계돼 있음). 그런데 컨테이너 교체
커맨드를 새로 짤 때 `-v songpyeon-data:/app/server/data`라고 씀 — 앞에 슬래시가 없어서 이건 호스트 경로가
아니라 Docker가 관리하는 완전히 별개의 저장 공간인 **네임드 볼륨**으로 해석됨. 공교롭게도 이 이름의
네임드 볼륨이 과거(다른 시점의 시행착오로) 이미 만들어져 있던 상태라 `docker volume ls`로 봐도 "어 이미
있네" 하고 그냥 넘어가기 쉬웠음. 새 컨테이너는 이 텅 빈(또는 예전에 살짝만 쓰인) 네임드 볼륨을 보고
시작했으므로, 실제 유저 174명이 있는 진짜 DB(바인드 마운트 경로)는 전혀 건드리지 않은 채 그대로 안전하게
남아있었지만, 컨테이너 입장에서는 안 보이는 상태였음.

**2차 원인 — 세션 쿠키가 숫자 id를 그대로 담고 있음:** `server/src/auth/session.ts`의 `signSession`이
세션 JWT에 `userId`(숫자 PK)를 그대로 서명해 넣는다. 1차 원인으로 인한 잘못된(텅 빈) DB가 떠 있던
동안, 이미 로그인돼 있던 몇몇 친구들이 뭔가 요청을 보내거나 재로그인을 하면서 `getOrCreateUser`가 그
텅 빈 DB 기준으로 새 계정을 만들었는데, 이때 발급된 새 세션 쿠키는 텅 빈 DB에서 막 배정된 **낮은
id**(3, 7 등)를 담고 있었음. 나중에 볼륨을 올바르게 고쳐서 진짜 DB로 다시 연결했을 때, 그 사람들의
브라우저엔 여전히 "텅 빈 DB 기준 낮은 id"가 담긴 쿠키가 남아있었고, 그 id가 진짜 DB에서는 완전히 다른
(아주 초기에 가입한) 사람의 계정을 가리키는 바람에 로그인 상태가 서로 뒤섞인 것처럼 보였음.

### 수정

1. 컨테이너를 중지·삭제하고, 올바른 바인드 마운트(`-v /home/ec2-user/songpyeon-data:/app/server/data`)로
   재생성 — 진짜 DB가 그대로 있었으므로 즉시 복구됨(`docker exec songpyeon node -e "...better-sqlite3...
   SELECT COUNT(*)..."`로 유저 수 직접 확인).
2. `SESSION_JWT_SECRET`을 새로 발급해서 다시 컨테이너에 반영 — 기존에 발급된 세션 쿠키를 (꼬인 것/정상인
   것 구분 없이) 전부 한 번에 무효화함. 이후 접속하는 사람은 전부 구글 로그인을 다시 하게 되는데, 이때는
   `google_sub`(구글 고유 id) 기준으로 계정을 다시 찾아가므로 확실하게 원래 계정으로 복구됨. 옛 시크릿으로
   서명한 토큰이 실제로 거부되는지 `/api/auth/me`에 그 쿠키를 직접 넣어 `null`이 나오는 걸로 확인.

### 재발 방지

`CLAUDE.md`의 Gotchas에 정확한 `docker run` 커맨드를 그대로 박아둠 — 재배포할 때마다 볼륨 경로를 기억에
의존해 재구성하지 말고 그 커맨드를 그대로 쓸 것. env 값(`ADMIN_PASSWORD`/`GOOGLE_CLIENT_ID`/
`SESSION_JWT_SECRET`)은 교체 직전에 `docker inspect songpyeon --format '{{json .Config.Env}}'`로 기존
컨테이너에서 재확인 후 그대로 재사용.

### 관련 파일
- 배포 절차 자체(코드 변경 없음) — `CLAUDE.md`의 Gotchas, `docs/superpowers/plans/2026-07-19-google-login.md`
- `server/src/auth/session.ts` (세션 쿠키에 숫자 id를 담는 방식 자체는 변경 안 함, 이 사고의 2차 원인일 뿐)

---

## #28 Colyseus 재접속이 onAuth를 다시 안 거쳐서, onAuth 시점에만 하는 검사(로그인/밴 등)가 재접속 유예 중엔 최신 상태가 아닐 수 있음

### 증상 (유저 밴 기능 리뷰 중 발견 — 실제 프로덕션 장애는 아니었음)

관리자가 어떤 유저를 밴하면 `MatchRoom.onAuth`가 이후 모든 입장/생성 시도를 거절하도록 구현했는데, 리뷰
과정에서 다음 시나리오가 뚫린다는 게 발견됨: 그 유저가 마침 연결이 끊겨 재접속 유예시간(기본 20초) 안에
있는 상태에서 관리자가 밴을 걸면, 유예시간 안에 재접속 토큰으로 돌아왔을 때 `onAuth`를 안 거치므로 밴
체크 자체가 실행 안 되어 다시 들어와버림.

### 원인 (확정, `node_modules/@colyseus/core/build/Room.js` 직접 확인)

`Room.allowReconnection(previousClient, seconds)`는 재접속을 위한 좌석을
`this._reserveSeat(sessionId, true, previousClient.auth, seconds, true)`로 예약하는데, 이때
`previousClient.auth`(원래 `onAuth`가 반환했던, 그 시점 기준 값)를 그대로 넘겨서 재사용한다. 재접속이
실제로 성사되면 `newClient.auth = previousClient.auth`로 그 값을 새 클라이언트에 그대로 복사할 뿐,
`onAuth`를 다시 호출하지 않는다. 즉 `onAuth`에서만 확인하는 어떤 검사든(로그인 여부, 밴 여부 등) 재접속
경로에서는 원래 접속 시점의 스냅샷 그대로 남아있고 갱신되지 않는다.

### 수정

`MatchRoom.ts`의 `onLeave`에서 `await this.allowReconnection(client, this.reconnectGraceSeconds)`가
성공(재접속 성사)한 직후, `client.auth.userId`로 최신 유저 정보를 DB에서 다시 조회해 밴 상태를 재확인한다.
밴돼 있으면 그 자리에서 다시 내보내는데, 이때 `client.leave()`를 무작정 먼저 부르면 안 됨 — Colyseus가
그 `client.leave()`로 인해 **같은 세션에 대해 `onLeave`를 재귀 호출**하고, 그 시점에 아직
`state.players`에 이 플레이어가 남아있으면 `phase === "playing" && !consented` 분기에 또 걸려 **새
재접속 유예를 한 번 더 부여**해버리는 무한 루프가 생긴다. 그래서 반드시 `removePlayer`로 로스터에서
먼저 빼고 `setMetadata`까지 반영한 다음에 `client.leave()`를 불러야 한다 — 그러면 재귀 호출된 `onLeave`가
맨 위의 `if (!this.state.players.has(client.sessionId)) return;` 가드에 걸려 즉시 끝난다(이 가드는 원래
onJoin이 거절한 세션의 유령 퇴장 로그를 막기 위해 먼저 추가돼 있던 것 — `#26` 참고, 여기서 재활용됨).

### 검증

`server/src/rooms/MatchRoom.test.ts`에 재접속 유예 중 밴 → 재접속 시도 → 결국 자리에서 빠지는지 확인하는
회귀 테스트 추가(재접속 프로미스 자체의 성공/실패 여부는 Colyseus 내부 마이크로태스크 순서에 따라 갈릴 수
있어 단정하지 않고, room 쪽 상태만으로 검증).

### 관련 파일
- `server/src/rooms/MatchRoom.ts`, `server/src/rooms/MatchRoom.test.ts`
- 설계: `docs/superpowers/specs/2026-07-21-user-ban-design.md`, 계획: `docs/superpowers/plans/2026-07-21-user-ban.md`
