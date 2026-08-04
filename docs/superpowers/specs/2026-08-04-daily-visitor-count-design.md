# 관리자 대시보드 — 일일 방문자수 표시 설계 문서

## 배경

관리자 대시보드(`AdminDashboard.tsx`)에는 "현재 접속자"(실시간, 인메모리)와 "최근
입장/퇴장"(매치룸 join/leave 기준)은 있지만, 로그인 여부와 무관하게 사이트에
들어온 사람 수를 보여주는 지표는 없다. `users.last_login_at`으로는 로그인한
유저만 잡히고, `events` 테이블은 매치룸에 실제로 입장한 경우만 기록되므로
(`MatchRoom.ts`의 `onJoin`/`onLeave`에서만 호출), 로그인 화면만 보고 나간 익명
방문자는 어디에도 안 잡힌다.

## 방문자 집계 방식

**중복 제거는 하지 않는다** — "사이트 로드 횟수"를 그대로 카운트한다. 같은
사람이 새로고침하면 여러 번 잡히지만, 로그인 안 한 사람을 구별할 별도
익명 추적 쿠키를 새로 심지 않아도 되므로 훨씬 간단하고, 이 프로젝트 규모에
맞는 선택이다.

## 데이터 모델

```sql
CREATE TABLE IF NOT EXISTS daily_visits (
  date TEXT PRIMARY KEY,   -- 'YYYY-MM-DD', SQLite의 date('now', '+9 hours')로 계산(KST) —
                           -- JS 쪽에서 타임존 계산을 따로 안 하고 DB 함수에 맡긴다.
  count INTEGER NOT NULL DEFAULT 0
)
```

날짜만 키로 쓰고 IP/식별자를 전혀 저장하지 않으므로 개인정보가 아니다 — 기존
`events` 테이블처럼 90일 보관 정책을 둘 필요 없이 무기한 보관하고, 나중에
"최근 추이" 조회에도 그대로 쓴다.

## 서버

**`server/src/admin/dailyVisits.ts`** (신규) — `recordVisit()`(SQLite의
`date('now', '+9 hours')`로 오늘 날짜를 구해서 그 row를 `INSERT ... ON
CONFLICT(date) DO UPDATE SET count = count + 1`으로 1 증가 — JS 쪽에서 타임존
계산을 하지 않고 DB 함수에 그대로 맡긴다), `getDailyVisitStats()`(오늘 값 +
최근 7일치를 날짜 오름차순으로 반환). 테스트에서 날짜를 고정해 검증할 수
있도록, 내부적으로 날짜 문자열을 받는 `recordVisitForDate(date: string)`을
따로 두고 `recordVisit()`은 그 함수에 `date('now', '+9 hours')` 계산 결과를
넘기기만 하는 얇은 래퍼로 둔다 — 실제 라우트는 항상 `recordVisit()`을 쓰고,
테스트만 `recordVisitForDate()`를 직접 호출해 특정 날짜를 고정한다.

**라우트 2개** (`createServer.ts`):
- `POST /api/visit` — 인증 불필요(로그인 여부와 무관하게 누구나 호출). body
  없음. `recordVisit()` 호출 후 `{ ok: true }` 응답.
- `GET /api/admin/stats/daily-visitors` — `requireAdmin`. `{ today: number,
  recent: { date: string; count: number }[] }` 응답(`recent`는 오늘 포함
  최근 7일, 데이터 없는 날짜는 `count: 0`으로 채워서 항상 7개 반환 — 그래야
  대시보드에서 빈 날짜를 따로 처리 안 해도 됨).

## 클라이언트

**`App.tsx`** — 최상위 `App` 컴포넌트(모드 선택 화면이 뜨는 그 컴포넌트)의
마운트 시점에 `useEffect`로 `POST /api/visit`을 한 번 fire-and-forget 호출한다.
"온라인"/"혼자 연습" 중 뭘 고르든, 아무것도 안 누르고 나가든 상관없이 앱이
로드된 시점에 한 번 잡힌다. 실패해도(네트워크 오류 등) 무시 — 방문자 카운트
실패가 실제 게임 플레이를 막으면 안 되므로 에러를 사용자에게 노출하지 않는다.

**`AdminDashboard.tsx`** — 기존 "현재 접속자"/"활성 방" 섹션과 같은 자리에
`<section>` 하나 추가: "오늘 방문 N회" 제목 아래 최근 7일치를 작은 목록으로
표시. 이 데이터는 4초 폴링(`POLL_INTERVAL_MS`)에 안 끼우고, 대시보드가 처음
마운트될 때 한 번만 `GET /api/admin/stats/daily-visitors`를 호출한다 — 하루
단위로만 바뀌는 데이터라 실시간 갱신이 필요 없다.

## 테스트

- 서버: `dailyVisits.test.ts` 신규 — `recordVisitForDate(date)`를 같은
  날짜로 여러 번 호출하면 count가 누적되는지, 다른 날짜로 호출하면 별도
  row가 생기는지, `getDailyVisitStats()`가 데이터 없는 날짜를 `count: 0`으로
  채워서 정확히 7개를 반환하는지 확인. `recordVisit()`(날짜 인자 없는 실제
  래퍼)은 SQLite의 `date('now', '+9 hours')`를 그대로 타므로 별도 단위테스트
  없이 통합 동작만 신뢰한다.
- 클라이언트: 기존 컨벤션대로(UI 로직은 타입체크 + 수동/Playwright 확인)
  — 실제로 사이트를 새로고침했을 때 `POST /api/visit`이 호출되고, 관리자
  대시보드에 숫자가 올라가는지 브라우저로 확인한다.

## 범위 제외

- 중복 제거(고유 방문자 수) — 익명 추적 쿠키가 필요해서 이번 스코프에서
  제외. 필요해지면 별도 스펙.
- 방문자의 유입 경로(리퍼러), 페이지별 방문 등 — 이번엔 "사이트 전체
  방문 횟수" 하나만 다룬다.
