# 친구 초대하기 / 따라가기 설계

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:writing-plans to turn this spec into an implementation plan.

**Goal:** 방 대기 화면(`RoleSelect.tsx`)에서 온라인 + 로비에 있는 친구를 현재 방으로 초대할 수 있게 하고, 로비의 친구 목록(`FriendsModal.tsx`)에서 방에 있는 친구를 "따라가기"로 바로 입장할 수 있게 한다. 따라가기는 친구가 있는 방의 현재 상태(대기 중/게임 중, 관전 허용 여부)에 따라 서버가 알아서 실제 참가자로 넣어주거나 관전자로 넣어주거나 거부한다 — 별도의 방 상태 판단 로직을 새로 만들지 않고 기존 `client.joinById()` → `MatchRoom.onJoin()` 경로를 그대로 재사용한다.

**Architecture:** 친구의 "현재 위치"(로비/특정 방)는 지난번 온라인 상태 수정에서 이미 쓰고 있는 `matchMaker.query({ name: "match" })` 조회를 확장해서 얻는다(새 추적 로직 없음) — `GET /api/friends` 응답에 `roomId: string | null`을 추가한다. 초대는 실시간 전달이 필요한 유일한 부분이라 서버 메모리에 초대함(`Map<받는사람userId, {...}>`, `presence.ts`와 같은 패턴)을 두고, 로비 화면이 이미 2초마다 돌리고 있는 `/api/rooms` 폴링 사이클에 `GET /api/invites/pending` 조회를 얹어서 새 웹소켓/푸시 없이 전달한다.

**Tech Stack:** `server/src/friends/friendships.ts`(수정 없음, 그대로 재사용), `server/src/createServer.ts`(`GET /api/friends` 확장 + 신규 `/api/invites/*` 라우트 3개), `server/src/friends/invites.ts`(신규, 초대함), `client/src/game/friends.ts`(`FriendEntry`에 `roomId` 추가), `client/src/game/invites.ts`(신규), `client/src/components/InviteFriendsModal.tsx`(신규), `client/src/components/RoleSelect.tsx`(초대하기 버튼), `client/src/components/RoomList.tsx`(초대 배너 + `onJoinRoom`을 `FriendsModal`로 전달), `client/src/components/FriendsModal.tsx`(따라가기 버튼).

## Global Constraints

- **따라가기의 "방 상태에 맞는 액션"은 새로 안 만든다** — `client.joinById(roomId)`가 이미 `MatchRoom.onJoin`을 그대로 타므로, 로비(대기) 단계면 실제 참가자로, 게임 중이고 관전 허용이면 관전자로, 게임 중이고 관전 비허용이면 에러(기존 방 목록 클릭과 완전히 동일한 경로) — 이 스펙에서 새로 만드는 건 "친구가 지금 어느 roomId에 있는지"뿐이다.
- **초대 대상은 "온라인 + roomId 없음(로비)"인 친구만** — 이미 다른 방에 있는 친구는 초대 목록에서 제외한다(초대해도 들어올 수 없으므로).
- **실시간 알림은 로비 폴링에만 얹는다** — 새 웹소켓 채널/SSE 없음. 로비 화면(`RoomList.tsx`)을 벗어나 있으면(게임 중 등) 초대를 받아도 그 사람 화면엔 안 뜨고, 다음에 로비로 돌아왔을 때(만료 전이면) 보인다.
- **초대함은 유저당 슬롯 1개** — 여러 명이 동시에 초대해도 마지막 초대만 남는다(덮어씀). 큐 없음.
- **초대 TTL 60초** — 응답 없으면 자동 소멸. 수락(참가 시도)하거나 명시적으로 닫으면 즉시 소멸.
- **친구 관계 확인** — 초대 대상은 반드시 accepted 상태의 친구여야 한다(서버에서 검증, `friendships` 테이블 조회로 확인).
- **방 제목/정원 등 부가 정보 없이 최소한으로** — 초대 배너는 "OO님이 초대했어요"만 보여준다(방 제목 등은 범위 밖).
- **차단/초대 거부 알림 등은 범위 밖.**

## `server/src/friends/invites.ts` (신규)

`server/src/admin/presence.ts`와 같은 메모리 맵 패턴:

```ts
import { db } from "../db/connection";

type PendingInvite = { fromNickname: string; roomId: string; expiresAt: number };

const INVITE_TTL_MS = 60_000;

const invites = new Map<number, PendingInvite>();

// requesterId/addresseeId 방향 무관, status='accepted' row가 있는지만 확인 —
// friendships.ts의 findFriendshipRow와 같은 방향-무관 조회를 별도로 다시 구현한다
// (friendships.ts는 이 목적의 함수를 export하지 않으므로 이 파일 안에서 간단히 확인).
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
```

## `server/src/createServer.ts` 변경

### `GET /api/friends` 확장

기존(온라인 상태 union 로직 그대로 두고) `inRoomNicknames`를 `Set<string>`에서 닉네임→roomId `Map`으로 바꾼다:

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

### 신규 `/api/invites/*` 라우트 (기존 `/api/friends/*` 라우트들 바로 뒤, 같은 인증 패턴)

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

`getUserById`는 이미 `googleAuth.ts`에서 import돼 있음(기존 import 목록에 있음, 확인 필요) — 닉네임을 세션에서 직접 못 얻으므로(세션은 userId만 담음) DB에서 조회.

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
  lastLoginAt: string | null;
};
```

### `client/src/game/invites.ts` (신규)

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

### `client/src/components/InviteFriendsModal.tsx` (신규)

`FriendsModal.tsx`와 같은 오버레이+모달 구조. `roomId: string`을 prop으로 받는다(현재 내가 있는 방).

- 열릴 때 `getFriends()` 호출, `online && roomId === null`인 친구만 필터링해서 목록.
- 목록 없으면 "초대할 수 있는 친구가 없어요".
- 각 행: 닉네임 + "초대" 버튼. 누르면 `sendInvite(friend.userId, roomId)` → 성공하면 그 행의 버튼을 "보냄"으로 바꾸고 비활성화(다시 누르지 않도록, 모달은 닫지 않음 — 여러 명 연속 초대 가능).
- 상단에 "닫기" 버튼(다른 모달들과 동일).

### `client/src/components/RoleSelect.tsx` 변경

"나가기" 버튼 왼쪽에 "초대하기" 버튼 추가:

```tsx
const [showInviteModal, setShowInviteModal] = useState(false);
// ...
<div className={styles.exitRow}>
  <button className={styles.inviteButton} onClick={() => setShowInviteModal(true)}>
    초대하기
  </button>
  <button className={styles.leaveButton} onClick={onExit}>
    나가기
  </button>
</div>
{showInviteModal && <InviteFriendsModal roomId={room.roomId} onClose={() => setShowInviteModal(false)} />}
```

(정확한 레이아웃/클래스명은 구현 시 기존 `RoleSelect.module.css`의 `.leaveButton` 스타일을 참고해서 나란히 배치)

### `client/src/components/RoomList.tsx` 변경

기존 `/api/rooms` 2초 폴링 `useEffect` 안에서 `listRooms()`와 같이 `getPendingInvite()`도 호출(같은 인터벌, 별도 타이머 추가 안 함):

```tsx
const [pendingInvite, setPendingInvite] = useState<PendingInvite>(null);

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

배너 JSX (제목 아래, 상단 버튼 그룹 위):

```tsx
{pendingInvite && (
  <div className={styles.inviteBanner}>
    <span>{pendingInvite.fromNickname}님이 초대했어요!</span>
    <div className={styles.inviteBannerActions}>
      <button onClick={handleAcceptInvite}>참가하기</button>
      <button onClick={handleDismissInvite}>닫기</button>
    </div>
  </div>
)}
```

`FriendsModal`에 `onJoinRoom` prop을 새로 전달(따라가기용):

```tsx
{showFriendsModal && (
  <FriendsModal
    onJoinRoom={onJoinRoom}
    onClose={() => { ... }}
  />
)}
```

### `client/src/components/FriendsModal.tsx` 변경

`onJoinRoom: (roomId: string) => void`을 새 prop으로 받는다. 친구 목록 각 행에서:

```tsx
{f.online && f.roomId && (
  <button className={styles.followButton} onClick={() => onJoinRoom(f.roomId!)}>
    따라가기
  </button>
)}
```

`f.online && !f.roomId`(로비에 있음)나 오프라인일 때는 버튼 없음 — 요구사항대로 "특별한 액션 없음".

## 에러 처리

- 초대 보내기 실패(네트워크 오류 등): 해당 행에 짧은 인라인 에러 메시지, 버튼은 다시 누를 수 있게 원상복구.
- 따라가기/초대 수락 후 실제 입장 실패(방이 꽉 참, 이미 사라짐 등): **새 에러 처리 안 만듦** — 기존 방 목록 클릭 시 입장 실패와 완전히 같은 경로(`onJoinRoom` → 기존 `ConnectedOnlineFlow`의 에러 화면)를 그대로 탄다.
- 초대함에 없는 초대를 수락/닫기 시도(이미 만료됨 등): 서버는 그냥 조용히 무시(`dismissInvite`가 없는 키를 지우려 해도 에러 없음, `getPendingInvite`가 이미 만료 체크).

## 테스트

- **서버**: `server/src/friends/invites.test.ts` 신규 — 기존 컨벤션대로 함수 직접 호출(`areFriends`/`sendInvite`/`getPendingInvite`/`dismissInvite`), TTL 만료는 `Date.now()`를 모킹하거나 `expiresAt`을 과거로 강제 설정해서 검증. `/api/invites/*`, `GET /api/friends`의 `roomId` 필드 자체는 이 프로젝트 관행대로 HTTP 라우트 자동 테스트 없음.
- **클라이언트**: 테스트 프레임워크 없음. 브라우저로 실제 검증 — 이번엔 실제 Colyseus 방 참가가 필요해서(로비 프레즌스와 달리 room membership은 실제 WS 연결이 있어야 함) 가짜 세션 쿠키 주입 + curl 하트비트만으로는 부족하고, **실제 Playwright 탭 2개**(또는 그 이상)로 다음을 확인:
  1. 계정 A가 방 생성 → 대기 화면에서 "초대하기" → 계정 B(로비에 있음)가 목록에 뜨는지
  2. B 초대 → A 화면에 "보냄" 표시
  3. B의 로비 화면에 초대 배너 뜨는지(다음 폴링 tick 이내, 최대 2~3초 대기)
  4. B가 "참가하기" → 실제로 A의 방에 들어가는지(대기 중이면 참가자로)
  5. 게임 시작 후(관전 허용 방) 계정 C가 친구 목록에서 A/B를 "따라가기" → 관전자로 들어가는지
  6. 관전 비허용 방에서 따라가기 시도 → 기존 입장 실패 에러 화면 뜨는지
  7. 60초 넘게 방치된 초대가 사라지는지(또는 짧은 TTL로 임시 조정해서 검증 후 원복)
  8. 로비에 있는 친구는 "따라가기" 버튼 자체가 안 뜨는지
