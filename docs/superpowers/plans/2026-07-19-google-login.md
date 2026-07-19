# 구글 로그인 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 온라인 모드를 구글 로그인 필수로 전환하고, 계정에 고정된 닉네임(최초 1회 설정)으로 플레이하게 한다.

**Architecture:** omok의 검증된 패턴(HTTP 로그인 엔드포인트 + httpOnly JWT 세션 쿠키)을 SQLite 기반으로
이식하고, Colyseus의 `MatchRoom.onAuth`가 같은 세션 쿠키를 직접 파싱·검증해서 방 입장 자체를 게이트한다.

**Tech Stack:** `better-sqlite3`(SQLite), `google-auth-library`(ID 토큰 검증), `jsonwebtoken`(세션),
기존 Node/Express/Colyseus/React/TS 스택 그대로.

## Global Constraints

- 혼자 연습(오프라인) 모드는 이번 변경과 무관 — 서버 연결 자체가 없음, 손대지 않음
- 온라인 모드는 로그인 필수 — `MatchRoom.onAuth`가 세션 없으면 입장 자체를 거부
- 로그인 후 닉네임은 계정에 최초 1회만 설정, 이후 매 접속마다 재사용 (수정 기능은 이번 스코프 제외)
- DB는 SQLite, 완전히 새로운 영구 저장소 — 서버 재배포 시에도 데이터가 살아남아야 함(게임
  상태·관리자 로그와 달리 회원 데이터는 날아가면 안 됨) → Docker 볼륨 마운트 필요(Task 8)
- 서버 테스트는 `describe`/`test`(`it` 아님) + vitest (기존 관례)
- 클라이언트 CSS는 `rem` 단위 (기존 관례)
- songpyeon 전용 Google OAuth 클라이언트 ID를 사용자가 Google Cloud Console에서 직접 생성해야 함
  (Task 8에서 안내)

---

### Task 1: SQLite 연결 계층 + 테스트 환경 설정

**Files:**
- Create: `server/src/db/connection.ts`
- Create: `server/src/db/connection.test.ts`
- Create: `server/vitest.setup.ts`
- Modify: `server/vitest.config.ts`
- Modify: `server/package.json` (의존성 추가)
- Modify: `.gitignore` (루트)
- Create: `server/data/.gitkeep`

**Interfaces:**
- Produces: `createDb(filename: string): Database.Database`, `db: Database.Database`(싱글턴,
  `SQLITE_DB_PATH` 환경변수로 경로 오버라이드 가능 — 테스트에서 `:memory:`로 격리) — Task 3(googleAuth),
  Task 5(MatchRoom)가 `db`를 그대로 import해서 씀

- [ ] **Step 1: 의존성 설치**

Run (레포 루트에서):
```bash
npm install better-sqlite3 --workspace server
npm install -D @types/better-sqlite3 --workspace server
```

- [ ] **Step 2: DB 연결 모듈 작성**

`server/src/db/connection.ts`:
```ts
import Database from "better-sqlite3";

export function createDb(filename: string): Database.Database {
  const db = new Database(filename);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      google_sub TEXT UNIQUE NOT NULL,
      email TEXT,
      name TEXT,
      nickname TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  return db;
}

export const db = createDb(process.env.SQLITE_DB_PATH ?? "data/songpyeon.db");
```

- [ ] **Step 3: 실패하는 테스트 작성**

`server/src/db/connection.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import { createDb } from "./connection";

describe("createDb", () => {
  test("creates a users table with the expected columns", () => {
    const db = createDb(":memory:");
    db.prepare(
      `INSERT INTO users (google_sub, email, name, nickname) VALUES (?, ?, ?, ?)`,
    ).run("sub-1", "a@example.com", "Alice", "닉네임1");

    const row = db.prepare(`SELECT * FROM users WHERE google_sub = ?`).get("sub-1") as {
      id: number;
      google_sub: string;
      email: string;
      name: string;
      nickname: string;
      created_at: string;
    };

    expect(row.google_sub).toBe("sub-1");
    expect(row.email).toBe("a@example.com");
    expect(row.nickname).toBe("닉네임1");
    expect(row.created_at).toBeTruthy();
  });

  test("google_sub is unique — a duplicate insert throws", () => {
    const db = createDb(":memory:");
    db.prepare(`INSERT INTO users (google_sub) VALUES (?)`).run("sub-dup");
    expect(() => db.prepare(`INSERT INTO users (google_sub) VALUES (?)`).run("sub-dup")).toThrow();
  });

  test("calling createDb twice with :memory: gives independent databases", () => {
    const dbA = createDb(":memory:");
    const dbB = createDb(":memory:");
    dbA.prepare(`INSERT INTO users (google_sub) VALUES (?)`).run("only-in-a");
    const rowInB = dbB.prepare(`SELECT * FROM users WHERE google_sub = ?`).get("only-in-a");
    expect(rowInB).toBeUndefined();
  });
});
```

- [ ] **Step 4: 테스트가 실패하는지 확인**

Run: `npm test --workspace server -- src/db/connection.test.ts`
Expected: FAIL — `Cannot find module './connection'` (아직 파일 생성 전이면) 또는 모듈은 있지만
better-sqlite3가 설치 안 됐다면 import 에러. Step 1을 먼저 했으므로 실제로는 파일이 없어서 나는
`Cannot find module` 에러여야 함 — Step 2를 아직 안 했다면.

(주: 이 태스크는 Step 2에서 이미 최종 구현을 작성했음 — `createDb`가 매우 단순한 함수라 "일부러
실패하게 작성 후 최소구현"의 중간 단계가 사실상 없음. RED 확인은 Step 2 이전 상태 기준으로 하고,
그 다음 GREEN으로 넘어간다.)

- [ ] **Step 5: 테스트 통과 확인**

Run: `npm test --workspace server -- src/db/connection.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: vitest 테스트 환경에서 SQLite를 인메모리로 격리**

`server/vitest.setup.ts` (신규 파일):
```ts
process.env.SQLITE_DB_PATH = ":memory:";
process.env.SESSION_JWT_SECRET = "test-session-secret";
process.env.GOOGLE_CLIENT_ID = "test-google-client-id";
```

`server/vitest.config.ts`를 아래로 교체:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    pool: "forks",
    setupFiles: ["./vitest.setup.ts"],
  },
});
```

이 설정 덕분에 이후 태스크(3, 5)의 테스트들이 `db/connection.ts`의 싱글턴 `db`를 그대로 import해도
실제 파일이 아니라 `:memory:` DB를 쓰게 된다 (vitest는 `setupFiles`를 각 테스트 파일의 import보다
먼저 실행함을 보장).

- [ ] **Step 7: 전체 서버 테스트가 여전히 통과하는지 확인 (setupFiles 추가로 인한 회귀 없는지)**

Run: `npm test --workspace server`
Expected: 기존 94개 + 새로 추가한 3개 = 97개 전부 PASS

- [ ] **Step 8: 데이터 디렉토리 준비 + gitignore**

`server/data/.gitkeep` (빈 파일, 내용 없음):
```

```

루트 `.gitignore`(`c:\Users\hong\OneDrive\Desktop\workspace\songpyeon\.gitignore`) 맨 끝에 추가:
```
server/data/*
!server/data/.gitkeep
```

- [ ] **Step 9: 커밋**

```bash
git add server/src/db/connection.ts server/src/db/connection.test.ts server/vitest.setup.ts server/vitest.config.ts server/package.json server/package-lock.json server/data/.gitkeep .gitignore
git commit -m "feat: add SQLite connection layer with test isolation via :memory:"
```

---

### Task 2: 세션 JWT 모듈

**Files:**
- Create: `server/src/auth/session.ts`
- Test: `server/src/auth/session.test.ts`

**Interfaces:**
- Consumes: 없음 (독립 모듈, `process.env.SESSION_JWT_SECRET`만 사용)
- Produces: `SESSION_COOKIE_NAME: string`, `signSession(userId: number): string`,
  `verifySession(token: string | undefined): number | null`,
  `getCookieValue(cookieHeader: string | undefined, name: string): string | undefined` —
  Task 4(라우트), Task 5(MatchRoom.onAuth)가 전부 가져다 씀

- [ ] **Step 1: 의존성 설치**

Run (레포 루트에서):
```bash
npm install jsonwebtoken --workspace server
npm install -D @types/jsonwebtoken --workspace server
```

- [ ] **Step 2: 실패하는 테스트 작성**

`server/src/auth/session.test.ts`:
```ts
import { beforeEach, describe, expect, test } from "vitest";
import { getCookieValue, SESSION_COOKIE_NAME, signSession, verifySession } from "./session";

describe("signSession / verifySession", () => {
  beforeEach(() => {
    process.env.SESSION_JWT_SECRET = "test-session-secret";
  });

  test("signs and verifies a session round-trip", () => {
    const token = signSession(42);
    expect(verifySession(token)).toBe(42);
  });

  test("rejects a tampered token", () => {
    const token = signSession(42);
    expect(verifySession(token + "x")).toBeNull();
  });

  test("rejects when the secret is unset", () => {
    const token = signSession(42);
    delete process.env.SESSION_JWT_SECRET;
    expect(verifySession(token)).toBeNull();
  });

  test("returns null for an undefined token", () => {
    expect(verifySession(undefined)).toBeNull();
  });

  test("signSession throws when the secret is unset", () => {
    delete process.env.SESSION_JWT_SECRET;
    expect(() => signSession(1)).toThrow();
  });
});

describe("getCookieValue", () => {
  test("extracts a named cookie from a header with multiple cookies", () => {
    expect(getCookieValue("foo=bar; " + SESSION_COOKIE_NAME + "=abc123; other=x", SESSION_COOKIE_NAME)).toBe(
      "abc123",
    );
  });

  test("returns undefined when the cookie is absent", () => {
    expect(getCookieValue("foo=bar", SESSION_COOKIE_NAME)).toBeUndefined();
  });

  test("returns undefined for an undefined header", () => {
    expect(getCookieValue(undefined, SESSION_COOKIE_NAME)).toBeUndefined();
  });

  test("decodes URI-encoded cookie values", () => {
    expect(getCookieValue(`${SESSION_COOKIE_NAME}=a%20b`, SESSION_COOKIE_NAME)).toBe("a b");
  });
});
```

- [ ] **Step 3: 테스트가 실패하는지 확인**

Run: `npm test --workspace server -- src/auth/session.test.ts`
Expected: FAIL — `Cannot find module './session'`

- [ ] **Step 4: 최소 구현 작성**

`server/src/auth/session.ts`:
```ts
import jwt from "jsonwebtoken";

export const SESSION_COOKIE_NAME = "session";

export function signSession(userId: number): string {
  const secret = process.env.SESSION_JWT_SECRET;
  if (!secret) throw new Error("SESSION_JWT_SECRET이 설정되지 않았습니다.");
  return jwt.sign({ userId }, secret, { expiresIn: "30d" });
}

export function verifySession(token: string | undefined): number | null {
  const secret = process.env.SESSION_JWT_SECRET;
  if (!secret || !token) return null;
  try {
    const payload = jwt.verify(token, secret) as { userId: number };
    return payload.userId;
  } catch {
    return null;
  }
}

export function getCookieValue(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const pair of cookieHeader.split(";")) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    if (pair.slice(0, eq).trim() === name) {
      return decodeURIComponent(pair.slice(eq + 1).trim());
    }
  }
  return undefined;
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npm test --workspace server -- src/auth/session.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 6: 커밋**

```bash
git add server/src/auth/session.ts server/src/auth/session.test.ts server/package.json server/package-lock.json
git commit -m "feat: add JWT session sign/verify and cookie header parsing"
```

---

### Task 3: 구글 인증 + 유저 upsert/닉네임

**Files:**
- Create: `server/src/auth/googleAuth.ts`
- Test: `server/src/auth/googleAuth.test.ts`

**Interfaces:**
- Consumes: `db`(Task 1), `sanitizeNickname`(기존, `server/src/game/nickname.ts`)
- Produces: `type UserProfile = { id: number; nickname: string | null }`,
  `verifyGoogleIdToken(credential: string): Promise<{sub: string; email?: string; name?: string}>`,
  `getOrCreateUser(googleSub: string, info: {email?: string; name?: string}): UserProfile`,
  `setNickname(userId: number, nickname: string): boolean`,
  `getUserById(userId: number): UserProfile | undefined` — Task 4(라우트), Task 5(MatchRoom)가
  `getUserById`를, Task 4가 나머지 전부를 가져다 씀

- [ ] **Step 1: 의존성 설치**

Run (레포 루트에서):
```bash
npm install google-auth-library --workspace server
```

- [ ] **Step 2: 실패하는 테스트 작성 (DB 연동 부분만 — `verifyGoogleIdToken`은 외부 네트워크 호출이라
  제외, 수동 검증은 Task 8)**

`server/src/auth/googleAuth.test.ts`:
```ts
import { beforeEach, describe, expect, test } from "vitest";
import { db } from "../db/connection";
import { getOrCreateUser, getUserById, setNickname } from "./googleAuth";

describe("getOrCreateUser", () => {
  beforeEach(() => {
    db.exec("DELETE FROM users");
  });

  test("creates a new user with no nickname yet", () => {
    const user = getOrCreateUser("sub-1", { email: "a@example.com", name: "Alice" });
    expect(user.nickname).toBeNull();
  });

  test("returns the same user id on a repeat login with the same google_sub", () => {
    const first = getOrCreateUser("sub-2", { name: "Bob" });
    const second = getOrCreateUser("sub-2", { name: "Bob" });
    expect(second.id).toBe(first.id);
  });

  test("does not overwrite an existing nickname on repeat login", () => {
    const user = getOrCreateUser("sub-3", { name: "Carol" });
    setNickname(user.id, "캐롤");
    const again = getOrCreateUser("sub-3", { name: "Carol Updated" });
    expect(again.nickname).toBe("캐롤");
  });
});

describe("setNickname", () => {
  beforeEach(() => {
    db.exec("DELETE FROM users");
  });

  test("sets the nickname for a user with none yet", () => {
    const user = getOrCreateUser("sub-4", {});
    const ok = setNickname(user.id, "둘리");
    expect(ok).toBe(true);
    expect(getUserById(user.id)?.nickname).toBe("둘리");
  });

  test("refuses to overwrite an already-set nickname", () => {
    const user = getOrCreateUser("sub-5", {});
    setNickname(user.id, "첫닉네임");
    const ok = setNickname(user.id, "새닉네임");
    expect(ok).toBe(false);
    expect(getUserById(user.id)?.nickname).toBe("첫닉네임");
  });

  test("sanitizes the nickname before storing (delegates to sanitizeNickname)", () => {
    const user = getOrCreateUser("sub-6", {});
    setNickname(user.id, "   ");
    expect(getUserById(user.id)?.nickname).toBe("플레이어");
  });
});

describe("getUserById", () => {
  beforeEach(() => {
    db.exec("DELETE FROM users");
  });

  test("returns undefined for an unknown id", () => {
    expect(getUserById(999999)).toBeUndefined();
  });
});
```

- [ ] **Step 3: 테스트가 실패하는지 확인**

Run: `npm test --workspace server -- src/auth/googleAuth.test.ts`
Expected: FAIL — `Cannot find module './googleAuth'`

- [ ] **Step 4: 최소 구현 작성**

`server/src/auth/googleAuth.ts`:
```ts
import { OAuth2Client } from "google-auth-library";
import { db } from "../db/connection";
import { sanitizeNickname } from "../game/nickname";

let oauthClient: OAuth2Client | null = null;
function getOAuthClient(): OAuth2Client {
  if (!oauthClient) oauthClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
  return oauthClient;
}

// Google ID 토큰(credential)을 검증해 { sub, email, name }을 반환한다.
// 검증 실패(서명/audience 불일치, 만료 등) 시 throw — 호출부(라우트)가 catch해서 401 처리
export async function verifyGoogleIdToken(
  credential: string,
): Promise<{ sub: string; email?: string; name?: string }> {
  const audience = process.env.GOOGLE_CLIENT_ID;
  // audience가 undefined면 google-auth-library가 aud 클레임 검증 자체를 건너뛰어, 이 앱이
  // 아닌 다른 OAuth 클라이언트용으로 발급된 토큰도 통과해버린다 — 반드시 명시적으로 실패시킨다
  if (!audience) throw new Error("GOOGLE_CLIENT_ID가 설정되지 않았습니다.");
  const client = getOAuthClient();
  const ticket = await client.verifyIdToken({ idToken: credential, audience });
  const payload = ticket.getPayload();
  if (!payload?.sub) throw new Error("구글 토큰에 sub 클레임이 없습니다.");
  return { sub: payload.sub, email: payload.email, name: payload.name };
}

export type UserProfile = { id: number; nickname: string | null };

// googleSub 기준 upsert — UNIQUE(google_sub) + ON CONFLICT로 존재 확인/생성/갱신을 원자적으로 처리.
// 닉네임은 이 시점에 건드리지 않는다 — 로그인할 때마다 구글 실명(name)이 사용자가 정한 닉네임을
// 덮어쓰면 안 되기 때문 (신규 생성 시에만 nickname은 NULL로 남는다).
export function getOrCreateUser(googleSub: string, info: { email?: string; name?: string }): UserProfile {
  db.prepare(
    `INSERT INTO users (google_sub, email, name)
     VALUES (?, ?, ?)
     ON CONFLICT(google_sub) DO UPDATE SET
       email = COALESCE(excluded.email, users.email),
       name = COALESCE(excluded.name, users.name)`,
  ).run(googleSub, info.email ?? null, info.name ?? null);

  return db.prepare(`SELECT id, nickname FROM users WHERE google_sub = ?`).get(googleSub) as UserProfile;
}

// 닉네임이 아직 없는 계정에만 설정한다 (이번 스코프는 "최초 1회 설정, 이후 수정 불가").
// 이미 설정되어 있으면 false를 반환 — 호출부(라우트)가 409로 응답한다.
export function setNickname(userId: number, nickname: string): boolean {
  const clean = sanitizeNickname(nickname);
  const result = db.prepare(`UPDATE users SET nickname = ? WHERE id = ? AND nickname IS NULL`).run(clean, userId);
  return result.changes > 0;
}

export function getUserById(userId: number): UserProfile | undefined {
  return db.prepare(`SELECT id, nickname FROM users WHERE id = ?`).get(userId) as UserProfile | undefined;
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npm test --workspace server -- src/auth/googleAuth.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 6: 커밋**

```bash
git add server/src/auth/googleAuth.ts server/src/auth/googleAuth.test.ts server/package.json server/package-lock.json
git commit -m "feat: add Google ID token verification and SQLite-backed user upsert"
```

---

### Task 4: 인증 REST 라우트 4개

**Files:**
- Modify: `server/src/createServer.ts`

**Interfaces:**
- Consumes: `verifyGoogleIdToken`, `getOrCreateUser`, `setNickname`, `getUserById`, `type UserProfile`
  (Task 3), `signSession`, `verifySession`, `SESSION_COOKIE_NAME`(Task 2)
- Produces: `POST /api/auth/google`, `GET /api/auth/me`, `POST /api/auth/nickname`,
  `POST /api/auth/logout` — Task 6(클라이언트 `auth.ts`)이 이 엔드포인트들을 호출함

이 태스크는 라우팅 배선이라 자동 테스트 대상이 아니다 — curl로 수동 검증한다(관리자 기능 때와 동일
관례).

- [ ] **Step 1: `createServer.ts` 수정**

`server/src/createServer.ts` 상단 import 블록에 추가:
```ts
import { getOrCreateUser, getUserById, setNickname, verifyGoogleIdToken } from "./auth/googleAuth";
import { SESSION_COOKIE_NAME, signSession, verifySession } from "./auth/session";
```

기존 `/api/admin/*` 라우트들 다음, `const httpServer = ...` 줄 이전에 아래 라우트들을 추가:
```ts
  app.post("/api/auth/google", async (req, res) => {
    try {
      const { credential } = req.body as { credential?: unknown };
      if (typeof credential !== "string") {
        res.status(400).json({ error: "credential이 필요합니다." });
        return;
      }
      const { sub, email, name } = await verifyGoogleIdToken(credential);
      const user = getOrCreateUser(sub, { email, name });
      const token = signSession(user.id);
      res.cookie(SESSION_COOKIE_NAME, token, { httpOnly: true, sameSite: "lax" });
      res.json({ id: user.id, nickname: user.nickname });
    } catch (err) {
      console.error("구글 로그인 실패:", err);
      res.status(401).json({ error: "로그인에 실패했습니다." });
    }
  });

  app.get("/api/auth/me", (req, res) => {
    const cookies = (req as unknown as { cookies?: Record<string, string> }).cookies;
    const userId = verifySession(cookies?.[SESSION_COOKIE_NAME]);
    if (!userId) {
      res.json(null);
      return;
    }
    const user = getUserById(userId);
    res.json(user ? { id: user.id, nickname: user.nickname } : null);
  });

  app.post("/api/auth/nickname", (req, res) => {
    const cookies = (req as unknown as { cookies?: Record<string, string> }).cookies;
    const userId = verifySession(cookies?.[SESSION_COOKIE_NAME]);
    if (!userId) {
      res.status(401).json({ error: "로그인이 필요합니다." });
      return;
    }
    const { nickname } = req.body as { nickname?: unknown };
    if (typeof nickname !== "string" || !nickname.trim()) {
      res.status(400).json({ error: "닉네임이 필요합니다." });
      return;
    }
    const ok = setNickname(userId, nickname);
    if (!ok) {
      res.status(409).json({ error: "이미 닉네임이 설정되어 있습니다." });
      return;
    }
    const user = getUserById(userId);
    res.json({ id: userId, nickname: user?.nickname ?? null });
  });

  app.post("/api/auth/logout", (_req, res) => {
    res.clearCookie(SESSION_COOKIE_NAME);
    res.json({ ok: true });
  });
```

- [ ] **Step 2: 타입체크**

Run: `npm run build --workspace server`
Expected: 에러 없이 통과 (`tsc --noEmit`)

- [ ] **Step 3: 서버 실행 후 curl로 수동 검증**

이 단계는 실제 구글 ID 토큰이 없어 `/api/auth/google` 자체는 여기서 완전히 검증할 수 없다(Task 8의
브라우저 검증에서 진행) — 여기서는 라우트 배선과 세션 없을 때의 동작만 확인한다.

```bash
GOOGLE_CLIENT_ID=test SESSION_JWT_SECRET=test1234 npm run dev --workspace server
```

다른 터미널에서:
```bash
# 세션 없이 /me 호출 — null 응답이어야 함(에러 아님)
curl -s http://localhost:2567/api/auth/me
# Expected: null

# 잘못된 credential로 로그인 시도 — 401
curl -i -X POST http://localhost:2567/api/auth/google -H "Content-Type: application/json" -d '{"credential":"not-a-real-token"}'
# Expected: HTTP/1.1 401

# 세션 없이 닉네임 설정 시도 — 401
curl -i -X POST http://localhost:2567/api/auth/nickname -H "Content-Type: application/json" -d '{"nickname":"테스트"}'
# Expected: HTTP/1.1 401

# 로그아웃은 세션 여부와 무관하게 항상 성공
curl -i -X POST http://localhost:2567/api/auth/logout
# Expected: HTTP/1.1 200, {"ok":true}
```

- [ ] **Step 4: 커밋**

```bash
git add server/src/createServer.ts
git commit -m "feat: wire Google login, profile, nickname, and logout routes"
```

---

### Task 5: MatchRoom 로그인 연동 + 기존 게임 로직 테스트 전체 치환

**Files:**
- Modify: `server/src/rooms/MatchRoom.ts`
- Modify: `server/src/rooms/MatchRoom.test.ts`

**Interfaces:**
- Consumes: `getUserById`(Task 3), `verifySession`, `getCookieValue`, `SESSION_COOKIE_NAME`,
  `signSession`(Task 2), `getOrCreateUser`, `setNickname`(Task 3, 테스트 헬퍼에서 사용)
- Produces: 없음 (최종 소비처 — `client.auth`에 `{ip, userId, nickname}`이 담기는 것은 Colyseus
  프레임워크 내부 계약이라 다른 태스크가 타입으로 가져다 쓰지 않음)

**중요한 사전 조사 결과 (그대로 활용):**
- `colyseus.js`의 `Client` 생성자는 Node 환경에서 `{headers: {...}}` 옵션으로 WebSocket 업그레이드
  요청에 커스텀 헤더(쿠키 포함)를 실어 보낼 수 있다(`node_modules/colyseus.js/lib/transport/WebSocketTransport.js`
  확인 완료 — Node의 `ws` 라이브러리가 이를 지원). `@colyseus/testing`의 `connectTo`는 이 기능을
  안 쓰지만, 테스트에서 직접 `new Client(...)`를 만들면 이 헤더 옵션을 그대로 쓸 수 있다.
- `ColyseusTestServer`의 `server` 필드(`colyseus.server`)에서 `server["port"]`로 로컬 테스트
  서버의 실제 포트를 얻을 수 있다(`@colyseus/testing`의 내부 구현이 정확히 이렇게 함).
- `Room.setMetadata()`는 필드 단위 병합이라(이미 검증됨), `hostNickname`을 매번 다시 넘길 필요는
  없다 — 하지만 이번엔 `onCreate`가 아니라 `onJoin`에서 최초 1명일 때만 설정해야 한다(아래 이유).
- **`onCreate`는 방을 만든 클라이언트의 `onAuth`/`onJoin`보다 먼저 실행된다** — 즉 `onCreate`
  시점엔 "누가 만들었는지" 인증된 정보가 아직 없다. 기존 코드는 `onCreate`가 `options.nickname`으로
  `hostNickname`을 설정했는데, 이제 `nickname`이 옵션에서 사라지므로 이 설정을 `onJoin`으로 옮겨야
  한다(방에 아무도 없을 때 들어온 사람 = 방장으로 판단).

- [ ] **Step 1: `MatchRoom.ts`의 `onAuth`/`onCreate`/`onJoin` 수정**

`server/src/rooms/MatchRoom.ts` 상단 import 블록에서 `import { sanitizeNickname } from "../game/nickname";`
줄을 삭제하고, 그 자리(또는 다른 import들 근처)에 아래 두 줄을 추가:
```ts
import { getUserById } from "../auth/googleAuth";
import { getCookieValue, SESSION_COOKIE_NAME, verifySession } from "../auth/session";
```

`interface MatchRoomOptions { ... }`에서 `nickname?: unknown;` 줄을 삭제 (최종 형태):
```ts
interface MatchRoomOptions {
  turnDurationMs?: number;
  teamCount?: unknown;
}
```

`onCreate` 안의 `this.setMetadata({ hostNickname: sanitizeNickname(options.nickname) });` 줄을
**삭제** (hostNickname은 이제 onJoin에서 설정됨 — 위 이유 참고). `onCreate`의 나머지 내용(턴
시간, patchRate, teamCount, state 초기화, onMessage 등록들)은 전혀 손대지 않는다.

기존 `onAuth`/`onJoin`/`onLeave` 블록 전체를 아래로 교체:
```ts
  // Colyseus's ws-transport already resolves the real client IP for us
  // (x-real-ip / x-forwarded-for / socket.remoteAddress, in that order).
  // Beyond IP, this room now also requires a valid login session — the
  // cookie header isn't parsed by Express's cookie-parser here (WS upgrade
  // requests never go through Express middleware), so we parse and verify
  // it ourselves, reusing the exact same session logic the HTTP auth routes
  // use. No session (or a session for an account with no nickname yet) —
  // reject the join outright; the client never even shows the room list
  // without first completing login + nickname setup, so this path only
  // fires for direct API access or a session that expired mid-lobby.
  async onAuth(_client: Client, _options: MatchRoomOptions, context: AuthContext) {
    const token = getCookieValue(context.headers?.cookie, SESSION_COOKIE_NAME);
    const userId = verifySession(token);
    const user = userId ? getUserById(userId) : undefined;
    if (!user || !user.nickname) {
      throw new Error("로그인이 필요합니다.");
    }
    return { ip: context.ip, userId: user.id, nickname: user.nickname };
  }

  async onJoin(client: Client, _options: MatchRoomOptions = {}) {
    if (this.state.players.has(client.sessionId)) return;

    if (this.state.phase !== "lobby") {
      throw new Error("Match already in progress");
    }

    // The first player to actually join (not the one who called client.create())
    // is the host, display-wise — onCreate runs before its own caller's
    // onAuth/onJoin, so hostNickname can't be set there anymore.
    const isHost = this.state.players.size === 0;
    const nickname = client.auth?.nickname ?? "플레이어";

    const player = new PlayerState();
    player.sessionId = client.sessionId;
    player.nickname = nickname;
    this.state.players.set(client.sessionId, player);
    this.pushChat(this.state.lobbyChat, "", `${player.nickname}님이 입장했습니다`);
    console.log(`[join] session=${client.sessionId} ip=${client.auth?.ip} nickname=${player.nickname}`);
    recordEvent({
      type: "join",
      timestamp: Date.now(),
      nickname: player.nickname,
      roomId: this.roomId,
      ip: String(client.auth?.ip ?? "unknown"),
      sessionId: client.sessionId,
    });

    const metadataUpdate: { players: { sessionId: string; nickname: string }[]; hostNickname?: string } = {
      players: this.rosterForMetadata(),
    };
    if (isHost) metadataUpdate.hostNickname = nickname;
    await this.setMetadata(metadataUpdate);
  }

  async onLeave(client: Client) {
    // No reconnection grace: the client never persists a reconnection token
    // and never attempts to resume (see client/src/colyseus.ts) — a refresh,
    // closed tab, or dropped connection always lands back on the room list.
    // Granting a grace period here just left a phantom player occupying a
    // role/team slot (and the room looking occupied to others) for up to
    // RECONNECTION_GRACE_SECONDS with nothing that could ever reconnect
    // through it. Free the slot immediately instead.
    console.log(`[leave] session=${client.sessionId} ip=${client.auth?.ip}`);
    const leavingNickname = this.state.players.get(client.sessionId)?.nickname ?? "?";
    recordEvent({
      type: "leave",
      timestamp: Date.now(),
      nickname: leavingNickname,
      roomId: this.roomId,
      ip: String(client.auth?.ip ?? "unknown"),
      sessionId: client.sessionId,
    });
    this.removePlayer(client.sessionId);
    await this.setMetadata({ players: this.rosterForMetadata() });
  }
```
(`private rosterForMetadata()`와 그 아래 `private removePlayer(...)` 등 나머지 메서드는 전혀
손대지 않는다 — 위 블록이 정확히 기존 `onAuth`/`onJoin`/`onLeave` 세 메서드를 대체하는 것이다.)

- [ ] **Step 2: 타입체크 (아직 테스트는 안 고침 — 여기서 기존 테스트가 무더기로 깨지는 게 정상)**

Run: `npm run build --workspace server`
Expected: 에러 없이 통과 (타입은 맞음 — 런타임 동작이 바뀐 것뿐)

- [ ] **Step 3: `MatchRoom.test.ts`에 로그인된 유저로 접속하는 테스트 헬퍼 추가**

`server/src/rooms/MatchRoom.test.ts` 상단 import 블록에 추가:
```ts
import { Client as ColyseusJsClient } from "colyseus.js";
import { getOrCreateUser, setNickname } from "../auth/googleAuth";
import { signSession } from "../auth/session";
```

파일 상단, `flush()`/`wait()` 헬퍼 함수들 바로 다음(같은 위치, `describe("MatchRoom", ...)` 블록
**밖**, 최상위 레벨)에 아래 헬퍼를 추가:
```ts
let testUserCounter = 0;

// MatchRoom.onAuth가 로그인 세션을 요구하므로, 게임 로직만 검증하려는 기존 테스트들도 이제
// "로그인된 유저로 접속"을 거쳐야 한다. 테스트용 유저를 DB에 만들고 실제 세션 쿠키를 발급받아,
// colyseus.js Client를 커스텀 Cookie 헤더로 직접 연결한다 (@colyseus/testing의 connectTo는
// 헤더를 커스터마이즈할 수 없어서 이 방식이 필요 — colyseus.js가 Node 환경에서 WebSocket
// 업그레이드 요청에 커스텀 헤더를 지원하는 것을 확인하고 쓰는 것).
async function connectAsUser(colyseus: ColyseusTestServer, room: ServerRoom<MatchState>, nickname: string) {
  testUserCounter += 1;
  const user = getOrCreateUser(`test-google-sub-${testUserCounter}`, {});
  setNickname(user.id, nickname);
  const token = signSession(user.id);
  const port = (colyseus.server as unknown as { port: number }).port;
  const client = new ColyseusJsClient(`ws://127.0.0.1:${port}`, {
    headers: { Cookie: `session=${token}` },
  });
  return client.joinById<MatchState>(room.roomId);
}
```

- [ ] **Step 4: 기존 `connectTo` 호출부를 전부 `connectAsUser`로 치환**

`server/src/rooms/MatchRoom.test.ts` 안의 아래 패턴을 **전부** 기계적으로 치환한다 (파일 전체를
훑어서 하나도 빠뜨리지 말 것 — `grep -n "colyseus.connectTo" server/src/rooms/MatchRoom.test.ts`로
치환 전후 위치를 대조):

- `await colyseus.connectTo(room)` (옵션 없음) → `await connectAsUser(colyseus, room, "플레이어")`
- `await colyseus.connectTo(room, { nickname: "닉네임값" })` → `await connectAsUser(colyseus, room, "닉네임값")`
- `colyseus.connectTo(room)` (await 없이 `expect(...).rejects.toThrow()` 안에 있는 경우, 예:
  507번·516번 줄 근처) → `connectAsUser(colyseus, room, "플레이어")` (마찬가지로 await 없이,
  `expect(...)` 안에)

**단, 딱 하나 예외가 있다.** 125~132번 줄 근처의 아래 테스트는 기계적으로 치환하지 말고 **통째로
삭제**할 것:
```ts
  test("onJoin stores a sanitized nickname from join options", async () => {
    const room = await colyseus.createRoom<MatchState>("match");
    const clean = await colyseus.connectTo(room, { nickname: "  둘리  " });
    const dirty = await colyseus.connectTo(room, { nickname: 12345 });

    expect(room.state.players.get(clean.sessionId)?.nickname).toBe("둘리");
    expect(room.state.players.get(dirty.sessionId)?.nickname).toBe("플레이어");
  });
```
이유: 이 테스트는 "클라이언트가 보낸 지저분한 닉네임을 MatchRoom이 직접 정제한다"는, 이번 변경으로
사라지는 동작을 검증하던 것이다. 닉네임 정제(`sanitizeNickname`)는 `server/src/game/nickname.test.ts`
에서 이미 독립적으로(그리고 더 철저하게) 테스트되고 있고, `setNickname`을 통한 저장 시점 정제는
Task 3의 `googleAuth.test.ts`("sanitizes the nickname before storing")가 커버한다 — 그러니 이
테스트는 그냥 삭제해도 커버리지 손실이 없다.

- [ ] **Step 5: 전체 서버 테스트 실행**

Run: `npm test --workspace server`
Expected: 전부 PASS (Task 1에서 97개였던 것 + 이 태스크에서 테스트 1개 삭제 = 96개 — 정확한 숫자는
실행 결과로 확인하고, 실패가 있으면 어떤 `connectTo` 호출을 놓쳤는지 하나씩 찾아서 고칠 것)

- [ ] **Step 6: 커밋**

```bash
git add server/src/rooms/MatchRoom.ts server/src/rooms/MatchRoom.test.ts
git commit -m "feat: require a logged-in session to join a match, derive nickname from account"
```

---

### Task 6: 클라이언트 구글 로그인 유틸 + 로그인 화면

**Files:**
- Create: `client/src/game/auth.ts`
- Create: `client/src/components/GoogleLoginScreen.tsx`
- Create: `client/src/components/GoogleLoginScreen.module.css`

**Interfaces:**
- Consumes: `POST /api/auth/google`, `GET /api/auth/me`, `POST /api/auth/nickname`,
  `POST /api/auth/logout` (Task 4)
- Produces: `type Profile = { id: number; nickname: string | null }`,
  `renderGoogleButton(containerId: string, onCredential: (credential: string) => void): Promise<void>`,
  `loginWithGoogle(credential: string): Promise<Profile>`, `fetchMe(): Promise<Profile | null>`,
  `submitNickname(nickname: string): Promise<Profile>`, `logout(): Promise<void>`,
  `<GoogleLoginScreen onCredential={...} />` — Task 7이 전부 가져다 씀

이 태스크는 자동 테스트 없이 빌드 통과 + 브라우저 확인(Task 8에서 종합) — 클라이언트 UI에 테스트
프레임워크가 없는 기존 관례를 따름.

- [ ] **Step 1: 구글 로그인 유틸 작성**

`client/src/game/auth.ts`:
```ts
const GIS_SRC = "https://accounts.google.com/gsi/client";

type GoogleAccountsId = {
  initialize: (config: { client_id: string; callback: (response: { credential: string }) => void }) => void;
  renderButton: (element: HTMLElement, options: Record<string, string>) => void;
};

declare global {
  interface Window {
    google?: { accounts: { id: GoogleAccountsId } };
  }
}

let scriptPromise: Promise<void> | null = null;
function loadGoogleScript(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = GIS_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Google Identity Services script"));
    document.head.appendChild(script);
  });
  return scriptPromise;
}

// containerId 엘리먼트 안에 구글 로그인 버튼을 렌더링한다.
// 로그인 성공 시 onCredential(idTokenString)이 호출된다.
export async function renderGoogleButton(
  containerId: string,
  onCredential: (credential: string) => void,
): Promise<void> {
  await loadGoogleScript();
  window.google!.accounts.id.initialize({
    client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
    callback: (response) => onCredential(response.credential),
  });
  const container = document.getElementById(containerId);
  if (!container) return;
  window.google!.accounts.id.renderButton(container, {
    theme: "outline",
    size: "large",
    shape: "pill",
    text: "signin_with",
  });
}

export type Profile = { id: number; nickname: string | null };

export async function loginWithGoogle(credential: string): Promise<Profile> {
  const res = await fetch("/api/auth/google", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ credential }),
  });
  if (!res.ok) throw new Error("로그인에 실패했습니다.");
  return res.json();
}

export async function fetchMe(): Promise<Profile | null> {
  const res = await fetch("/api/auth/me", { credentials: "same-origin" });
  if (!res.ok) return null;
  return res.json();
}

export async function submitNickname(nickname: string): Promise<Profile> {
  const res = await fetch("/api/auth/nickname", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ nickname }),
  });
  if (!res.ok) throw new Error("닉네임 설정에 실패했습니다.");
  return res.json();
}

export async function logout(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
}
```

- [ ] **Step 2: 로그인 화면 컴포넌트 작성**

`client/src/components/GoogleLoginScreen.module.css`:
```css
.wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1.5rem;
  padding: 3rem 1rem;
  color: #fff;
  text-align: center;
  flex: 1;
  justify-content: center;
}

.hint {
  margin: 0;
  font-size: 0.95rem;
  opacity: 0.85;
}
```

`client/src/components/GoogleLoginScreen.tsx`:
```tsx
import { useEffect, useRef } from "react";
import { renderGoogleButton } from "../game/auth";
import styles from "./GoogleLoginScreen.module.css";

const BUTTON_CONTAINER_ID = "google-login-button";

export function GoogleLoginScreen({ onCredential }: { onCredential: (credential: string) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    renderGoogleButton(BUTTON_CONTAINER_ID, onCredential);
  }, [onCredential]);

  return (
    <main className={styles.wrap}>
      <h1>송편 만들기</h1>
      <p className={styles.hint}>온라인 플레이는 구글 로그인이 필요해요</p>
      <div ref={containerRef} id={BUTTON_CONTAINER_ID} />
    </main>
  );
}
```

- [ ] **Step 3: 타입체크 + 빌드**

Run: `npm run build --workspace client`
Expected: 에러 없이 통과

- [ ] **Step 4: 커밋**

```bash
git add client/src/game/auth.ts client/src/components/GoogleLoginScreen.tsx client/src/components/GoogleLoginScreen.module.css
git commit -m "feat: add Google Identity Services login utilities and login screen"
```

---

### Task 7: 온라인 진입 흐름을 로그인 기반으로 재구성

**Files:**
- Modify: `client/src/components/NicknameEntry.tsx`
- Delete: `client/src/game/nickname.ts` (구 로컬 닉네임 캐싱 — 더는 아무도 안 씀)
- Modify: `client/src/components/NicknameEntry.module.css`
- Modify: `client/src/App.tsx`
- Modify: `client/src/colyseus.ts`

**Interfaces:**
- Consumes: `fetchMe`, `loginWithGoogle`, `submitNickname`, `type Profile`(Task 6),
  `GoogleLoginScreen`(Task 6)
- Produces: 없음 (최종 소비처 — 온라인 진입 흐름 자체)

- [ ] **Step 1: `client/src/game/nickname.ts` 삭제**

이 파일(`getSavedNickname`/`saveNickname`, sessionStorage 기반 로컬 닉네임 캐싱)은 이번 변경 전
`NicknameEntry.tsx`에서만 쓰였다 — 닉네임이 계정에 고정되는 지금은 "이전에 입력한 닉네임을 다음
방문에 미리 채워주는" 이 기능 자체가 의미가 없어진다. 파일을 삭제한다.

- [ ] **Step 2: `NicknameEntry.tsx`를 "계정 최초 1회 닉네임 설정" 화면으로 재작성**

`client/src/components/NicknameEntry.module.css`에서 `.hint` 규칙 바로 다음에 `.error` 규칙을
추가(파일의 나머지 부분은 그대로 둠):
```css
.error {
  color: #ff8a80;
  font-size: 0.85rem;
  margin: 0;
}
```

`client/src/components/NicknameEntry.tsx` 전체를 아래로 교체:
```tsx
import { useState, type FormEvent } from "react";
import { submitNickname } from "../game/auth";
import styles from "./NicknameEntry.module.css";

const MAX_NICKNAME_LENGTH = 10;

export function NicknameEntry({ onSubmit }: { onSubmit: (nickname: string) => void }) {
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = value.trim().slice(0, MAX_NICKNAME_LENGTH);
    if (!trimmed) return;
    setSubmitting(true);
    setError(null);
    try {
      const profile = await submitNickname(trimmed);
      if (!profile.nickname) {
        setError("닉네임 설정에 실패했어요");
        return;
      }
      onSubmit(profile.nickname);
    } catch {
      setError("닉네임 설정에 실패했어요");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className={styles.wrap} onSubmit={handleSubmit}>
      <p className={styles.hint}>처음 오셨네요! 사용할 닉네임을 정해주세요 (나중에 바꿀 수 없어요)</p>
      <input
        className={styles.input}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        maxLength={MAX_NICKNAME_LENGTH}
        placeholder="닉네임"
        autoFocus
      />
      {error && <p className={styles.error}>{error}</p>}
      <button className={styles.submit} type="submit" disabled={!value.trim() || submitting}>
        확인
      </button>
    </form>
  );
}
```

- [ ] **Step 3: `colyseus.ts`의 `JoinSpec`에서 `nickname` 제거**

`client/src/colyseus.ts`의 `JoinSpec` 타입과 `connectToMatch` 함수를 아래로 교체:
```ts
export type JoinSpec = { type: "create"; teamCount: number } | { type: "joinById"; roomId: string };

// 세션 쿠키(httpOnly, 브라우저가 WebSocket 업그레이드 요청에 자동으로 실어 보냄)로 서버가
// 로그인 여부와 닉네임을 판단하므로, 더 이상 nickname을 옵션으로 넘길 필요가 없다
// (MatchRoom.onAuth/onJoin 참고).
async function connectToMatch<T>(spec: JoinSpec): Promise<Room<T>> {
  return spec.type === "create"
    ? await client.create<T>("match", { teamCount: spec.teamCount })
    : await client.joinById<T>(spec.roomId);
}
```
(파일의 나머지 — `endpoint`, `apiBase`, `listRooms`, `roomPromise`, `joinMatch`, `leaveMatch` —
는 전혀 손대지 않는다.)

- [ ] **Step 4: `App.tsx`의 `OnlineFlow`를 로그인 게이트로 재구성**

`client/src/App.tsx` 상단 import 블록을 아래로 교체:
```tsx
import { useEffect, useState } from "react";
import { useMatchRoom } from "./game/useMatchRoom";
import type { JoinSpec } from "./colyseus";
import { fetchMe, loginWithGoogle, type Profile } from "./game/auth";
import { Game } from "./components/Game";
import { GoogleLoginScreen } from "./components/GoogleLoginScreen";
import { ModeSelect } from "./components/ModeSelect";
import { NicknameEntry } from "./components/NicknameEntry";
import { RoomList } from "./components/RoomList";
import { SoloRoleSelect } from "./components/SoloRoleSelect";
import { SoloPlayScreen } from "./components/SoloPlayScreen";
import type { Role } from "./game/colors";
import { AnnouncementBanner } from "./components/AnnouncementBanner";
import "./App.css";
```

`OnlineFlow` 함수 전체를 아래로 교체:
```tsx
function OnlineFlow({ onExit }: { onExit: () => void }) {
  const [me, setMe] = useState<Profile | null | undefined>(undefined);
  const [joinSpec, setJoinSpec] = useState<JoinSpec | null>(null);

  useEffect(() => {
    fetchMe().then(setMe);
  }, []);

  if (me === undefined) {
    return (
      <main className="connecting">
        <h1>송편 만들기</h1>
        <p>불러오는 중...</p>
      </main>
    );
  }

  if (me === null) {
    return (
      <GoogleLoginScreen
        onCredential={async (credential) => {
          try {
            const profile = await loginWithGoogle(credential);
            setMe(profile);
          } catch (err) {
            console.error("구글 로그인 실패", err);
          }
        }}
      />
    );
  }

  if (!me.nickname) {
    return <NicknameEntry onSubmit={(nickname) => setMe({ ...me, nickname })} />;
  }

  // A refresh or a dropped connection always lands back on the room list —
  // no automatic resume into whatever room you were last in. Combined with
  // RoleSelect now allowing free role changes without leaving the room,
  // there's no scenario left where losing your place mid-lobby is costly
  // enough to need a silent resume.
  if (!joinSpec) {
    return (
      <RoomList
        onCreateRoom={(teamCount) => setJoinSpec({ type: "create", teamCount })}
        onJoinRoom={(roomId) => setJoinSpec({ type: "joinById", roomId })}
        onExit={onExit}
      />
    );
  }

  return <ConnectedOnlineFlow joinSpec={joinSpec} onExit={() => setJoinSpec(null)} />;
}
```
(파일의 나머지 — `ConnectedOnlineFlow`, `OfflineFlow`, `App` 본문 — 는 전혀 손대지 않는다. 특히
`App()` 함수의 `<AnnouncementBanner />` 마운트는 그대로 유지.)

- [ ] **Step 5: 타입체크 + 빌드**

Run: `npm run build --workspace client`
Expected: 에러 없이 통과 (특히 `client/src/game/nickname.ts`를 참조하는 곳이 하나도 안 남았는지
확인 — 남아있으면 빌드가 실패하며 알려줌)

- [ ] **Step 6: 커밋**

```bash
git add client/src/components/NicknameEntry.tsx client/src/components/NicknameEntry.module.css client/src/App.tsx client/src/colyseus.ts
git rm client/src/game/nickname.ts
git commit -m "feat: gate online mode behind Google login, derive nickname from account"
```

---

### Task 8: Dockerfile 반영 + 실제 구글 로그인 전체 흐름 검증

**Files:**
- Modify: `Dockerfile`

**Interfaces:**
- Consumes: 이전 태스크 전부
- Produces: 없음 (배포 반영 + 최종 검증)

- [ ] **Step 1: Dockerfile에 클라이언트 빌드 인자 + 데이터 볼륨 추가**

`Dockerfile` 전체를 아래로 교체:
```dockerfile
# --- Stage 1: client build ---
FROM node:22-slim AS client-build
WORKDIR /app
COPY package.json package-lock.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
RUN npm ci
COPY client/ client/
ARG VITE_GOOGLE_CLIENT_ID
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID
RUN npm run build --workspace client

# --- Stage 2: server runtime ---
FROM node:22-slim AS server
WORKDIR /app
COPY package.json package-lock.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
RUN npm ci
COPY server/ server/
COPY --from=client-build /app/client/dist ./server/public

WORKDIR /app/server
ENV PORT=2567
EXPOSE 2567
VOLUME /app/server/data
CMD ["npm", "start"]
```

- [ ] **Step 2: 로컬에서 Docker 빌드가 실제로 성공하는지 확인 (better-sqlite3 네이티브 빌드 검증)**

Run (레포 루트에서):
```bash
docker build -t songpyeon:google-login-test --build-arg VITE_GOOGLE_CLIENT_ID=test-placeholder .
```
Expected: 빌드 성공. **만약 `better-sqlite3` 관련 컴파일 에러(예: `node-gyp`, `python`, `make`
못 찾음)로 실패하면**, `Dockerfile`의 두 `FROM node:22-slim` 스테이지 각각에 `WORKDIR /app` 다음
줄로 아래를 추가하고 다시 시도할 것:
```dockerfile
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
```
(better-sqlite3는 보통 사전 컴파일된 바이너리를 받아오므로 이 단계가 필요 없을 가능성이 높지만,
`node:22-slim`은 최소 구성이라 실패 시를 대비해 적어둠)

- [ ] **Step 3: Google Cloud Console에서 songpyeon 전용 OAuth 클라이언트 ID 생성 (사용자 작업)**

이 단계는 자동화할 수 없다 — 진행하면서 사용자에게 실시간으로 화면을 안내하며 다음을 확인:
1. https://console.cloud.google.com/apis/credentials 에서 새 OAuth 2.0 클라이언트 ID 생성
   (유형: "웹 애플리케이션")
2. "승인된 자바스크립트 원본"에 현재 배포 주소(`https://52-79-227-179.nip.io` 형태, EC2 재시작 시
   바뀔 수 있음 — `CLAUDE.md`의 관련 Gotcha 참고) 등록
3. 로컬 검증용으로 `http://localhost:2567`도 함께 등록해두면 이후 로컬 Docker 컨테이너로도 실제
   로그인을 테스트할 수 있음
4. 발급된 클라이언트 ID를 확보

- [ ] **Step 4: 로컬 Docker 컨테이너로 실제 브라우저 로그인 흐름 검증**

Run:
```bash
docker build -t songpyeon:google-login-test --build-arg VITE_GOOGLE_CLIENT_ID=<Step 3에서 받은 클라이언트 ID> .
docker run -d -p 8080:2567 --name songpyeon-google-test -e GOOGLE_CLIENT_ID=<같은 클라이언트 ID> -e SESSION_JWT_SECRET=<임의의 긴 랜덤 문자열> songpyeon:google-login-test
```

브라우저로 `http://localhost:8080` 접속해서:
1. "온라인" 클릭 → 구글 로그인 화면이 뜨는지 확인
2. 실제 구글 계정으로 로그인 → 신규 계정이므로 닉네임 설정 화면으로 전환되는지 확인
3. 닉네임 입력 → 방 목록 화면으로 전환되는지 확인
4. 방 생성 → 정상 입장되는지, 방장 이름이 방금 정한 닉네임으로 표시되는지 확인
5. 페이지 새로고침(브라우저 F5) 후 다시 "온라인" 클릭 → 로그인 화면이 아니라 곧장 방 목록으로
   가는지 확인 (세션 쿠키가 유지되는지 — 재로그인 요구하면 안 됨)
6. 새 시크릿/프라이빗 창(쿠키 없음)에서 같은 서버 접속 → 로그인 화면부터 다시 뜨는지 확인
7. "혼자 연습" 모드는 로그인 화면 없이 그대로 진입되는지 확인 (이번 변경과 무관해야 함)

- [ ] **Step 5: 정리**

```bash
docker rm -f songpyeon-google-test
docker rmi songpyeon:google-login-test
```

- [ ] **Step 6: 실제 EC2 배포는 이 태스크 범위 밖 — 별도로 진행**

`ADMIN_PASSWORD`와 마찬가지로, EC2에 실제 반영할 땐 `docker run` 명령에 `-e GOOGLE_CLIENT_ID=...`,
`-e SESSION_JWT_SECRET=...`을 추가하고, **`-v /home/ec2-user/songpyeon-data:/app/server/data`로
데이터 디렉토리를 호스트에 마운트해야** 재배포 시 회원 데이터가 사라지지 않는다(Global Constraints
참고). `docker build`도 `--build-arg VITE_GOOGLE_CLIENT_ID=...`를 추가해서 다시 빌드해야 한다.
