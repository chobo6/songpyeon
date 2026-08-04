# 관리자 대시보드 — 일일 방문자수 표시 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 관리자 대시보드에 로그인 여부와 무관한 사이트 방문 횟수(오늘 + 최근 7일)를 표시한다.

**Architecture:** 새 `daily_visits(date, count)` 테이블에 사이트가 로드될 때마다 오늘 날짜의 카운트를 1 증가시키고(중복 제거 없음, 로드 횟수 그대로), 관리자 대시보드가 그 값을 한 번 읽어와 보여준다.

**Tech Stack:** Node.js/TypeScript/Express/better-sqlite3(서버), React/TypeScript(클라이언트)

## Global Constraints

- 중복 제거(고유 방문자) 없음 — 사이트 로드 횟수를 그대로 집계.
- `daily_visits`는 IP/식별자를 저장하지 않으므로 개인정보가 아니다 — 보관 기간 제한 없이 무기한 보관.
- 날짜는 SQLite의 `date('now', '+9 hours')`(KST)로 계산 — JS 쪽에서 타임존 계산을 하지 않는다.
- `POST /api/visit`은 인증 불필요(로그인 여부와 무관하게 누구나 호출 가능).

---

### Task 1: 서버 — `daily_visits` 테이블 + 모듈 + 라우트

**Files:**
- Modify: `server/src/db/connection.ts`
- Create: `server/src/admin/dailyVisits.ts`
- Test: `server/src/admin/dailyVisits.test.ts`
- Modify: `server/src/createServer.ts`

**Interfaces:**
- Consumes: 없음(새 독립 모듈).
- Produces: `dailyVisits.ts`에서 `export function recordVisit(): void`, `export function recordVisitForDate(date: string): void`, `export type DailyVisitStats = { today: number; recent: { date: string; count: number }[] }`, `export function getDailyVisitStats(): DailyVisitStats`, `export function _resetForTest(): void` — Task 2(클라이언트)가 아니라 이 태스크 안의 라우트가 그대로 씀. 라우트: `POST /api/visit`(응답 `{ ok: true }`), `GET /api/admin/stats/daily-visitors`(`requireAdmin`, 응답이 `DailyVisitStats` 그대로).

- [ ] **Step 1: `daily_visits` 테이블 추가**

`server/src/db/connection.ts`의 `owned_nickname_effects` 테이블 정의
(약 156-173번 줄) 바로 뒤, `return db;`(175번 줄) 앞에 삽입:

```ts
  // 로그인 여부와 무관하게 사이트에 들어온 횟수 — 날짜별 카운터 하나뿐이라
  // IP 등 개인정보를 전혀 저장하지 않는다. events 테이블과 달리 보관 기간
  // 제한을 두지 않고 무기한 보관한다(관리자 대시보드의 "최근 추이" 조회용).
  db.exec(`
    CREATE TABLE IF NOT EXISTS daily_visits (
      date TEXT PRIMARY KEY,
      count INTEGER NOT NULL DEFAULT 0
    )
  `);
```

- [ ] **Step 2: 실패하는 테스트부터 작성**

`server/src/admin/dailyVisits.test.ts` 신규 생성:

```ts
import { beforeEach, describe, expect, test } from "vitest";
import { _resetForTest, getDailyVisitStats, recordVisitForDate } from "./dailyVisits";

describe("dailyVisits", () => {
  beforeEach(() => {
    _resetForTest();
  });

  test("recordVisitForDate creates a new row with count 1 for a fresh date", () => {
    recordVisitForDate("2026-08-04");

    const stats = getDailyVisitStats();
    const row = stats.recent.find((r) => r.date === "2026-08-04");
    expect(row?.count).toBe(1);
  });

  test("recordVisitForDate accumulates count on repeated calls for the same date", () => {
    recordVisitForDate("2026-08-04");
    recordVisitForDate("2026-08-04");
    recordVisitForDate("2026-08-04");

    const stats = getDailyVisitStats();
    const row = stats.recent.find((r) => r.date === "2026-08-04");
    expect(row?.count).toBe(3);
  });

  test("different dates get separate rows", () => {
    recordVisitForDate("2026-08-03");
    recordVisitForDate("2026-08-04");
    recordVisitForDate("2026-08-04");

    const stats = getDailyVisitStats();
    expect(stats.recent.find((r) => r.date === "2026-08-03")?.count).toBe(1);
    expect(stats.recent.find((r) => r.date === "2026-08-04")?.count).toBe(2);
  });

  test("getDailyVisitStats.recent always returns exactly 7 entries, filling missing dates with count 0", () => {
    recordVisitForDate("2026-08-04");

    const stats = getDailyVisitStats();
    expect(stats.recent).toHaveLength(7);
    expect(stats.recent.every((r) => typeof r.count === "number")).toBe(true);
  });

  test("getDailyVisitStats.recent is sorted by date ascending, oldest first", () => {
    recordVisitForDate("2026-08-01");
    recordVisitForDate("2026-08-04");

    const stats = getDailyVisitStats();
    const dates = stats.recent.map((r) => r.date);
    expect(dates).toEqual([...dates].sort());
  });
});
```

- [ ] **Step 3: 테스트 실행해서 실패하는지 확인**

Run: `cd server && npx vitest run dailyVisits`
Expected: FAIL — Cannot find module './dailyVisits' (아직 파일 자체가 없음)

- [ ] **Step 4: `server/src/admin/dailyVisits.ts` 구현**

```ts
import { db } from "../db/connection";

export type DailyVisitStats = {
  today: number;
  recent: { date: string; count: number }[];
};

// SQLite의 date('now', '+9 hours')로 오늘(KST) 날짜를 구해서 그대로 넘긴다 —
// JS Date로 타임존 계산을 따로 하지 않는다.
export function recordVisit(): void {
  const today = db.prepare(`SELECT date('now', '+9 hours') AS today`).get() as { today: string };
  recordVisitForDate(today.today);
}

// recordVisit()의 실제 로직 — 날짜를 인자로 받아 테스트에서 특정 날짜로
// 고정해 검증할 수 있게 분리해뒀다. 실제 라우트는 항상 recordVisit()을 쓴다.
export function recordVisitForDate(date: string): void {
  db.prepare(
    `INSERT INTO daily_visits (date, count) VALUES (?, 1)
     ON CONFLICT(date) DO UPDATE SET count = count + 1`,
  ).run(date);
}

// 오늘 포함 최근 7일을 오름차순(오래된 날짜 먼저)으로, 데이터 없는 날짜는
// count: 0으로 채워서 항상 정확히 7개를 반환한다 — 호출부(관리자 대시보드)가
// 빈 날짜를 따로 처리할 필요가 없도록.
export function getDailyVisitStats(): DailyVisitStats {
  const todayRow = db.prepare(`SELECT date('now', '+9 hours') AS today`).get() as { today: string };
  const today = todayRow.today;

  const rows = db
    .prepare(`SELECT date, count FROM daily_visits WHERE date >= date(?, '-6 days')`)
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
  db.exec(`DELETE FROM daily_visits`);
}
```

- [ ] **Step 5: 테스트 재실행해서 통과 확인**

Run: `cd server && npx vitest run dailyVisits`
Expected: PASS (전부)

- [ ] **Step 6: 라우트 2개 추가**

`server/src/createServer.ts` 상단, `getEvents, searchEventsByNickname`를
가져오는 import 줄(`import { getEvents, searchEventsByNickname } from
"./admin/eventLog";`) 바로 뒤에 추가:

```ts
import { getDailyVisitStats, recordVisit } from "./admin/dailyVisits";
```

`app.get("/api/ranking", ...)` 라우트(약 137-140번 줄) 바로 뒤, `app.post("/api/admin/login", ...)` 앞에 추가:

```ts
  // 로그인 여부와 무관하게 사이트가 로드될 때마다 App.tsx가 한 번 호출 —
  // 중복 제거 없이 로드 횟수를 그대로 센다(daily_visits 테이블 참고).
  app.post("/api/visit", (_req, res) => {
    recordVisit();
    res.json({ ok: true });
  });
```

`app.get("/api/admin/events/search", ...)` 라우트(약 230-237번 줄) 바로 뒤,
`app.get("/api/admin/users", ...)` 앞에 추가:

```ts
  app.get("/api/admin/stats/daily-visitors", requireAdmin, (_req, res) => {
    res.json(getDailyVisitStats());
  });
```

- [ ] **Step 7: 타입체크 + 서버 전체 테스트**

Run: `cd server && npm run build && npx vitest run`
Expected: 에러 없음, 이 태스크에서 추가한 테스트 전부 PASS, 기존 테스트 회귀 없음.

- [ ] **Step 8: 커밋**

```bash
git add server/src/db/connection.ts server/src/admin/dailyVisits.ts server/src/admin/dailyVisits.test.ts server/src/createServer.ts
git commit -m "서버: 일일 방문자수 집계(daily_visits) + /api/visit, /api/admin/stats/daily-visitors 추가"
```

---

### Task 2: 클라이언트 — 방문 ping + 관리자 대시보드 표시

**Files:**
- Modify: `client/src/App.tsx`
- Modify: `client/src/components/AdminDashboard.tsx`

**Interfaces:**
- Consumes: Task 1의 `POST /api/visit`(요청 body 없음, 응답 무시), `GET /api/admin/stats/daily-visitors`(응답 `{ today: number; recent: { date: string; count: number }[] }`).
- Produces: 없음(이 기능의 마지막 조각).

- [ ] **Step 1: `App.tsx`에 방문 ping 추가**

`client/src/App.tsx`의 최상위 `App` 컴포넌트(약 169-185번 줄)를 교체:

```tsx
function App() {
  // 게임 도중 새로고침/탭을 닫았다 다시 열었을 때 모드 선택 화면 없이 곧장 재접속을 시도하기
  // 위한 진입점 — 위 OnlineFlow의 joinSpec 초기값과 짝을 이룬다.
  const [mode, setMode] = useState<Mode>(() => (hasStoredReconnectToken() ? "online" : "select"));

  // 로그인 여부와 무관하게 앱이 처음 뜰 때 한 번만 방문 집계 — 실패해도
  // 무시(방문자 카운트가 실제 플레이를 막으면 안 됨).
  useEffect(() => {
    fetch("/api/visit", { method: "POST", credentials: "same-origin" }).catch(() => {});
  }, []);

  return (
    <>
      <AnnouncementBanner />
      <MegaphoneBanner />
      {mode === "online" && <OnlineFlow onExit={() => setMode("select")} />}
      {mode === "offline" && <OfflineFlow onExit={() => setMode("select")} />}
      {mode === "select" && (
        <ModeSelect onSelectOnline={() => setMode("online")} onSelectOffline={() => setMode("offline")} />
      )}
    </>
  );
}
```

- [ ] **Step 2: 타입체크로 확인**

Run: `cd client && npx tsc -b`
Expected: 에러 없음.

- [ ] **Step 3: `AdminDashboard.tsx`에 표시 섹션 추가**

`client/src/components/AdminDashboard.tsx:14-22`(`type AdminEvent = {...}`)
바로 뒤에 새 타입 추가:

```ts
type DailyVisitStats = {
  today: number;
  recent: { date: string; count: number }[];
};
```

`onlineNicknames` state 선언(약 53번 줄, `const [onlineNicknames, setOnlineNicknames] = useState<string[]>([]);`)
바로 뒤에 추가:

```ts
  const [visitStats, setVisitStats] = useState<DailyVisitStats | null>(null);
```

기존 `useEffect`(4초 폴링, 약 63-92번 줄) 바로 뒤에 새 `useEffect`를 추가 —
방문자 통계는 하루 단위로만 바뀌므로 폴링에 안 끼우고 마운트 시 한 번만
불러온다:

```ts
  useEffect(() => {
    fetchAdminJson<DailyVisitStats>("/api/admin/stats/daily-visitors").then((result) => {
      if (result.ok) setVisitStats(result.data);
      else if (result.unauthorized) onUnauthorized();
    });
  }, [onUnauthorized]);
```

`<section>현재 접속자 ({onlineNicknames.length})</section>` 블록(약 183-194번 줄)
바로 뒤에 새 섹션 추가:

```tsx
      <section>
        <h2>오늘 방문 {visitStats?.today ?? 0}회</h2>
        <ul className={styles.roomList}>
          {visitStats?.recent.map((r) => (
            <li key={r.date}>
              {r.date}: {r.count}회
            </li>
          ))}
        </ul>
      </section>
```

(`styles.roomList`는 기존 "활성 방" 섹션이 쓰는 클래스를 그대로 재사용 —
단순 목록 스타일이라 새 CSS 클래스를 추가할 필요가 없다.)

- [ ] **Step 4: 타입체크 + 빌드**

Run: `cd client && npx tsc -b && npm run build`
Expected: 에러 없음, 빌드 성공.

- [ ] **Step 5: 로컬에서 동기화 후 수동 확인**

Run: `npm run sync-public` (루트에서)

`http://localhost:2567`에 접속해서(새로고침 여러 번) 관리자 페이지
(`/admin`)에서 "오늘 방문 N회"와 최근 7일 목록이 뜨는지, 새로고침할 때마다
숫자가 올라가는지 확인한다.

- [ ] **Step 6: 커밋**

```bash
git add client/src/App.tsx client/src/components/AdminDashboard.tsx
git commit -m "클라이언트: 사이트 방문 집계 ping + 관리자 대시보드에 일일 방문자수 표시"
```

---

## 최종 확인

```bash
cd server && npx vitest run && npm run build
cd ../client && npx tsc -b && npm run build
```

전부 그린이면(팀 탈락 관련 기존 무관 실패가 있다면 이 플랜과 무관하니 무시)
배포 여부를 확인한다(이 프로젝트는 브랜치 없이 `main`에 직접 커밋하는
컨벤션이므로 finishing-a-development-branch의 "3옵션" 메뉴는 건너뜀).
