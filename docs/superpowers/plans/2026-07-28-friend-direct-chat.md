# 친구 1:1 채팅 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 친구 목록에서 "채팅" 버튼으로 1:1 대화창을 열고, 영구 저장되는 텍스트 메시지를 주고받는다.

**Architecture:** 새 SQLite 테이블 `direct_messages`/`chat_read_state`만으로 구현한다. 닉네임/색은 `users` 테이블을 매번 조인해서 가져온다(최초 1회 설정 후 불변이라 안전). 메시지 검증은 기존 `server/src/game/chat.ts`의 `sanitizeChatText`를 재사용. 클라이언트는 기존 `ChatBox.tsx`를 그대로 재사용(REST로 받은 메시지를 그 컴포넌트가 기대하는 모양으로 변환만). `areFriends` 헬퍼를 `invites.ts`에서 `friendships.ts`로 옮겨 채팅과 초대 양쪽이 공유하게 한다.

**Tech Stack:** better-sqlite3(raw SQL), Express, React 19, 기존 `ChatBox.tsx` 재사용, vitest.

## Global Constraints

- 채팅은 로비(친구 목록)에서만 — 매치 대기/진행 화면에는 접근 경로 없음.
- 채팅 대상은 반드시 accepted 상태의 친구여야 한다(서버 검증).
- 메시지 검증은 `server/src/game/chat.ts`의 `sanitizeChatText`(trim + 100자) 그대로 재사용 — 새로 안 만듦.
- 새 웹소켓/SSE 없음 — 채팅창이 열려있는 동안만 2초 폴링.
- 메시지 전송 성공 직후엔 다음 폴링을 기다리지 않고 즉시 한 번 더 새로고침한다.
- 메시지 기록은 최근 100개만 — 페이지네이션 없음.
- 안 읽음 배지는 친구 목록(FriendsModal) 안에서만 — 로비의 "친구" 버튼 자체는 안 건드림.
- 안 읽음 카운트는 `GET /api/friends` 호출 시점에만 계산.
- 채팅창을 열면(그리고 열려있는 동안 새 메시지를 받을 때마다) 상대가 보낸 메시지를 읽음 처리한다.
- 차단, 메시지 삭제/수정, 첨부, 상대에게 보이는 읽음 표시는 범위 밖.
- 이 프로젝트는 Express 라우트에 대한 HTTP 레벨 자동 테스트 관행이 없다 — 서버 테스트는 라우트 아래 순수 함수를 직접 호출해서 검증한다. 클라이언트는 테스트 프레임워크가 전혀 없다 — 브라우저 직접 검증만 한다.

---

### Task 1: DB 스키마 + `areFriends` 이전 (`invites.ts` → `friendships.ts`)

**Files:**
- Modify: `server/src/db/connection.ts`
- Modify: `server/src/friends/friendships.ts`
- Modify: `server/src/friends/friendships.test.ts`
- Modify: `server/src/friends/invites.ts`
- Modify: `server/src/friends/invites.test.ts`
- Modify: `server/src/createServer.ts`

**Interfaces:**
- Produces: `direct_messages`/`chat_read_state` 테이블, `areFriends(userIdA: number, userIdB: number): boolean`가 이제 `friendships.ts`에서 export됨 — Task 2/3이 그대로 소비.

- [ ] **Step 1: `server/src/db/connection.ts`에 새 테이블 추가**

기존 `friendships` 인덱스 생성 직후(`return db;` 바로 앞)에 추가:

```ts
  db.exec(`
    CREATE TABLE IF NOT EXISTS direct_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER NOT NULL,
      recipient_id INTEGER NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours'))
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_direct_messages_pair ON direct_messages(sender_id, recipient_id, id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_direct_messages_pair2 ON direct_messages(recipient_id, sender_id, id)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_read_state (
      user_id INTEGER NOT NULL,
      other_user_id INTEGER NOT NULL,
      last_read_message_id INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, other_user_id)
    )
  `);
```

- [ ] **Step 2: `areFriends`를 `friendships.ts`로 이전 — 추가**

`server/src/friends/friendships.ts`의 `findFriendshipRow` 함수 바로 뒤에 추가:

```ts
// requesterId/addresseeId 방향 무관, status='accepted' row가 있는지만 확인한다.
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
```

- [ ] **Step 3: `areFriends`의 테스트를 `friendships.test.ts`로 이전**

`server/src/friends/friendships.test.ts`의 기존 import 줄:

```ts
import { sendFriendRequest, respondToRequest, cancelRequest, removeFriend, listFriends, listReceivedRequests, listSentRequests } from "./friendships";
```

변경:

```ts
import { sendFriendRequest, respondToRequest, cancelRequest, removeFriend, listFriends, listReceivedRequests, listSentRequests, areFriends } from "./friendships";
```

파일 끝(마지막 `describe` 블록 뒤)에 추가 — 기존 파일의 `makeUser(sub, nickname)` 헬퍼를 그대로 재사용:

```ts
describe("areFriends", () => {
  beforeEach(() => {
    db.exec("DELETE FROM friendships");
    db.exec("DELETE FROM users");
  });

  test("returns true when an accepted friendship row exists (requester direction)", () => {
    const a = makeUser("sub-a", "에이");
    const b = makeUser("sub-b", "비");
    db.prepare(`INSERT INTO friendships (requester_id, addressee_id, status) VALUES (?, ?, 'accepted')`).run(a, b);
    expect(areFriends(a, b)).toBe(true);
  });

  test("returns true regardless of which side is requester vs addressee", () => {
    const a = makeUser("sub-a", "에이");
    const b = makeUser("sub-b", "비");
    db.prepare(`INSERT INTO friendships (requester_id, addressee_id, status) VALUES (?, ?, 'accepted')`).run(b, a);
    expect(areFriends(a, b)).toBe(true);
  });

  test("returns false when the friendship is still pending", () => {
    const a = makeUser("sub-a", "에이");
    const b = makeUser("sub-b", "비");
    db.prepare(`INSERT INTO friendships (requester_id, addressee_id, status) VALUES (?, ?, 'pending')`).run(a, b);
    expect(areFriends(a, b)).toBe(false);
  });

  test("returns false when there's no friendship row at all", () => {
    const a = makeUser("sub-a", "에이");
    const b = makeUser("sub-b", "비");
    expect(areFriends(a, b)).toBe(false);
  });
});
```

- [ ] **Step 4: `invites.ts`에서 `areFriends` 제거**

`server/src/friends/invites.ts`에서 다음 블록(주석 포함)을 통째로 삭제:

```ts
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
```

(이 파일의 다른 함수는 `areFriends`를 호출하지 않으므로, 삭제만 하면 되고 대체 import는 필요 없다.)

- [ ] **Step 5: `invites.test.ts`에서 `areFriends` 테스트 제거**

기존 import 줄:

```ts
import { _resetForTest, areFriends, dismissInvite, getPendingInvite, sendInvite } from "./invites";
```

변경:

```ts
import { _resetForTest, dismissInvite, getPendingInvite, sendInvite } from "./invites";
```

파일 상단의 `describe("areFriends", ...)` 블록 전체(그 안의 4개 테스트)를 삭제한다. `makeUser`/`makeFriendship` 헬퍼 함수 둘 다 이 describe 블록에서만 쓰이고 `sendInvite`/`getPendingInvite`/`dismissInvite` 블록은 숫자 리터럴(1 등)을 직접 쓰므로, 두 헬퍼 함수 정의도 같이 삭제한다.

- [ ] **Step 6: `createServer.ts`의 import 이전**

기존:

```ts
import {
  cancelRequest,
  findUserByNickname,
  listFriends,
  listReceivedRequests,
  listSentRequests,
  removeFriend,
  respondToRequest,
  sendFriendRequest,
} from "./friends/friendships";
import { areFriends, dismissInvite, getPendingInvite, sendInvite } from "./friends/invites";
```

변경:

```ts
import {
  areFriends,
  cancelRequest,
  findUserByNickname,
  listFriends,
  listReceivedRequests,
  listSentRequests,
  removeFriend,
  respondToRequest,
  sendFriendRequest,
} from "./friends/friendships";
import { dismissInvite, getPendingInvite, sendInvite } from "./friends/invites";
```

- [ ] **Step 7: 테스트 + 타입체크**

Run: `npm test --workspace server` (레포 루트에서)
Expected: 전체 통과. `MatchRoom.test.ts`의 "timeAdd extends the actual turn deadline"는 실제 wall-clock 타이밍에 의존하는 pre-existing flake — 그것만 실패하면 재실행해서 통과하는지 확인하고 무관한 것으로 취급(고치려 하지 말 것).

Run: `npx tsc --noEmit -p tsconfig.json` (`server/` 디렉토리에서)
Expected: 에러 없음.

- [ ] **Step 8: 커밋**

```bash
git add server/src/db/connection.ts server/src/friends/friendships.ts server/src/friends/friendships.test.ts server/src/friends/invites.ts server/src/friends/invites.test.ts server/src/createServer.ts
git commit -m "$(cat <<'EOF'
1:1 채팅 테이블 추가, areFriends를 friendships.ts로 이전

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `server/src/chat/directMessages.ts` (메시지 저장/조회)

**Files:**
- Create: `server/src/chat/directMessages.ts`
- Create: `server/src/chat/directMessages.test.ts`

**Interfaces:**
- Consumes: Task 1의 `direct_messages`/`chat_read_state` 테이블.
- Produces: `DirectMessageEntry` 타입, `getMessages(userId, otherUserId): DirectMessageEntry[]`, `sendMessage(senderId, recipientId, text): void`, `markRead(userId, otherUserId): void`, `getUnreadCount(userId, otherUserId): number` — Task 3이 그대로 소비.

- [ ] **Step 1: 실패하는 테스트 작성**

`server/src/chat/directMessages.test.ts`:

```ts
import { beforeEach, describe, expect, test } from "vitest";
import { db } from "../db/connection";
import { getOrCreateUser } from "../auth/googleAuth";
import { getMessages, getUnreadCount, markRead, sendMessage } from "./directMessages";

function makeUser(sub: string, nickname: string): number {
  const user = getOrCreateUser(sub, {});
  db.prepare(`UPDATE users SET nickname = ? WHERE id = ?`).run(nickname, user.id);
  return user.id;
}

describe("directMessages", () => {
  beforeEach(() => {
    db.exec("DELETE FROM direct_messages");
    db.exec("DELETE FROM chat_read_state");
    db.exec("DELETE FROM users");
  });

  test("sendMessage stores a message retrievable by both participants", () => {
    const a = makeUser("sub-a", "에이");
    const b = makeUser("sub-b", "비");
    sendMessage(a, b, "안녕");

    const fromA = getMessages(a, b);
    const fromB = getMessages(b, a);
    expect(fromA).toHaveLength(1);
    expect(fromB).toHaveLength(1);
    expect(fromA[0].text).toBe("안녕");
    expect(fromA[0].senderNickname).toBe("에이");
  });

  test("returns messages in chronological order (oldest first)", () => {
    const a = makeUser("sub-a", "에이");
    const b = makeUser("sub-b", "비");
    sendMessage(a, b, "첫번째");
    sendMessage(b, a, "두번째");
    sendMessage(a, b, "세번째");

    const messages = getMessages(a, b);
    expect(messages.map((m) => m.text)).toEqual(["첫번째", "두번째", "세번째"]);
  });

  test("only returns the most recent 100 messages", () => {
    const a = makeUser("sub-a", "에이");
    const b = makeUser("sub-b", "비");
    for (let i = 0; i < 101; i++) sendMessage(a, b, `msg-${i}`);

    const messages = getMessages(a, b);
    expect(messages).toHaveLength(100);
    expect(messages[0].text).toBe("msg-1");
    expect(messages[messages.length - 1].text).toBe("msg-100");
  });

  test("getUnreadCount counts only messages sent by the other person", () => {
    const a = makeUser("sub-a", "에이");
    const b = makeUser("sub-b", "비");
    sendMessage(b, a, "하나");
    sendMessage(b, a, "둘");
    sendMessage(a, b, "내가 보낸 것 (안 셈)");

    expect(getUnreadCount(a, b)).toBe(2);
  });

  test("markRead resets unread count to zero", () => {
    const a = makeUser("sub-a", "에이");
    const b = makeUser("sub-b", "비");
    sendMessage(b, a, "하나");
    sendMessage(b, a, "둘");

    markRead(a, b);
    expect(getUnreadCount(a, b)).toBe(0);
  });

  test("only messages after the last read point count as unread again", () => {
    const a = makeUser("sub-a", "에이");
    const b = makeUser("sub-b", "비");
    sendMessage(b, a, "하나");
    markRead(a, b);

    sendMessage(b, a, "둘");
    expect(getUnreadCount(a, b)).toBe(1);
  });

  test("markRead with no messages from the other person is a no-op", () => {
    const a = makeUser("sub-a", "에이");
    const b = makeUser("sub-b", "비");
    expect(() => markRead(a, b)).not.toThrow();
    expect(getUnreadCount(a, b)).toBe(0);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run directMessages.test.ts` (`server/` 디렉토리에서)
Expected: FAIL — `Cannot find module './directMessages'`

- [ ] **Step 3: 구현**

`server/src/chat/directMessages.ts`:

```ts
import { db } from "../db/connection";

export type DirectMessageEntry = {
  id: number;
  senderId: number;
  senderNickname: string;
  senderNicknameColor: string | null;
  text: string;
  createdAt: string;
};

const HISTORY_LIMIT = 100;

// 최근 100개, 시간순(오래된 것 먼저) — 화면에 그대로 위에서 아래로 뿌릴 수 있는 순서.
export function getMessages(userId: number, otherUserId: number): DirectMessageEntry[] {
  const rows = db
    .prepare(
      `SELECT m.id AS id, m.sender_id AS senderId, u.nickname AS senderNickname,
              u.nickname_color AS senderNicknameColor, m.text AS text, m.created_at AS createdAt
       FROM direct_messages m
       JOIN users u ON u.id = m.sender_id
       WHERE (m.sender_id = ? AND m.recipient_id = ?) OR (m.sender_id = ? AND m.recipient_id = ?)
       ORDER BY m.id DESC
       LIMIT ?`,
    )
    .all(userId, otherUserId, otherUserId, userId, HISTORY_LIMIT) as DirectMessageEntry[];
  return rows.reverse();
}

export function sendMessage(senderId: number, recipientId: number, text: string): void {
  db.prepare(`INSERT INTO direct_messages (sender_id, recipient_id, text) VALUES (?, ?, ?)`).run(
    senderId,
    recipientId,
    text,
  );
}

export function markRead(userId: number, otherUserId: number): void {
  const latest = db
    .prepare(`SELECT MAX(id) AS maxId FROM direct_messages WHERE sender_id = ? AND recipient_id = ?`)
    .get(otherUserId, userId) as { maxId: number | null };
  if (latest.maxId === null) return;

  db.prepare(
    `INSERT INTO chat_read_state (user_id, other_user_id, last_read_message_id)
     VALUES (?, ?, ?)
     ON CONFLICT(user_id, other_user_id) DO UPDATE SET last_read_message_id = excluded.last_read_message_id`,
  ).run(userId, otherUserId, latest.maxId);
}

// 상대(otherUserId)가 나(userId)에게 보낸 것 중, 내가 마지막으로 읽은 지점 이후 것만 센다.
export function getUnreadCount(userId: number, otherUserId: number): number {
  const readState = db
    .prepare(
      `SELECT last_read_message_id AS lastReadMessageId FROM chat_read_state WHERE user_id = ? AND other_user_id = ?`,
    )
    .get(userId, otherUserId) as { lastReadMessageId: number } | undefined;
  const lastReadMessageId = readState?.lastReadMessageId ?? 0;

  const row = db
    .prepare(`SELECT COUNT(*) AS c FROM direct_messages WHERE sender_id = ? AND recipient_id = ? AND id > ?`)
    .get(otherUserId, userId, lastReadMessageId) as { c: number };
  return row.c;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run directMessages.test.ts` (`server/` 디렉토리에서)
Expected: PASS (7 tests)

- [ ] **Step 5: 커밋**

```bash
git add server/src/chat/directMessages.ts server/src/chat/directMessages.test.ts
git commit -m "$(cat <<'EOF'
1:1 채팅 메시지 저장/조회/읽음처리 모듈 추가

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `/api/chat/*` 라우트 + `GET /api/friends`에 unreadCount 추가

**Files:**
- Modify: `server/src/createServer.ts`

**Interfaces:**
- Consumes: Task 1의 `areFriends`(이제 `./friends/friendships`에서), Task 2의 `getMessages`/`sendMessage`/`markRead`/`getUnreadCount`.
- Produces: `GET /api/friends` 응답에 `unreadCount: number` 필드 추가, `POST /api/chat/send`, `GET /api/chat/:friendUserId/messages`, `POST /api/chat/:friendUserId/read` — Task 4가 그대로 소비.

- [ ] **Step 1: import 추가**

기존 `from "./friends/invites"` import 줄 바로 뒤에 추가:

```ts
import { getMessages, getUnreadCount, markRead, sendMessage } from "./chat/directMessages";
import { sanitizeChatText } from "./game/chat";
```

- [ ] **Step 2: `GET /api/friends` 핸들러에 `unreadCount` 추가**

기존(Task 1의 `createServer.ts` import 변경 이후, 현재 상태):

```ts
    const friends = listFriends(userId).map((f) => ({
      ...f,
      online: isUserOnline(f.userId) || roomByNickname.has(f.nickname),
      roomId: roomByNickname.get(f.nickname) ?? null,
    }));
    res.json(friends);
```

변경:

```ts
    const friends = listFriends(userId).map((f) => ({
      ...f,
      online: isUserOnline(f.userId) || roomByNickname.has(f.nickname),
      roomId: roomByNickname.get(f.nickname) ?? null,
      unreadCount: getUnreadCount(userId, f.userId),
    }));
    res.json(friends);
```

- [ ] **Step 3: `/api/chat/*` 라우트 3개 추가**

`app.post("/api/invites/dismiss", ...)` 핸들러(파일 끝쪽, `const httpServer = createHttpServer(app);` 바로 앞) 뒤에 추가:

```ts
  app.post("/api/chat/send", (req, res) => {
    const cookies = (req as unknown as { cookies?: Record<string, string> }).cookies;
    const userId = verifySession(cookies?.[SESSION_COOKIE_NAME]);
    if (!userId) {
      res.status(401).json({ error: "로그인이 필요합니다." });
      return;
    }
    const { toUserId, text } = req.body ?? {};
    if (!Number.isInteger(toUserId)) {
      res.status(400).json({ error: "잘못된 요청이에요." });
      return;
    }
    if (!areFriends(userId, toUserId)) {
      res.status(403).json({ error: "친구가 아니에요." });
      return;
    }
    const clean = sanitizeChatText(text);
    if (!clean) {
      res.status(400).json({ error: "메시지를 입력해주세요." });
      return;
    }
    sendMessage(userId, toUserId, clean);
    res.json({ ok: true });
  });

  app.get("/api/chat/:friendUserId/messages", (req, res) => {
    const cookies = (req as unknown as { cookies?: Record<string, string> }).cookies;
    const userId = verifySession(cookies?.[SESSION_COOKIE_NAME]);
    if (!userId) {
      res.status(401).json({ error: "로그인이 필요합니다." });
      return;
    }
    const friendUserId = Number(req.params.friendUserId);
    if (!Number.isInteger(friendUserId)) {
      res.status(400).json({ error: "잘못된 요청이에요." });
      return;
    }
    if (!areFriends(userId, friendUserId)) {
      res.status(403).json({ error: "친구가 아니에요." });
      return;
    }
    res.json(getMessages(userId, friendUserId));
  });

  app.post("/api/chat/:friendUserId/read", (req, res) => {
    const cookies = (req as unknown as { cookies?: Record<string, string> }).cookies;
    const userId = verifySession(cookies?.[SESSION_COOKIE_NAME]);
    if (!userId) {
      res.status(401).json({ error: "로그인이 필요합니다." });
      return;
    }
    const friendUserId = Number(req.params.friendUserId);
    if (!Number.isInteger(friendUserId)) {
      res.status(400).json({ error: "잘못된 요청이에요." });
      return;
    }
    markRead(userId, friendUserId);
    res.json({ ok: true });
  });
```

- [ ] **Step 4: 테스트 + 타입체크**

Run: `npm test --workspace server` (레포 루트에서)
Expected: 전체 통과(이 Task는 새 테스트 파일을 추가하지 않음 — 프로젝트 관행대로 Express 라우트 자체는 자동 테스트 없음). `MatchRoom.test.ts`의 timeAdd 관련 테스트가 단독으로 실패하면 재실행해서 통과하는지 확인하고 pre-existing flake로 취급.

Run: `npx tsc --noEmit -p tsconfig.json` (`server/` 디렉토리에서)
Expected: 에러 없음.

- [ ] **Step 5: 커밋**

```bash
git add server/src/createServer.ts
git commit -m "$(cat <<'EOF'
GET /api/friends에 unreadCount 추가, /api/chat/* 라우트 추가

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: 클라이언트 API 함수

**Files:**
- Modify: `client/src/game/friends.ts`
- Create: `client/src/game/chat.ts`
- Create: `client/src/game/directMessageToChatMessage.ts`

**Interfaces:**
- Consumes: Task 3의 응답 형태.
- Produces: `FriendEntry.unreadCount: number`, `DirectMessageEntry` 타입, `getDirectMessages(friendUserId)`, `sendDirectMessage(toUserId, text)`, `markDirectMessagesRead(friendUserId)`, `directMessageToChatMessage(entry): ChatMessage` — Task 5가 그대로 소비.

- [ ] **Step 1: `client/src/game/friends.ts`의 `FriendEntry` 타입에 필드 추가**

기존:

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

변경:

```ts
export type FriendEntry = {
  friendshipId: number;
  userId: number;
  nickname: string;
  online: boolean;
  roomId: string | null;
  unreadCount: number;
  lastLoginAt: string | null;
};
```

- [ ] **Step 2: `client/src/game/chat.ts` 작성**

```ts
export type DirectMessageEntry = {
  id: number;
  senderId: number;
  senderNickname: string;
  senderNicknameColor: string | null;
  text: string;
  createdAt: string;
};

async function chatFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: "same-origin", ...init });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error ?? "요청에 실패했어요.");
  return body as T;
}

export function getDirectMessages(friendUserId: number): Promise<DirectMessageEntry[]> {
  return chatFetch(`/api/chat/${friendUserId}/messages`);
}

export function sendDirectMessage(toUserId: number, text: string): Promise<{ ok: true }> {
  return chatFetch("/api/chat/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ toUserId, text }),
  });
}

export function markDirectMessagesRead(friendUserId: number): Promise<{ ok: true }> {
  return chatFetch(`/api/chat/${friendUserId}/read`, { method: "POST" });
}
```

- [ ] **Step 3: `client/src/game/directMessageToChatMessage.ts` 작성**

```ts
import type { ChatMessage } from "./matchTypes";
import type { DirectMessageEntry } from "./chat";

export function directMessageToChatMessage(m: DirectMessageEntry): ChatMessage {
  return {
    nickname: m.senderNickname,
    nicknameColor: m.senderNicknameColor ?? "",
    text: m.text,
    sentAt: new Date(`${m.createdAt.replace(" ", "T")}+09:00`).getTime(),
  };
}
```

- [ ] **Step 4: 타입체크**

Run: `npm run build --workspace client` (레포 루트에서)
Expected: 에러 없음.

- [ ] **Step 5: 커밋**

```bash
git add client/src/game/friends.ts client/src/game/chat.ts client/src/game/directMessageToChatMessage.ts
git commit -m "$(cat <<'EOF'
친구 unreadCount 필드 및 1:1 채팅 API 클라이언트 함수 추가

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `DirectChatModal` + `FriendsModal.tsx` 배선 + 브라우저 검증

**Files:**
- Create: `client/src/components/DirectChatModal.tsx`
- Create: `client/src/components/DirectChatModal.module.css`
- Modify: `client/src/components/FriendsModal.tsx`
- Modify: `client/src/components/FriendsModal.module.css`

**Interfaces:**
- Consumes: Task 4의 `getDirectMessages`, `sendDirectMessage`, `markDirectMessagesRead`, `directMessageToChatMessage`, `FriendEntry.unreadCount`. 기존 `ChatBox.tsx`(수정 없이 그대로 재사용).
- Produces: 없음 — 이 플랜의 마지막 Task.

- [ ] **Step 1: `DirectChatModal.tsx` 작성**

```tsx
import { useEffect, useRef, useState } from "react";
import { ChatBox } from "./ChatBox";
import { getDirectMessages, markDirectMessagesRead, sendDirectMessage, type DirectMessageEntry } from "../game/chat";
import { directMessageToChatMessage } from "../game/directMessageToChatMessage";
import styles from "./DirectChatModal.module.css";

const POLL_INTERVAL_MS = 2000;

export function DirectChatModal({
  friendUserId,
  friendNickname,
  onClose,
}: {
  friendUserId: number;
  friendNickname: string;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<DirectMessageEntry[]>([]);
  const cancelledRef = useRef(false);

  async function refresh() {
    try {
      const list = await getDirectMessages(friendUserId);
      if (!cancelledRef.current) setMessages(list);
      await markDirectMessagesRead(friendUserId);
    } catch (err) {
      console.error("failed to load direct messages", err);
    }
  }

  useEffect(() => {
    cancelledRef.current = false;
    refresh();
    const interval = setInterval(refresh, POLL_INTERVAL_MS);
    return () => {
      cancelledRef.current = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [friendUserId]);

  async function handleSend(text: string) {
    await sendDirectMessage(friendUserId, text);
    refresh();
  }

  const chatMessages = messages.map(directMessageToChatMessage);

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h2 className={styles.heading}>{friendNickname}님과의 채팅</h2>
        <ChatBox
          messages={chatMessages}
          messageCount={chatMessages.length}
          lastMessageAt={chatMessages.length ? chatMessages[chatMessages.length - 1].sentAt : 0}
          onSend={handleSend}
          fill
        />
        <button className={styles.closeButton} onClick={onClose}>
          닫기
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: `DirectChatModal.module.css` 작성**

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
  max-width: 24rem;
  height: 70svh;
  padding: 1.5rem;
  border-radius: 0.8rem;
  background: #1f2937;
  color: #fff;
  box-sizing: border-box;
  min-height: 0;
}

.heading {
  margin: 0;
  font-size: 1.2rem;
  font-weight: 800;
  text-align: center;
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

(`ChatBox`는 `fill` prop을 받으면 자기 자신에 `flex: 1; min-height: 0;`을 적용한다 — `ChatBox.module.css`의 `.fill` 클래스 참고. `.modal`이 `display: flex; flex-direction: column; height: 70svh; min-height: 0;`으로 실제 고정 높이와 flex 예산을 제공해야 `ChatBox`가 그 안에서 내부 스크롤로 동작한다 — `docs/TROUBLESHOOTING.md`의 flex-fill 관련 항목과 같은 패턴.)

- [ ] **Step 3: `FriendsModal.tsx` 배선**

기존 import 블록:

```tsx
import { useEffect, useState } from "react";
import {
  acceptFriendRequest,
  cancelFriendRequest,
  declineFriendRequest,
  getFriends,
  getReceivedRequests,
  getSentRequests,
  removeFriend,
  sendFriendRequest,
  type FriendEntry,
  type ReceivedRequestEntry,
  type SentRequestEntry,
} from "../game/friends";
import { formatLastSeen } from "../game/formatLastSeen";
import styles from "./FriendsModal.module.css";
```

변경:

```tsx
import { useEffect, useState } from "react";
import {
  acceptFriendRequest,
  cancelFriendRequest,
  declineFriendRequest,
  getFriends,
  getReceivedRequests,
  getSentRequests,
  removeFriend,
  sendFriendRequest,
  type FriendEntry,
  type ReceivedRequestEntry,
  type SentRequestEntry,
} from "../game/friends";
import { formatLastSeen } from "../game/formatLastSeen";
import { DirectChatModal } from "./DirectChatModal";
import styles from "./FriendsModal.module.css";
```

기존 state 선언(함수 시작부):

```tsx
export function FriendsModal({ onClose, onJoinRoom }: { onClose: () => void; onJoinRoom: (roomId: string) => void }) {
  const [friends, setFriends] = useState<FriendEntry[] | null>(null);
  const [received, setReceived] = useState<ReceivedRequestEntry[] | null>(null);
  const [sent, setSent] = useState<SentRequestEntry[] | null>(null);
  const [nickname, setNickname] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [view, setView] = useState<"friends" | "requests">("friends");
```

변경(state 한 줄 추가):

```tsx
export function FriendsModal({ onClose, onJoinRoom }: { onClose: () => void; onJoinRoom: (roomId: string) => void }) {
  const [friends, setFriends] = useState<FriendEntry[] | null>(null);
  const [received, setReceived] = useState<ReceivedRequestEntry[] | null>(null);
  const [sent, setSent] = useState<SentRequestEntry[] | null>(null);
  const [nickname, setNickname] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [view, setView] = useState<"friends" | "requests">("friends");
  const [chatWith, setChatWith] = useState<{ userId: number; nickname: string } | null>(null);
```

친구 목록 렌더링 블록, 기존:

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
                <button
                  className={styles.chatButton}
                  onClick={() => setChatWith({ userId: f.userId, nickname: f.nickname })}
                >
                  채팅
                  {f.unreadCount > 0 && <span className={styles.unreadBadge}>{f.unreadCount}</span>}
                </button>
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

        {chatWith && (
          <DirectChatModal
            friendUserId={chatWith.userId}
            friendNickname={chatWith.nickname}
            onClose={() => {
              setChatWith(null);
              refreshAll();
            }}
          />
        )}
```

- [ ] **Step 4: `FriendsModal.module.css`에 스타일 추가**

기존 `.followButton` 규칙 뒤, `.closeButton` 앞에 추가:

```css
.chatButton {
  position: relative;
  padding: 0.35rem 0.7rem;
  font-size: 0.8rem;
  border-radius: 0.4rem;
  border: none;
  cursor: pointer;
  color: #fff;
  font-weight: 700;
  white-space: nowrap;
  background: #495057;
}

.unreadBadge {
  position: absolute;
  top: -0.4rem;
  right: -0.4rem;
  min-width: 1.1rem;
  height: 1.1rem;
  padding: 0 0.25rem;
  border-radius: 999px;
  background: #e03131;
  color: #fff;
  font-size: 0.65rem;
  font-weight: 800;
  line-height: 1.1rem;
  text-align: center;
}
```

- [ ] **Step 5: 타입체크 + 빌드**

Run: `npm run build --workspace client`
Expected: 에러 없음.

- [ ] **Step 6: 로컬 same-origin 서버로 실행**

```bash
node sync-public.js
npm run dev:server
```

`http://localhost:2567` 접속.

- [ ] **Step 7: 브라우저로 전체 플로우 검증**

이전 초대/따라가기 검증과 같은 방식(`signSession`으로 세션 JWT 발급, `server/.env`의 `SESSION_JWT_SECRET`, 가짜 계정을 DB에 직접 INSERT하고 서로 accepted 친구로 만들어둠)으로 최소 2개 계정(A, B, 서로 친구)을 준비한다. 이번엔 두 계정이 동시에 살아있는 별도 브라우저 컨텍스트일 필요는 없다(채팅은 순수 HTTP 폴링이라 Colyseus WS 연결이 필요 없음) — 순차적으로 계정을 바꿔가며 확인해도 되고, 별도 컨텍스트 2개를 열어 실시간처럼 확인해도 된다.

검증 순서:
1. A: 로비 진입 → 친구 창 열기 → B의 행에 "채팅" 버튼, 안읽음 배지 없음(처음이라 메시지 없음) 확인.
2. A: B에게 채팅 버튼 클릭 → `DirectChatModal` 열림 → "아직 채팅이 없어요" 표시 확인(`ChatBox`의 기존 empty 상태).
3. A: 메시지 "안녕!" 전송 → 목록에 바로 반영되는지 확인(전송 후 즉시 재조회).
4. B: 로비 진입 → 친구 창 열기 → A의 행에 "채팅" 버튼 옆 안읽음 배지 "1" 확인.
5. B: A와의 채팅 열기 → 메시지 "안녕!" 보이는지 확인 → 창을 계속 열어둔 채로 몇 초 대기(자동 읽음 처리 확인 목적).
6. B: 채팅 닫기 → 친구 창의 A 행에서 배지가 사라졌는지 확인(읽음 처리됨).
7. A: B에게 "잘 지내?" 전송 → B가 채팅창을 연 채로 있다면 다음 폴링(≤ ~3초) 안에 새 메시지가 자동으로 뜨는지 확인.
8. 친구가 아닌 두 계정(C를 만들어 A와는 친구 아님)으로 C가 A에게 `/api/chat/send`를 시도하면(브라우저 UI에는 애초에 친구가 아니면 목록에 안 뜨므로, API를 직접 두드려서) 403이 오는지 확인.
9. 101개 메시지를 보내고(스크립트로 직접 DB에 INSERT하거나 반복 전송) 채팅창을 열었을 때 최근 100개만 보이는지, 가장 오래된 게 잘렸는지 확인.
10. 매치 화면(RoleSelect/PlayingScreen 등)에는 채팅 버튼 자체가 없는지 확인(로비 전용이라는 제약 재확인).

전부 통과하면 이 Task 완료.

- [ ] **Step 8: 테스트 아티팩트 정리**

가짜 계정들과 `direct_messages`/`chat_read_state`/`friendships` 관련 행을 DB에서 삭제. 개발 서버 종료.

- [ ] **Step 9: 커밋**

```bash
git add client/src/components/DirectChatModal.tsx client/src/components/DirectChatModal.module.css client/src/components/FriendsModal.tsx client/src/components/FriendsModal.module.css
git commit -m "$(cat <<'EOF'
친구 목록에 1:1 채팅 버튼/모달 추가

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## 이 플랜에서 의도적으로 빠진 것

- 매치 화면에서의 접근 — 로비(친구 목록)에서만 가능.
- 실시간 푸시/웹소켓 알림 — 채팅창이 열려있을 때만 2초 폴링.
- 페이지네이션/전체 기록 불러오기 — 최근 100개만.
- 차단, 메시지 삭제/수정, 첨부파일, 상대에게 보이는 읽음 표시.
- 로비의 "친구" 버튼(모달 밖) 자체에 안읽음 총합 배지 추가 — 배지는 모달 안 각 행에만.
