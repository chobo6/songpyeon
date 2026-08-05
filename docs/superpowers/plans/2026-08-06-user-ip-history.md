# 계정별 IP 이력 수집 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 계정이 "온라인" 모드에 진입할 때마다(로그인 상태에서 `GET /api/auth/me` 호출 시) 그 계정이 쓴 IP를 무기한 누적 기록하고, 관리자가 특정 계정의 IP 이력을 조회할 수 있게 한다.

**Architecture:** 새 테이블 `user_ips(user_id, ip)`를 `PRIMARY KEY (user_id, ip)`로 두어 "같은 IP면 갱신, 다른 IP면 추가"를 SQL 제약조건 하나로 구현한다. 기존 `GET /api/auth/me` 라우트(이미 온라인 진입 시 항상 호출됨)에 기록 호출 하나만 추가해서 클라이언트 변경 없이 수집하고, 새 관리자 전용 라우트로 조회를 제공한다.

**Tech Stack:** Node/Express, better-sqlite3, React 19, Vitest.

## Global Constraints

- 보관 기간: 무기한 (90일 자동 삭제 없음 — `events`/`daily_visit_log`와 의도적으로 다름).
- `ip === "unknown"`인 경우 기록하지 않는다.
- 날짜/시각은 항상 SQLite의 `datetime('now', '+9 hours')`(KST)로 계산한다 — JS Date 타임존 계산 금지.
- `verifySession()`은 실패 시 `null`을 반환한다(`undefined` 아님) — 단, `GET /api/auth/me`는 이미 `if (!userId) { res.json(null); return; }` 가드를 거치므로, 그 이후 블록에서는 `userId`가 TypeScript상 이미 `number`로 좁혀져 있어 `?? undefined` 변환이 필요 없다.
- 새 관리자 라우트는 `requireAdmin` 미들웨어로 보호한다.
- `:id` 라우트 파라미터는 기존 관례대로 `Number(req.params.id)` + `Number.isInteger(userId)` 검증 후 400을 반환한다(`invalid id`).

---

### Task 1: `user_ips` 테이블 + `userIps.ts` 모듈

**Files:**
- Modify: `server/src/db/connection.ts` (테이블 정의 추가)
- Create: `server/src/admin/userIps.ts`
- Test: `server/src/admin/userIps.test.ts`

**Interfaces:**
- Produces:
  - `recordUserIp(userId: number, ip: string): void`
  - `getIpsForUser(userId: number): { ip: string; firstSeen: string; lastSeen: string }[]` (내림차순, `lastSeen` 최근 순)
  - `_resetForTest(): void` (테스트 전용, `dailyVisits.ts`의 동명 함수와 같은 역할)

- [ ] **Step 1: `connection.ts`에 `user_ips` 테이블 추가**

`server/src/db/connection.ts`에서 `daily_visit_log` 테이블 정의 블록(현재 파일 끝 부분, `return db;` 바로 앞) 뒤에 아래를 추가한다:

```ts
// 계정이 온라인 모드에 진입할 때마다(GET /api/auth/me) 그 계정이 쓴 IP를
// 누적 기록한다 — events 테이블과 달리 매치룸에 안 들어가도(로그인만
// 해도) 기록된다. PRIMARY KEY (user_id, ip)라 같은 IP로 다시 들어오면
// last_seen만 갱신되고(중복 행 없음), 새 IP면 새 행이 추가된다.
// 보관 기간: 무기한(이 테이블의 존재 이유 자체가 장기 조사 목적이라
// events/daily_visit_log의 90일 자동 삭제를 의도적으로 적용하지 않는다).
db.exec(`
  CREATE TABLE IF NOT EXISTS user_ips (
    user_id INTEGER NOT NULL,
    ip TEXT NOT NULL,
    first_seen TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
    last_seen TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
    PRIMARY KEY (user_id, ip)
  )
`);
```

- [ ] **Step 2: 실패하는 테스트 작성**

`server/src/admin/userIps.test.ts` 전체 내용:

```ts
import { beforeEach, describe, expect, test } from "vitest";
import { db } from "../db/connection";
import { _resetForTest, getIpsForUser, recordUserIp } from "./userIps";

describe("userIps", () => {
  beforeEach(() => {
    _resetForTest();
  });

  test("recording the same user+IP multiple times keeps only one row", () => {
    recordUserIp(1, "1.2.3.4");
    recordUserIp(1, "1.2.3.4");

    const rows = getIpsForUser(1);
    expect(rows).toHaveLength(1);
    expect(rows[0].ip).toBe("1.2.3.4");
  });

  test("recording a different IP for the same user adds a new row without touching the old one", () => {
    recordUserIp(1, "1.1.1.1");
    const firstSeenBefore = getIpsForUser(1)[0].firstSeen;

    recordUserIp(1, "2.2.2.2");

    const rows = getIpsForUser(1);
    expect(rows).toHaveLength(2);
    const old = rows.find((r) => r.ip === "1.1.1.1");
    expect(old?.firstSeen).toBe(firstSeenBefore);
  });

  test("different users recording the same IP are tracked independently", () => {
    recordUserIp(1, "9.9.9.9");
    recordUserIp(2, "9.9.9.9");

    expect(getIpsForUser(1)).toHaveLength(1);
    expect(getIpsForUser(2)).toHaveLength(1);
  });

  test("ip === 'unknown' is not recorded", () => {
    recordUserIp(1, "unknown");

    expect(getIpsForUser(1)).toHaveLength(0);
  });

  test("getIpsForUser returns rows sorted by last_seen descending", () => {
    db.prepare(`INSERT INTO user_ips (user_id, ip, first_seen, last_seen) VALUES (?, ?, ?, ?)`).run(
      1,
      "1.1.1.1",
      "2026-08-01 00:00:00",
      "2026-08-01 00:00:00",
    );
    db.prepare(`INSERT INTO user_ips (user_id, ip, first_seen, last_seen) VALUES (?, ?, ?, ?)`).run(
      1,
      "2.2.2.2",
      "2026-08-03 00:00:00",
      "2026-08-03 00:00:00",
    );

    const rows = getIpsForUser(1);
    expect(rows.map((r) => r.ip)).toEqual(["2.2.2.2", "1.1.1.1"]);
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `cd server && npm test -- userIps` (또는 `npx vitest run src/admin/userIps.test.ts`)
Expected: FAIL — `Cannot find module './userIps'` (아직 파일 없음)

- [ ] **Step 4: `userIps.ts` 구현**

`server/src/admin/userIps.ts` 전체 내용:

```ts
import { db } from "../db/connection";

export type UserIpEntry = {
  ip: string;
  firstSeen: string;
  lastSeen: string;
};

// ip가 "unknown"이면(캡처 실패) 기록하지 않는다 — 의미 없는 값이라 저장할
// 필요가 없다. PRIMARY KEY (user_id, ip) 제약이 "같은 IP면 last_seen만
// 갱신, 다른 IP면 새 행"을 알아서 처리하므로 애플리케이션 코드에서 별도로
// "이전 값과 비교"할 필요가 없다.
export function recordUserIp(userId: number, ip: string): void {
  if (ip === "unknown") return;
  db.prepare(
    `INSERT INTO user_ips (user_id, ip) VALUES (?, ?)
     ON CONFLICT(user_id, ip) DO UPDATE SET last_seen = datetime('now', '+9 hours')`,
  ).run(userId, ip);
}

// 최근에 쓴 IP가 먼저 나오도록 last_seen 내림차순으로 반환한다.
export function getIpsForUser(userId: number): UserIpEntry[] {
  const rows = db
    .prepare(`SELECT ip, first_seen, last_seen FROM user_ips WHERE user_id = ? ORDER BY last_seen DESC`)
    .all(userId) as { ip: string; first_seen: string; last_seen: string }[];
  return rows.map((r) => ({ ip: r.ip, firstSeen: r.first_seen, lastSeen: r.last_seen }));
}

export function _resetForTest(): void {
  db.exec(`DELETE FROM user_ips`);
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `cd server && npm test -- userIps`
Expected: PASS (5 tests)

- [ ] **Step 6: 서버 전체 테스트 + 타입체크**

Run: `cd server && npm test && npm run build`
Expected: 기존 테스트 전부 PASS, 타입 에러 없음

- [ ] **Step 7: 커밋**

커밋 전 사용자에게 확인받을 것(AskUserQuestion) — 이 프로젝트의 표준 워크플로우.

```bash
git add server/src/db/connection.ts server/src/admin/userIps.ts server/src/admin/userIps.test.ts
git commit -m "$(cat <<'EOF'
계정별 IP 이력 저장 모듈 추가

EOF
)"
```

---

### Task 2: `createServer.ts` — 수집 훅 + 관리자 조회 라우트

**Files:**
- Modify: `server/src/createServer.ts:11` (import 추가)
- Modify: `server/src/createServer.ts:441-466` (`GET /api/auth/me`)
- Modify: `server/src/createServer.ts` (`nickname-effects` 라우트 블록, 현재 264-325줄 부근 — 새 라우트 삽입 위치)

**Interfaces:**
- Consumes: Task 1의 `recordUserIp(userId: number, ip: string): void`, `getIpsForUser(userId: number): { ip: string; firstSeen: string; lastSeen: string }[]`
- Produces: `GET /api/admin/users/:id/ips` — `requireAdmin` 보호, 응답 바디는 `getIpsForUser`의 배열 그대로.

- [ ] **Step 1: import 추가**

`server/src/createServer.ts:11` 근처, 기존 `import { getDailyVisitStats, recordVisit } from "./admin/dailyVisits";` 바로 아래 줄에 추가:

```ts
import { getIpsForUser, recordUserIp } from "./admin/userIps";
```

- [ ] **Step 2: `GET /api/auth/me`에 기록 훅 추가**

`server/src/createServer.ts:449`의 아래 한 줄을:

```ts
    if (user) touchLastLogin(userId);
```

다음과 같이 바꾼다:

```ts
    if (user) {
      touchLastLogin(userId);
      recordUserIp(userId, req.ip ?? "unknown");
    }
```

- [ ] **Step 3: 관리자 조회 라우트 추가**

`server/src/createServer.ts`에서 `/api/admin/users/:id/nickname-effects` 라우트가 끝나는 지점(현재 325번째 줄 `});`) 바로 뒤, `/api/admin/users/:id/ban` 라우트 시작 전에 추가:

```ts
  app.get("/api/admin/users/:id/ips", requireAdmin, (req, res) => {
    const userId = Number(req.params.id);
    if (!Number.isInteger(userId)) {
      res.status(400).json({ error: "invalid id" });
      return;
    }
    res.json(getIpsForUser(userId));
  });
```

- [ ] **Step 4: 타입체크**

Run: `cd server && npm run build`
Expected: 에러 없음

- [ ] **Step 5: 로컬 서버로 살아있는 라우트 확인**

`npm run sync-public`으로 client를 빌드해 `server/public`에 복사한 뒤(관리자 라우트는 same-origin 필요 — CLAUDE.md Gotchas 참고), `cd server && npm run dev`로 2567 포트에서 서버를 띄운다. 실제 구글 로그인 세션이 없어도 다음으로 확인 가능:

1. 로그인 없이 `curl http://localhost:2567/api/auth/me` → `null` 확인(기존 동작 유지, 회귀 없음).
2. 관리자 비밀번호로 로그인 후(`/admin` 페이지 또는 `POST /api/admin/login`) 세션 쿠키로 `GET /api/admin/users/1/ips` 호출 → `[]` 또는 기존에 기록된 배열이 정상적으로 반환되는지 확인.
3. `Number.isInteger` 검증 확인: `GET /api/admin/users/abc/ips` → `400 { "error": "invalid id" }`.

실제 구글 로그인 계정으로 `GET /api/auth/me`를 호출해 `user_ips` 테이블에 행이 실제로 쌓이는지까지 확인하려면, 이전 세션에서 반복 사용한 `server/make-test-session.ts` 패턴(임시 스크립트로 세션 토큰 발급 → 사용 후 삭제)을 재사용해 로그인 상태를 흉내낸 뒤 `GET /api/auth/me`를 호출하고, `data/songpyeon.db`를 직접 열어 `SELECT * FROM user_ips`로 확인한다.

- [ ] **Step 6: 커밋**

커밋 전 사용자에게 확인받을 것(AskUserQuestion).

```bash
git add server/src/createServer.ts
git commit -m "$(cat <<'EOF'
GET /api/auth/me에 IP 기록 훅 추가, 관리자 IP 이력 조회 라우트 추가

EOF
)"
```

---

### Task 3: `AdminEditUserModal.tsx` — 읽기 전용 "IP 이력" 섹션

**Files:**
- Modify: `client/src/components/AdminEditUserModal.tsx`
- Modify: `client/src/components/AdminEditUserModal.module.css`

**Interfaces:**
- Consumes: `GET /api/admin/users/:id/ips` (Task 2) — 응답 바디는 `{ ip: string; firstSeen: string; lastSeen: string }[]`.

- [ ] **Step 1: `AdminEditUserModal.tsx` 상단 import에 `useEffect` 추가**

`client/src/components/AdminEditUserModal.tsx:1`의:

```ts
import { useState } from "react";
```

다음으로 교체:

```ts
import { useEffect, useState } from "react";
```

- [ ] **Step 2: IP 이력 상태 + fetch 추가**

`client/src/components/AdminEditUserModal.tsx:51`(`const [currentMoney, setCurrentMoney] = useState(user.gameMoney);`) 바로 뒤에 추가:

```ts
  const [ipHistory, setIpHistory] = useState<{ ip: string; firstSeen: string; lastSeen: string }[] | null>(
    null,
  );

  // 모달이 열릴 때(user.id 확정 시) 한 번만 불러온다 — AdminDashboard.tsx의
  // 방문자 통계와 같은 패턴(폴링 없이 mount 시 1회 fetch). 수정 기능은
  // 없으므로 저장 관련 상태(saving 등)가 필요 없다.
  useEffect(() => {
    let cancelled = false;
    setIpHistory(null);
    fetch(`/api/admin/users/${user.id}/ips`, { credentials: "same-origin" })
      .then((res) => {
        if (res.status === 401) {
          onUnauthorized();
          return null;
        }
        return res.json();
      })
      .then((data) => {
        if (!cancelled && data) setIpHistory(data as { ip: string; firstSeen: string; lastSeen: string }[]);
      })
      .catch(() => {
        if (!cancelled) setIpHistory([]);
      });
    return () => {
      cancelled = true;
    };
  }, [user.id, onUnauthorized]);
```

- [ ] **Step 3: 렌더링에 섹션 추가**

`client/src/components/AdminEditUserModal.tsx`에서 게임머니 섹션(`</section>`, 현재 271번째 줄)과 닫기 버튼(`<button className={styles.closeButton}...`) 사이에 추가:

```tsx
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>IP 이력</h3>
          {ipHistory === null ? (
            <p className={styles.moneyDisplay}>불러오는 중...</p>
          ) : ipHistory.length === 0 ? (
            <p className={styles.moneyDisplay}>기록된 IP가 없습니다.</p>
          ) : (
            <ul className={styles.ipList}>
              {ipHistory.map((entry) => (
                <li key={entry.ip} className={styles.ipEntry}>
                  <span>{entry.ip}</span>
                  <span>
                    최초 {entry.firstSeen} · 최근 {entry.lastSeen}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
```

- [ ] **Step 4: CSS 추가**

`client/src/components/AdminEditUserModal.module.css` 끝에 추가:

```css
.ipList {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 0.8rem;
}

.ipEntry {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  flex-wrap: wrap;
  color: #4b5563;
}
```

- [ ] **Step 5: 타입체크 + lint**

Run: `cd client && npm run build && npm run lint`
Expected: 에러 없음

- [ ] **Step 6: 실제 화면 확인**

`npm run sync-public` 후 `cd server && npm run dev`로 2567 포트 서버를 띄우고, `/admin` 페이지에서 관리자 비밀번호로 로그인한 뒤 아무 유저나 "정보 수정" 모달을 연다. Playwright(`browser_navigate` → `/admin` 로그인 폼 채우기 → 유저 목록에서 수정 버튼 클릭)로:

1. 모달이 열리자마자 "IP 이력" 섹션에 "불러오는 중..." → 실제 목록 또는 "기록된 IP가 없습니다."로 바뀌는지 확인.
2. `GET /api/auth/me`로 기록된 적 있는 계정(Task 2에서 테스트에 썼던 계정)의 모달을 열어, IP·최초·최근 값이 실제로 표시되는지 확인.
3. 네트워크 탭 또는 `browser_network_requests`로 `GET /api/admin/users/:id/ips` 요청이 모달이 열릴 때 정확히 한 번만 나가는지(폴링되지 않는지) 확인.

- [ ] **Step 7: 커밋**

커밋 전 사용자에게 확인받을 것(AskUserQuestion).

```bash
git add client/src/components/AdminEditUserModal.tsx client/src/components/AdminEditUserModal.module.css
git commit -m "$(cat <<'EOF'
관리자 유저 수정 모달에 읽기 전용 IP 이력 섹션 추가

EOF
)"
```

---

### 배포

세 태스크가 모두 커밋된 후, 사용자에게 배포 여부를 확인(AskUserQuestion)하고 승인 시 CLAUDE.md의 표준 Docker 배포 절차(빌드 시 `--build-arg VITE_GOOGLE_CLIENT_ID` 필수, 배포 전 번들 내 client_id 확인, EC2에서 기존 컨테이너와 동일한 env/네트워크/바인드 마운트/재시작 정책으로 교체, 배포 후 라이브 사이트 확인)를 따른다.
