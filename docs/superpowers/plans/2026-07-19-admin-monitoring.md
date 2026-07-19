# 관리자 모니터링 페이지 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 비밀번호로 보호된 관리자 페이지에서 현재 활성 방/접속자 현황과 최근 입장·퇴장 로그를 보고,
전체 접속자에게 공지 배너를 실시간으로 띄울 수 있게 한다.

**Architecture:** DB 없이 서버 메모리에만 상태를 두는 현재 구조를 유지한다. 방/접속자 현황은 REST
폴링, 공지는 SSE(Server-Sent Events)로 단방향 실시간 전송한다. Colyseus Room은 추가하지 않는다.

**Tech Stack:** Node/Express(서버), Colyseus(게임 룸), React 19 + TypeScript(클라이언트),
vitest(서버 테스트), `cookie-parser`(신규 의존성)

## Global Constraints

- 서버는 `"type": "module"` 필수 (ESM) — 기존 `songpyeon-server` 관례
- DB/영구 저장소 추가 금지 — 이번 스코프는 완전 인메모리 (스펙 §요구사항)
- Colyseus Room을 추가로 만들지 않음 — 기존 재접속/StrictMode 처리 복잡도를 배가시키지 않기 위함
  (스펙 §아키텍처)
- 로그인 시도 횟수 제한 등 무차별 대입 방어는 이번 스코프 아님 (스펙 §요구사항)
- 서버 재시작 시 로그/공지 이력/로그인 세션이 초기화되는 것은 허용 (스펙 §요구사항)
- 클라이언트 CSS는 `rem` 단위 사용 (기존 코드베이스 관례 — `ModeSelect.module.css` 등 참고)
- 서버 테스트는 `describe`/`test`(`it` 아님) + `vitest` (기존 관례 — `server/src/game/mortar.test.ts`
  참고)

---

### Task 1: 이벤트 로그 저장소 (`eventLog.ts`)

**Files:**
- Create: `server/src/admin/eventLog.ts`
- Test: `server/src/admin/eventLog.test.ts`

**Interfaces:**
- Produces: `AdminEvent` 타입, `recordEvent(event: AdminEvent): void`, `getEvents(): AdminEvent[]`,
  `_resetForTest(): void` — Task 4(MatchRoom 연동), Task 5(라우트)가 이 함수들을 그대로 가져다 씀

- [ ] **Step 1: 실패하는 테스트 작성**

`server/src/admin/eventLog.test.ts`:
```ts
import { beforeEach, describe, expect, test } from "vitest";
import { _resetForTest, getEvents, recordEvent, type AdminEvent } from "./eventLog";

function makeEvent(overrides: Partial<AdminEvent> = {}): AdminEvent {
  return {
    type: "join",
    timestamp: Date.now(),
    nickname: "테스트",
    roomId: "room1",
    ip: "127.0.0.1",
    sessionId: "sess1",
    ...overrides,
  };
}

describe("eventLog", () => {
  beforeEach(() => {
    _resetForTest();
  });

  test("returns recorded events in insertion order", () => {
    recordEvent(makeEvent({ sessionId: "a" }));
    recordEvent(makeEvent({ sessionId: "b" }));

    expect(getEvents().map((e) => e.sessionId)).toEqual(["a", "b"]);
  });

  test("caps stored events at 500, dropping the oldest first", () => {
    for (let i = 0; i < 500; i++) {
      recordEvent(makeEvent({ sessionId: `s${i}` }));
    }
    recordEvent(makeEvent({ sessionId: "s500" }));

    const events = getEvents();
    expect(events.length).toBe(500);
    expect(events[0].sessionId).toBe("s1");
    expect(events[events.length - 1].sessionId).toBe("s500");
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npm test --workspace server -- src/admin/eventLog.test.ts`
Expected: FAIL — `Cannot find module './eventLog'` (아직 파일이 없음)

- [ ] **Step 3: 최소 구현 작성**

`server/src/admin/eventLog.ts`:
```ts
export type AdminEvent = {
  type: "join" | "leave";
  timestamp: number;
  nickname: string;
  roomId: string;
  ip: string;
  sessionId: string;
};

const MAX_EVENTS = 500;
const events: AdminEvent[] = [];

export function recordEvent(event: AdminEvent): void {
  events.push(event);
  if (events.length > MAX_EVENTS) {
    events.shift();
  }
}

export function getEvents(): AdminEvent[] {
  return events;
}

export function _resetForTest(): void {
  events.length = 0;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test --workspace server -- src/admin/eventLog.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: 커밋**

```bash
git add server/src/admin/eventLog.ts server/src/admin/eventLog.test.ts
git commit -m "feat: add in-memory admin event log with 500-entry cap"
```

---

### Task 2: 관리자 인증 (`auth.ts`)

**Files:**
- Create: `server/src/admin/auth.ts`
- Test: `server/src/admin/auth.test.ts`

**Interfaces:**
- Consumes: 없음 (독립 모듈)
- Produces: `checkPassword(password: string): boolean`, `createSession(): string`,
  `isValidSession(token: string | undefined): boolean`,
  `destroySession(token: string | undefined): void`,
  `requireAdmin(req: Request, res: Response, next: NextFunction): void`,
  `_resetForTest(): void` — Task 5(라우트)가 이 함수들을 가져다 씀

- [ ] **Step 1: 실패하는 테스트 작성**

`server/src/admin/auth.test.ts`:
```ts
import { beforeEach, describe, expect, test } from "vitest";
import {
  _resetForTest,
  checkPassword,
  createSession,
  destroySession,
  isValidSession,
} from "./auth";

describe("auth", () => {
  beforeEach(() => {
    _resetForTest();
    process.env.ADMIN_PASSWORD = "correct-horse";
  });

  test("accepts the correct password", () => {
    expect(checkPassword("correct-horse")).toBe(true);
  });

  test("rejects an incorrect password", () => {
    expect(checkPassword("wrong")).toBe(false);
  });

  test("rejects any password when ADMIN_PASSWORD is unset", () => {
    delete process.env.ADMIN_PASSWORD;
    expect(checkPassword("anything")).toBe(false);
  });

  test("a created session validates as valid", () => {
    const token = createSession();
    expect(isValidSession(token)).toBe(true);
  });

  test("an unknown token is invalid", () => {
    expect(isValidSession("never-issued")).toBe(false);
  });

  test("destroySession invalidates the token", () => {
    const token = createSession();
    destroySession(token);
    expect(isValidSession(token)).toBe(false);
  });

  test("undefined token is invalid", () => {
    expect(isValidSession(undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npm test --workspace server -- src/admin/auth.test.ts`
Expected: FAIL — `Cannot find module './auth'`

- [ ] **Step 3: 최소 구현 작성**

`server/src/admin/auth.ts`:
```ts
import { randomBytes } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

const sessions = new Set<string>();

export function checkPassword(password: string): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  return typeof expected === "string" && expected.length > 0 && password === expected;
}

export function createSession(): string {
  const token = randomBytes(32).toString("hex");
  sessions.add(token);
  return token;
}

export function isValidSession(token: string | undefined): boolean {
  return typeof token === "string" && sessions.has(token);
}

export function destroySession(token: string | undefined): void {
  if (typeof token === "string") {
    sessions.delete(token);
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const cookies = (req as unknown as { cookies?: Record<string, string> }).cookies;
  if (!isValidSession(cookies?.admin_session)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
}

export function _resetForTest(): void {
  sessions.clear();
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test --workspace server -- src/admin/auth.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: 커밋**

```bash
git add server/src/admin/auth.ts server/src/admin/auth.test.ts
git commit -m "feat: add admin password check and in-memory session auth"
```

---

### Task 3: 공지 방송 (`announcements.ts`)

**Files:**
- Create: `server/src/admin/announcements.ts`
- Test: `server/src/admin/announcements.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces: `shouldResend(announcement: Announcement | null, now: number): boolean`,
  `subscribe(req: Request, res: Response): void`, `broadcast(message: string): void`,
  `_resetForTest(): void`, `_subscriberCountForTest(): number` — Task 5(라우트)가 `subscribe`/
  `broadcast`를 가져다 씀

- [ ] **Step 1: 실패하는 테스트 작성 (순수 로직만 — SSE 연결 자체는 Task 5에서 curl로 수동 검증)**

`server/src/admin/announcements.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import { shouldResend } from "./announcements";

describe("shouldResend", () => {
  test("returns false when there is no announcement yet", () => {
    expect(shouldResend(null, Date.now())).toBe(false);
  });

  test("returns true within the 5 minute window", () => {
    const now = 1_000_000;
    expect(shouldResend({ message: "hi", timestamp: now - 60_000 }, now)).toBe(true);
  });

  test("returns false once older than 5 minutes", () => {
    const now = 1_000_000;
    const fiveMinutes = 5 * 60 * 1000;
    expect(shouldResend({ message: "hi", timestamp: now - fiveMinutes - 1 }, now)).toBe(false);
  });

  test("returns true exactly at the 5 minute boundary", () => {
    const now = 1_000_000;
    const fiveMinutes = 5 * 60 * 1000;
    expect(shouldResend({ message: "hi", timestamp: now - fiveMinutes }, now)).toBe(true);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npm test --workspace server -- src/admin/announcements.test.ts`
Expected: FAIL — `Cannot find module './announcements'`

- [ ] **Step 3: 최소 구현 작성**

`server/src/admin/announcements.ts`:
```ts
import type { Request, Response } from "express";

export type Announcement = { message: string; timestamp: number };

const RESEND_WINDOW_MS = 5 * 60 * 1000;
const subscribers = new Set<Response>();
let lastAnnouncement: Announcement | null = null;

export function shouldResend(
  announcement: Announcement | null,
  now: number,
): announcement is Announcement {
  return announcement !== null && now - announcement.timestamp <= RESEND_WINDOW_MS;
}

function formatSseMessage(announcement: Announcement): string {
  return `data: ${JSON.stringify(announcement)}\n\n`;
}

export function subscribe(req: Request, res: Response): void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  if (shouldResend(lastAnnouncement, Date.now())) {
    res.write(formatSseMessage(lastAnnouncement));
  }

  subscribers.add(res);

  req.on("close", () => {
    subscribers.delete(res);
  });
}

export function broadcast(message: string): void {
  const announcement: Announcement = { message, timestamp: Date.now() };
  lastAnnouncement = announcement;
  const payload = formatSseMessage(announcement);
  for (const res of subscribers) {
    res.write(payload);
  }
}

export function _resetForTest(): void {
  subscribers.clear();
  lastAnnouncement = null;
}

export function _subscriberCountForTest(): number {
  return subscribers.size;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test --workspace server -- src/admin/announcements.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: 커밋**

```bash
git add server/src/admin/announcements.ts server/src/admin/announcements.test.ts
git commit -m "feat: add SSE announcement broadcast with 5-minute resend window"
```

---

### Task 4: `MatchRoom.ts`에 이벤트 로그·인원 명단 연동

**Files:**
- Modify: `server/src/rooms/MatchRoom.ts:102-127` (`onJoin`, `onLeave`)
- Test: `server/src/rooms/MatchRoom.test.ts` (기존 파일에 테스트 추가)

**Interfaces:**
- Consumes: `recordEvent`, `AdminEvent`(Task 1), `getEvents`(Task 1, 테스트 검증용)
- Produces: 방 메타데이터에 `players: { sessionId: string; nickname: string }[]` 필드 추가 —
  Task 5의 `/api/admin/rooms`가 이 필드를 읽어서 응답에 포함시킴

이 프로젝트는 룸 통합 테스트에서 `room.waitForNextPatch()`로 기다리지 않고 `onMessage` 처리 시간만큼
짧은 `setTimeout` 기반 flush를 쓰는 관례가 있음(`CLAUDE.md` Gotchas). 아래 테스트도 그 패턴을 따름.

- [ ] **Step 1: 실패하는 테스트 작성**

`server/src/rooms/MatchRoom.test.ts` 파일 상단 import에 아래 두 줄 추가:
```ts
import { _resetForTest as resetEventLog, getEvents } from "../admin/eventLog";
```

파일 하단(다른 `describe` 블록들과 같은 레벨)에 새 `describe` 블록 추가:
```ts
describe("admin event log integration", () => {
  test("onJoin records a join event and updates the room's player roster metadata", async () => {
    resetEventLog();
    const room = await colyseus.createRoom<MatchState>("match", { teamCount: 1 });
    const client = await colyseus.connectTo(room, { nickname: "철수" });
    await flush();

    const events = getEvents();
    const joinEvent = events.find((e) => e.sessionId === client.sessionId && e.type === "join");
    expect(joinEvent?.nickname).toBe("철수");
    expect(joinEvent?.roomId).toBe(room.roomId);

    const metadata = room.listing.metadata as { players?: { nickname: string }[] };
    expect(metadata.players?.map((p) => p.nickname)).toEqual(["철수"]);
  });

  test("onLeave records a leave event and removes the player from roster metadata", async () => {
    resetEventLog();
    const room = await colyseus.createRoom<MatchState>("match", { teamCount: 1 });
    const client = await colyseus.connectTo(room, { nickname: "영희" });
    await flush();

    await client.leave();
    await flush();

    const events = getEvents();
    const leaveEvent = events.find((e) => e.sessionId === client.sessionId && e.type === "leave");
    expect(leaveEvent?.nickname).toBe("영희");

    const metadata = room.listing.metadata as { players?: { nickname: string }[] };
    expect(metadata.players ?? []).toEqual([]);
  });
});
```

`colyseus.createRoom<MatchState>`, `colyseus.connectTo`, `flush()`는 이 테스트 파일(`MatchRoom.test.ts`)
상단(각각 5번째 줄 `beforeAll`의 `colyseus` 변수, 23번째 줄의 `flush()` 헬퍼)에 이미 정의되어 있는
것을 그대로 재사용한다 — 새로 정의하지 않는다.

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npm test --workspace server -- src/rooms/MatchRoom.test.ts`
Expected: FAIL — `joinEvent`가 `undefined`이거나 `metadata.players`가 없음 (아직 연동 안 함)

- [ ] **Step 3: 구현**

`server/src/rooms/MatchRoom.ts` 상단 import 블록에 추가:
```ts
import { recordEvent } from "../admin/eventLog";
```

`server/src/rooms/MatchRoom.ts:102-127`을 아래로 교체:
```ts
  async onJoin(client: Client, options: { nickname?: unknown } = {}) {
    if (this.state.players.has(client.sessionId)) return;

    if (this.state.phase !== "lobby") {
      throw new Error("Match already in progress");
    }

    const player = new PlayerState();
    player.sessionId = client.sessionId;
    player.nickname = sanitizeNickname(options.nickname);
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
    await this.setMetadata({ players: this.rosterForMetadata() });
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

  private rosterForMetadata(): { sessionId: string; nickname: string }[] {
    return [...this.state.players.values()].map((p) => ({
      sessionId: p.sessionId,
      nickname: p.nickname,
    }));
  }
```

(`setMetadata`는 필드 단위로 병합되므로 `hostNickname`을 매번 다시 넘길 필요 없음 —
`@colyseus/core`의 `Room.setMetadata` 구현 확인함.)

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test --workspace server -- src/rooms/MatchRoom.test.ts`
Expected: PASS, 그리고 전체 스위트도 깨지지 않았는지 `npm test --workspace server` 전체 실행해서 확인

- [ ] **Step 5: 커밋**

```bash
git add server/src/rooms/MatchRoom.ts server/src/rooms/MatchRoom.test.ts
git commit -m "feat: record join/leave events and live player roster in room metadata"
```

---

### Task 5: 관리자 REST/SSE 라우트 연결

**Files:**
- Modify: `server/src/createServer.ts`
- Modify: `server/package.json` (의존성 추가)

**Interfaces:**
- Consumes: `checkPassword`, `createSession`, `destroySession`, `requireAdmin`(Task 2),
  `getEvents`(Task 1), `subscribe`, `broadcast`(Task 3)
- Produces: `POST /api/admin/login`, `POST /api/admin/logout`, `GET /api/admin/rooms`,
  `GET /api/admin/events`, `POST /api/admin/announce`, `GET /api/announcements/stream` —
  Task 7(클라이언트 대시보드), Task 6(배너)이 이 엔드포인트들을 호출함

이 태스크는 코드 자체가 자동 테스트 대상이 아니라(라우팅 배선), curl로 수동 검증한다.

- [ ] **Step 1: 의존성 추가**

Run (레포 루트에서):
```bash
npm install cookie-parser --workspace server
npm install -D @types/cookie-parser --workspace server
```

- [ ] **Step 2: `createServer.ts` 수정**

`server/src/createServer.ts` 상단 import 블록:
```ts
import express from "express";
import { createServer as createHttpServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import cookieParser from "cookie-parser";
import { Server, matchMaker } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { MatchRoom } from "./rooms/MatchRoom";
import { checkPassword, createSession, destroySession, requireAdmin } from "./admin/auth";
import { getEvents } from "./admin/eventLog";
import { broadcast, subscribe } from "./admin/announcements";
```

`export function createGameServer(): Server {` 본문에서 `app.use(express.static(clientDistPath));`
바로 다음 줄에 추가:
```ts
  app.use(express.json());
  app.use(cookieParser());
```

기존 `app.get("/api/rooms", ...)` 라우트 블록 바로 다음, `const httpServer = ...` 줄 이전에 아래
라우트들을 추가:
```ts
  app.post("/api/admin/login", (req, res) => {
    const { password } = req.body as { password?: unknown };
    if (typeof password !== "string" || !checkPassword(password)) {
      res.status(401).json({ error: "invalid password" });
      return;
    }
    const token = createSession();
    res.cookie("admin_session", token, { httpOnly: true, sameSite: "lax" });
    res.json({ ok: true });
  });

  app.post("/api/admin/logout", requireAdmin, (req, res) => {
    const cookies = (req as unknown as { cookies?: Record<string, string> }).cookies;
    destroySession(cookies?.admin_session);
    res.clearCookie("admin_session");
    res.json({ ok: true });
  });

  app.get("/api/admin/rooms", requireAdmin, async (_req, res) => {
    const rooms = await matchMaker.query({ name: "match" });
    res.json(
      rooms.map((r) => {
        const metadata = r.metadata as
          | { hostNickname?: string; players?: { sessionId: string; nickname: string }[] }
          | undefined;
        return {
          roomId: r.roomId,
          clients: r.clients,
          maxClients: r.maxClients,
          locked: r.locked,
          hostNickname: metadata?.hostNickname ?? "?",
          players: metadata?.players ?? [],
        };
      }),
    );
  });

  app.get("/api/admin/events", requireAdmin, (_req, res) => {
    res.json(getEvents());
  });

  app.post("/api/admin/announce", requireAdmin, (req, res) => {
    const { message } = req.body as { message?: unknown };
    if (typeof message !== "string" || message.trim().length === 0) {
      res.status(400).json({ error: "message required" });
      return;
    }
    broadcast(message.trim());
    res.json({ ok: true });
  });

  app.get("/api/announcements/stream", (req, res) => {
    subscribe(req, res);
  });
```

- [ ] **Step 3: 타입체크**

Run: `npm run build --workspace server`
Expected: 에러 없이 통과 (`tsc --noEmit`)

- [ ] **Step 4: 서버 실행 후 curl로 수동 검증**

```bash
ADMIN_PASSWORD=test1234 npm run dev --workspace server
```

다른 터미널에서:
```bash
# 로그인 실패
curl -i -X POST http://localhost:2567/api/admin/login -H "Content-Type: application/json" -d '{"password":"wrong"}'
# Expected: HTTP/1.1 401

# 로그인 성공 + 쿠키 저장
curl -i -c /tmp/cookies.txt -X POST http://localhost:2567/api/admin/login -H "Content-Type: application/json" -d '{"password":"test1234"}'
# Expected: HTTP/1.1 200, {"ok":true}, Set-Cookie: admin_session=...

# 인증 없이 접근 시 401
curl -i http://localhost:2567/api/admin/rooms
# Expected: HTTP/1.1 401

# 쿠키로 인증된 접근
curl -i -b /tmp/cookies.txt http://localhost:2567/api/admin/rooms
# Expected: HTTP/1.1 200, []

curl -i -b /tmp/cookies.txt http://localhost:2567/api/admin/events
# Expected: HTTP/1.1 200, []

curl -i -b /tmp/cookies.txt -X POST http://localhost:2567/api/admin/announce -H "Content-Type: application/json" -d '{"message":"테스트 공지"}'
# Expected: HTTP/1.1 200, {"ok":true}
```

Windows PowerShell에서 위 curl들을 돌릴 경우 `curl`이 `Invoke-WebRequest`의 별칭이라 플래그가
다르게 동작할 수 있음 — Git Bash(현재 이 프로젝트에서 쓰는 셸)에서 실행할 것.

- [ ] **Step 5: 커밋**

```bash
git add server/src/createServer.ts server/package.json server/package-lock.json
git commit -m "feat: wire admin auth, rooms/events endpoints, and announcement SSE stream"
```

---

### Task 6: 공지 배너 (클라이언트)

**Files:**
- Create: `client/src/components/AnnouncementBanner.tsx`
- Create: `client/src/components/AnnouncementBanner.module.css`
- Modify: `client/src/App.tsx`

**Interfaces:**
- Consumes: `GET /api/announcements/stream` (Task 5, SSE)
- Produces: `<AnnouncementBanner />` 컴포넌트 — Task 6 자체가 마지막 소비자(App.tsx에 마운트)

이 컴포넌트는 자동 테스트 없이 브라우저로 직접 확인한다 (클라이언트 쪽 테스트 프레임워크가 이
프로젝트에 없는 기존 관례를 따름).

- [ ] **Step 1: 컴포넌트 작성**

`client/src/components/AnnouncementBanner.module.css`:
```css
.banner {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  padding: 0.6rem 1rem;
  background: #1f2937;
  color: #fff;
  font-size: 0.85rem;
  text-align: center;
}

.banner button {
  background: none;
  border: none;
  color: #fff;
  font-size: 1.1rem;
  line-height: 1;
  cursor: pointer;
  padding: 0 0.25rem;
}
```

`client/src/components/AnnouncementBanner.tsx`:
```tsx
import { useEffect, useState } from "react";
import styles from "./AnnouncementBanner.module.css";

type Announcement = { message: string; timestamp: number };

export function AnnouncementBanner() {
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const source = new EventSource("/api/announcements/stream");
    source.onmessage = (event) => {
      const data = JSON.parse(event.data) as Announcement;
      setAnnouncement(data);
      setDismissed(false);
    };
    return () => source.close();
  }, []);

  if (!announcement || dismissed) return null;

  return (
    <div className={styles.banner} role="status">
      <span>{announcement.message}</span>
      <button type="button" onClick={() => setDismissed(true)} aria-label="공지 닫기">
        ×
      </button>
    </div>
  );
}
```

- [ ] **Step 2: `App.tsx`에 마운트**

`client/src/App.tsx` 상단 import 블록에 추가:
```tsx
import { AnnouncementBanner } from "./components/AnnouncementBanner";
```

`client/src/App.tsx`의 `function App()` 본문(파일 끝부분)을 아래로 교체:
```tsx
function App() {
  const [mode, setMode] = useState<Mode>("select");

  return (
    <>
      <AnnouncementBanner />
      {mode === "online" && <OnlineFlow onExit={() => setMode("select")} />}
      {mode === "offline" && <OfflineFlow onExit={() => setMode("select")} />}
      {mode === "select" && (
        <ModeSelect onSelectOnline={() => setMode("online")} onSelectOffline={() => setMode("offline")} />
      )}
    </>
  );
}
```

- [ ] **Step 3: 타입체크 + 빌드**

Run: `npm run build --workspace client`
Expected: 에러 없이 통과

- [ ] **Step 4: 브라우저로 확인**

`ADMIN_PASSWORD=test1234 npm run dev`(레포 루트)로 서버+클라이언트 동시 실행 후,
`http://localhost:2567/api/admin/login`에 curl로 로그인해서 쿠키를 얻고(Task 5 Step 4 참고)
`curl -b /tmp/cookies.txt -X POST http://localhost:2567/api/admin/announce -H "Content-Type: application/json" -d '{"message":"배너 테스트"}'`로 공지를 보낸 뒤, 브라우저에서
`http://localhost:5173`을 열어 화면 상단에 배너가 뜨는지 확인. (5173은 Vite dev 서버라
`/api/announcements/stream` 요청이 2564 서버로 직접 안 감 — 이 확인은 `vite.config.ts`에 프록시가
없는 현재 구조상 실패할 수 있음. 실패하면 `http://localhost:2567`으로 접속해서 확인할 것 — 이
포트는 서버가 빌드된 클라이언트를 직접 서빙하므로 같은 오리진이라 확실히 동작함. 최종 확인은
`npm run build --workspace client` 후 `http://localhost:2567`에서.)

- [ ] **Step 5: 커밋**

```bash
git add client/src/components/AnnouncementBanner.tsx client/src/components/AnnouncementBanner.module.css client/src/App.tsx
git commit -m "feat: show admin announcements as a dismissible top banner via SSE"
```

---

### Task 7: 관리자 로그인/대시보드 (클라이언트)

**Files:**
- Create: `client/src/components/AdminLogin.tsx`
- Create: `client/src/components/AdminLogin.module.css`
- Create: `client/src/components/AdminDashboard.tsx`
- Create: `client/src/components/AdminDashboard.module.css`
- Create: `client/src/components/AdminPage.tsx`

**Interfaces:**
- Consumes: `POST /api/admin/login`, `GET /api/admin/rooms`, `GET /api/admin/events`,
  `POST /api/admin/announce` (Task 5)
- Produces: `<AdminPage />` — Task 8(main.tsx 라우팅)이 이걸 렌더링함

자동 테스트 없이 브라우저로 직접 확인 (기존 관례).

- [ ] **Step 1: 로그인 폼**

`client/src/components/AdminLogin.module.css`:
```css
.wrap {
  min-height: 100svh;
  display: grid;
  place-items: center;
  background: #111827;
}

.form {
  display: grid;
  gap: 0.75rem;
  width: 17.5rem;
  color: #fff;
}

.form input {
  padding: 0.5rem;
  border-radius: 0.4rem;
  border: none;
}

.form button {
  padding: 0.5rem;
  border-radius: 0.4rem;
  border: none;
  cursor: pointer;
  font-weight: 700;
}

.error {
  color: #f87171;
  font-size: 0.8rem;
  margin: 0;
}
```

`client/src/components/AdminLogin.tsx`:
```tsx
import { useState, type FormEvent } from "react";
import styles from "./AdminLogin.module.css";

export function AdminLogin({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        setError("비밀번호가 틀렸습니다");
        return;
      }
      onSuccess();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className={styles.wrap}>
      <form onSubmit={handleSubmit} className={styles.form}>
        <h1>관리자 로그인</h1>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="비밀번호"
          autoFocus
        />
        {error && <p className={styles.error}>{error}</p>}
        <button type="submit" disabled={submitting}>
          로그인
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 2: 대시보드**

`client/src/components/AdminDashboard.module.css`:
```css
.wrap {
  padding: 1.5rem;
  display: grid;
  gap: 1.5rem;
  color: #111827;
  background: #f9fafb;
  min-height: 100svh;
  box-sizing: border-box;
}

.announceForm {
  display: flex;
  gap: 0.5rem;
}

.announceForm input {
  flex: 1;
  padding: 0.5rem;
}

.roomList {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.5rem;
}

.roomList li {
  padding: 0.5rem;
  border: 1px solid #e5e7eb;
  border-radius: 0.4rem;
}

.playerNames {
  font-size: 0.8rem;
  color: #6b7280;
}

.eventTable {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8rem;
}

.eventTable th,
.eventTable td {
  text-align: left;
  padding: 0.25rem 0.5rem;
  border-bottom: 1px solid #e5e7eb;
}
```

`client/src/components/AdminDashboard.tsx`:
```tsx
import { useEffect, useState, type FormEvent } from "react";
import styles from "./AdminDashboard.module.css";

type RoomInfo = {
  roomId: string;
  clients: number;
  maxClients: number;
  locked: boolean;
  hostNickname: string;
  players: { sessionId: string; nickname: string }[];
};

type AdminEvent = {
  type: "join" | "leave";
  timestamp: number;
  nickname: string;
  roomId: string;
  ip: string;
  sessionId: string;
};

const POLL_INTERVAL_MS = 4000;

async function fetchAdminJson<T>(
  url: string,
): Promise<{ ok: true; data: T } | { ok: false; unauthorized: boolean }> {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) {
    return { ok: false, unauthorized: res.status === 401 };
  }
  return { ok: true, data: (await res.json()) as T };
}

export function AdminDashboard({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      const [roomsResult, eventsResult] = await Promise.all([
        fetchAdminJson<RoomInfo[]>("/api/admin/rooms"),
        fetchAdminJson<AdminEvent[]>("/api/admin/events"),
      ]);
      if (cancelled) return;

      if (!roomsResult.ok || !eventsResult.ok) {
        if (!roomsResult.ok && roomsResult.unauthorized) onUnauthorized();
        if (!eventsResult.ok && eventsResult.unauthorized) onUnauthorized();
        return;
      }

      setRooms(roomsResult.data);
      setEvents(eventsResult.data);
    }

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [onUnauthorized]);

  async function handleAnnounce(e: FormEvent) {
    e.preventDefault();
    if (!message.trim()) return;
    setSending(true);
    try {
      await fetch("/api/admin/announce", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ message }),
      });
      setMessage("");
    } finally {
      setSending(false);
    }
  }

  return (
    <main className={styles.wrap}>
      <h1>관리자 대시보드</h1>

      <form onSubmit={handleAnnounce} className={styles.announceForm}>
        <input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="전체 공지 문구"
        />
        <button type="submit" disabled={sending || !message.trim()}>
          공지 보내기
        </button>
      </form>

      <section>
        <h2>활성 방 ({rooms.length})</h2>
        <ul className={styles.roomList}>
          {rooms.map((room) => (
            <li key={room.roomId}>
              <strong>{room.hostNickname}</strong> — {room.clients}/{room.maxClients}
              {room.locked ? " (진행 중)" : " (대기 중)"}
              <div className={styles.playerNames}>
                {room.players.map((p) => p.nickname).join(", ") || "(없음)"}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>최근 입장/퇴장</h2>
        <table className={styles.eventTable}>
          <thead>
            <tr>
              <th>시각</th>
              <th>종류</th>
              <th>닉네임</th>
              <th>방</th>
              <th>IP</th>
            </tr>
          </thead>
          <tbody>
            {[...events].reverse().map((event) => (
              <tr key={`${event.sessionId}-${event.timestamp}-${event.type}`}>
                <td>{new Date(event.timestamp).toLocaleTimeString()}</td>
                <td>{event.type === "join" ? "입장" : "퇴장"}</td>
                <td>{event.nickname}</td>
                <td>{event.roomId}</td>
                <td>{event.ip}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
```

- [ ] **Step 3: 컨테이너 컴포넌트**

`client/src/components/AdminPage.tsx`:
```tsx
import { useState } from "react";
import { AdminLogin } from "./AdminLogin";
import { AdminDashboard } from "./AdminDashboard";

export function AdminPage() {
  const [loggedIn, setLoggedIn] = useState(false);

  if (!loggedIn) {
    return <AdminLogin onSuccess={() => setLoggedIn(true)} />;
  }

  return <AdminDashboard onUnauthorized={() => setLoggedIn(false)} />;
}
```

- [ ] **Step 4: 타입체크 + 빌드**

Run: `npm run build --workspace client`
Expected: 에러 없이 통과

- [ ] **Step 5: 커밋**

```bash
git add client/src/components/AdminLogin.tsx client/src/components/AdminLogin.module.css client/src/components/AdminDashboard.tsx client/src/components/AdminDashboard.module.css client/src/components/AdminPage.tsx
git commit -m "feat: add admin login form and monitoring dashboard UI"
```

---

### Task 8: `/admin` 경로 라우팅 + 전체 흐름 검증

**Files:**
- Modify: `client/src/main.tsx`

**Interfaces:**
- Consumes: `<AdminPage />`(Task 7), `<App />`(기존)
- Produces: 없음 (최종 진입점)

- [ ] **Step 1: `main.tsx` 수정**

`client/src/main.tsx` 전체를 아래로 교체:
```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AdminPage } from './components/AdminPage'

const root = createRoot(document.getElementById('root')!)

if (window.location.pathname === '/admin') {
  root.render(
    <StrictMode>
      <AdminPage />
    </StrictMode>,
  )
} else {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
```

- [ ] **Step 2: 타입체크 + 빌드**

Run: `npm run build --workspace client`
Expected: 에러 없이 통과

- [ ] **Step 3: 서버까지 포함한 전체 빌드 + 실행**

Run (레포 루트):
```bash
npm run build --workspace client
ADMIN_PASSWORD=test1234 npm run dev --workspace server
```

- [ ] **Step 4: 브라우저로 전체 흐름 확인**

`http://localhost:2567/admin` 접속:
1. 로그인 폼이 뜨는지 확인
2. 틀린 비밀번호 입력 → "비밀번호가 틀렸습니다" 에러 메시지 확인
3. `test1234` 입력 → 대시보드로 전환되는지 확인
4. 다른 브라우저 탭에서 `http://localhost:2567`로 접속해서 닉네임 입력 후 방 생성
5. 관리자 탭으로 돌아와서 몇 초 안에 방 목록에 그 방과 닉네임이 뜨는지 확인
6. 관리자 탭에서 공지 문구 입력 후 "공지 보내기" → 플레이어 탭 화면 상단에 배너가 뜨는지 확인
7. 배너의 × 버튼으로 닫히는지 확인
8. 플레이어 탭에서 나가기 → 관리자 탭의 "최근 입장/퇴장" 표에 퇴장 로그가 뜨는지 확인
9. `http://localhost:2567/`(경로 끝에 `/admin` 없이)로 접속하면 평소 게임 화면이 정상적으로 뜨는지
   확인 (기존 흐름이 안 깨졌는지 회귀 확인)

- [ ] **Step 5: 서버 전체 테스트 스위트 + 클라이언트 lint 최종 확인**

Run:
```bash
npm test --workspace server
npm run lint --workspace client
```
Expected: 둘 다 에러 없이 통과

- [ ] **Step 6: 커밋**

```bash
git add client/src/main.tsx
git commit -m "feat: route /admin to the admin page, separate from the main game entry"
```

---

## 배포 관련 참고 (이번 플랜 범위 밖)

이 플랜은 로컬 구현·검증까지만 다룬다. 실제 EC2 배포 시 `docker run` 명령에
`-e ADMIN_PASSWORD=<실제_비밀번호>`를 추가해야 관리자 로그인이 동작한다 (이 프로젝트는 `dotenv`를
쓰지 않으므로 `.env` 파일이 아니라 컨테이너 실행 시점의 환경변수로 직접 주입해야 함). 배포는 별도
단계로 진행한다.
