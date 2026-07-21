# 유저 밴 기능 설계

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:writing-plans to turn this spec into an implementation plan.

**Goal:** 관리자 페이지(`/admin`의 유저 정보 화면)에서 특정 유저를 밴/해제할 수 있게 한다. 밴된 유저는 즉시 강제 퇴장되고, 이후 온라인 매치에 새로 입장하거나 방을 만들 수 없게 된다(로그인 자체나 방 목록 열람은 막지 않음). 영구 밴만 지원(기간제 없음).

**Architecture:** `users` 테이블에 `banned_at` 컬럼을 추가해 밴 여부/시각을 기록한다. 차단은 `MatchRoom.onAuth`(로그인 세션 검증 직후, 이미 "닉네임 없으면 거부"를 하고 있는 바로 그 자리) 한 곳에서만 이루어진다 — 온라인 매치 입장/생성이라는 이 앱의 유일한 실질적 "행동"을 막으면 충분하기 때문. 밴 API는 여기에 더해 **현재 접속해 있는 세션을 즉시 끊는다** — Colyseus의 `matchMaker.getLocalRoomById`로 이 프로세스에 떠 있는 모든 "match" 룸의 실제 인스턴스를 찾아, 해당 유저의 클라이언트를 `client.leave()`로 서버 쪽에서 강제 종료시킨다.

**Tech Stack:** 서버 `server/src/db/connection.ts`(SQLite 마이그레이션), `server/src/auth/googleAuth.ts`, `server/src/rooms/MatchRoom.ts`, `server/src/createServer.ts`. 클라이언트 `client/src/components/AdminUsers.tsx`.

## Global Constraints

- **영구 밴만 지원** — 기간제(임시 밴)는 범위 밖.
- 밴은 **온라인 매치 입장/생성만** 차단한다. 로그인, 방 목록 열람은 막지 않는다.
- **밴하는 즉시 강제 퇴장** — 현재 어떤 방에 있든(플레이어든 관전자든) 그 방에서 바로 튕겨나간다.
- 밴 사유(reason) 입력 UI는 없음 — 단순 밴/해제 토글.
- 밴 상태는 관리자 유저 목록(`AdminUsers.tsx`)에서 행 단위로 토글하며, 밴된 행은 시각적으로 구분(흐리게 표시)한다.

## 서버 설계

### `server/src/db/connection.ts` — 마이그레이션

기존 `max_round` 컬럼과 동일한 `ALTER TABLE ADD COLUMN` 가드 패턴:

```ts
const hasBannedAt = (db.prepare(`PRAGMA table_info(users)`).all() as { name: string }[]).some(
  (col) => col.name === "banned_at",
);
if (!hasBannedAt) {
  db.exec(`ALTER TABLE users ADD COLUMN banned_at TEXT`);
}
```

`banned_at`은 `TEXT` (NULL = 정상, 값이 있으면 그 시각에 밴됨). 새 컬럼이라 `CREATE TABLE IF NOT EXISTS`의 초기 스키마에는 안 넣어도 되지만(이미 있는 다른 컬럼들처럼 신규 DB에도 이 ALTER가 그대로 한 번 실행되어 결과적으로 컬럼이 생김), 명확성을 위해 초기 `CREATE TABLE` 문에도 `banned_at TEXT`를 같이 넣는다.

### `server/src/auth/googleAuth.ts` — 타입/쿼리 확장

```ts
export type UserProfile = { id: number; nickname: string | null; bannedAt: string | null };
```

`getUserById`의 SELECT에 `banned_at AS bannedAt` 추가. `getOrCreateUser`의 마지막 SELECT도 동일하게 확장(밴된 유저가 재로그인 시도 시 `onAuth`가 즉시 걸러내야 하므로).

`AdminUserRow`에도 `bannedAt: string | null` 추가, `listUsers`의 SELECT에 `banned_at AS bannedAt` 추가.

신규 함수:

```ts
export function setUserBanned(userId: number, banned: boolean): void {
  if (banned) {
    db.prepare(`UPDATE users SET banned_at = datetime('now', '+9 hours') WHERE id = ?`).run(userId);
  } else {
    db.prepare(`UPDATE users SET banned_at = NULL WHERE id = ?`).run(userId);
  }
}
```

### `server/src/rooms/MatchRoom.ts` — 차단 + 강제 퇴장

**`onAuth`**: 기존 닉네임 체크 바로 다음 줄에 추가.

```ts
async onAuth(_client: Client, _options: MatchRoomOptions, context: AuthContext) {
  const token = getCookieValue(context.headers?.cookie, SESSION_COOKIE_NAME);
  const userId = verifySession(token);
  const user = userId ? getUserById(userId) : undefined;
  if (!user || !user.nickname) {
    throw new Error("로그인이 필요합니다.");
  }
  if (user.bannedAt) {
    throw new Error("이용이 제한된 계정입니다.");
  }
  return { ip: context.ip, userId: user.id, nickname: user.nickname };
}
```

기존에도 `onAuth`의 에러 메시지가 클라이언트 `errorMessage`로 그대로 전파되는 경로가 이미 있으므로(`useMatchRoom.ts`), 이 메시지도 별도 배선 없이 화면에 뜬다.

**신규 public 메서드 — 강제 퇴장용**:

```ts
kickUserId(userId: number): boolean {
  const client = this.clients.find((c) => c.auth?.userId === userId);
  if (!client) return false;
  client.leave();
  return true;
}
```

`this.clients`는 Colyseus가 관리하는, 이 방에 연결된 모든 클라이언트(플레이어+관전자 구분 없이)의 배열이다. `client.auth`는 `onAuth`가 반환한 값이 그대로 들어있으므로(플레이어든 관전자든 동일하게 `onAuth`를 거치므로) 역할과 무관하게 찾아진다. 매치를 찾아서 직접 `client.leave()`를 호출하는 것은 Colyseus 자체가 `_autoDisposeTimeout` 등에서 쓰는 표준적인 서버발 강제 종료 방식과 동일 — 호출되면 정상적으로 해당 방의 `onLeave`가 실행되어(플레이어면 절구/로스터 정리, 관전자면 즉시 제거) 기존 퇴장 로직을 그대로 탄다.

### `server/src/createServer.ts` — 라우트

```ts
app.post("/api/admin/users/:id/ban", requireAdmin, async (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId)) {
    res.status(400).json({ error: "invalid id" });
    return;
  }
  setUserBanned(userId, true);

  const rooms = await matchMaker.query({ name: "match" });
  for (const r of rooms) {
    const room = matchMaker.getLocalRoomById(r.roomId) as MatchRoom | undefined;
    room?.kickUserId(userId);
  }

  res.json({ ok: true });
});

app.post("/api/admin/users/:id/unban", requireAdmin, async (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId)) {
    res.status(400).json({ error: "invalid id" });
    return;
  }
  setUserBanned(userId, false);
  res.json({ ok: true });
});
```

`matchMaker.getRoomById`(반환값이 실제 방 인스턴스가 아니라 room listing 캐시)와 `matchMaker.getLocalRoomById`(실제 살아있는 `Room` 인스턴스, 이 프로세스에 있는 것만)는 다른 함수다 — 여기서는 후자가 필요하다. 이 프로젝트는 단일 프로세스 배포(AWS EC2 한 대, 다중 인스턴스 없음)라 "이 프로세스에 있는 것만"이라는 제약이 실질적인 문제가 되지 않는다.

## 클라이언트 설계 (`client/src/components/AdminUsers.tsx`)

`UserRow` 타입에 `bannedAt: string | null` 추가. 각 행의 액션 셀에 닉네임 수정 버튼과 나란히 밴/해제 버튼을 추가:

```tsx
<button
  className={styles.smallButton}
  onClick={() => toggleBan(user)}
  disabled={banningId === user.id}
>
  {user.bannedAt ? "밴 해제" : "밴"}
</button>
```

`toggleBan`은 `user.bannedAt`이 있으면 `/api/admin/users/${id}/unban`, 없으면 `/api/admin/users/${id}/ban`을 POST하고 `loadUsers()`로 새로고침 — 기존 `saveEdit`과 동일한 fetch/에러 처리 패턴(401이면 `onUnauthorized()`, 그 외 실패면 에러 메시지 표시).

밴된 행은 `styles.bannedRow`(투명도를 낮추는 CSS 한 줄)로 시각적으로 구분한다.

## 테스트

- `server/src/auth/googleAuth.test.ts`: `setUserBanned`로 밴/해제 후 `getUserById`/`listUsers`가 `bannedAt`을 정확히 반영하는지.
- `server/src/rooms/MatchRoom.test.ts`:
  - 밴된 유저의 `onAuth`가 "이용이 제한된 계정입니다"로 거부되는지(로그인은 되지만 방 입장은 안 되는 케이스).
  - `kickUserId`가 실제로 해당 유저의 클라이언트를 방에서 제거하는지(플레이어 케이스로 충분 — 관전자 케이스는 `client.auth` 조회 로직이 역할과 무관하므로 별도 테스트 없이 코드 리뷰로 충분).
  - `kickUserId`가 해당 유저가 그 방에 없으면(다른 방/미접속) `false`를 반환하고 아무 일도 안 하는지.
