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
