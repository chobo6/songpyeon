# 일일 방문자수 — 사용자당 하루 1회 중복 제거 리팩토링 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 일일 방문자 집계를 "사이트 로드 횟수"에서 "사용자 한 명당 하루 1회"로 바꾸고, 기존에 쌓인 카운트를 초기화한다.

**Architecture:** `daily_visits(date, count)` 집계 테이블을 `daily_visit_log(date, visitor_key)` 로그 테이블로 교체 — `PRIMARY KEY (date, visitor_key)` + `INSERT OR IGNORE`로 중복 제거를 DB 제약조건 자체에 맡긴다. 로그인 유저는 `user:<id>`, 익명은 `ip:<IP>`로 식별. 클라이언트는 변경 없음(서버 응답 형태가 그대로라).

**Tech Stack:** Node.js/TypeScript/Express/better-sqlite3, Vitest

## Global Constraints

- `visitor_key`는 로그인 시 `user:<userId>`, 비로그인 시 `ip:<IP>`.
- `daily_visit_log`는 IP를 저장할 수 있으므로 `events` 테이블과 동일하게 90일 보관 후 자동 삭제.
- 기존 `daily_visits` 테이블은 `DROP TABLE IF EXISTS`로 제거(누적값 초기화) — 매 서버 시작마다 실행해도 안전(idempotent)하므로 `user_version` 가드 불필요.
- 클라이언트(`App.tsx`, `AdminDashboard.tsx`)는 이번 변경에서 건드리지 않는다 — 서버 응답 형태(`DailyVisitStats`)가 그대로 유지되므로.

---

### Task 1: 서버 — `daily_visit_log`로 교체 + 중복 제거 로직

**Files:**
- Modify: `server/src/db/connection.ts`
- Modify: `server/src/admin/dailyVisits.ts`
- Modify: `server/src/admin/dailyVisits.test.ts`
- Modify: `server/src/createServer.ts`

**Interfaces:**
- Consumes: 없음(기존 `dailyVisits.ts` 모듈을 이 태스크 안에서 전면 교체).
- Produces: `export function recordVisit(userId: number | undefined, ip: string): void`, `export function recordVisitForDate(date: string, userId: number | undefined, ip: string): void`, `export type DailyVisitStats = { today: number; recent: { date: string; count: number }[] }`(기존과 동일한 형태 유지), `export function getDailyVisitStats(): DailyVisitStats`, `export function _resetForTest(): void`. `createServer.ts`의 `POST /api/visit` 라우트가 이 함수들을 그대로 씀 — 응답 형태가 안 바뀌므로 클라이언트/`GET /api/admin/stats/daily-visitors`는 수정 불필요.

- [ ] **Step 1: `daily_visits` → `daily_visit_log`로 테이블 교체**

`server/src/db/connection.ts:175-183`을 교체:

```ts
  // daily_visits(집계 카운터)는 사용자당 하루 1회 중복 제거 방식으로
  // 바뀌면서 폐기됐다 — 기존에 쌓인 값을 초기화하려는 의도도 겸해서
  // DROP한다. 매 시작마다 실행해도 안전(두 번째 시작부턴 이미 없어서 no-op).
  db.exec(`DROP TABLE IF EXISTS daily_visits`);

  // 로그인 여부와 무관하게 사이트에 들어온 방문자를 "하루에 한 명당 1회"로
  // 집계한다 — visitor_key가 PRIMARY KEY의 일부라 INSERT OR IGNORE 한 번으로
  // 중복 제거가 끝난다(dailyVisits.ts 참고). user_id 대신 문자열 키를 쓰는
  // 이유: 로그인 유저는 "user:<id>", 비로그인 유저는 "ip:<IP>"로 서로 다른
  // 식별 방식을 한 컬럼에 같이 담기 위함. IP가 들어갈 수 있으므로 events
  // 테이블과 동일하게 90일 보관 후 자동 삭제(dailyVisits.ts의
  // recordVisitForDate 참고).
  db.exec(`
    CREATE TABLE IF NOT EXISTS daily_visit_log (
      date TEXT NOT NULL,
      visitor_key TEXT NOT NULL,
      PRIMARY KEY (date, visitor_key)
    )
  `);
```

- [ ] **Step 2: 실패하는 테스트부터 작성 (전면 재작성)**

`server/src/admin/dailyVisits.test.ts` 전체를 교체:

```ts
import { beforeEach, describe, expect, test } from "vitest";
import { db } from "../db/connection";
import { _resetForTest, getDailyVisitStats, recordVisitForDate } from "./dailyVisits";

describe("dailyVisits", () => {
  beforeEach(() => {
    _resetForTest();
  });

  test("the same logged-in user visiting twice on the same date is only counted once", () => {
    recordVisitForDate("2026-08-05", 42, "1.2.3.4");
    recordVisitForDate("2026-08-05", 42, "5.6.7.8"); // IP가 바뀌어도 userId로 식별되므로 여전히 같은 사람

    const stats = getDailyVisitStats();
    expect(stats.recent.find((r) => r.date === "2026-08-05")?.count).toBe(1);
  });

  test("the same anonymous IP visiting twice on the same date is only counted once", () => {
    recordVisitForDate("2026-08-05", undefined, "9.9.9.9");
    recordVisitForDate("2026-08-05", undefined, "9.9.9.9");

    const stats = getDailyVisitStats();
    expect(stats.recent.find((r) => r.date === "2026-08-05")?.count).toBe(1);
  });

  test("two different logged-in users on the same date count as 2", () => {
    recordVisitForDate("2026-08-05", 1, "1.1.1.1");
    recordVisitForDate("2026-08-05", 2, "1.1.1.1"); // 같은 IP라도 userId가 다르면 다른 사람

    const stats = getDailyVisitStats();
    expect(stats.recent.find((r) => r.date === "2026-08-05")?.count).toBe(2);
  });

  test("two different anonymous IPs on the same date count as 2", () => {
    recordVisitForDate("2026-08-05", undefined, "1.1.1.1");
    recordVisitForDate("2026-08-05", undefined, "2.2.2.2");

    const stats = getDailyVisitStats();
    expect(stats.recent.find((r) => r.date === "2026-08-05")?.count).toBe(2);
  });

  test("a logged-in user and an anonymous visitor on the same date count as 2", () => {
    recordVisitForDate("2026-08-05", 1, "1.1.1.1");
    recordVisitForDate("2026-08-05", undefined, "2.2.2.2");

    const stats = getDailyVisitStats();
    expect(stats.recent.find((r) => r.date === "2026-08-05")?.count).toBe(2);
  });

  test("the same user is counted separately on different dates", () => {
    recordVisitForDate("2026-08-04", 42, "1.2.3.4");
    recordVisitForDate("2026-08-05", 42, "1.2.3.4");

    const stats = getDailyVisitStats();
    expect(stats.recent.find((r) => r.date === "2026-08-04")?.count).toBe(1);
    expect(stats.recent.find((r) => r.date === "2026-08-05")?.count).toBe(1);
  });

  test("getDailyVisitStats.recent always returns exactly 7 entries, filling missing dates with count 0", () => {
    recordVisitForDate("2026-08-05", 1, "1.1.1.1");

    const stats = getDailyVisitStats();
    expect(stats.recent).toHaveLength(7);
    expect(stats.recent.every((r) => typeof r.count === "number")).toBe(true);
  });

  test("getDailyVisitStats.recent is sorted by date ascending, oldest first", () => {
    recordVisitForDate("2026-08-01", 1, "1.1.1.1");
    recordVisitForDate("2026-08-05", 2, "1.1.1.1");

    const stats = getDailyVisitStats();
    const dates = stats.recent.map((r) => r.date);
    expect(dates).toEqual([...dates].sort());
  });

  test("prunes visits older than the 90-day retention window on write", () => {
    const today = "2026-08-05";
    const ninetyOneDaysAgo = "2026-05-06"; // 2026-08-05 기준 91일 전 — date('2026-08-05', '-90 days') = '2026-05-07'보다 이전이라 정리 대상

    recordVisitForDate(ninetyOneDaysAgo, 1, "1.1.1.1");
    recordVisitForDate(today, 2, "2.2.2.2"); // 이 쓰기가 위 옛날 행을 정리한다

    // getDailyVisitStats()는 최근 7일로 범위를 고정해서 조회하므로, 정리가
    // 실제로 일어났는지(단순히 화면에 안 보이는 것과는 다름)는 raw 테이블을
    // 직접 봐야 확인할 수 있다.
    const remaining = db.prepare(`SELECT date FROM daily_visit_log WHERE date = ?`).all(ninetyOneDaysAgo);
    expect(remaining).toHaveLength(0);

    const stats = getDailyVisitStats();
    expect(stats.recent.find((r) => r.date === today)?.count).toBe(1);
  });
});
```

- [ ] **Step 3: 테스트 실행해서 실패하는지 확인**

Run: `cd server && npx vitest run dailyVisits`
Expected: FAIL — `recordVisitForDate`가 여전히 `(date: string)` 한 개 인자만
받는 옛 시그니처라 타입 에러 또는 인자 무시로 인한 단언 실패.

- [ ] **Step 4: `dailyVisits.ts` 전면 재작성**

`server/src/admin/dailyVisits.ts` 전체를 교체:

```ts
import { db } from "../db/connection";

export type DailyVisitStats = {
  today: number;
  recent: { date: string; count: number }[];
};

function visitorKeyFor(userId: number | undefined, ip: string): string {
  return userId !== undefined ? `user:${userId}` : `ip:${ip}`;
}

// SQLite의 date('now', '+9 hours')로 오늘(KST) 날짜를 구해서 그대로 넘긴다 —
// JS Date로 타임존 계산을 따로 하지 않는다.
export function recordVisit(userId: number | undefined, ip: string): void {
  const today = db.prepare(`SELECT date('now', '+9 hours') AS today`).get() as { today: string };
  recordVisitForDate(today.today, userId, ip);
}

// recordVisit()의 실제 로직 — 날짜를 인자로 받아 테스트에서 특정 날짜로
// 고정해 검증할 수 있게 분리해뒀다. 실제 라우트는 항상 recordVisit()을 쓴다.
//
// PRIMARY KEY (date, visitor_key)라 INSERT OR IGNORE 한 번으로 "오늘 이
// 사람은 이미 기록됨"이 자동으로 처리된다 — 로그인 유저는 user:<id>,
// 비로그인 유저는 ip:<IP>로 식별(visitorKeyFor).
export function recordVisitForDate(date: string, userId: number | undefined, ip: string): void {
  db.prepare(`INSERT OR IGNORE INTO daily_visit_log (date, visitor_key) VALUES (?, ?)`).run(
    date,
    visitorKeyFor(userId, ip),
  );

  // IP가 저장될 수 있으므로 events 테이블과 동일하게 90일 지난 행은 쓰기
  // 시점마다 정리한다.
  db.prepare(`DELETE FROM daily_visit_log WHERE date < date(?, '-90 days')`).run(date);
}

// 오늘 포함 최근 7일을 오름차순(오래된 날짜 먼저)으로, 데이터 없는 날짜는
// count: 0으로 채워서 항상 정확히 7개를 반환한다 — 호출부(관리자 대시보드)가
// 빈 날짜를 따로 처리할 필요가 없도록.
export function getDailyVisitStats(): DailyVisitStats {
  const todayRow = db.prepare(`SELECT date('now', '+9 hours') AS today`).get() as { today: string };
  const today = todayRow.today;

  const rows = db
    .prepare(
      `SELECT date, COUNT(*) AS count FROM daily_visit_log WHERE date >= date(?, '-6 days') GROUP BY date`,
    )
    .all(today) as { date: string; count: number }[];
  const byDate = new Map(rows.map((r) => [r.date, r.count]));

  const recent: { date: string; count: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const dateRow = db.prepare(`SELECT date(?, '-' || ? || ' days') AS d`).get(today, i) as { d: string };
    recent.push({ date: dateRow.d, count: byDate.get(dateRow.d) ?? 0 });
  }

  return { today: byDate.get(today) ?? 0, recent };
}

export function _resetForTest(): void {
  db.exec(`DELETE FROM daily_visit_log`);
}
```

- [ ] **Step 5: 테스트 재실행해서 통과 확인**

Run: `cd server && npx vitest run dailyVisits`
Expected: PASS (전부)

- [ ] **Step 6: `POST /api/visit` 라우트가 세션/IP를 넘기도록 수정**

`server/src/createServer.ts:145-148`을 교체:

```ts
  // 로그인 여부와 무관하게 사이트가 로드될 때마다 App.tsx가 한 번 호출 —
  // 사용자 한 명당 하루 1회만 카운트된다(daily_visit_log 테이블 참고).
  app.post("/api/visit", (req, res) => {
    const cookies = (req as unknown as { cookies?: Record<string, string> }).cookies;
    const userId = verifySession(cookies?.[SESSION_COOKIE_NAME]);
    recordVisit(userId, req.ip ?? "unknown");
    res.json({ ok: true });
  });
```

- [ ] **Step 7: 타입체크 + 서버 전체 테스트**

Run: `cd server && npm run build && npx vitest run`
Expected: 에러 없음, 이 태스크에서 재작성한 테스트 전부 PASS, 기존 테스트
회귀 없음(팀 탈락 관련 기존 무관 flaky 실패가 있다면 이 플랜과 무관하니
재실행해서 확인).

- [ ] **Step 8: 로컬에서 동기화 후 수동 확인**

Run: `npm run sync-public` (루트에서), 서버가 이미 떠 있다면 재시작.

`http://localhost:2567`에 로그인 상태로 접속해서 새로고침을 여러 번 한
뒤 관리자 페이지에서 오늘 방문 수가 "1"에서 안 늘어나는지 확인한다(같은
계정으로 여러 번 새로고침해도 중복 카운트 안 됨). 그 다음 시크릿 창
(로그인 안 한 상태)으로 한 번 더 접속해서 방문 수가 정확히 1 늘어나는지
확인한다.

- [ ] **Step 9: 커밋**

```bash
git add server/src/db/connection.ts server/src/admin/dailyVisits.ts server/src/admin/dailyVisits.test.ts server/src/createServer.ts
git commit -m "일일 방문자수: daily_visits 집계 방식을 사용자당 하루 1회 중복 제거(daily_visit_log)로 교체"
```

---

## 최종 확인

```bash
cd server && npx vitest run && npm run build
cd ../client && npx tsc -b && npm run build
```

전부 그린이면 배포 여부를 확인한다(이 프로젝트는 브랜치 없이 `main`에
직접 커밋하는 컨벤션이므로 finishing-a-development-branch의 "3옵션" 메뉴는
건너뜀). **배포 시 프로덕션 DB의 `daily_visits` 테이블이 자동으로 DROP되어
기존에 쌓인 방문자 카운트가 초기화됨** — 사용자가 명시적으로 요청한
동작이므로 그대로 진행한다.
