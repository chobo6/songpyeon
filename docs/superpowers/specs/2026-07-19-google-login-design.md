# 구글 로그인 설계

## 배경 / 목적

향후 랭킹전/ELO 레이팅 시스템을 만들 계획이라, 그 전에 "누가 접속했는지"를 신뢰할 수 있는
계정 기반 사용자 인증이 먼저 필요하다. `omok` 프로젝트에 이미 검증된 Google OAuth + JWT 세션
쿠키 패턴이 있어(`server/googleAuth.js`, `client/src/utils/auth.js`) 이를 songpyeon에 맞게
이식한다.

이번 스코프는 **로그인 자체**만 다룬다. 랭킹/ELO는 다음 단계에서 별도로 설계한다.

## 요구사항 (합의된 내용)

- **혼자 연습(오프라인 모드)은 로그인 없이 그대로 이용 가능** — 순수 클라이언트 로직이라
  서버 연결 자체가 없음, 이번 변경과 무관
- **온라인 모드는 로그인 필수**로 전환 — 지금의 "닉네임만 입력하면 바로 참가" 흐름은 온라인
  모드에서 사라지고, 구글 로그인이 그 자리를 대체함
- **로그인 후 닉네임은 계정에 고정** — 신규 계정은 최초 1회만 닉네임을 설정하고, 그 이후
  접속부터는 매번 입력할 필요 없이 계정에 저장된 닉네임을 그대로 사용
- **닉네임 수정 기능(프로필 화면 등)은 이번 스코프 제외** — 나중에 필요해지면 별도 진행
- DB는 SQLite (이전 논의에서 결정 — 완전 인메모리였던 현재 구조에 처음 추가되는 영구 저장소)

## 아키텍처

`omok`의 검증된 패턴(HTTP 로그인 엔드포인트 + httpOnly JWT 세션 쿠키)을 그대로 따르되, songpyeon
고유의 제약인 **Colyseus WebSocket 연결에도 같은 세션을 적용**하는 부분이 핵심 차이다.

```
[클라이언트]                          [서버]
"온라인" 클릭
  → GET /api/auth/me ─────────────→  세션 쿠키 확인 (있으면 SQLite 조회)
  ← null (미로그인) / 프로필

  (미로그인) 구글 로그인 버튼 클릭
  → Google Identity Services 팝업 → ID 토큰 획득
  → POST /api/auth/google {credential} → 토큰 검증(google-auth-library)
                                       → SQLite users 테이블 upsert(google_sub 기준)
                                       → JWT 세션을 httpOnly 쿠키로 발급
  ← 프로필(id, nickname|null)

  (신규 계정, nickname === null) 닉네임 입력 화면
  → POST /api/auth/nickname {nickname} → 세션 쿠키로 인증
                                       → 닉네임이 이미 있으면 거부, 없으면 저장

  방 생성/입장 (colyseus.js, WebSocket)
  → 브라우저가 세션 쿠키를 자동으로 실어 보냄
                                       → MatchRoom.onAuth가 Cookie 헤더를 직접 파싱
                                         (WS 업그레이드 요청엔 cookie-parser 미들웨어가
                                         안 통하므로 세션 검증 로직을 직접 재사용)
                                       → 세션 무효 → 입장 거부 (에러)
                                       → 세션 유효 → SQLite에서 닉네임 조회,
                                         client.auth에 저장
  → onJoin이 client.auth의 닉네임 사용 (클라이언트가 보낸 값이 아님 — 더 안전)
```

## 컴포넌트

### 서버

**`server/src/db/connection.ts`**
- `better-sqlite3` 인스턴스 하나를 모듈 스코프에 유지, `server/data/songpyeon.db` 파일 오픈
- 부팅 시 `CREATE TABLE IF NOT EXISTS users (...)` 실행 — 테이블이 하나뿐이라 별도 마이그레이션
  도구 없이 이 방식으로 충분 (YAGNI)
- WAL 모드 활성화(`PRAGMA journal_mode = WAL`) — 읽기와 쓰기가 서로를 덜 막게

**스키마**
```sql
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  google_sub TEXT UNIQUE NOT NULL,
  email TEXT,
  name TEXT,
  nickname TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```
(`name`은 구글 실명, `nickname`은 게임에서 쓰는 표시 이름 — omok과 동일하게 구분해서, 로그인할
때마다 구글 실명이 사용자가 정한 닉네임을 덮어쓰지 않게 함)

**`server/src/auth/googleAuth.ts`** (omok `server/googleAuth.js`를 TS/ESM으로 이식)
- `verifyGoogleIdToken(credential: string): Promise<{sub, email, name}>` — 검증 실패 시 throw
- `getOrCreateUser(googleSub, {email, name}): {id, nickname}` — `INSERT ... ON CONFLICT DO UPDATE`
  로 원자적 upsert. 닉네임은 이 시점에 건드리지 않음(신규 생성 시에만 `nickname = NULL`)
- `setNickname(userId, nickname): boolean` — 현재 `nickname`이 NULL일 때만 갱신, 이미 있으면
  `false` 반환(호출부가 409로 응답)

**`server/src/auth/session.ts`**
- `signSession(userId): string` — JWT, `SESSION_JWT_SECRET` 환경변수로 서명, 만료 30일
- `verifySession(token: string | undefined): number | null` — 유효하지 않으면 null(throw 안 함)
- `getSessionFromCookieHeader(cookieHeader: string | undefined): string | undefined` — 원시
  `Cookie` 헤더 문자열에서 세션 쿠키 값만 추출 (Colyseus의 `onAuth`는 Express
  `cookie-parser` 미들웨어를 거치지 않으므로 직접 파싱 필요)

**`createServer.ts`에 추가할 라우트**
| 메서드 | 경로 | 설명 |
|---|---|---|
| POST | `/api/auth/google` | `{credential}` → 토큰 검증 → upsert → 세션 쿠키 발급 → 프로필 응답 |
| GET | `/api/auth/me` | 세션 쿠키 확인 → 프로필 또는 `null` (에러 아님) |
| POST | `/api/auth/nickname` | `{nickname}` → 세션 인증 필요, 닉네임 없을 때만 설정(1회) |
| POST | `/api/auth/logout` | 세션 쿠키 삭제 |

**`MatchRoom.ts` 수정**
- `onAuth`가 기존 IP 캡처에 더해 `context.headers.cookie`에서 세션을 추출·검증
- 세션이 없거나 무효하면 **throw**(Colyseus가 이를 입장 거부로 처리, 클라이언트는 에러 화면)
- 유효하면 SQLite에서 닉네임 조회 후 `{ip, userId, nickname}`을 반환해 `client.auth`에 저장
- `onJoin`은 더 이상 `options.nickname`을 쓰지 않고 `client.auth.nickname` 사용 —
  `MatchRoomOptions`에서 `nickname` 필드 제거

### 클라이언트

**`client/src/game/auth.ts`** (omok `client/src/utils/auth.js`를 TS로 이식)
- `renderGoogleButton(containerId, onCredential)` — Google Identity Services 스크립트 로드 +
  버튼 렌더링
- `loginWithGoogle(credential)`, `fetchMe()`, `setNickname(nickname)`, `logout()` — 각각 대응
  API 호출

**`client/src/components/GoogleLoginScreen.tsx`** (신규)
- 미로그인 상태에서 온라인 진입 시 표시, 구글 로그인 버튼만 있음

**`client/src/components/NicknameEntry.tsx`** (역할 변경)
- 이제 "신규 계정의 최초 1회 닉네임 설정" 전용 — 제출 시 로컬 콜백이 아니라
  `POST /api/auth/nickname` 호출

**`App.tsx`의 `OnlineFlow`**
- 진입 시 `fetchMe()`로 로그인 상태 확인 (로딩 → 미로그인 → 닉네임없음 → 방목록, 4단계)
- `colyseus.ts`의 `JoinSpec`에서 `nickname` 필드 제거(서버가 세션으로 판단하므로 클라이언트가
  더 이상 넘길 필요 없음)

## 에러 처리

- 구글 ID 토큰 검증 실패 → `POST /api/auth/google` 401
- 세션 쿠키 없음/만료 → `GET /api/auth/me`는 에러가 아니라 `null` 반환(미로그인 상태로 취급)
- 이미 닉네임이 있는 계정이 `/api/auth/nickname` 재호출 → 409 (이번 스코프엔 UI 경로가 없어
  정상 흐름에선 발생 안 하지만 API 레벨 방어)
- `MatchRoom.onAuth`에서 세션 무효 → `onJoin` 자체가 호출되지 않음(Colyseus가 join 실패로 처리),
  클라이언트는 기존 `ConnectedOnlineFlow`의 에러 화면(`status === "error"`)으로 자연스럽게 표시됨

## 배포 관련 알려진 제약

- **songpyeon 전용 Google OAuth 클라이언트 ID를 Google Cloud Console에서 새로 생성해야 함**
  (`omok`과는 다른 사이트라 재사용 불가) — 사용자가 직접 해야 하는 절차, 구현 단계에서 안내
- **EC2가 재시작되어 퍼블릭 IP/nip.io 주소가 바뀌면, Google Cloud Console의 "승인된 자바스크립트
  원본"도 그 새 주소로 수동 갱신해야 로그인 버튼이 동작함** — `docs/TROUBLESHOOTING.md` #18의
  Caddyfile 갱신 절차와 같은 종류의 수동 작업이 하나 더 늘어나는 셈. 재현 시 이 문서에 새 항목으로
  추가할 것
- Docker 빌드 시 `VITE_GOOGLE_CLIENT_ID`를 빌드 인자로 전달해야 함(Vite가 빌드 시점에 값을
  번들에 박아넣으므로) — `Dockerfile`에 `ARG VITE_GOOGLE_CLIENT_ID` / `ENV
  VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID`를 client 빌드 스테이지에 추가하고,
  `docker build --build-arg VITE_GOOGLE_CLIENT_ID=...`로 전달

## 테스트

- `session.ts`(JWT sign/verify, `getSessionFromCookieHeader`)는 순수 로직 → vitest 단위 테스트
- DB 레이어(`getOrCreateUser`, `setNickname`)는 `:memory:` SQLite로 실제 통합 테스트(mock 불필요)
- 구글 토큰 검증 자체(외부 네트워크 호출)는 자동 테스트로 목업하기보다 실제 브라우저로 로그인
  흐름을 수동 검증하는 쪽이 현실적 — 기존 관례(클라이언트 UI는 브라우저로 확인)와 일치

## 스코프 제외 (다음에 논의)

- 닉네임 변경 기능(프로필 화면)
- 랭킹전/ELO 레이팅 시스템
- 세션 즉시 무효화(로그아웃 외의 강제 로그아웃 등) — JWT 특성상 만료 전까지는 유효, 이 규모에선
  허용
