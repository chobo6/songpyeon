# CLAUDE.md

송편 만들기 웹 게임 — "마피아42"의 이벤트 미니게임을 Colyseus 기반 실시간 멀티플레이어 웹으로 이식하는 프로젝트.

## Commands

루트에서:
```bash
npm run dev          # server(2567)+client(5173) 동시 실행. predev가 두 포트 점유 프로세스 먼저 정리함
npm run dev:server   # server만
npm run dev:client   # client만
```

server/:
```bash
npm run dev    # tsx watch src/index.ts
npm test       # vitest run
npm run build  # tsc --noEmit (타입체크만, 산출물 없음)
```

client/:
```bash
npm run dev    # vite
npm run build  # tsc -b && vite build
npm run lint   # oxlint
```

## Architecture

- npm workspaces 모노레포: `client/` (React 19 + Vite + colyseus.js), `server/` (Node + Colyseus, ESM)
- **서버 권위형(authoritative)**: 시퀀스 생성, 커서 위치, 4초 타이머, 절구 개수, 라운드/승패 판정을 서버(`MatchRoom`/`MatchState`)가 전부 소유. 클라이언트는 버튼 입력만 보내고 state diff를 받아 그리기만 함 — 클라이언트에서 판정 로직을 복제하지 말 것.
- 핵심 게임 규칙은 `server/src/game/` 아래 순수 함수로 분리되어 있고 각각 동명 `*.test.ts`가 있음: `sequence`(시퀀스 생성), `mortar`(절구/생명), `rotation`(팀 순환), `turnOrder`, `fragments`(돼지/토끼 조각), `colors`. 새 규칙을 추가할 때도 이 패턴(순수 함수 + 테스트)을 유지.
- Room 진입점: `server/src/rooms/MatchRoom.ts` (로직), `MatchState.ts` (Colyseus Schema)
- Colyseus 개념 매핑: Room = 한 경기(2팀×2명), Message client→server = `pressButton`, server→client는 state 변경분 자동 브로드캐스트.

## Key docs

- `docs/REQUIREMENTS.md` — 게임 규칙 명세(v0.5). **1차 소스는 사용자의 직접 설명**이며 참고 유튜브 영상은 채팅 오버레이 때문에 신뢰 불가 — 규칙 관련 판단은 이 문서를 우선.
- `docs/ARCHITECTURE.md` — 기술 스택 선택 이유(왜 Colyseus/서버 권위형인지)
- `docs/TROUBLESHOOTING.md` — 실제 발생한 버그의 근본 원인 기록 (아래 Gotchas는 요약본, 재현 코드는 원문 참고)
- `docs/todo.md` — 다음 할 일 (완료된 작업은 git log로 확인, 이 문서는 미래 할 일만)

## Gotchas

- **server는 `"type": "module"` 필수.** CJS로 두면 `colyseus`/`@colyseus/core`가 CJS·ESM 두 경로로 이중 로드되어 `matchMaker` 싱글턴이 두 벌 생기고, `gameServer.define()`으로 등록한 룸이 `@colyseus/testing` 쪽에서 안 보이는 "room name not defined" 에러가 남 (dual-package hazard).
- `server/vitest.config.ts`는 `pool: "forks"` 필요 — 실제 네트워크 소켓을 쓰는 룸 테스트는 워커 스레드 풀과 상성이 나쁨.
- 룸 통합 테스트에서 버튼을 연속으로 누를 때 `room.waitForNextPatch()`로 기다리지 말 것 — 테스트가 잡는 `room`은 서버 사이드 라이브 인스턴스라 상태를 직접 읽으면 되고, 패치 브로드캐스트를 기다리면 누적 지연으로 턴 타이머와 경합해 타임아웃 남. 대신 `onMessage` 처리 시간만큼의 짧은 `setTimeout` 기반 flush 사용.
- client: `joinOrCreate()`가 resolve된 시점에도 `room.state`의 필드가 아직 디코딩 안 됐을 수 있음 — 첫 `onStateChange` 콜백을 받은 뒤에야 `status`를 `"connected"`로 바꿀 것 (`client/src/game/useMatchRoom.ts` 참고).
- client: React StrictMode 개발 모드의 effect 이중 실행 때문에 `joinOrCreate()`가 탭당 최대 2번 호출되어, 같은 4명이 서로 다른 방으로 분산되는 문제가 있었음 → join promise를 컴포넌트가 아니라 모듈 스코프(`client/src/colyseus.ts`의 `joinMatch()`)에 캐싱해서 우회. 이 패턴을 깨지 말 것 — cleanup에서 `.leave()`를 다시 호출하면 가짜 언마운트 때 진짜 연결이 끊김.

## Workflow

- 순수 게임 로직(`server/src/game/*`)은 TDD로 구현되어 왔음 — 새 규칙도 로직 파일과 테스트 파일을 같이 작성.
- 다음 작업 우선순위는 `docs/todo.md` 참고 (탈락 처리 UI, 재대국 흐름, 매치메이킹/방 코드가 최우선).
