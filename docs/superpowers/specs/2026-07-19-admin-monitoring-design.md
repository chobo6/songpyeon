# 관리자 모니터링 페이지 설계

## 배경 / 목적

지금까지 접속자 IP는 `MatchRoom.ts`의 `onAuth`/`onJoin`/`onLeave`에서 `console.log`로만
찍히고, `docker logs`로 SSH 접속해야만 볼 수 있었다. 테스트 단계에서 친구들과 같이 플레이할 때
누가 접속해 있는지, 방 상황이 어떤지를 웹에서 편하게 확인하고 싶고, 서버를 재배포/재시작하기 전에
접속 중인 사람들에게 미리 공지할 방법도 필요하다.

정식 로그인/계정 시스템(소셜 로그인 등)은 범위 밖 — 나중에 별도로 논의. 이번 스코프는 **본인만
접근하는 모니터링 페이지 + 공지 배너**로 한정한다.

## 요구사항 (합의된 내용)

- 관리자 페이지에서 볼 것: 현재 활성 방 목록과 각 방의 인원, 최근 입장/퇴장 로그(닉네임, 방, IP,
  시각)
- 관리자가 텍스트를 입력하면 그 순간 접속 중인 모든 사용자 화면 상단에 공지 배너로 표시
- 인증: 고정 비밀번호 1개 (환경변수로 관리)
- 서버 재시작 시 로그/공지 이력/관리자 로그인 상태가 전부 초기화되는 것은 허용 (테스트 단계라 문제
  없음 — 나중에 필요해지면 영구 저장 별도 논의)
- 차단/제어 기능(IP 차단, 방 강제 종료 등)은 이번 스코프 아님 — 모니터링 전용
- 비밀번호 시도 횟수 제한 등 무차별 대입 방어는 이번 스코프 아님 — 친구들끼리만 아는 주소로 운영

## 아키텍처

DB 없이 완전 인메모리로 동작하는 현재 구조를 그대로 유지한다. Colyseus Room을 추가로 만들지 않고
(클라이언트가 이미 재접속/StrictMode 이중접속 문제를 해결해둔 상태라 Room을 하나 더 얹으면 그
복잡도가 배가됨), REST 폴링 + SSE(Server-Sent Events) 조합으로 처리한다.

```
클라이언트(모든 방문자) ──GET /api/announcements/stream (SSE)──> 공지 배너 표시
관리자 브라우저 ──POST /api/admin/login──> 세션 쿠키 발급
관리자 브라우저 ──GET /api/admin/rooms, /api/admin/events (3~5초 폴링)──> 대시보드
관리자 브라우저 ──POST /api/admin/announce──> 서버가 SSE로 전체 방송
MatchRoom.onJoin/onLeave ──eventLog.record()──> 메모리 링버퍼(최근 500개)
MatchRoom.onJoin/onLeave ──setMetadata()──> 방 인원 명단 갱신
```

## 컴포넌트

### 서버 (`server/src/admin/` 신설)

**`auth.ts`**
- `checkPassword(password: string): boolean` — `process.env.ADMIN_PASSWORD`와 비교
- `createSession(): string` — `crypto.randomBytes(32).toString("hex")` 토큰 생성, 메모리
  `Set<string>`에 저장, 반환
- `isValidSession(token: string | undefined): boolean`
- `destroySession(token: string): void`
- `requireAdmin` — Express 미들웨어. 쿠키(`admin_session`)의 토큰이 유효하지 않으면 401

**`eventLog.ts`**
```ts
type AdminEvent = {
  type: "join" | "leave";
  timestamp: number;
  nickname: string;
  roomId: string;
  ip: string;
  sessionId: string;
};
```
- `recordEvent(event: AdminEvent): void` — 배열에 push, 500개 초과 시 앞에서부터 제거 (순수 로직
  분리해서 vitest로 테스트 — 500개 제한이 정확히 지켜지는지, 오래된 것부터 빠지는지)
- `getEvents(): AdminEvent[]`

**`announcements.ts`**
- SSE 구독자 목록을 `Set<Response>`로 관리
- `subscribe(res: Response): void` — SSE 헤더 설정, 연결 유지, 연결 종료 시 Set에서 제거
- `broadcast(message: string): void` — 모든 구독자에게 `data: {...}\n\n` 전송
- 새 구독자가 붙는 순간 가장 최근 공지가 있으면(예: 최근 5분 이내) 즉시 한 번 보내줌 — 공지가 뜬
  후 새로고침하거나 뒤늦게 들어온 사람도 놓치지 않게

### `MatchRoom.ts` 수정

- `onJoin`/`onLeave`에서 기존 `console.log`는 유지하고, 그 옆에 `eventLog.recordEvent(...)` 호출
  추가
- 방 인원 명단을 메타데이터에 반영: `onJoin`/`onLeave`에서
  `this.setMetadata({ hostNickname, players: [...this.state.players.values()].map(p => ({ sessionId: p.sessionId, nickname: p.nickname })) })`
  (`setMetadata`는 비동기이므로 `await` 필요 — 두 메서드 모두 `async`로 이미 되어 있거나 전환)

### `createServer.ts`에 라우트 추가 (기존 `/api/rooms` 라우트 근처, catch-all 핸들러보다 위)

| 메서드 | 경로 | 인증 | 설명 |
|---|---|---|---|
| POST | `/api/admin/login` | - | `{password}` → 맞으면 세션 쿠키 발급 |
| POST | `/api/admin/logout` | O | 세션 파기 |
| GET | `/api/admin/rooms` | O | 방 목록 + 방마다 인원 명단 (`matchMaker.query`의 metadata에서 추출) |
| GET | `/api/admin/events` | O | `eventLog.getEvents()` |
| POST | `/api/admin/announce` | O | `{message}` → `announcements.broadcast()` |
| GET | `/api/announcements/stream` | - | SSE 구독 (누구나) |

쿠키 파싱을 위해 `cookie-parser` 의존성 추가 (omok 프로젝트에서 이미 쓰던 것과 동일 패턴).

### 클라이언트

- `client/src/main.tsx`에서 `window.location.pathname === "/admin"`이면 `<AdminPage />`를,
  아니면 기존 `<App />`을 렌더링 — 기존 `App.tsx`의 모드 전환(`select`/`online`/`offline`) 로직과
  완전히 분리
- `client/src/components/AdminPage.tsx` — 비밀번호 입력 폼 → 통과하면 대시보드(방 목록/인원, 최근
  로그 테이블, 공지 입력창+전송 버튼). 3~5초 간격 `setInterval` 폴링으로 방 목록/로그 갱신
- `client/src/components/AnnouncementBanner.tsx` — `App.tsx` 최상단(모드 전환과 무관하게 항상
  마운트)에 배치. `new EventSource("/api/announcements/stream")`로 구독, 메시지 수신 시 화면
  상단에 표시, 닫기 버튼으로 수동 닫기 가능

## 에러 처리

- 비밀번호 틀림: 401 응답, 폼에 인라인 에러 메시지만 표시 (횟수 제한 없음)
- SSE 연결 끊김: `EventSource`는 브라우저가 자동 재연결 시도함 — 별도 처리 불필요
- 서버 재시작 중 관리자가 폴링 중이었다면 몇 번의 요청이 실패함 — 재시작 후 다음 폴링에서 자연히
  복구 (재로그인은 필요, 세션이 메모리라 초기화되므로)

## 테스트

- `eventLog.ts`의 링버퍼 로직(500개 제한, FIFO 제거)은 순수 함수로 분리해서 `server/src/game/*`
  기존 패턴대로 vitest 단위 테스트 작성
- 로그인/SSE/대시보드 UI는 자동화 테스트 없이 실제 브라우저로 직접 확인 (클라이언트 쪽 테스트
  프레임워크가 프로젝트에 없는 기존 관례를 따름)

## 스코프 제외 (다음에 논의)

- 소셜 로그인 등 정식 사용자 인증
- IP/토큰 차단, 방 강제 종료 등 관리 조치
- 로그인 시도 횟수 제한
- 재시작해도 살아남는 영구 로그 저장(파일/DB)
