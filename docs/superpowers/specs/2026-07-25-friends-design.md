# 친구 시스템 (요청/수락/삭제/목록) 설계

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:writing-plans to turn this spec into an implementation plan.

**Goal:** 닉네임으로 친구 요청을 보내고, 받은 요청을 수락/거절하고, 친구를 삭제하고, 친구 목록에서 온라인 여부와 "n시간 전 접속"을 볼 수 있게 한다. 실시간 알림은 없음 — 친구 창을 열 때만 서버에서 최신 상태를 가져온다. **1:1 영구 채팅은 범위 밖** — 이 스펙이 구현된 뒤 별도로 브레인스토밍/설계한다(채팅은 친구 관계를 전제로 하므로 이 스펙이 먼저 필요).

**Architecture:** 새 SQLite 테이블 `friendships` 하나로 요청 대기/수락 상태를 전부 관리한다(한 쌍당 row 하나, 상태 전이만으로 요청→수락을 표현 — 요청 row와 친구 row를 분리하지 않음). 서버는 `server/src/friends/`에 순수 데이터 접근 함수를 모으고(기존 `server/src/auth/googleAuth.ts` 패턴과 동일하게 raw SQL, ORM 없음), `createServer.ts`에 `/api/friends/*` REST 라우트를 추가한다(기존 `/api/auth/*`, `/api/admin/*`와 같은 위치·인증 패턴 — 세션 쿠키 확인만, admin 권한 불필요). 온라인 여부는 기존 `server/src/admin/presence.ts`(로비 폴링 기반 in-memory Map)를 재사용 — 새 추적 로직 안 만듦. 클라이언트는 `RoomList.tsx`에 새 버튼 + 기존 `RankingModal`/`InquiryModal`과 같은 패턴의 모달 하나(`FriendsModal.tsx`).

**Tech Stack:** `server/src/db/connection.ts`(테이블 추가), `server/src/friends/`(신규 디렉토리), `server/src/createServer.ts`(라우트), `server/src/admin/presence.ts`(온라인 조회 헬퍼 추가), `client/src/components/FriendsModal.tsx`(신규), `client/src/components/RoomList.tsx`, `client/src/game/formatLastSeen.ts`(신규, 시간 포맷 유틸).

## Global Constraints

- **친구 지정은 닉네임 정확히 입력** — 검색/부분일치/자동완성 없음. 존재하지 않는 닉네임이면 에러.
- **실시간 알림 없음** — 받은 요청 배지 숫자는 로비(`RoomList`) 진입 시 한 번만 조회. SSE/폴링 안 씀(기존 `/api/rooms` 2초 폴링과는 별개 — 그 폴링에 얹지 않는다).
- **온라인 표시는 기존 `presence.ts` 재사용** — 로비 화면이 `/api/rooms`를 2초마다 폴링하면서 이미 `touchPresence(userId, nickname)`을 호출하고 있음(그 사이드이펙트를 그대로 활용). 오프라인 친구는 `users.last_login_at` 기준 "n분/시간/일 전 접속"으로 표시.
- **친구 관계는 대칭(mutual)** — 요청 수락 시 양쪽 다 서로의 친구 목록에 나타남. 일방적 팔로우 개념 없음.
- **동시 상호 요청은 자동 수락** — A→B 요청이 대기 중일 때 B→A 요청이 오면, 새 row를 만들지 않고 기존 A→B row를 즉시 `accepted`로 전환한다.
- **거절은 재요청 제한 없음** — 거절되면 그 row를 삭제, 보낸 사람은 즉시 다시 요청 가능.
- **친구 삭제는 조용히** — 상대에게 알림 없이 그 row를 삭제. 재요청하면 처음부터 다시 시작(과거 이력 안 남음).
- **보낸 요청 취소 가능** — 대기 중인 내 요청을 본인이 취소(삭제)할 수 있음.
- **차단(block) 기능은 범위 밖** — 이번 스펙에 포함하지 않음.
- **친구 수 제한 없음.**

## `server/src/db/connection.ts` 변경

기존 테이블 생성 블록들(`users`, `events`, `inquiries`) 옆에 추가:

```ts
db.exec(`
  CREATE TABLE IF NOT EXISTS friendships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    requester_id INTEGER NOT NULL,
    addressee_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'accepted'
    created_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
    responded_at TEXT
  )
`);
// 한 쌍(A,B) 사이에는 요청 방향과 무관하게 유효한 row가 항상 하나만 있어야 함 —
// 애플리케이션 레벨에서 보장(요청 보낼 때 반대 방향 pending을 먼저 확인, 아래
// `sendFriendRequest` 참고). DB 제약으로는 강제하지 않음(SQLite는 두 컬럼의
// unordered pair unique를 직접 표현 못 함 — CHECK 제약으로 흉내내려면 오히려
// 복잡해지고, 이미 애플리케이션 레벨에서 막고 있어 실익이 적음).
db.exec(`CREATE INDEX IF NOT EXISTS idx_friendships_requester ON friendships(requester_id, status)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_friendships_addressee ON friendships(addressee_id, status)`);
```

`users` 테이블처럼 `ALTER TABLE ... ADD COLUMN` 마이그레이션 가드는 필요 없음 — 완전히 새 테이블이라 `CREATE TABLE IF NOT EXISTS`만으로 충분.

## `server/src/friends/friendships.ts` (신규)

`server/src/auth/googleAuth.ts`와 같은 스타일(raw SQL, 각 함수가 하나의 동작). 대략적인 함수 목록과 각각의 동작:

- `findUserByNickname(nickname: string): { id: number } | undefined` — 닉네임으로 대상 유저 조회(요청 보낼 때 존재 확인용).
- `sendFriendRequest(requesterId: number, addresseeId: number): "sent" | "auto_accepted" | "already_friends" | "already_pending" | "self"` — 반환값으로 결과 분기.
  - `requesterId === addresseeId`면 `"self"`.
  - 두 사람 사이에 이미 `accepted` row가 있으면(**방향 무관** — requester/addressee 어느 쪽이든 이 두 유저 id 조합이면) `"already_friends"`.
  - 이미 requester→addressee 방향 `pending` row 있으면 `"already_pending"`.
  - **반대 방향**(addressee→requester) `pending` row가 있으면, 그 row를 `status='accepted', responded_at=now`로 업데이트하고 `"auto_accepted"`.
  - 그 외엔 새 row(`status='pending'`) insert, `"sent"`.
- `respondToRequest(requestId: number, addresseeId: number, accept: boolean): boolean` — `addressee_id`가 본인 것 맞는지 확인(다른 사람 요청을 함부로 수락/거절 못 하게) 후, accept면 `status='accepted'`로 업데이트, 아니면 row 삭제. 소유권 안 맞으면 `false`.
- `cancelRequest(requestId: number, requesterId: number): boolean` — `requester_id`가 본인 것 맞는지 확인 후 row 삭제(pending 상태일 때만).
- `removeFriend(userId: number, friendshipId: number): boolean` — 그 row에 본인이 requester/addressee 둘 중 하나로 걸려있고 `status='accepted'`인지 확인 후 삭제.
- `listFriends(userId: number): { friendshipId: number; userId: number; nickname: string; lastLoginAt: string | null }[]` — `status='accepted'`이고 본인이 양쪽 중 하나인 row들을 `users` 테이블과 join, **상대방** 쪽 정보만 뽑아서 반환.
- `listReceivedRequests(userId: number): { requestId: number; fromUserId: number; fromNickname: string; createdAt: string }[]` — `addressee_id=userId AND status='pending'`.
- `listSentRequests(userId: number): { requestId: number; toUserId: number; toNickname: string; createdAt: string }[]` — `requester_id=userId AND status='pending'`.

## `server/src/admin/presence.ts` 변경

기존 `getOnlineUsers()`(전체 온라인 목록) 옆에 헬퍼 하나 추가:

```ts
export function isUserOnline(userId: number): boolean {
  return getOnlineUsers().some((entry) => entry.userId === userId);
}
```

## `server/src/createServer.ts` — `/api/friends/*` 라우트

기존 `/api/auth/*` 라우트들과 같은 자리, 같은 인증 패턴(`verifySession(cookies?.[SESSION_COOKIE_NAME])`, 실패 시 401):

- `POST /api/friends/request` — body `{ nickname }`. `findUserByNickname` → 없으면 404. 있으면 `sendFriendRequest` 호출, 결과에 따라 메시지 다르게 응답(`"already_pending"`/`"already_friends"`/`"self"`는 409, `"sent"`/`"auto_accepted"`는 200).
- `POST /api/friends/:id/accept` — `respondToRequest(id, userId, true)`.
- `POST /api/friends/:id/decline` — `respondToRequest(id, userId, false)`.
- `POST /api/friends/:id/cancel` — `cancelRequest(id, userId)`.
- `DELETE /api/friends/:id` — `removeFriend(userId, id)`.
- `GET /api/friends` — `listFriends(userId)` 각 항목에 `isUserOnline(userId)` 붙여서 반환: `{ friendshipId, userId, nickname, online, lastLoginAt }[]`.
- `GET /api/friends/requests` — `listReceivedRequests(userId)`.
- `GET /api/friends/sent` — `listSentRequests(userId)`.

전부 로그인 필요(401 if not authed) — admin 권한 불필요.

## 클라이언트

### `client/src/game/formatLastSeen.ts` (신규)

```ts
// lastLoginAt: DB에서 온 "YYYY-MM-DD HH:MM:SS"(KST, UTC 오프셋 없이 이미 +9시간 적용된 문자열
// — server/src/db/connection.ts의 datetime('now', '+9 hours') 컨벤션과 동일). 이 프로젝트는
// 지금까지 이 문자열을 파싱한 적이 없고 그냥 원문 그대로 보여주기만 했음(AdminUsers.tsx가
// {user.createdAt}처럼 raw string 표시) — 상대 시간 계산은 이번이 처음이라 새로 주의 필요.
// SQLite datetime()의 공백 구분 형식은 브라우저마다 Date 파싱이 일관되지 않을 수 있어서,
// 공백을 "T"로 바꾸고 KST 오프셋을 붙여 표준 ISO 8601로 만든 뒤 파싱한다.
export function formatLastSeen(lastLoginAt: string | null): string {
  if (!lastLoginAt) return "접속 기록 없음";
  const diffMs = Date.now() - new Date(`${lastLoginAt.replace(" ", "T")}+09:00`).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "방금 전 접속";
  if (minutes < 60) return `${minutes}분 전 접속`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전 접속`;
  const days = Math.floor(hours / 24);
  return `${days}일 전 접속`;
}
```

### `client/src/components/FriendsModal.tsx` (신규)

`RankingModal.tsx`/`InquiryModal.tsx`와 같은 오버레이+모달 구조. 3개 섹션(탭이 아니라 세로로 다 보이는 형태 — 항목 수가 적을 걸로 예상돼 탭 전환 없이):

1. **상단**: 닉네임 입력 + "요청 보내기" 버튼. 성공/실패 메시지를 인라인으로.
2. **받은 요청**: 각 항목에 닉네임 + "수락"/"거절" 버튼.
3. **보낸 요청**: 각 항목에 닉네임 + "취소" 버튼.
4. **친구 목록**: 각 항목에 닉네임 + (🟢 온라인 또는 `formatLastSeen` 결과) + "삭제" 버튼.

모달이 열릴 때 4개 목록(`GET /api/friends`, `/api/friends/requests`, `/api/friends/sent`)을 한 번에 불러오고, 액션(수락/거절/취소/삭제/요청) 성공할 때마다 해당 목록만 다시 불러온다(전체 재조회 대신 — 기존 컴포넌트들 패턴과 동일하게 액션 성공 후 로컬 상태 갱신).

### `client/src/components/RoomList.tsx` 변경

기존 "방 만들기"/"랭킹" 버튼 옆에 **"친구"** 버튼 추가. `RoomList`가 마운트될 때(기존 `/api/rooms` 폴링 `useEffect`와는 별개의 `useEffect`) `GET /api/friends/requests`를 한 번 호출해서 배지 숫자로 표시(`받은 요청.length > 0`이면 버튼에 작은 빨간 숫자 배지). 모달을 닫을 때도 다시 조회해서 배지 갱신(모달 안에서 수락/거절해서 숫자가 바뀔 수 있으므로).

## 테스트

**정정(스펙 자체 검토 중 발견):** 이 프로젝트에는 `createServer.ts`의 Express 라우트를 HTTP 레벨로 테스트하는 기존 패턴 자체가 없다(`server/src/**/*.test.ts` 전체를 확인함 — `admin/auth.test.ts`, `auth/googleAuth.test.ts` 등 전부 라우트가 아니라 그 아래 순수 데이터 함수를 직접 호출해서 테스트함). 그래서 `/api/friends/*` 라우트도 기존 관행을 그대로 따른다:

- `server/src/friends/friendships.test.ts`를 `server/src/auth/googleAuth.test.ts`와 정확히 같은 패턴으로 작성 — `db`(`../db/connection`에서 import)를 직접 쓰고, `beforeEach`에서 `db.exec("DELETE FROM friendships")`(및 필요시 `users`)로 초기화한 뒤 `friendships.ts`의 함수들을 직접 호출해서 검증. HTTP 계층은 거치지 않음.
- `createServer.ts`의 라우트 자체(요청 바디 파싱, 상태 코드 매핑)는 이 프로젝트의 다른 라우트들과 마찬가지로 **자동화 테스트 없이 브라우저로 직접 검증**한다 — 새 관행을 만드는 게 아니라 기존 공백을 그대로 따르는 것.

`friendships.test.ts`가 커버할 케이스:
- 요청 보내기 → 상대 목록에 받은 요청으로 뜸
- 수락 → 양쪽 친구 목록에 서로 나타남
- 거절 → 요청 사라짐, 재요청 가능
- 취소 → 보낸 요청 사라짐
- 동시 상호 요청 → 자동 수락(새 row 안 생기고 기존 row가 accepted로)
- 자기 자신에게 요청 → 거부
- 이미 친구/이미 pending인데 재요청 → 거부
- 삭제 → 양쪽 목록에서 사라짐, 재요청으로 처음부터 다시 가능
- 다른 사람의 요청을 수락/거절/취소하려는 시도 → 거부(소유권 체크)

`isUserOnline`(새 헬퍼, `friendships.ts`가 아니라 `presence.ts` 소속)은 이미 존재하는 `server/src/admin/presence.test.ts`에 테스트 추가(같은 파일의 `getOnlineUsers` 테스트들과 같은 패턴 — `touchPresence` 호출 후 확인). `GET /api/friends` 라우트가 `listFriends` + `isUserOnline`을 실제로 합쳐서 응답하는지는 두 함수 각각의 단위 테스트로 커버되는 조합이라 별도 통합 테스트 없이, 브라우저 검증 때 온라인 친구 옆에 🟢가 뜨는지로 같이 확인.

클라이언트는 이 프로젝트 컨벤션대로 브라우저 직접 검증(테스트 프레임워크 없음) — 두 계정으로 요청→수락→목록 확인까지 실제로 눌러봄.
