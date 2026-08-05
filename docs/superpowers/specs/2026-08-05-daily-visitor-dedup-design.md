# 일일 방문자수 — 사용자당 하루 1회 중복 제거 리팩토링 설계 문서

## 배경

기존 `daily_visits(date, count)`은 사이트 로드 횟수를 그대로 집계했다(같은
사람이 새로고침하면 여러 번 카운트). 이제 "하루 기준으로 사용자 한 명당
카운트 하나만" 올라가도록 바꾼다. 로그인 여부와 무관하게 사이트 접속
자체를 세는 기존 방식(App.tsx 마운트 시 `POST /api/visit`)은 그대로 두고,
서버 쪽 집계 로직만 중복 제거하도록 바꾼다.

## 방문자 식별

- 로그인한 유저: `user:<userId>`
- 로그인 안 한 유저: `ip:<IP주소>` — 같은 날 같은 IP는 한 번만 카운트한다.
  NAT/공유기 뒤 여러 명이 한 IP로 잡혀 실제보다 적게 셀 수 있다는 한계는
  감수한다(익명 추적 쿠키를 새로 심지 않기로 한 기존 결정 유지).

## 데이터 모델

기존 `daily_visits` 테이블을 없애고 새 테이블로 교체한다:

```sql
CREATE TABLE IF NOT EXISTS daily_visit_log (
  date TEXT NOT NULL,
  visitor_key TEXT NOT NULL,
  PRIMARY KEY (date, visitor_key)
)
```

`PRIMARY KEY (date, visitor_key)`이므로 `INSERT OR IGNORE`만으로 "오늘 이
방문자는 이미 기록됨"이 자동으로 처리된다 — 별도의 존재 확인 쿼리나 카운터
증가 로직이 필요 없다. 오늘 방문자 수는 `SELECT COUNT(*) FROM
daily_visit_log WHERE date = ?`로 구한다.

**보관 기간**: `visitor_key`에 IP가 들어갈 수 있으므로(익명 방문자), 개인정보
보관 관례에 따라 `events` 테이블과 동일하게 90일 지난 행은 쓰기 시점마다
자동 삭제한다.

**기존 데이터 초기화**: 서버 시작 시(`server/src/db/connection.ts`) `DROP
TABLE IF EXISTS daily_visits`로 옛 테이블을 지우고 새 `daily_visit_log`를
만든다. 매 시작마다 실행해도 안전(두 번째 시작부턴 이미 없으니 no-op)하므로
`user_version` 같은 1회성 마이그레이션 가드가 필요 없다.

## 서버

**`server/src/admin/dailyVisits.ts`** — 함수 시그니처 변경:
- `recordVisit(userId: number | undefined, ip: string): void` — 오늘(KST)
  날짜를 구해서 `recordVisitForDate`에 위임.
- `recordVisitForDate(date: string, userId: number | undefined, ip: string): void`
  — `visitor_key`를 계산해 `INSERT OR IGNORE`로 기록하고, 같은 호출에서
  90일 지난 행을 정리한다(`eventLog.ts`의 `recordEvent`와 동일한 패턴).
- `getDailyVisitStats(): DailyVisitStats` — `SELECT date, COUNT(*) AS count
  FROM daily_visit_log WHERE date >= date(오늘, '-6 days') GROUP BY date`로
  집계하고, 데이터 없는 날짜는 기존과 동일하게 `count: 0`으로 채워 정확히
  7개를 반환한다. 반환 타입(`DailyVisitStats = { today: number; recent:
  {date, count}[] }`)은 그대로 유지 — 클라이언트는 이 응답 형태 변화를
  전혀 신경 쓸 필요 없다.
- `_resetForTest(): void` — `daily_visit_log`를 비운다.

**`server/src/createServer.ts`의 `POST /api/visit`** — 세션 쿠키에서
`userId`를 읽고(다른 라우트들과 동일한 `verifySession` 패턴), `req.ip ??
"unknown"`을 같이 `recordVisit`에 넘긴다. 클라이언트는 이미
`credentials: "same-origin"`으로 쿠키를 같이 보내고 있으므로 클라이언트
쪽 변경은 없다.

## 클라이언트

변경 없음 — `App.tsx`의 `POST /api/visit` 호출과 `AdminDashboard.tsx`의
표시 로직 둘 다 그대로 유지된다. 응답 형태(`DailyVisitStats`)가 동일하기
때문이다.

## 테스트

`dailyVisits.test.ts` 전면 재작성 — `recordVisitForDate(date, userId, ip)`
시그니처로:
- 같은 유저(같은 userId)가 같은 날 여러 번 방문해도 카운트가 1을 유지하는지.
- 같은 IP(둘 다 로그인 안 함)가 같은 날 여러 번 방문해도 카운트가 1을
  유지하는지.
- 서로 다른 userId 둘은 카운트 2가 되는지.
- 서로 다른 IP 둘(둘 다 익명)은 카운트 2가 되는지.
- 로그인 유저 1명 + 익명 방문자 1명(다른 식별자)이 같은 날 방문하면
  카운트 2가 되는지.
- 같은 유저가 날짜를 달리해서 방문하면(예: 어제, 오늘) 각 날짜마다 1씩
  따로 카운트되는지 — 날짜가 바뀌면 중복 제거가 리셋됨을 확인.
- `getDailyVisitStats().recent`가 데이터 없는 날짜를 0으로 채워 정확히
  7개 반환하는지(기존 테스트 유지).
- 90일 지난 행이 쓰기 시점에 정리되는지(`eventLog.test.ts`의 "prunes
  events older than the 90-day retention window on write"와 동일한 형태).

## 범위 제외

- 로그인 유저가 여러 IP(모바일+PC 등)를 오가며 같은 날 여러 번 방문해도
  `user:<id>`로 식별되므로 정상적으로 1회만 카운트된다 — 별도 처리 불필요.
- 익명 방문자가 IP가 바뀌면(와이파이→모바일데이터 전환 등) 같은 날 두
  번 카운트될 수 있음 — 익명 추적 쿠키 없이는 근본적으로 못 막는 한계라
  이번 스코프에서 받아들인다.
