# 친구 초대하기 / 따라가기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 방 대기 화면에서 온라인 + 로비에 있는 친구를 현재 방으로 초대하고, 로비의 친구 목록에서 방에 있는 친구를 "따라가기"로 바로 입장할 수 있게 한다.

**Architecture:** 친구의 현재 방(`roomId`)은 기존 온라인 상태 판단에 쓰던 `matchMaker.query({ name: "match" })` 조회를 확장해서 얻는다(새 추적 로직 없음). "따라가기"의 방 상태별 분기(참가자로 넣을지/관전자로 넣을지/거부할지)는 새로 안 만들고 기존 `client.joinById(roomId)` → `MatchRoom.onJoin()` 경로를 그대로 재사용한다. 초대는 서버 메모리 맵(`presence.ts`와 같은 패턴, TTL 60초)에 담아두고, 로비 화면이 이미 2초마다 돌리는 `/api/rooms` 폴링에 `GET /api/invites/pending` 조회를 얹어서 전달한다 — 새 웹소켓/푸시 없음.

**Tech Stack:** better-sqlite3(raw SQL), Express, React 19, Colyseus(`matchMaker.query`, `client.joinById`), vitest.

## Global Constraints

- 따라가기의 방 상태별 분기는 새로 만들지 않는다 — `client.joinById(roomId)`가 `MatchRoom.onJoin`을 그대로 타면서 로비 단계면 참가자로, 게임 중+관전허용이면 관전자로, 게임 중+관전비허용이면 에러를 낸다.
- 초대 대상은 "온라인 + roomId 없음(로비)"인 친구만 — 이미 다른 방에 있는 친구는 제외.
- 새 웹소켓 채널/SSE 없음 — 초대 전달은 로비의 기존 2초 폴링에만 얹는다.
- 초대함은 유저당 슬롯 1개(큐 없음, 마지막 초대가 이전 걸 덮어씀).
- 초대 TTL 60초 — 응답 없으면 자동 소멸, 수락/명시적 닫기 시 즉시 소멸.
- 초대 대상은 반드시 accepted 상태의 친구여야 함(서버 검증).
- 초대 배너는 "OO님이 초대했어요"만 표시 — 방 제목 등 부가 정보 없음.
- 차단/초대 거부 알림 등은 범위 밖.
- 이 프로젝트는 Express 라우트에 대한 HTTP 레벨 자동 테스트 관행이 없다 — 모든 서버 테스트는 라우트 아래 순수 함수를 직접 호출해서 검증한다. 클라이언트는 테스트 프레임워크가 전혀 없다 — 브라우저 직접 검증만 한다.

---

### Task 1: `server/src/friends/invites.ts` (초대함)

**Files:**
- Create: `server/src/friends/invites.ts`
- Create: `server/src/friends/invites.test.ts`

**Interfaces:**
- Produces: `areFriends(userIdA: number, userIdB: number): boolean`, `sendInvite(fromNickname: string, toUserId: number, roomId: string): void`, `getPendingInvite(userId: number): { fromNickname: string; roomId: string; expiresAt: number } | null`, `dismissInvite(userId: number): void`, `_resetForTest(): void` — Task 2가 그대로 가져다 씀.

- [ ] **Step 1: 실패하는 테스트 작성**

`server/src/friends/invites.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { db } from "../db/connection";
import { _resetForTest, areFriends, dismissInvite, getPendingInvite, sendInvite } from "./invites";

function makeUser(googleSub: string, nickname: string): number {
  const result = db.prepare(`INSERT INTO users (google_sub, nickname) VALUES (?, ?)`).run(googleSub, nickname);
  return result.lastInsertRowid as number;
}

function makeFriendship(requesterId: number, addresseeId: number, status: "pending" | "accepted"): void {
  db.prepare(`INSERT INTO friendships (requester_id, addressee_id, status) VALUES (?, ?, ?)`).run(
    requesterId,
    addresseeId,
    status,
  );
}

describe("areFriends", () => {
  beforeEach(() => {
    db.exec("DELETE FROM friendships");
    db.exec("DELETE FROM users");
  });

  test("returns true when an accepted friendship row exists (requester direction)", () => {
    const a = makeUser("sub-a", "A");
    const b = makeUser("sub-b", "B");
    makeFriendship(a, b, "accepted");
    expect(areFriends(a, b)).toBe(true);
  });

  test("returns true regardless of which side is requester vs addressee", () => {
    const a = makeUser("sub-a", "A");
    const b = makeUser("sub-b", "B");
    makeFriendship(b, a, "accepted");
    expect(areFriends(a, b)).toBe(true);
  });

  test("returns false when the friendship is still pending", () => {
    const a = makeUser("sub-a", "A");
    const b = makeUser("sub-b", "B");
    makeFriendship(a, b, "pending");
    expect(areFriends(a, b)).toBe(false);
  });

  test("returns false when there's no friendship row at all", () => {
    const a = makeUser("sub-a", "A");
    const b = makeUser("sub-b", "B");
    expect(areFriends(a, b)).toBe(false);
  });
});

describe("sendInvite / getPendingInvite / dismissInvite", () => {
  beforeEach(() => {
    _resetForTest();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("a sent invite is retrievable via getPendingInvite", () => {
    sendInvite("초대한사람", 1, "room-abc");
    expect(getPendingInvite(1)).toEqual({
      fromNickname: "초대한사람",
      roomId: "room-abc",
      expiresAt: expect.any(Number),
    });
  });

  test("a second invite to the same user overwrites the first (single slot, no queue)", () => {
    sendInvite("첫번째", 1, "room-1");
    sendInvite("두번째", 1, "room-2");
    expect(getPendingInvite(1)).toEqual({
      fromNickname: "두번째",
      roomId: "room-2",
      expiresAt: expect.any(Number),
    });
  });

  test("getPendingInvite returns null when there's no invite for that user", () => {
    expect(getPendingInvite(1)).toBeNull();
  });

  test("dismissInvite clears the pending invite", () => {
    sendInvite("초대한사람", 1, "room-xyz");
    dismissInvite(1);
    expect(getPendingInvite(1)).toBeNull();
  });

  test("an expired invite (past its 60s TTL) is treated as gone", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    sendInvite("초대한사람", 1, "room-old");

    vi.setSystemTime(60_001);
    expect(getPendingInvite(1)).toBeNull();
  });

  test("keeps an invite right up to the TTL boundary", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    sendInvite("초대한사람", 1, "room-old");

    vi.setSystemTime(60_000);
    expect(getPendingInvite(1)).not.toBeNull();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run invites.test.ts` (`server/` 디렉토리에서)
Expected: FAIL — `Cannot find module './invites'`

- [ ] **Step 3: 구현**

`server/src/friends/invites.ts`:

```ts
import { db } from "../db/connection";

type PendingInvite = { fromNickname: string; roomId: string; expiresAt: number };

const INVITE_TTL_MS = 60_000;

const invites = new Map<number, PendingInvite>();

// requesterId/addresseeId 방향 무관, status='accepted' row가 있는지만 확인한다.
// friendships.ts는 이 목적의 함수를 export하지 않으므로 여기서 별도로 조회한다.
export function areFriends(userIdA: number, userIdB: number): boolean {
  const row = db
    .prepare(
      `SELECT 1 FROM friendships
       WHERE status = 'accepted'
         AND ((requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?))`,
    )
    .get(userIdA, userIdB, userIdB, userIdA);
  return !!row;
}

export function sendInvite(fromNickname: string, toUserId: number, roomId: string): void {
  invites.set(toUserId, { fromNickname, roomId, expiresAt: Date.now() + INVITE_TTL_MS });
}

export function getPendingInvite(userId: number): PendingInvite | null {
  const invite = invites.get(userId);
  if (!invite) return null;
  if (invite.expiresAt < Date.now()) {
    invites.delete(userId);
    return null;
  }
  return invite;
}

export function dismissInvite(userId: number): void {
  invites.delete(userId);
}

export function _resetForTest(): void {
  invites.clear();
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run invites.test.ts` (`server/` 디렉토리에서)
Expected: PASS (10 tests)

- [ ] **Step 5: 커밋**

```bash
git add server/src/friends/invites.ts server/src/friends/invites.test.ts
git commit -m "$(cat <<'EOF'
친구 초대함(invites) 모듈 추가

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `/api/invites/*` 라우트 + `GET /api/friends`에 roomId 추가

**Files:**
- Modify: `server/src/createServer.ts`

**Interfaces:**
- Consumes: Task 1의 `areFriends`, `sendInvite`, `getPendingInvite`, `dismissInvite`.
- Produces: `GET /api/friends` 응답에 `roomId: string | null` 필드 추가, `POST /api/invites/send`, `GET /api/invites/pending`, `POST /api/invites/dismiss` — Task 3이 그대로 소비.

- [ ] **Step 1: import 추가**

기존 `server/src/createServer.ts`의 `from "./friends/friendships"` import 블록 바로 뒤에 추가:

```ts
import { areFriends, dismissInvite, getPendingInvite, sendInvite } from "./friends/invites";
```

- [ ] **Step 2: `GET /api/friends` 핸들러 수정**

기존(파일 안에서 `app.get("/api/friends", async (req, res) => {` 로 찾을 수 있음):

```ts
  app.get("/api/friends", async (req, res) => {
    const cookies = (req as unknown as { cookies?: Record<string, string> }).cookies;
    const userId = verifySession(cookies?.[SESSION_COOKIE_NAME]);
    if (!userId) {
      res.status(401).json({ error: "로그인이 필요합니다." });
      return;
    }
    const rooms = await matchMaker.query({ name: "match" });
    const inRoomNicknames = new Set(
      rooms.flatMap((r) => {
        const metadata = r.metadata as
          | { players?: { nickname: string }[]; spectators?: { nickname: string }[] }
          | undefined;
        return [
          ...(metadata?.players?.map((p) => p.nickname) ?? []),
          ...(metadata?.spectators?.map((s) => s.nickname) ?? []),
        ];
      }),
    );
    const friends = listFriends(userId).map((f) => ({
      ...f,
      online: isUserOnline(f.userId) || inRoomNicknames.has(f.nickname),
    }));
    res.json(friends);
  });
```

변경(`Set` 대신 닉네임→roomId `Map`으로 바꿔서 `roomId` 필드를 같이 내려줌):

```ts
  app.get("/api/friends", async (req, res) => {
    const cookies = (req as unknown as { cookies?: Record<string, string> }).cookies;
    const userId = verifySession(cookies?.[SESSION_COOKIE_NAME]);
    if (!userId) {
      res.status(401).json({ error: "로그인이 필요합니다." });
      return;
    }
    const rooms = await matchMaker.query({ name: "match" });
    const roomByNickname = new Map<string, string>();
    for (const r of rooms) {
      const metadata = r.metadata as
        | { players?: { nickname: string }[]; spectators?: { nickname: string }[] }
        | undefined;
      for (const p of metadata?.players ?? []) roomByNickname.set(p.nickname, r.roomId);
      for (const s of metadata?.spectators ?? []) roomByNickname.set(s.nickname, r.roomId);
    }
    const friends = listFriends(userId).map((f) => ({
      ...f,
      online: isUserOnline(f.userId) || roomByNickname.has(f.nickname),
      roomId: roomByNickname.get(f.nickname) ?? null,
    }));
    res.json(friends);
  });
```

- [ ] **Step 3: `/api/invites/*` 라우트 3개 추가**

`app.get("/api/friends/sent", ...)` 핸들러(파일 끝쪽, `const httpServer = createHttpServer(app);` 바로 앞) 뒤에 추가:

```ts
  app.post("/api/invites/send", (req, res) => {
    const cookies = (req as unknown as { cookies?: Record<string, string> }).cookies;
    const userId = verifySession(cookies?.[SESSION_COOKIE_NAME]);
    if (!userId) {
      res.status(401).json({ error: "로그인이 필요합니다." });
      return;
    }
    const { toUserId, roomId } = req.body ?? {};
    if (!Number.isInteger(toUserId) || typeof roomId !== "string" || !roomId) {
      res.status(400).json({ error: "잘못된 요청이에요." });
      return;
    }
    if (!areFriends(userId, toUserId)) {
      res.status(403).json({ error: "친구가 아니에요." });
      return;
    }
    const user = getUserById(userId);
    sendInvite(user?.nickname ?? "누군가", toUserId, roomId);
    res.json({ ok: true });
  });

  app.get("/api/invites/pending", (req, res) => {
    const cookies = (req as unknown as { cookies?: Record<string, string> }).cookies;
    const userId = verifySession(cookies?.[SESSION_COOKIE_NAME]);
    if (!userId) {
      res.status(401).json({ error: "로그인이 필요합니다." });
      return;
    }
    res.json(getPendingInvite(userId));
  });

  app.post("/api/invites/dismiss", (req, res) => {
    const cookies = (req as unknown as { cookies?: Record<string, string> }).cookies;
    const userId = verifySession(cookies?.[SESSION_COOKIE_NAME]);
    if (!userId) {
      res.status(401).json({ error: "로그인이 필요합니다." });
      return;
    }
    dismissInvite(userId);
    res.json({ ok: true });
  });
```

- [ ] **Step 4: 서버 테스트 스위트가 여전히 통과하는지 확인**

Run: `npm test --workspace server` (레포 루트에서)
Expected: 기존 전체 테스트 그대로 통과(이 Task는 새 테스트 파일을 추가하지 않음 — 프로젝트 관행대로 Express 라우트 자체는 자동 테스트 없음). 참고: `MatchRoom.test.ts`의 "timeAdd extends the actual turn deadline" 테스트는 실제 wall-clock 타이밍에 의존해서 전체 스위트를 돌릴 때 가끔(몇 ms 차이로) 실패하는 게 기존부터 있던 현상이다 — 그 테스트 하나만 실패하면 재실행해서 통과하는지 확인하고, 이 Task와 무관한 pre-existing flake로 취급한다(고치려 하지 말 것).

- [ ] **Step 5: 타입체크**

Run: `npx tsc --noEmit -p tsconfig.json` (`server/` 디렉토리에서)
Expected: 에러 없음.

- [ ] **Step 6: 커밋**

```bash
git add server/src/createServer.ts
git commit -m "$(cat <<'EOF'
GET /api/friends에 roomId 추가, /api/invites/* 라우트 추가

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: 클라이언트 API 함수

**Files:**
- Modify: `client/src/game/friends.ts`
- Create: `client/src/game/invites.ts`

**Interfaces:**
- Consumes: Task 2의 응답 형태(`GET /api/friends`의 `roomId` 필드, `/api/invites/*` 라우트).
- Produces: `FriendEntry.roomId: string | null`, `PendingInvite` 타입, `sendInvite(toUserId, roomId)`, `getPendingInvite()`, `dismissInvite()` — Task 4/5가 그대로 소비.

- [ ] **Step 1: `client/src/game/friends.ts`의 `FriendEntry` 타입에 필드 추가**

기존:

```ts
export type FriendEntry = {
  friendshipId: number;
  userId: number;
  nickname: string;
  online: boolean;
  lastLoginAt: string | null;
};
```

변경:

```ts
export type FriendEntry = {
  friendshipId: number;
  userId: number;
  nickname: string;
  online: boolean;
  roomId: string | null;
  lastLoginAt: string | null;
};
```

- [ ] **Step 2: `client/src/game/invites.ts` 작성**

```ts
export type PendingInvite = { fromNickname: string; roomId: string; expiresAt: number } | null;

async function invitesFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: "same-origin", ...init });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error ?? "요청에 실패했어요.");
  return body as T;
}

export function sendInvite(toUserId: number, roomId: string): Promise<{ ok: true }> {
  return invitesFetch("/api/invites/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ toUserId, roomId }),
  });
}

export function getPendingInvite(): Promise<PendingInvite> {
  return invitesFetch("/api/invites/pending");
}

export function dismissInvite(): Promise<{ ok: true }> {
  return invitesFetch("/api/invites/dismiss", { method: "POST" });
}
```

- [ ] **Step 3: 타입체크**

Run: `npm run build --workspace client` (레포 루트에서)
Expected: 에러 없음(이 시점엔 `roomId`를 쓰는 곳이 아직 없어서 새 필드 자체는 아무것도 깨뜨리지 않음).

- [ ] **Step 4: 커밋**

```bash
git add client/src/game/friends.ts client/src/game/invites.ts
git commit -m "$(cat <<'EOF'
친구 roomId 필드 및 초대 API 클라이언트 함수 추가

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: 초대하기 (`InviteFriendsModal` + `RoleSelect.tsx` 배선)

**Files:**
- Create: `client/src/components/InviteFriendsModal.tsx`
- Create: `client/src/components/InviteFriendsModal.module.css`
- Modify: `client/src/components/RoleSelect.tsx`
- Modify: `client/src/components/RoleSelect.module.css`

**Interfaces:**
- Consumes: Task 3의 `getFriends`(기존, `roomId` 필드 포함), `sendInvite`.
- Produces: 없음 — 이 Task는 UI 종단.

- [ ] **Step 1: `InviteFriendsModal.tsx` 작성**

```tsx
import { useEffect, useState } from "react";
import { getFriends, type FriendEntry } from "../game/friends";
import { sendInvite } from "../game/invites";
import styles from "./InviteFriendsModal.module.css";

export function InviteFriendsModal({ roomId, onClose }: { roomId: string; onClose: () => void }) {
  const [friends, setFriends] = useState<FriendEntry[] | null>(null);
  const [sentTo, setSentTo] = useState<Set<number>>(new Set());
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    getFriends()
      .then(setFriends)
      .catch(() => setFriends([]));
  }, []);

  const invitable = (friends ?? []).filter((f) => f.online && f.roomId === null);

  async function handleInvite(friend: FriendEntry) {
    setMessage(null);
    try {
      await sendInvite(friend.userId, roomId);
      setSentTo((prev) => new Set(prev).add(friend.userId));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "초대에 실패했어요.");
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h2 className={styles.heading}>친구 초대하기</h2>
        {message && <p className={styles.message}>{message}</p>}
        {friends === null && <p className={styles.loading}>불러오는 중...</p>}
        {friends !== null && invitable.length === 0 && <p className={styles.empty}>초대할 수 있는 친구가 없어요</p>}
        {invitable.map((f) => (
          <div key={f.friendshipId} className={styles.row}>
            <span className={styles.rowNickname}>{f.nickname}</span>
            <button className={styles.inviteButton} onClick={() => handleInvite(f)} disabled={sentTo.has(f.userId)}>
              {sentTo.has(f.userId) ? "보냄" : "초대"}
            </button>
          </div>
        ))}
        <button className={styles.closeButton} onClick={onClose}>
          닫기
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: `InviteFriendsModal.module.css` 작성**

```css
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  box-sizing: border-box;
  z-index: 10;
}

.modal {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  width: 100%;
  max-width: 22rem;
  max-height: 80svh;
  padding: 1.5rem;
  border-radius: 0.8rem;
  background: #1f2937;
  color: #fff;
  box-sizing: border-box;
  overflow-y: auto;
}

.heading {
  margin: 0;
  font-size: 1.3rem;
  font-weight: 800;
  text-align: center;
}

.message {
  margin: 0;
  font-size: 0.85rem;
  text-align: center;
  opacity: 0.9;
}

.loading,
.empty {
  text-align: center;
  opacity: 0.8;
  font-size: 0.85rem;
  margin: 0;
}

.row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  border-radius: 0.5rem;
  background: rgba(255, 255, 255, 0.08);
}

.rowNickname {
  flex: 1;
  font-weight: 600;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.inviteButton {
  padding: 0.35rem 0.8rem;
  font-size: 0.8rem;
  border-radius: 0.4rem;
  border: none;
  cursor: pointer;
  color: #fff;
  font-weight: 700;
  white-space: nowrap;
  background: linear-gradient(135deg, #3b82f6, #2563eb);
}

.inviteButton:disabled {
  cursor: not-allowed;
  opacity: 0.6;
  background: #4b5563;
}

.closeButton {
  padding: 0.6rem 1rem;
  font-size: 0.95rem;
  border-radius: 0.6rem;
  border: none;
  cursor: pointer;
  color: #fff;
  font-weight: 700;
  background: #363861;
}
```

- [ ] **Step 3: `RoleSelect.tsx` 배선**

기존 import 블록:

```tsx
import { useCallback } from "react";
import type { Room } from "colyseus.js";
import type { MatchState } from "../game/matchTypes";
import type { Role } from "../game/colors";
import { ChatBox } from "./ChatBox";
import styles from "./RoleSelect.module.css";
```

변경:

```tsx
import { useCallback, useState } from "react";
import type { Room } from "colyseus.js";
import type { MatchState } from "../game/matchTypes";
import type { Role } from "../game/colors";
import { ChatBox } from "./ChatBox";
import { InviteFriendsModal } from "./InviteFriendsModal";
import styles from "./RoleSelect.module.css";
```

기존 함수 시작부:

```tsx
export function RoleSelect({ room, onExit }: { room: Room<MatchState>; onExit: () => void }) {
  const me = room.state.players.get(room.sessionId);
  const myRole = me?.role;
  const teams = room.state.teams;
  const lobbyChat = room.state.lobbyChat;
  const unassignedPlayers = Array.from(room.state.players.values()).filter((p) => p.role === "");
```

변경(state 한 줄 추가):

```tsx
export function RoleSelect({ room, onExit }: { room: Room<MatchState>; onExit: () => void }) {
  const me = room.state.players.get(room.sessionId);
  const myRole = me?.role;
  const teams = room.state.teams;
  const lobbyChat = room.state.lobbyChat;
  const unassignedPlayers = Array.from(room.state.players.values()).filter((p) => p.role === "");
  const [showInviteModal, setShowInviteModal] = useState(false);
```

기존 파일 끝부분:

```tsx
      <button className={styles.leaveButton} onClick={onExit}>
        나가기
      </button>
    </div>
  );
}
```

변경:

```tsx
      <div className={styles.exitRow}>
        <button className={styles.inviteButton} onClick={() => setShowInviteModal(true)}>
          초대하기
        </button>
        <button className={styles.leaveButton} onClick={onExit}>
          나가기
        </button>
      </div>
      {showInviteModal && <InviteFriendsModal roomId={room.roomId} onClose={() => setShowInviteModal(false)} />}
    </div>
  );
}
```

- [ ] **Step 4: `RoleSelect.module.css`에 스타일 추가**

기존 `.leaveButton` 규칙 바로 앞에 추가:

```css
.exitRow {
  display: flex;
  gap: 0.75rem;
}

.inviteButton {
  padding: 0.6rem 1.5rem;
  font-size: 0.95rem;
  border-radius: 0.6rem;
  border: none;
  cursor: pointer;
  color: #fff;
  font-weight: 700;
  background: linear-gradient(135deg, #6a5acd, #4b6cb7);
}
```

- [ ] **Step 5: 타입체크 + 빌드**

Run: `npm run build --workspace client`
Expected: 에러 없음.

- [ ] **Step 6: 커밋**

```bash
git add client/src/components/InviteFriendsModal.tsx client/src/components/InviteFriendsModal.module.css client/src/components/RoleSelect.tsx client/src/components/RoleSelect.module.css
git commit -m "$(cat <<'EOF'
방 대기 화면에 친구 초대하기 버튼/모달 추가

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: 초대 받기(`RoomList.tsx` 배너/폴링) + 따라가기(`FriendsModal.tsx`) + 전체 브라우저 검증

**왜 한 Task로 묶었나:** `RoomList.tsx`가 `FriendsModal`에 `onJoinRoom` prop을 새로 넘기는 변경과, `FriendsModal.tsx`가 그 prop을 받도록 시그니처를 바꾸는 변경은 서로의 짝이 맞아야만 타입체크가 통과하는 하나의 인터페이스 변경이다 — 둘을 별개 Task/커밋으로 쪼개면 그 사이에 반드시 빌드가 깨지는 커밋이 생긴다. 두 파일을 한 Task 안에서 같이 바꾼다.

**Files:**
- Modify: `client/src/components/RoomList.tsx`
- Modify: `client/src/components/RoomList.module.css`
- Modify: `client/src/components/FriendsModal.tsx`
- Modify: `client/src/components/FriendsModal.module.css`

**Interfaces:**
- Consumes: Task 3의 `getPendingInvite`, `dismissInvite`, `PendingInvite` 타입, `FriendEntry.roomId`.
- Produces: 없음 — 이 플랜의 마지막 Task.

- [ ] **Step 1: import 추가**

기존:

```tsx
import { useEffect, useState } from "react";
import { listRooms, type RoomListEntry } from "../colyseus";
import { getReceivedRequests } from "../game/friends";
import { CreateRoomModal } from "./CreateRoomModal";
import { RankingModal } from "./RankingModal";
import { InquiryModal } from "./InquiryModal";
import { FriendsModal } from "./FriendsModal";
import styles from "./RoomList.module.css";
```

변경:

```tsx
import { useEffect, useState } from "react";
import { listRooms, type RoomListEntry } from "../colyseus";
import { getReceivedRequests } from "../game/friends";
import { dismissInvite, getPendingInvite, type PendingInvite } from "../game/invites";
import { CreateRoomModal } from "./CreateRoomModal";
import { RankingModal } from "./RankingModal";
import { InquiryModal } from "./InquiryModal";
import { FriendsModal } from "./FriendsModal";
import styles from "./RoomList.module.css";
```

- [ ] **Step 2: state 추가**

기존:

```tsx
  const [rooms, setRooms] = useState<RoomListEntry[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showRankingModal, setShowRankingModal] = useState(false);
  const [showInquiryModal, setShowInquiryModal] = useState(false);
  const [showFriendsModal, setShowFriendsModal] = useState(false);
  const [pendingRequestCount, setPendingRequestCount] = useState(0);
```

변경:

```tsx
  const [rooms, setRooms] = useState<RoomListEntry[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showRankingModal, setShowRankingModal] = useState(false);
  const [showInquiryModal, setShowInquiryModal] = useState(false);
  const [showFriendsModal, setShowFriendsModal] = useState(false);
  const [pendingRequestCount, setPendingRequestCount] = useState(0);
  const [pendingInvite, setPendingInvite] = useState<PendingInvite>(null);
```

- [ ] **Step 3: 기존 방 목록 폴링 `useEffect`에 초대 조회 얹기**

기존:

```tsx
  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      try {
        const list = await listRooms();
        if (!cancelled) setRooms(list);
      } catch (err) {
        console.error("failed to list rooms", err);
      }
    }

    refresh();
    const interval = setInterval(refresh, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);
```

변경:

```tsx
  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      try {
        const [list, invite] = await Promise.all([listRooms(), getPendingInvite()]);
        if (!cancelled) {
          setRooms(list);
          setPendingInvite(invite);
        }
      } catch (err) {
        console.error("failed to list rooms", err);
      }
    }

    refresh();
    const interval = setInterval(refresh, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);
```

- [ ] **Step 4: 초대 수락/닫기 핸들러 추가**

기존 `getReceivedRequests` 조회용 `useEffect` 바로 뒤에 추가:

```tsx
  async function handleAcceptInvite() {
    if (!pendingInvite) return;
    const roomId = pendingInvite.roomId;
    await dismissInvite();
    setPendingInvite(null);
    onJoinRoom(roomId);
  }

  async function handleDismissInvite() {
    await dismissInvite();
    setPendingInvite(null);
  }
```

- [ ] **Step 5: 배너 JSX 추가**

기존:

```tsx
  return (
    <div className={styles.wrap}>
      <h1 className={styles.title}>송편 만들기</h1>
      <div className={styles.topButtons}>
```

변경:

```tsx
  return (
    <div className={styles.wrap}>
      <h1 className={styles.title}>송편 만들기</h1>
      {pendingInvite && (
        <div className={styles.inviteBanner}>
          <span>{pendingInvite.fromNickname}님이 초대했어요!</span>
          <div className={styles.inviteBannerActions}>
            <button className={styles.inviteAcceptButton} onClick={handleAcceptInvite}>
              참가하기
            </button>
            <button className={styles.inviteDismissButton} onClick={handleDismissInvite}>
              닫기
            </button>
          </div>
        </div>
      )}
      <div className={styles.topButtons}>
```

- [ ] **Step 6: `FriendsModal`에 `onJoinRoom` 전달**

기존:

```tsx
      {showFriendsModal && (
        <FriendsModal
          onClose={() => {
            setShowFriendsModal(false);
            getReceivedRequests()
              .then((requests) => setPendingRequestCount(requests.length))
              .catch(() => {});
          }}
        />
      )}
```

변경:

```tsx
      {showFriendsModal && (
        <FriendsModal
          onJoinRoom={onJoinRoom}
          onClose={() => {
            setShowFriendsModal(false);
            getReceivedRequests()
              .then((requests) => setPendingRequestCount(requests.length))
              .catch(() => {});
          }}
        />
      )}
```

- [ ] **Step 7: `RoomList.module.css`에 배너 스타일 추가**

기존 `.topButtons` 규칙 바로 앞에 추가:

```css
.inviteBanner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  width: 100%;
  max-width: 20rem;
  padding: 0.75rem 1rem;
  border-radius: 0.6rem;
  background: rgba(106, 90, 205, 0.25);
  border: 1px solid rgba(106, 90, 205, 0.6);
  font-size: 0.9rem;
}

.inviteBannerActions {
  display: flex;
  gap: 0.4rem;
}

.inviteAcceptButton {
  padding: 0.35rem 0.8rem;
  font-size: 0.8rem;
  border-radius: 0.4rem;
  border: none;
  cursor: pointer;
  color: #fff;
  font-weight: 700;
  white-space: nowrap;
  background: linear-gradient(135deg, #3b82f6, #2563eb);
}

.inviteDismissButton {
  padding: 0.35rem 0.8rem;
  font-size: 0.8rem;
  border-radius: 0.4rem;
  border: none;
  cursor: pointer;
  color: #fff;
  font-weight: 700;
  white-space: nowrap;
  background: #495057;
}
```

- [ ] **Step 8: `FriendsModal.tsx`의 함수 시그니처 변경**

기존:

```tsx
export function FriendsModal({ onClose }: { onClose: () => void }) {
```

변경:

```tsx
export function FriendsModal({ onClose, onJoinRoom }: { onClose: () => void; onJoinRoom: (roomId: string) => void }) {
```

- [ ] **Step 9: 친구 목록 행에 "따라가기" 버튼 추가**

기존:

```tsx
        {view === "friends" && (
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>친구 목록</h3>
            {friends === null && <p className={styles.loading}>불러오는 중...</p>}
            {friends?.length === 0 && <p className={styles.empty}>아직 친구가 없어요</p>}
            {friends?.map((f) => (
              <div key={f.friendshipId} className={styles.row}>
                <span className={styles.rowNickname}>{f.nickname}</span>
                <span className={styles.status}>{f.online ? "🟢 온라인" : formatLastSeen(f.lastLoginAt)}</span>
                <button className={styles.removeButton} onClick={() => handleRemove(f.friendshipId)}>
                  삭제
                </button>
              </div>
            ))}
          </section>
        )}
```

변경:

```tsx
        {view === "friends" && (
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>친구 목록</h3>
            {friends === null && <p className={styles.loading}>불러오는 중...</p>}
            {friends?.length === 0 && <p className={styles.empty}>아직 친구가 없어요</p>}
            {friends?.map((f) => (
              <div key={f.friendshipId} className={styles.row}>
                <span className={styles.rowNickname}>{f.nickname}</span>
                <span className={styles.status}>{f.online ? "🟢 온라인" : formatLastSeen(f.lastLoginAt)}</span>
                {f.online && f.roomId && (
                  <button className={styles.followButton} onClick={() => onJoinRoom(f.roomId!)}>
                    따라가기
                  </button>
                )}
                <button className={styles.removeButton} onClick={() => handleRemove(f.friendshipId)}>
                  삭제
                </button>
              </div>
            ))}
          </section>
        )}
```

(`f.online && !f.roomId`, 즉 로비에 있는 친구는 버튼 자체가 안 뜬다 — 요구사항대로 "특별한 액션 없음".)

- [ ] **Step 10: `FriendsModal.module.css`에 스타일 추가**

기존 `.removeButton` 규칙이 포함된 블록(`.acceptButton, .declineButton, .cancelButton, .removeButton { ... }`) 뒤, `.closeButton` 앞에 추가:

```css
.followButton {
  padding: 0.35rem 0.7rem;
  font-size: 0.8rem;
  border-radius: 0.4rem;
  border: none;
  cursor: pointer;
  color: #fff;
  font-weight: 700;
  white-space: nowrap;
  background: linear-gradient(135deg, #3b82f6, #2563eb);
}
```

- [ ] **Step 11: 타입체크 + 빌드**

Run: `npm run build --workspace client`
Expected: 에러 없음.

- [ ] **Step 12: 로컬 same-origin 서버로 실행**

```bash
node sync-public.js
npm run dev:server
```

`http://localhost:2567` 접속.

- [ ] **Step 13: 브라우저로 전체 플로우 검증**

이 기능은 실제 Colyseus 방 참가(WebSocket 연결)가 필요해서, 이전 친구 시스템 검증 때 쓴 "curl로 로비 폴링만 흉내내기"로는 부족하다 — **최소 2개의 완전히 분리된 Playwright 브라우저 컨텍스트**(각자 독립적인 WS 연결을 유지해야 하므로 쿠키만 바꿔치기하는 방식 불가)가 필요하다.

세션 발급 방법은 이전과 동일(`server/src/auth/session.ts`의 `signSession(userId)`, `SESSION_JWT_SECRET`은 `server/.env`) — 이번엔 계정 3개(A/B/C, 서로 accepted 친구 관계로 DB에 직접 INSERT)를 만들고, 각각 별도 브라우저 컨텍스트에 세션 쿠키를 주입한다.

검증 순서:
1. A: 로그인 → "온라인" → 로비 진입(방 목록 폴링 시작).
2. B: 로그인 → "온라인" → 로비에 그대로 대기(로비 폴링 중이어야 온라인+roomId=null 상태가 됨).
3. A: "방 만들기"로 관전 허용 방 생성 → 대기 화면(RoleSelect) 진입.
4. A: "초대하기" 클릭 → 목록에 B가 보이는지 확인(로비에 있는 온라인 친구만 나와야 함).
5. A: B 초대 → 버튼이 "보냄"으로 바뀌는지 확인.
6. B: 다음 폴링 tick 이내(최대 2~3초 대기) 로비 화면 상단에 "A님이 초대했어요!" 배너가 뜨는지 확인.
7. B: "참가하기" 클릭 → 실제로 A의 방(대기 화면)에 들어가는지 확인.
8. A, B 둘 다 역할 선택 후 게임 시작(관전 허용 방이므로 게임 시작 가능하도록 인원 맞춤 — teamCount 1로 방을 만들면 2명이면 시작 가능).
9. C: 로그인 → 로비 진입 → 친구 창 열어서 A(또는 B)의 친구 목록 행에 "따라가기" 버튼이 뜨는지(roomId가 채워졌으므로) 확인 → 클릭 → 관전자로 그 방에 들어가는지 확인.
10. 로비에 있는 친구(예: 아직 로비에 있는 계정)는 친구 목록에 "따라가기" 버튼이 안 뜨는지 확인.
11. 관전 비허용(allowSpectators=false) 방을 하나 더 만들어서 게임 시작 후 다른 계정으로 따라가기 시도 → 기존 방 입장 실패 에러 화면이 뜨는지 확인(새로 만든 에러 처리 없음 — 기존 경로 그대로).
12. TTL 검증: `server/src/friends/invites.ts`의 `INVITE_TTL_MS`를 임시로 `3_000`(3초)으로 바꾸고 서버 재시작 → 초대 후 3초 넘게 응답 안 하면 배너가 사라지는지 확인 → 확인 후 **반드시 60_000으로 원복**하고 다시 서버 재시작.

전부 통과하면 이 Task 완료.

- [ ] **Step 14: 테스트 아티팩트 정리**

가짜 계정 3개(및 관련 friendship row)를 DB에서 삭제. 개발 서버 종료.

- [ ] **Step 15: 커밋**

```bash
git add client/src/components/RoomList.tsx client/src/components/RoomList.module.css client/src/components/FriendsModal.tsx client/src/components/FriendsModal.module.css
git commit -m "$(cat <<'EOF'
로비 초대 배너 + 친구 목록 따라가기 버튼 추가

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## 이 플랜에서 의도적으로 빠진 것

- 초대 취소(보낸 사람이 초대를 취소하는 기능) — 60초 TTL로 충분히 짧다고 판단, 범위 밖.
- 초대 대상이 여러 명일 때 일괄 초대(전체 선택) — 한 명씩만.
- 방 제목 등 초대 배너에 부가 정보 표시.
- 차단 기능, 초대 거부 알림.
