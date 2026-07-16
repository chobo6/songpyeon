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
