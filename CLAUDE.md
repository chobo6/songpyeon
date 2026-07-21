# CLAUDE.md

송편 만들기 웹 게임 — "마피아42"의 이벤트 미니게임을 Colyseus 기반 실시간 멀티플레이어 웹으로 이식하는 프로젝트.

## Commands

루트에서:
```bash
npm run dev          # server(2567)+client(5173) 동시 실행. predev가 두 포트 점유 프로세스 먼저 정리함
npm run dev:server   # server만
npm run dev:client   # client만
npm run sync-public  # client 빌드 후 server/public에 복사 (관리자 페이지/구글 로그인처럼
                      # same-origin이 필요한 기능을 로컬 2567 포트에서 확인할 때)
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
- **서버 권위형(authoritative)**: 시퀀스 생성, 커서 위치, 4초 타이머, 절구 개수, 라운드/팀 탈락 판정을 서버(`MatchRoom`/`MatchState`)가 전부 소유. 클라이언트는 버튼 입력만 보내고 state diff를 받아 그리기만 함 — 클라이언트에서 판정 로직을 복제하지 말 것. 팀이 탈락해도 매치는 끝나지 않고 생존 팀이 계속 진행됨(승리 개념 없음) — `docs/REQUIREMENTS.md` §1 참고.
- 핵심 게임 규칙은 `server/src/game/` 아래 순수 함수로 분리되어 있고 각각 동명 `*.test.ts`가 있음: `sequence`(시퀀스 생성), `mortar`(절구/생명), `rotation`(팀 순환), `turnOrder`, `fragments`(돼지/토끼 조각), `colors`. 새 규칙을 추가할 때도 이 패턴(순수 함수 + 테스트)을 유지.
- Room 진입점: `server/src/rooms/MatchRoom.ts` (로직), `MatchState.ts` (Colyseus Schema)
- Colyseus 개념 매핑: Room = 한 경기(팀 개수는 방 생성 시 1~4팀 중 선택, 팀당 2명 고정 — `server/src/game/teamCount.ts`), 방 제목은 생성 시 직접 입력(`server/src/game/roomTitle.ts`로 정제, 방 목록에 `hostNickname` 대신 표시). Message client→server = `pressButton`, server→client는 state 변경분 자동 브로드캐스트.
- `MatchRoom.onAuth`가 Colyseus가 계산해주는 실제 클라이언트 IP(`x-real-ip` → `x-forwarded-for` →
  `socket.remoteAddress`)를 받아 `client.auth`에 담아둠 — `onJoin`/`onLeave`가 세션ID·닉네임과
  함께 입장/퇴장 로그로 남김(아래 관리자 페이지가 이 로그를 보여줌). `onJoin`/`onLeave` 둘 다
  `async`이며, 방 메타데이터(`setMetadata`)에 현재 방 인원 명단(`players`)도 매번 갱신함.
- **관리자 모니터링 페이지** (`/admin`, 고정 비밀번호 인증 — `ADMIN_PASSWORD` 환경변수): 현재
  활성 방/인원, 최근 입장·퇴장 로그, 전체 공지 배너(SSE)를 제공. `server/src/admin/`
  (`eventLog.ts`=인메모리 최근 500개 로그, `auth.ts`=비밀번호+세션, `announcements.ts`=SSE 방송),
  라우트는 `createServer.ts`의 `/api/admin/*` + `/api/announcements/stream`. 클라이언트는
  `client/src/components/Admin*.tsx` + `AnnouncementBanner.tsx`(전역 마운트), 진입은
  `main.tsx`가 `window.location.pathname === "/admin"`으로 분기(라우터 라이브러리 없음).
  설계: `docs/superpowers/specs/2026-07-19-admin-monitoring-design.md`. **로그/세션 전부
  인메모리라 서버 재시작 시 초기화됨** — 의도된 동작.
- **입력 연타(스팸) 방어** (2026-07-21~, 온라인 매치에만 적용): 폰에 키보드/매크로를 연결해 버튼 위치에 키를
  매핑해 연타하는 부정행위를 막기 위한 서버 측 방어. `server/src/game/inputSpamGuard.ts`의 `isSpammedPress`가
  직전 버튼 입력(색 무관)으로부터 역할별 임계값 미만이면 해당 입력을 조용히 무시(`MatchRoom.handlePressButton`)
  — 절구 감점도, 클라이언트 메시지도, 관리자 로그도 없음. 씹힌 시도를 포함해 매 입력마다 기준 시각을 갱신하는
  자기-차단 구조라 빠른 연타가 계속되면 계속 막힘. 역할별로 대상/임계값이 다름:
  - **토끼**: 민트 버튼만 대상(`MINT_SPAM_THRESHOLD_MS`, 현재 35ms) — 이 게임에서 같은 버튼을 반복해서 눌러야
    하는 유일한 패턴이 민트 런이라, 손가락 재입력 속도의 한계가 가장 잘 드러나는 자리이기 때문. 다른 토끼 색은
    대상 아님.
  - **돼지**: 4색 전부 대상(`PIG_SPAM_THRESHOLD_MS`, 현재 5ms) — 돼지 조각(`[색상, 보라]`)은 같은 색이 연속으로
    나오는 패턴 자체가 없어서, "같은 버튼 연타"가 아니라 "색이 바뀌었는데도 인식·반응하기엔 너무 빠른 입력"을
    잡는 용도라 훨씬 타이트한 임계값을 씀.

  **혼자 연습 모드에는 의도적으로 적용 안 함**(로컬 전용 로직이라 부정행위와 무관). 민트 임계값을 직접 재보기
  위해 만들었던 계측용 임시 도구(민트 버튼만 뜨는 화면 + ms 표시 + z/x 키보드 매핑)는 검증 끝나고 삭제함 —
  전체 코드는 `docs/TROUBLESHOOTING.md` #25에 재사용 가능하게 기록해둠.
- **유저 밴 기능** (2026-07-21~): 관리자 유저 목록(`/admin` → 유저 정보)에서 계정을 밴/해제하는 토글.
  `users.banned_at`(NULL이면 정상) 하나로 관리하는 영구 밴만 지원(기간제 없음), 사유 입력 UI 없음. 밴은
  **온라인 매치 입장/생성만** 차단하고 로그인·방 목록 열람은 그대로 허용 — `MatchRoom.onAuth`가 유일한 차단
  지점(`server/src/auth/googleAuth.ts`의 `setUserBanned`/`getUserById`가 밴 상태를 관리). 밴 즉시 강제
  퇴장까지 처리: `POST /api/admin/users/:id/ban`이 DB 갱신 후 `matchMaker.getLocalRoomById`로 이 프로세스에
  떠 있는 모든 방을 뒤져 `MatchRoom.kickUserId(userId)`로 연결을 끊는다(단일 프로세스 배포라 가능한 방식 —
  `getRoomById`와 달리 `getLocalRoomById`만 실제 살아있는 룸 인스턴스를 반환함, 아래 Gotchas 참고). 로비
  단계 강퇴는 즉시 로스터에서 빠지지만, **진행 중인 매치에서 강퇴하면 연결은 즉시 끊겨도 로스터 정리는 기존
  재접속 유예(20초) 경로를 그대로 탐** — 그 사이 재입장이 막히는 건 별도 처리 덕분(아래 Gotchas의 Colyseus
  재접속 항목 참고). 설계: `docs/superpowers/specs/2026-07-21-user-ban-design.md`.
- **관리자 페이지 IP 제한** (2026-07-20~): EC2의 `/home/ec2-user/caddy/Caddyfile`이 `/admin`, `/api/admin/*` 경로를
  관리자 PC의 IP(IPv4 정확히 매치, IPv6은 뒤쪽 인터페이스 식별자가 자주 바뀌어서 앞쪽 /64 대역
  전체 허용)로만 제한하고 나머지는 403. `handle`/`handle`(첫 매치 우선, 명시적 순서 보장) 패턴으로
  작성돼 있어 Caddyfile의 암묵적 디렉티브 순서에 기대지 않음. 관리자 비밀번호 로그인과는 별개의
  추가 방어선(둘 다 통과해야 함) — 게임 자체(로그인/방 목록/입장)는 이 제한과 무관하게 그대로
  전체 공개. **집 인터넷이 유동 IP라 IP가 바뀌면 관리자 페이지가 403으로 막힘** — 그럴 땐
  `ssh songpyeon-ec2`로 들어가 Caddyfile의 `remote_ip` 목록을 새 IP로 갱신하고
  `docker restart caddy`. 현재 값 백업은 같은 디렉토리에 `Caddyfile.bak-YYYYMMDD`로 남겨둠.
- **배포**: AWS EC2 단일 인스턴스, Docker 컨테이너(`songpyeon`) + Caddy(`caddy`, HTTPS 리버스 프록시, `songpyeon-net` 도커 네트워크로 연결) — 재배포는 수동 flow(로컬 `docker build` → `docker save` → `scp` → EC2에서 `docker load` 후 컨테이너 교체, Caddy/네트워크는 그대로 둠). GitHub Actions 등 CI/CD 없음, 이미지 레지스트리도 안 씀(저작권 있는 `game-assets/`가 이미지에 포함되므로 제3자 서버 경유 안 함). 절차 상세는 `docs/superpowers/specs/2026-07-15-aws-light-deploy-test-design.md` 참고. **EC2 재시작으로 퍼블릭 IP가 바뀌면 접속 주소(nip.io, IP가 호스트네임에 그대로 박힘)도 통째로 바뀜** — 컨테이너는 `--restart unless-stopped`로 자동 복구되지만 `/home/ec2-user/caddy/Caddyfile`(호스트 bind mount)의 옛 호스트네임은 수동으로 갱신하고 `docker restart caddy`로 새 Let's Encrypt 인증서를 다시 받아야 함 (`docs/TROUBLESHOOTING.md` #18).

## Key docs

- `docs/REQUIREMENTS.md` — 게임 규칙 명세(v0.6). **1차 소스는 사용자의 직접 설명**이며 참고 유튜브 영상은 채팅 오버레이 때문에 신뢰 불가 — 규칙 관련 판단은 이 문서를 우선.
- `docs/ARCHITECTURE.md` — 기술 스택 선택 이유(왜 Colyseus/서버 권위형인지)
- `docs/TROUBLESHOOTING.md` — 실제 발생한 버그의 근본 원인 기록 (아래 Gotchas는 요약본, 재현 코드는 원문 참고)
- `docs/todo.md` — 다음 할 일 (완료된 작업은 git log로 확인, 이 문서는 미래 할 일만)
- `client/public/game-assets/README.md` — 원본 게임에서 가져온 UI 에셋(버튼 토큰, 배경, 캐릭터 스프라이트) 목록과 색상/역할 매핑
- `docs/superpowers/specs/`, `docs/superpowers/plans/` — 과거 브레인스토밍/구현 계획 문서. 완료된 기능의 설계 배경("왜 이렇게 만들었는지")을 알고 싶을 때 참고

## Gotchas

- **server는 `"type": "module"` 필수.** CJS로 두면 `colyseus`/`@colyseus/core`가 CJS·ESM 두 경로로 이중 로드되어 `matchMaker` 싱글턴이 두 벌 생기고, `gameServer.define()`으로 등록한 룸이 `@colyseus/testing` 쪽에서 안 보이는 "room name not defined" 에러가 남 (dual-package hazard).
- `server/vitest.config.ts`는 `pool: "forks"` 필요 — 실제 네트워크 소켓을 쓰는 룸 테스트는 워커 스레드 풀과 상성이 나쁨.
- 룸 통합 테스트에서 버튼을 연속으로 누를 때 `room.waitForNextPatch()`로 기다리지 말 것 — 테스트가 잡는 `room`은 서버 사이드 라이브 인스턴스라 상태를 직접 읽으면 되고, 패치 브로드캐스트를 기다리면 누적 지연으로 턴 타이머와 경합해 타임아웃 남. 대신 `onMessage` 처리 시간만큼의 짧은 `setTimeout` 기반 flush 사용.
- client: `joinOrCreate()`가 resolve된 시점에도 `room.state`의 필드가 아직 디코딩 안 됐을 수 있음 — 첫 `onStateChange` 콜백을 받은 뒤에야 `status`를 `"connected"`로 바꿀 것 (`client/src/game/useMatchRoom.ts` 참고).
- client: React StrictMode 개발 모드의 effect 이중 실행 때문에 `joinOrCreate()`가 탭당 최대 2번 호출되어, 같은 4명이 서로 다른 방으로 분산되는 문제가 있었음 → join promise를 컴포넌트가 아니라 모듈 스코프(`client/src/colyseus.ts`의 `joinMatch()`)에 캐싱해서 우회. 이 패턴을 깨지 말 것 — cleanup에서 `.leave()`를 다시 호출하면 가짜 언마운트 때 진짜 연결이 끊김.
- **Colyseus의 `maxClients` 기반 자동 잠금은 클라이언트가 나가는 순간 자동으로 풀림** (`_decrementClientCount`가 `!_lockedExplicitly`일 때 unlock 호출) — 진행 중인 방에서 플레이어가 나가면 그 즉시 `joinOrCreate`의 매치메이킹 후보로 다시 노출됨. 게임 시작 시 `this.lock()`을 명시적으로 호출해야 실제 방어가 됨 (`_lockedExplicitly`로 표시되어 자동 unlock 대상에서 제외). `server/src/rooms/MatchRoom.ts`의 `maybeStartGame()` 참고.
- `rotation.ts`의 `nextActiveTeamIndex`는 **모든 팀이 탈락하면 건너뛸 곳이 없어 현재 인덱스를 그대로 반환**함 — `advanceToNextTurn`이 이를 확인 없이 항상 `startTurn()`을 호출하면 이미 탈락한 팀에게 유령 턴이 무한 생성됨. 다음 활성 팀도 탈락 상태면 새 턴을 시작하지 않고 멈추는 가드가 필요 (`MatchRoom.ts`의 `advanceToNextTurn()` 끝부분 참고).
- client CSS: `display:flex` 부모(`align-items:center`, cross-axis) 안의 `display:grid` 자식은 shrink-to-fit되므로, `max-width`만 주고 명시적 `width`를 안 주면 `1fr` 컬럼이 min-content로 쪼그라들어 버튼이 비정상적으로 작게 렌더링될 수 있음 (`ButtonPanel.module.css`에서 실제로 겪음) — `width: 100%`를 같이 줄 것.
- client CSS: 내용이 늘어나도 그 안의 스크롤 영역이 늘어나지 않고 페이지 전체가 늘어나는 문제는 거의 항상 flex 체인 어딘가에 `min-height: 0`이 빠진 것 — flex 자식 기본값이 `min-height: auto`라 내용물보다 작아지길 거부함. `#root`(`index.css`)가 `height: 100svh`로 고정돼 있어야 그 예산이 하위로 흐르고, `flex:1` 쓰는 조상 전부(`.wrap`/`.content`/스크롤 컨테이너 자신)에 `min-height: 0`이 있어야 최하단 `overflow-y: auto`가 실제로 동작함 — 한 곳이라도 빠지면 전체가 무효화됨 (`ChatBox`의 `fill` variant에서 실제로 겪음, `docs/TROUBLESHOOTING.md` #13).
- client CSS: `@media` 블록의 규칙은 특정도(specificity)가 같으면 **소스 순서**로 승패가 갈림 — 오버라이드하려는 기본 클래스 정의보다 **파일에서 앞쪽**에 미디어 쿼리를 적으면, 조건이 맞아도 뒤쪽의 조건 없는 기본 규칙한테 그냥 짐(뷰포트 조건 자체는 만족했는데도 적용 안 됨). 실제로 이 실수로 미디어 쿼리가 통째로 무효화된 적 있음 — 반드시 오버라이드할 기본 규칙 *뒤에* 추가하고, `getComputedStyle()`로 실제 적용된 값을 찍어서 확인할 것(화면만 봐서는 "왜 안 줄어들지?" 정도로만 보임) (`docs/TROUBLESHOOTING.md` #17).
- 클라이언트-서버 시계 오차: 클라이언트 기기 시계가 서버(AWS EC2)와 몇 초씩 어긋나는 게 흔함 — `turnEndsAt`(서버 절대 타임스탬프)에서 클라이언트 `Date.now()`를 그냥 빼면 안 되고, ping/pong RTT로 추정한 `clockOffsetMs`를 보정해서 써야 함(`client/src/game/clockSync.ts`). 솔로 모드(`useSoloMatch.ts`)는 같은 기기 시계만 쓰므로 이 문제 자체가 없음 — 온라인에서만 재현되는 타이머 버그면 먼저 의심할 것.
- Docker 배포: `.dockerignore`는 `.gitignore`와 달리 하위 폴더까지 자동 재귀 매칭되지 않음 — `.env`/`.env.*`만 적어두면 `client/.env.local` 같은 하위 경로 파일은 안 걸러지고 그대로 이미지에 들어감(LAN IP 등 로컬 전용 값이 프로덕션 번들에 박히는 사고로 실제 발생, `docs/TROUBLESHOOTING.md` #9). 재귀 매칭하려면 `**/.env`/`**/.env.*` 형태로 적을 것 — 재배포 전엔 `docker run --rm <image> grep -r <의심 패턴> /app/server/public`로 빌드된 번들을 직접 확인.
- **관리자 페이지(`/admin`)와 구글 로그인은 같은 오리진에서만 동작함** — `client/src/components/Admin*.tsx`와
  `game/auth.ts`는 상대경로(`/api/admin/...`, `/api/auth/...`)로 `fetch`하는데, `npm run dev`의
  Vite 서버(5173)와 게임 서버(2567)는 서로 다른 오리진이라 쿠키 기반 세션이 안 통함. 로컬에서
  이 기능들을 확인하려면 `npm run sync-public`으로 client를 빌드해 `server/public`에 복사한 뒤
  (Dockerfile이 하는 방식 재현) `server`가 직접 서빙하는 2567 포트로 접속해야 함. client 코드를
  고칠 때마다 다시 실행해야 반영됨 — 실행을 깜빡하면 옛 빌드가 그대로 서빙되는데 화면상으로는
  구분이 안 가서 "코드는 고쳤는데 반영이 안 된다"처럼 보이기 쉬움. 실제 배포(Caddy 뒤)는 항상
  같은 오리진이라 문제없음.
- **서버 환경변수(`GOOGLE_CLIENT_ID`/`SESSION_JWT_SECRET`/`ADMIN_PASSWORD`)는 `server/.env`에서
  읽음** (`server/src/index.ts`가 시작 시 `dotenv/config`로 로드, git에는 안 올라감 —
  `client/.env.local`과 같은 역할). 이 파일이 없거나 값이 비어있으면 구글 로그인이
  `GOOGLE_CLIENT_ID가 설정되지 않았습니다` 에러로 즉시 실패함.
- **Windows에서 `tsx watch`(server dev)가 `server/src/**` 파일을 고칠 때마다 재시작을 시도하다 `EADDRINUSE`로 실패하는 경우가 있음** — 직전 프로세스가 포트 2567을 바로 안 놓아서 생기는 타이밍 문제로, 몇 초 뒤 재시도해서 결국 성공하기도 하고 그대로 죽은 채 예전 프로세스가 계속 응답하기도 함(콘솔에 `EADDRINUSE` 에러가 찍혀도 방 생성/입장 같은 기본 동작은 옛 코드로 계속 "정상 작동"하는 것처럼 보여서 눈치채기 어려움). 서버 쪽 파일을 고친 직후 실제 동작을 확인해야 한다면 `netstat -ano | grep :2567`로 리스닝 PID가 바뀌었는지 먼저 확인할 것 — 안 바뀌었으면 옛 코드를 테스트하고 있는 것. 확실히 하려면 `taskkill //F //PID <pid> //T`로 관련 프로세스를 다 죽이고 `npm run dev`를 처음부터 다시 실행.
- **Colyseus의 `matchMaker.getRoomById(roomId)`는 실제 룸 인스턴스가 아니라 룸 목록 캐시(driver의 `RoomCache`)를 반환한다** — 메서드 호출이나 `state` 조작이 필요하면 `matchMaker.getLocalRoomById(roomId)`를 써야 함(이 프로세스에 살아있는 실제 `Room` 인스턴스 반환, 없으면 `undefined`). 이 프로젝트는 단일 프로세스 배포라 "이 프로세스에 있는 것만"이 곧 전부라 문제없이 쓸 수 있음. 유저 밴 기능의 강제 퇴장(`server/src/createServer.ts`의 `/api/admin/users/:id/ban`)이 이 차이 때문에 실제로 헷갈렸던 지점 — `node_modules/@colyseus/core/build/MatchMaker.js`의 `getRoomById`/`getLocalRoomById` 함수 정의 주석에 "This method does not return the actual room instance, use `getLocalRoomById` for that" 라고 명시돼 있음.
- **Colyseus의 재접속(`allowReconnection`)은 `onAuth`를 다시 안 거친다** — 연결이 끊긴 클라이언트가 재접속 유예시간(기본 20초, `MatchRoom.ts`의 `DEFAULT_RECONNECT_GRACE_SECONDS`) 안에 재접속 토큰으로 돌아오면, Colyseus는 원래 `onAuth`가 반환했던 `client.auth` 객체를 그대로 재사용(`previousClient.auth`를 새 클라이언트에 복사)할 뿐 `onAuth`를 다시 호출하지 않음. `onAuth` 시점에만 확인하는 검사(예: 로그인 여부, 밴 상태)는 그 유예시간 동안엔 최신 상태가 아닐 수 있다는 뜻 — 실제로 유저 밴 기능에서 "재접속 유예 중에 밴되면 그대로 다시 들어와버리는" 버그로 발견됨(`MatchRoom.ts`의 `onLeave`, `allowReconnection` 성공 직후 최신 밴 상태를 다시 조회해 막도록 수정). 이런 상황을 고치려고 재접속 성공 직후 `client.leave()`를 다시 호출할 땐 **반드시 `removePlayer`로 먼저 로스터에서 빼고 나서** 호출할 것 — 안 그러면 그 `client.leave()`가 `onLeave`를 재귀 호출하면서 `phase === "playing" && !consented` 분기에 다시 걸려 새 재접속 유예를 또 부여해버리는 무한 루프가 생김(`onLeave` 맨 위의 `if (!this.state.players.has(...)) return;` 가드가 이 재귀를 끊어줌).
- **Docker 배포 시 데이터 볼륨을 named volume과 bind mount로 헷갈리면 실제 프로덕션 DB 대신 빈 DB를 보게 됨** — 실제 사용하는 건 `-v /home/ec2-user/songpyeon-data:/app/server/data`(호스트 디렉토리 **바인드 마운트**)인데, 이름이 비슷해서 `-v songpyeon-data:/app/server/data`(Docker **네임드 볼륨** — 완전히 다른 저장 공간)로 잘못 쓰기 쉬움. 둘 다 `docker volume ls`엔 안 걸리는 게 아니라 오히려 네임드 볼륨 쪽이 과거 실수로 이미 만들어져 있어서 겉보기엔 정상 작동하는 것처럼 보임 — 새 컨테이너가 텅 빈 스키마로 시작하는데도 에러가 안 남. 재배포할 때마다 정확한 커맨드를 매번 재구성하지 말고 아래를 그대로 쓸 것(env 값은 실제 배포 시 `docker inspect songpyeon --format '{{json .Config.Env}}'`로 기존 값 재확인 후 그대로 재사용):
  ```
  docker run -d --name songpyeon --network songpyeon-net --restart unless-stopped \
    -e ADMIN_PASSWORD=... -e GOOGLE_CLIENT_ID=... -e SESSION_JWT_SECRET=... \
    -v /home/ec2-user/songpyeon-data:/app/server/data songpyeon:latest
  ```
  잘못된 볼륨으로 이미 배포해버렸다면: 실제 데이터는 바인드 마운트 경로에 그대로 안전하게 남아있음(컨테이너를 지워도 안 지워짐) — 컨테이너만 올바른 마운트로 재생성하면 즉시 복구됨. 다만 그 사이 로그인한 사람이 있었다면 세션 쿠키가 (텅 빈 DB 기준으로 새로 매겨진) 엉뚱한 낮은 id를 가리키게 돼 실제 DB로 복구한 뒤에도 다른 사람 계정으로 로그인된 것처럼 보이는 2차 문제가 생김 — `SESSION_JWT_SECRET`을 새로 발급해 재배포하면(기존 세션 전부 무효화, 재로그인 시 `google_sub` 기준으로 정확한 계정을 다시 찾음) 해결됨.

## Workflow

- 순수 게임 로직(`server/src/game/*`)은 TDD로 구현되어 왔음 — 새 규칙도 로직 파일과 테스트 파일을 같이 작성.
- 다음 작업 우선순위는 `docs/todo.md` 참고 (매치메이킹/방 코드가 최우선).
