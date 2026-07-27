# 친구 1:1 채팅 설계

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:writing-plans to turn this spec into an implementation plan.

**Goal:** 친구 목록(`FriendsModal`)에서 "채팅" 버튼을 눌러 그 친구와의 1:1 대화창을 열고, 텍스트를 주고받는다. 대화 기록은 계정에 영구히 저장된다. 로비에서만 가능(매치 진행 중/대기 화면에서는 접근 불가 — 이미 그 화면들엔 자체 `lobbyChat`/`matchChat`이 있음). 친구 목록에 안 읽은 메시지 배지를 표시한다. 실시간 알림은 없음 — 채팅창이 열려있는 동안만 2초마다 새로고침한다.

**Architecture:** 새 SQLite 테이블 `direct_messages`(메시지 자체)와 `chat_read_state`(유저 쌍별 마지막으로 읽은 메시지 id)만으로 전체를 구현한다. 닉네임/닉네임색은 저장 시점에 박아넣지 않고 `users` 테이블을 조인해서 매번 가져온다(닉네임은 최초 1회 설정 후 변경 불가라 안전 — `googleAuth.ts`의 `setNickname` 참고). 메시지 검증은 기존 매치 내 채팅이 쓰는 `server/src/game/chat.ts`의 `sanitizeChatText`(trim + 100자 제한)를 그대로 재사용한다. 클라이언트는 새 UI를 만들지 않고 기존 `ChatBox.tsx`(매치 내 채팅에 이미 쓰는 리스트+입력창 컴포넌트)를 그대로 재사용 — REST로 받아온 메시지를 그 컴포넌트가 기대하는 `ChatMessage` 모양으로 매핑해서 넣어준다. **곁다리 리팩터:** `areFriends` 헬퍼가 지금 `server/src/friends/invites.ts`에 있는데 이 기능도 "친구끼리만 채팅 가능" 검증에 그대로 필요해서, 더 자연스러운 위치인 `server/src/friends/friendships.ts`로 옮긴다.

**Tech Stack:** better-sqlite3(raw SQL), Express, React 19, 기존 `ChatBox.tsx` 재사용.

## Global Constraints

- 채팅은 **로비(친구 목록)에서만** 가능 — 매치 대기/진행 화면에서는 접근 버튼 자체가 없다.
- 채팅 대상은 반드시 accepted 상태의 친구여야 한다(서버 검증, `areFriends` 재사용).
- 메시지 검증은 기존 `server/src/game/chat.ts`의 `sanitizeChatText`(trim + 100자) 그대로 재사용 — 새로 안 만듦.
- 새 웹소켓/SSE 없음 — 채팅창이 열려있는 동안만 2초 폴링으로 최신 메시지를 다시 불러온다(로비 방 목록 폴링과 같은 주기, 그러나 별개의 타이머 — 채팅창이 안 열려있으면 이 폴링 자체가 없음).
- 메시지 전송 성공 직후에는 다음 폴링을 기다리지 않고 즉시 한 번 더 목록을 새로고침한다.
- **메시지 기록은 최근 100개만** — 페이지네이션/더보기 없음.
- **안 읽음 배지는 친구 목록(`FriendsModal`) 안에서만** — 각 친구 행의 "채팅" 버튼에 숫자 배지. 로비의 "친구" 버튼 자체(모달 밖)는 안 건드림 — 계속 친구 요청 개수만 표시.
- 안 읽음 카운트는 `GET /api/friends` 호출 시점(모달 열 때/닫을 때)에만 계산 — 별도의 지속 폴링 없음.
- 채팅창을 열면(그리고 열려있는 동안 새 메시지를 받을 때마다) 그 친구가 보낸 메시지를 전부 읽음 처리한다.
- 차단, 메시지 삭제/수정, 이모지/파일 첨부, 읽음 표시(상대에게 "읽었음" 보여주기)는 범위 밖.

## `server/src/db/connection.ts` 변경

기존 `friendships` 테이블 생성 블록 뒤에 추가:

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

## `server/src/friends/friendships.ts` 변경 — `areFriends` 이전

`server/src/friends/invites.ts`에서 `areFriends` 함수 전체(주석 포함)를 잘라내서 `server/src/friends/friendships.ts`의 `findFriendshipRow` 함수 바로 뒤에 붙여넣고 export한다:

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

`server/src/friends/invites.ts`에서는 이 함수와 그 주석을 삭제하고, 대신 파일 상단에 `import { areFriends } from "./friendships";`를 추가한 뒤 파일 안에서 계속 그대로 쓴다(이 파일의 기존 사용처는 없음 — `createServer.ts`가 `invites.ts`에서 import해가는 용도였을 뿐이므로, re-export는 불필요하다).

`server/src/createServer.ts`의 import를 다음과 같이 바꾼다:

기존:

```ts
import { areFriends, dismissInvite, getPendingInvite, sendInvite } from "./friends/invites";
```

변경:

```ts
import { dismissInvite, getPendingInvite, sendInvite } from "./friends/invites";
```

그리고 기존 `from "./friends/friendships"` import 블록에 `areFriends`를 추가한다(그 블록에 이미 `findUserByNickname`, `listFriends` 등이 나열돼 있는 곳).

## `server/src/chat/directMessages.ts` (신규)

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
      `SELECT id, sender_id AS senderId, u.nickname AS senderNickname,
              u.nickname_color AS senderNicknameColor, text, created_at AS createdAt
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
    .prepare(
      `SELECT MAX(id) AS maxId FROM direct_messages WHERE sender_id = ? AND recipient_id = ?`,
    )
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
    .prepare(`SELECT last_read_message_id AS lastReadMessageId FROM chat_read_state WHERE user_id = ? AND other_user_id = ?`)
    .get(userId, otherUserId) as { lastReadMessageId: number } | undefined;
  const lastReadMessageId = readState?.lastReadMessageId ?? 0;

  const row = db
    .prepare(
      `SELECT COUNT(*) AS c FROM direct_messages WHERE sender_id = ? AND recipient_id = ? AND id > ?`,
    )
    .get(otherUserId, userId, lastReadMessageId) as { c: number };
  return row.c;
}
```

`ON CONFLICT ... DO UPDATE` upsert는 이 함수가 (userId, otherUserId) 쌍마다 항상 자기 자신의 `last_read_message_id`를 "갱신"하는 것뿐이라 재로그인 시 id를 낭비하던 `getOrCreateUser`의 예전 버그와는 다른 상황이다(그 버그는 매번 다른 사람이 새로 로그인할 때도 AUTOINCREMENT를 태우는 게 문제였음 — 여기 `chat_read_state`는 PRIMARY KEY가 `(user_id, other_user_id)`라 AUTOINCREMENT 자체가 없다).

## `server/src/createServer.ts` — `/api/chat/*` 라우트

기존 `from "./friends/friendships"` import 블록에 `areFriends` 추가(위에서 설명), 새 import 한 줄 추가:

```ts
import { getMessages, getUnreadCount, markRead, sendMessage } from "./chat/directMessages";
```

`sanitizeChatText`도 새로 import:

```ts
import { sanitizeChatText } from "./game/chat";
```

`GET /api/friends` 핸들러(이미 `roomId`까지 추가된 상태)를 다시 확장 — 각 친구 항목에 `unreadCount` 추가:

기존(현재 상태, `Task 2`에서 이미 `roomId`를 추가한 버전):

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

새 라우트 3개(기존 `/api/invites/*` 라우트들 뒤, `const httpServer = createHttpServer(app);` 앞에 추가):

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

## 클라이언트

### `client/src/game/friends.ts` 변경

`FriendEntry`에 필드 추가:

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

### `client/src/game/chat.ts` (신규)

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

### `client/src/game/directMessageToChatMessage.ts` (신규, 작은 변환 유틸)

`ChatBox.tsx`가 기대하는 `ChatMessage`(`client/src/game/matchTypes.ts`) 모양으로 변환 — `createdAt`은 SQLite가 준 KST 공백 구분 문자열이라, `formatLastSeen.ts`가 이미 쓰는 것과 같은 방식으로 파싱한다:

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

### `client/src/components/DirectChatModal.tsx` (신규)

`FriendsModal.tsx`와 같은 오버레이+모달 구조, 내부 메시지 리스트/입력은 기존 `ChatBox`를 재사용:

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

### `client/src/components/DirectChatModal.module.css` (신규)

`FriendsModal.module.css`의 `.overlay`/`.modal`/`.heading`/`.closeButton`을 그대로 가져오되, `ChatBox`가 실제 세로 공간을 채울 수 있게 `.modal`에 고정 높이를 준다(`ChatBox`의 `fill` variant는 부모가 실제 높이를 가지고 있어야 내부 스크롤이 동작함 — `docs/TROUBLESHOOTING.md`의 flex-fill 관련 항목 참고):

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

(`ChatBox`는 자체 스타일을 가지고 있어 `.modal`의 남은 flex 공간을 `flex: 1`로 채운다 — `ChatBox.module.css`의 `.fill` 클래스 확인.)

### `client/src/components/FriendsModal.tsx` 변경

친구 목록 각 행에 "채팅" 버튼(안 읽음 배지 포함) 추가, 클릭 시 `DirectChatModal` 오픈:

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

새 state(컴포넌트 상단, `view` state 바로 뒤에 추가):

```tsx
  const [chatWith, setChatWith] = useState<{ userId: number; nickname: string } | null>(null);
```

새 import 추가:

```tsx
import { DirectChatModal } from "./DirectChatModal";
```

(채팅창을 닫을 때 `refreshAll()`을 다시 불러서 안읽음 배지가 0으로 갱신되게 한다 — 이미 있는 "모달 액션 후 재조회" 패턴과 동일.)

### `client/src/components/FriendsModal.module.css` 변경

기존 `.followButton` 규칙 뒤에 추가:

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

## 테스트

- **서버**: `server/src/chat/directMessages.test.ts` 신규 — 기존 컨벤션대로 함수 직접 호출(`sendMessage`/`getMessages`/`markRead`/`getUnreadCount`). 커버할 케이스: 메시지 보내면 양쪽에서 조회 가능(방향 무관), 최근 100개 제한(101개 넣고 100개만 오는지, 가장 오래된 게 잘림), 읽음 처리 전엔 unreadCount가 실제 메시지 수와 일치, 읽음 처리 후 0, 읽은 뒤 추가로 온 메시지만 다시 카운트.
- `areFriends`가 `invites.ts`에서 `friendships.ts`로 옮겨간 뒤에도 `invites.test.ts`가 여전히 통과하는지 확인(간접 의존 — `invites.ts`가 이제 `friendships.ts`에서 import).
- `/api/chat/*` 라우트 자체는 이 프로젝트 관행대로 자동 테스트 없음.
- **클라이언트**: 테스트 프레임워크 없음. 브라우저로 실제 검증 — 계정 2개로 서로 메시지 주고받기, 안읽음 배지, 100개 제한, 다른 계정으로는 못 훔쳐보는지(친구 아닌 사이 403) 확인.
