# 닉네임 특수효과(레인보우/글로우) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 관리자가 `/admin`에서 유저별로 레인보우(움직이는 그라데이션)/글로우(닉네임 자기 색 기준 빛 효과) 두 특수효과를 켜고 끌 수 있게 하고, 색이 이미 적용되던 모든 화면 + 이번에 색 자체를 새로 추가하는 친구창/관전자 목록에 반영한다.

**Architecture:** `users` 테이블에 boolean 컬럼 2개(`nickname_rainbow`/`nickname_glow`) 추가, 기존 `setNicknameColor`와 나란히 `setNicknameEffects` 추가. 인게임 실시간 데이터는 Colyseus state로, 나머지는 REST 응답으로 흐른다. 클라이언트는 공용 헬퍼 `nicknameStyle(color, rainbow, glow)` 하나로 모든 화면의 스타일 계산을 통일한다.

**Tech Stack:** Node.js/TypeScript, better-sqlite3(동기 DB), Colyseus, React, vitest.

## Global Constraints

- 지급 방식: 관리자가 `/admin`에서 체크박스로 즉시 켜고 끔 — 별도 저장 버튼 없음, 형식 검증 없음(boolean이라 실패 케이스 없음). 상점/자동 지급 없음(이번 스코프).
- **레인보우**: 움직이는 그라데이션. 지정된 `nicknameColor`를 무시하고 덮어씀(배타적).
- **글로우**: 닉네임 자기 색(`nicknameColor`) 기준 `text-shadow`. 레인보우와 독립적 on/off, 동시에 켤 수 있음. 색이 없거나 레인보우가 켜져 있으면(대표색 없음) 흰색(`#ffffff`)으로 대체.
- 적용 범위: 인게임 팀 로스터, 대기실 로스터/대기 목록, 인게임+대기실+1:1 채팅, 랭킹, 프로필 팝업, 관리자 유저 목록(색이 이미 있던 곳) + 관전자 목록, 친구창 3개 탭(이번에 색 자체를 새로 추가하는 곳).
- 혼자 연습 모드는 서버 API를 안 타므로 대상 아님(손댈 코드 없음).
- 새 DB 컬럼은 `CREATE TABLE` + `ALTER TABLE ADD COLUMN` 가드 이중 정의 패턴.
- SQLite `INTEGER`(0/1)를 읽는 모든 곳에서 `sqliteBool()`로 명시적으로 실제 `boolean`으로 변환한다 — 그냥 캐스팅해서 숫자가 boolean인 척 흘러가지 않게.
- 참고 스펙 문서: `docs/superpowers/specs/2026-07-29-nickname-effects-design.md`(모든 코드 변경의 정확한 내용은 이 문서를 그대로 따른다 — 아래 각 태스크는 그 문서의 어느 섹션에 해당하는지와 실행 순서/테스트만 정리한 것).

---

### Task 1: DB 스키마 + 유저 데이터 계층 (서버)

**Files:**
- Modify: `server/src/db/connection.ts`
- Modify: `server/src/auth/googleAuth.ts`
- Modify: `server/src/auth/googleAuth.test.ts`

**Interfaces:**
- Produces: `sqliteBool(value: number): boolean` (from `server/src/db/connection.ts`, exported alongside `db`). `UserProfile.nicknameRainbow: boolean`, `UserProfile.nicknameGlow: boolean`. `setNicknameEffects(userId: number, effects: { rainbow: boolean; glow: boolean }): void`. `AdminUserRow.nicknameRainbow/nicknameGlow: boolean`. `RankingEntry.nicknameRainbow/nicknameGlow: boolean`. 이후 모든 태스크가 이 타입/함수들을 그대로 가져다 쓴다.

- [ ] **Step 1: 스펙 문서의 `server/src/db/connection.ts` 변경 섹션 그대로 적용**

`docs/superpowers/specs/2026-07-29-nickname-effects-design.md`의 "`server/src/db/connection.ts` 변경" 섹션을 읽고 그대로 적용한다 — `CREATE TABLE`에 컬럼 2개 추가, `ALTER TABLE ADD COLUMN` 가드 2개 추가, `sqliteBool` 함수 추가.

- [ ] **Step 2: 스펙 문서의 `server/src/auth/googleAuth.ts` 변경 섹션 그대로 적용**

같은 스펙 문서의 "`server/src/auth/googleAuth.ts` 변경" 섹션을 그대로 적용한다 — import에 `sqliteBool` 추가, `UserProfile` 타입, `getOrCreateUser`/`getUserById`(boolean 변환 포함), `setNicknameEffects`, `AdminUserRow`, `listUsers`(boolean 변환 포함), `RankingEntry`, `getTopRanking`(boolean 변환 포함).

- [ ] **Step 3: 기존에 깨지는 테스트 3개 수정**

`getTopRanking`이 반환하는 객체 모양이 필드 2개만큼 늘어나서, 정확한 모양을 통째로 비교(`toEqual`)하던 기존 테스트 3개가 그대로 두면 실패한다. `server/src/auth/googleAuth.test.ts`에서 다음 3곳을 고친다:

`describe("recordRoundAchievement", ...)` 안, 기존(146-152번째 줄 부근):

```ts
  test("raises max_round when the new round is higher", () => {
    const user = getOrCreateUser("sub-14", {});
    recordRoundAchievement(user.id, 3);
    recordRoundAchievement(user.id, 7);
    expect(getTopRanking(10)).toEqual([]); // no nickname yet, excluded from ranking
    setNickname(user.id, "달리기");
    expect(getTopRanking(10)).toEqual([{ nickname: "달리기", nicknameColor: null, maxRound: 7 }]);
  });

  test("never lowers an existing max_round", () => {
    const user = getOrCreateUser("sub-15", {});
    setNickname(user.id, "버티기");
    recordRoundAchievement(user.id, 9);
    recordRoundAchievement(user.id, 2);
    expect(getTopRanking(10)).toEqual([{ nickname: "버티기", nicknameColor: null, maxRound: 9 }]);
  });
```

변경(두 곳의 `toEqual` 기대값에 새 필드 2개씩 추가):

```ts
  test("raises max_round when the new round is higher", () => {
    const user = getOrCreateUser("sub-14", {});
    recordRoundAchievement(user.id, 3);
    recordRoundAchievement(user.id, 7);
    expect(getTopRanking(10)).toEqual([]); // no nickname yet, excluded from ranking
    setNickname(user.id, "달리기");
    expect(getTopRanking(10)).toEqual([
      { nickname: "달리기", nicknameColor: null, nicknameRainbow: false, nicknameGlow: false, maxRound: 7 },
    ]);
  });

  test("never lowers an existing max_round", () => {
    const user = getOrCreateUser("sub-15", {});
    setNickname(user.id, "버티기");
    recordRoundAchievement(user.id, 9);
    recordRoundAchievement(user.id, 2);
    expect(getTopRanking(10)).toEqual([
      { nickname: "버티기", nicknameColor: null, nicknameRainbow: false, nicknameGlow: false, maxRound: 9 },
    ]);
  });
```

`describe("setNicknameColor", ...)` 안, 기존:

```ts
  test("reflects the color in listUsers and getTopRanking", () => {
    const user = getOrCreateUser("sub-23", {});
    setNickname(user.id, "색깔유저");
    recordRoundAchievement(user.id, 4);
    setNicknameColor(user.id, "#00ff00");

    expect(listUsers().find((u) => u.id === user.id)?.nicknameColor).toBe("#00ff00");
    expect(getTopRanking(10)).toEqual([{ nickname: "색깔유저", nicknameColor: "#00ff00", maxRound: 4 }]);
  });
```

변경:

```ts
  test("reflects the color in listUsers and getTopRanking", () => {
    const user = getOrCreateUser("sub-23", {});
    setNickname(user.id, "색깔유저");
    recordRoundAchievement(user.id, 4);
    setNicknameColor(user.id, "#00ff00");

    expect(listUsers().find((u) => u.id === user.id)?.nicknameColor).toBe("#00ff00");
    expect(getTopRanking(10)).toEqual([
      { nickname: "색깔유저", nicknameColor: "#00ff00", nicknameRainbow: false, nicknameGlow: false, maxRound: 4 },
    ]);
  });
```

- [ ] **Step 4: import에 `setNicknameEffects` 추가**

파일 상단의 `./googleAuth` import 문, 기존:

```ts
import {
  adminSetNickname,
  getOrCreateUser,
  getTopRanking,
  getUserById,
  listUsers,
  recordRolePlayed,
  recordRoundAchievement,
  setNickname,
  setNicknameColor,
  setUserBanned,
  touchLastLogin,
} from "./googleAuth";
```

변경(`setNicknameEffects` 추가, `addGameMoney`가 이미 있다면 그것도 유지):

```ts
import {
  adminSetNickname,
  getOrCreateUser,
  getTopRanking,
  getUserById,
  listUsers,
  recordRolePlayed,
  recordRoundAchievement,
  setNickname,
  setNicknameColor,
  setNicknameEffects,
  setUserBanned,
  touchLastLogin,
} from "./googleAuth";
```

(파일에 이미 `addGameMoney` 등 다른 import가 있다면 그대로 두고 `setNicknameEffects`만 알파벳 순서에 맞게 끼워 넣는다 — 정확한 나머지 목록은 파일을 열어서 확인할 것.)

- [ ] **Step 5: `setNicknameEffects`용 새 테스트 작성**

`describe("setNicknameColor", ...)` 블록이 끝나는 지점과 `describe("setUserBanned", ...)` 블록 사이에 새 블록 추가:

```ts
describe("setNicknameEffects", () => {
  beforeEach(() => {
    db.exec("DELETE FROM users");
  });

  test("turns rainbow and glow on independently", () => {
    const user = getOrCreateUser("sub-effects-1", {});
    setNicknameEffects(user.id, { rainbow: true, glow: false });

    const profile = getUserById(user.id);
    expect(profile?.nicknameRainbow).toBe(true);
    expect(profile?.nicknameGlow).toBe(false);
  });

  test("turns them back off", () => {
    const user = getOrCreateUser("sub-effects-2", {});
    setNicknameEffects(user.id, { rainbow: true, glow: true });
    setNicknameEffects(user.id, { rainbow: false, glow: false });

    const profile = getUserById(user.id);
    expect(profile?.nicknameRainbow).toBe(false);
    expect(profile?.nicknameGlow).toBe(false);
  });

  test("getUserById returns real booleans, not 0/1 numbers", () => {
    const user = getOrCreateUser("sub-effects-3", {});
    setNicknameEffects(user.id, { rainbow: true, glow: true });

    const profile = getUserById(user.id);
    expect(typeof profile?.nicknameRainbow).toBe("boolean");
    expect(typeof profile?.nicknameGlow).toBe("boolean");
  });
});
```

- [ ] **Step 6: 테스트 실행**

Run: `cd server && npx vitest run src/auth/googleAuth.test.ts`
Expected: PASS — 새 테스트 3개 포함, Step 3에서 고친 기존 테스트도 전부 PASS.

- [ ] **Step 7: 타입체크**

Run: `cd server && npm run build`
Expected: 에러 없음

- [ ] **Step 8: 커밋**

```bash
git add server/src/db/connection.ts server/src/auth/googleAuth.ts server/src/auth/googleAuth.test.ts
git commit -m "닉네임 레인보우/글로우 컬럼과 데이터 계층(setNicknameEffects) 추가"
```

---

### Task 2: 친구/1:1채팅 데이터 계층 (서버)

**Files:**
- Modify: `server/src/friends/friendships.ts`
- Modify: `server/src/friends/friendships.test.ts`
- Modify: `server/src/chat/directMessages.ts`

**Interfaces:**
- Consumes: Task 1의 `sqliteBool(value: number): boolean` (from `../db/connection`).
- Produces: `FriendListEntry`/`ReceivedRequestEntry`/`SentRequestEntry`/`DirectMessageEntry`에 색+효과 필드 추가(정확한 필드명은 스펙 문서 참고 — `nicknameColor`/`nicknameRainbow`/`nicknameGlow`, `fromNickname*`, `toNickname*`, `senderNickname*` 접두사 패턴).

- [ ] **Step 1: 스펙 문서의 `server/src/friends/friendships.ts` 변경 섹션 그대로 적용**

`docs/superpowers/specs/2026-07-29-nickname-effects-design.md`의 "`server/src/friends/friendships.ts` 변경" 섹션을 그대로 적용한다 — import에 `sqliteBool` 추가, `FriendListEntry`/`listFriends`, `ReceivedRequestEntry`/`listReceivedRequests`, `SentRequestEntry`/`listSentRequests` 전부.

- [ ] **Step 2: 스펙 문서의 `server/src/chat/directMessages.ts` 변경 섹션 그대로 적용**

같은 스펙 문서의 "`server/src/chat/directMessages.ts` 변경" 섹션을 그대로 적용한다.

- [ ] **Step 3: 기존에 깨지는 테스트 3곳 수정**

`listFriends`/`listReceivedRequests`/`listSentRequests`가 반환하는 객체 모양이 늘어나서, 정확한 모양을 비교하던 기존 테스트가 그대로 두면 실패한다. `server/src/friends/friendships.test.ts`에서 다음을 고친다.

기존(186-195번째 줄 부근):

```ts
  test("listFriends returns the OTHER person's info for each accepted friendship", () => {
    const a = makeUser("sub-a", "에이");
    const b = makeUser("sub-b", "비");
    sendFriendRequest(a, b);
    const id = getFriendshipId(a, b);
    respondToRequest(id, b, true);

    expect(listFriends(a)).toEqual([{ friendshipId: id, userId: b, nickname: "비", lastLoginAt: expect.any(String) }]);
    expect(listFriends(b)).toEqual([{ friendshipId: id, userId: a, nickname: "에이", lastLoginAt: expect.any(String) }]);
  });

  test("listReceivedRequests only shows pending requests addressed to me", () => {
    const a = makeUser("sub-a", "에이");
    const b = makeUser("sub-b", "비");
    sendFriendRequest(a, b);

    expect(listReceivedRequests(b)).toEqual([
      { requestId: getFriendshipId(a, b), fromUserId: a, fromNickname: "에이", createdAt: expect.any(String) },
    ]);
    expect(listReceivedRequests(a)).toEqual([]);
  });

  test("listSentRequests only shows my own pending outgoing requests", () => {
    const a = makeUser("sub-a", "에이");
    const b = makeUser("sub-b", "비");
    sendFriendRequest(a, b);

    expect(listSentRequests(a)).toEqual([
      { requestId: getFriendshipId(a, b), toUserId: b, toNickname: "비", createdAt: expect.any(String) },
    ]);
```

변경(각 기대값에 색+효과 필드 추가 — 새로 만든 유저는 전부 기본값: 색 `null`, 효과 `false`):

```ts
  test("listFriends returns the OTHER person's info for each accepted friendship", () => {
    const a = makeUser("sub-a", "에이");
    const b = makeUser("sub-b", "비");
    sendFriendRequest(a, b);
    const id = getFriendshipId(a, b);
    respondToRequest(id, b, true);

    expect(listFriends(a)).toEqual([
      {
        friendshipId: id,
        userId: b,
        nickname: "비",
        lastLoginAt: expect.any(String),
        nicknameColor: null,
        nicknameRainbow: false,
        nicknameGlow: false,
      },
    ]);
    expect(listFriends(b)).toEqual([
      {
        friendshipId: id,
        userId: a,
        nickname: "에이",
        lastLoginAt: expect.any(String),
        nicknameColor: null,
        nicknameRainbow: false,
        nicknameGlow: false,
      },
    ]);
  });

  test("listReceivedRequests only shows pending requests addressed to me", () => {
    const a = makeUser("sub-a", "에이");
    const b = makeUser("sub-b", "비");
    sendFriendRequest(a, b);

    expect(listReceivedRequests(b)).toEqual([
      {
        requestId: getFriendshipId(a, b),
        fromUserId: a,
        fromNickname: "에이",
        createdAt: expect.any(String),
        fromNicknameColor: null,
        fromNicknameRainbow: false,
        fromNicknameGlow: false,
      },
    ]);
    expect(listReceivedRequests(a)).toEqual([]);
  });

  test("listSentRequests only shows my own pending outgoing requests", () => {
    const a = makeUser("sub-a", "에이");
    const b = makeUser("sub-b", "비");
    sendFriendRequest(a, b);

    expect(listSentRequests(a)).toEqual([
      {
        requestId: getFriendshipId(a, b),
        toUserId: b,
        toNickname: "비",
        createdAt: expect.any(String),
        toNicknameColor: null,
        toNicknameRainbow: false,
        toNicknameGlow: false,
      },
    ]);
```

(이 세 번째 테스트의 나머지 줄 — `expect(listSentRequests(b)).toEqual([]);` 등 — 은 그대로 둔다.)

- [ ] **Step 4: 테스트 실행**

Run: `cd server && npx vitest run src/friends/friendships.test.ts src/chat/directMessages.test.ts`
Expected: PASS — Step 3에서 고친 3개 테스트 포함 전부 PASS. (`directMessages.test.ts`는 `senderNickname` 등을 개별 프로퍼티로만 비교하는 스타일이라 이번 변경으로 깨지는 기존 테스트는 없음 — 새로 추가한 필드에 대한 실패 없이 그대로 통과해야 정상.)

- [ ] **Step 5: 타입체크**

Run: `cd server && npm run build`
Expected: 에러 없음

- [ ] **Step 6: 커밋**

```bash
git add server/src/friends/friendships.ts server/src/friends/friendships.test.ts server/src/chat/directMessages.ts
git commit -m "친구/1:1채팅 목록에 닉네임 색+효과 필드 추가"
```

---

### Task 3: 관리자 API + UI

**Files:**
- Modify: `server/src/createServer.ts`
- Modify: `client/src/components/AdminUsers.tsx`
- Modify: `client/src/components/AdminUsers.module.css`

**Interfaces:**
- Consumes: Task 1의 `setNicknameEffects(userId, {rainbow, glow}): void`, `AdminUserRow.nicknameRainbow/nicknameGlow: boolean`.

- [ ] **Step 1: 스펙 문서의 `server/src/createServer.ts` 변경 중 관리자 라우트 부분 적용**

`docs/superpowers/specs/2026-07-29-nickname-effects-design.md`의 "`server/src/createServer.ts` 변경" 섹션에서 새 import(`setNicknameEffects`)와 `POST /api/admin/users/:id/nickname-effects` 라우트를 그대로 적용한다. (`GET /api/profile/:nickname` 응답 변경은 이번 태스크 범위가 아님 — Task 6에서 함께 다룬다. `GET /api/admin/users`는 `listUsers()`를 그대로 반환하는 구조라 Task 1에서 이미 필드가 자동으로 실려 나가므로 이 라우트 자체는 손댈 코드 없음.)

- [ ] **Step 2: 스펙 문서의 `client/src/components/AdminUsers.tsx` 변경 섹션 그대로 적용**

같은 스펙 문서의 "`client/src/components/AdminUsers.tsx` 변경" 섹션을 그대로 적용한다 — `UserRow` 타입, `toggleEffect` 함수, 테이블 헤더에 "효과" 컬럼, 색상 `<td>` 뒤에 체크박스 2개짜리 `<td>` 추가.

- [ ] **Step 3: `AdminUsers.module.css`에 `.effectLabel` 클래스 추가**

같은 스펙 문서에 있는 `.effectLabel` 클래스를 파일 끝에 추가한다.

- [ ] **Step 4: 서버 타입체크**

Run: `cd server && npm run build`
Expected: 에러 없음

- [ ] **Step 5: 클라이언트 빌드 + server/public 동기화**

Run(프로젝트 루트에서): `npm run sync-public`
Expected: 타입 에러 없이 빌드 성공

- [ ] **Step 6: 브라우저로 실제 검증**

1. `cd server && npm run dev`
2. `/admin`에 관리자 비밀번호로 로그인, 유저 정보 페이지로 이동
3. 아무 유저나 골라 "효과" 컬럼의 레인보우/글로우 체크박스를 각각 켜고 끄면서 즉시 반영되는지 확인(새로고침 없이 체크 상태 유지, `loadUsers()` 재호출로 최신값 반영)
4. 서버 재시작 후에도 체크 상태가 유지되는지(DB에 저장됐는지) 확인

Expected: 체크/해제가 즉시 반영되고 재시작 후에도 유지됨.

- [ ] **Step 7: 커밋**

```bash
git add server/src/createServer.ts client/src/components/AdminUsers.tsx client/src/components/AdminUsers.module.css
git commit -m "관리자 페이지에 닉네임 레인보우/글로우 지급 UI 추가"
```

---

### Task 4: Colyseus 스키마 + MatchRoom 실시간 배선

**Files:**
- Modify: `server/src/rooms/MatchState.ts`
- Modify: `server/src/rooms/MatchRoom.ts`
- Modify: `server/src/rooms/MatchRoom.test.ts`

**Interfaces:**
- Consumes: Task 1의 `UserProfile.nicknameRainbow/nicknameGlow: boolean` (via `getUserById`, `onAuth`에서 사용).
- Produces: `PlayerState.nicknameRainbow/nicknameGlow: boolean`, `SpectatorState.nicknameRainbow/nicknameGlow: boolean`, `ChatMessage.nicknameRainbow/nicknameGlow: boolean` — Task 5가 클라이언트에서 이 필드들을 읽는다.

- [ ] **Step 1: 스펙 문서의 `server/src/rooms/MatchState.ts` 변경 섹션 그대로 적용**

`docs/superpowers/specs/2026-07-29-nickname-effects-design.md`의 "`server/src/rooms/MatchState.ts` 변경" 섹션을 그대로 적용한다 — `PlayerState`/`ChatMessage`/`SpectatorState` 세 클래스 전부.

- [ ] **Step 2: 스펙 문서의 `server/src/rooms/MatchRoom.ts` 변경 섹션 그대로 적용**

같은 문서의 "`server/src/rooms/MatchRoom.ts` 변경" 섹션을 그대로 적용한다 — `onAuth` 반환문, `onJoin`의 관전자/플레이어 분기, `handleSendChat`과 `pushChat`(시그니처 확장 + 호출부 2곳).

- [ ] **Step 3: `MatchRoom.test.ts`의 `connectAsUser` 헬퍼 확장**

기존(파일 상단 부근, 99-115번째 줄):

```ts
async function connectAsUser(
  colyseus: ColyseusTestServer,
  room: ServerRoom<MatchState>,
  nickname: string,
  nicknameColor?: string,
) {
  testUserCounter += 1;
  const user = getOrCreateUser(`test-google-sub-${testUserCounter}`, {});
  setNickname(user.id, nickname);
  if (nicknameColor) setNicknameColor(user.id, nicknameColor);
  const token = signSession(user.id);
  const port = (colyseus.server as unknown as { port: number }).port;
  const client = new ColyseusJsClient(`ws://127.0.0.1:${port}`, {
    headers: { Cookie: `session=${token}` },
  });
  return client.joinById<MatchState>(room.roomId);
}
```

변경(5번째 파라미터로 효과 추가):

```ts
async function connectAsUser(
  colyseus: ColyseusTestServer,
  room: ServerRoom<MatchState>,
  nickname: string,
  nicknameColor?: string,
  nicknameEffects?: { rainbow?: boolean; glow?: boolean },
) {
  testUserCounter += 1;
  const user = getOrCreateUser(`test-google-sub-${testUserCounter}`, {});
  setNickname(user.id, nickname);
  if (nicknameColor) setNicknameColor(user.id, nicknameColor);
  if (nicknameEffects) {
    setNicknameEffects(user.id, {
      rainbow: nicknameEffects.rainbow ?? false,
      glow: nicknameEffects.glow ?? false,
    });
  }
  const token = signSession(user.id);
  const port = (colyseus.server as unknown as { port: number }).port;
  const client = new ColyseusJsClient(`ws://127.0.0.1:${port}`, {
    headers: { Cookie: `session=${token}` },
  });
  return client.joinById<MatchState>(room.roomId);
}
```

파일 상단 import, 기존:

```ts
import { getOrCreateUser, setNickname, setNicknameColor, setUserBanned } from "../auth/googleAuth";
```

변경:

```ts
import { getOrCreateUser, setNickname, setNicknameColor, setNicknameEffects, setUserBanned } from "../auth/googleAuth";
```

- [ ] **Step 4: 새 테스트 작성 — `"nickname color propagation"` 블록 바로 뒤에 추가**

```ts
  describe("nickname rainbow/glow propagation", () => {
    test("a player with rainbow/glow enabled has it reflected in PlayerState", async () => {
      const room = await colyseus.createRoom<MatchState>("match");
      const client = await connectAsUser(colyseus, room, "레인보우돼지", undefined, { rainbow: true, glow: true });
      await flush();

      const player = room.state.players.get(client.sessionId);
      expect(player?.nicknameRainbow).toBe(true);
      expect(player?.nicknameGlow).toBe(true);
    });

    test("a player with neither enabled has both false, not undefined", async () => {
      const room = await colyseus.createRoom<MatchState>("match");
      const client = await connectAsUser(colyseus, room, "평범플레이어");
      await flush();

      const player = room.state.players.get(client.sessionId);
      expect(player?.nicknameRainbow).toBe(false);
      expect(player?.nicknameGlow).toBe(false);
    });

    test("a chat message from a rainbow/glow player carries the same flags", async () => {
      const room = await colyseus.createRoom<MatchState>("match");
      const client = await connectAsUser(colyseus, room, "채팅효과", undefined, { rainbow: true, glow: false });
      client.send("sendChat", { text: "안녕" });
      await flush();

      const message = room.state.lobbyChat.find((m) => m.text === "안녕");
      expect(message?.nicknameRainbow).toBe(true);
      expect(message?.nicknameGlow).toBe(false);
    });

    test("a spectator with glow enabled has it reflected in SpectatorState, and in their chat messages", async () => {
      const { room } = await fillRolesAndStart();
      const spectatorClient = await connectAsUser(colyseus, room, "관전효과", undefined, { glow: true });
      await flush();

      expect(room.state.spectators.get(spectatorClient.sessionId)?.nicknameGlow).toBe(true);

      spectatorClient.send("sendChat", { text: "구경중" });
      await flush();

      const message = room.state.matchChat.find((m) => m.text === "구경중");
      expect(message?.nicknameGlow).toBe(true);
    });
  });
```

- [ ] **Step 5: 테스트 실행 (포커스)**

Run: `cd server && npx vitest run src/rooms/MatchRoom.test.ts -t "rainbow/glow"`
Expected: PASS — 새 테스트 4개 전부.

- [ ] **Step 6: 전체 스위트 실행**

Run: `cd server && npx vitest run src/rooms/MatchRoom.test.ts`
Expected: PASS — 기존 전체 테스트(100개 이상)도 그대로 PASS. 이 파일은 실제 타이머를 쓰는 통합 테스트라 수 분 걸릴 수 있음 — 정상.

- [ ] **Step 7: 타입체크**

Run: `cd server && npm run build`
Expected: 에러 없음

- [ ] **Step 8: 커밋**

```bash
git add server/src/rooms/MatchState.ts server/src/rooms/MatchRoom.ts server/src/rooms/MatchRoom.test.ts
git commit -m "인게임 실시간 상태(로스터/채팅/관전자)에 닉네임 레인보우/글로우 전파"
```

---

### Task 5: 공용 클라이언트 헬퍼 + 인게임 화면 배선

**Files:**
- Create: `client/src/game/nicknameStyle.ts`
- Create: `client/src/game/nicknameStyle.module.css`
- Modify: `client/src/game/matchTypes.ts`
- Modify: `client/src/components/RoleSelect.tsx`
- Modify: `client/src/components/TeamRosterPanel.tsx`
- Modify: `client/src/components/ChatBox.tsx`

**Interfaces:**
- Consumes: Task 4의 Colyseus state 필드(`PlayerState`/`SpectatorState`/`ChatMessage`의 `nicknameRainbow`/`nicknameGlow`).
- Produces: `nicknameStyle(color: string | null | undefined, rainbow: boolean | undefined, glow: boolean | undefined): { className: string; style: CSSProperties }` (from `client/src/game/nicknameStyle.ts`) — Task 6, Task 7이 그대로 가져다 쓴다.

- [ ] **Step 1: 스펙 문서의 공용 헬퍼 섹션 그대로 적용**

`docs/superpowers/specs/2026-07-29-nickname-effects-design.md`의 "클라이언트 — 공용 헬퍼 (신규)" 섹션을 그대로 적용해 `nicknameStyle.ts`와 `nicknameStyle.module.css`를 만든다.

- [ ] **Step 2: `client/src/game/matchTypes.ts` 변경**

같은 문서의 "`client/src/game/matchTypes.ts`" 섹션을 그대로 적용한다 — `PlayerState`/`ChatMessage`/`SpectatorState` 세 인터페이스 전부.

- [ ] **Step 3: `client/src/components/ChatBox.tsx` 변경**

같은 문서의 "`client/src/components/ChatBox.tsx`" 섹션(블록 바디로 바꾼 `.map` 포함, 시스템 메시지 분기의 닫는 괄호 수정까지)을 그대로 적용한다.

- [ ] **Step 4: `client/src/components/TeamRosterPanel.tsx` 변경**

같은 문서의 "`client/src/components/TeamRosterPanel.tsx`" 섹션을 그대로 적용한다 — `Seat` 컴포넌트 props 확장 + `TeamRosterPanel` 본문의 두 `Seat` 호출부.

- [ ] **Step 5: `client/src/components/RoleSelect.tsx` 변경**

같은 문서의 "`client/src/components/RoleSelect.tsx`" 섹션을 그대로 적용한다 — `nicknameRainbowFor`/`nicknameGlowFor` 헬퍼 추가, "역할 선택 중" 대기 목록, 팀 로스터(블록 바디로 바꾼 `teams.map` 포함) 전부.

- [ ] **Step 6: 클라이언트 타입체크**

Run: `cd client && npx tsc -b`
Expected: 에러 없음

- [ ] **Step 7: 빌드 + server/public 동기화**

Run(프로젝트 루트에서): `npm run sync-public`
Expected: 빌드 성공

- [ ] **Step 8: 브라우저로 실제 검증**

1. Task 3에서 만든 관리자 UI로 테스트 계정 하나에 레인보우, 다른 하나에 글로우를 켠다(또는 DB에 직접 `UPDATE users SET nickname_rainbow = 1 WHERE id = ?` 등으로 세팅)
2. 두 계정으로 같은 방에 들어가 대기실 로스터, 채팅(입력해서 실제 전송), 인게임 팀 로스터(매치 시작 후)에서 각각 효과가 보이는지 확인
3. 레인보우 계정의 닉네임이 실제로 움직이는지(고정된 그림이 아닌지) 확인

Expected: 세 화면 모두에서 효과가 정확히 보임.

- [ ] **Step 9: 커밋**

```bash
git add client/src/game/nicknameStyle.ts client/src/game/nicknameStyle.module.css client/src/game/matchTypes.ts client/src/components/RoleSelect.tsx client/src/components/TeamRosterPanel.tsx client/src/components/ChatBox.tsx
git commit -m "공용 닉네임 스타일 헬퍼 추가 및 대기실/인게임 로스터·채팅에 배선"
```

---

### Task 6: 랭킹/프로필팝업 화면에 효과 추가

**Files:**
- Modify: `client/src/colyseus.ts`
- Modify: `client/src/game/profile.ts`
- Modify: `client/src/components/RankingModal.tsx`
- Modify: `client/src/components/ProfileModal.tsx`
- Modify: `server/src/createServer.ts` (프로필 라우트 응답만)

**Interfaces:**
- Consumes: Task 2의 서버 데이터(`getTopRanking`이 이미 반환하는 필드), Task 1의 `UserProfile.nicknameRainbow/nicknameGlow`(프로필 라우트가 `getUserById` 결과에서 가져다 씀), Task 5의 `nicknameStyle()`.

- [ ] **Step 1: `server/src/createServer.ts`의 `GET /api/profile/:nickname` 응답에 필드 추가**

스펙 문서의 "`server/src/createServer.ts` 변경" 섹션 중 `GET /api/profile/:nickname` 응답 부분만 적용한다(관리자 라우트는 Task 3에서 이미 끝남).

- [ ] **Step 2: `client/src/colyseus.ts`의 `RankingEntry` 변경**

스펙 문서의 "`client/src/colyseus.ts`" 섹션을 그대로 적용한다.

- [ ] **Step 3: `client/src/game/profile.ts`의 `PublicProfile` 변경**

스펙 문서의 "`client/src/game/profile.ts`" 섹션을 그대로 적용한다.

- [ ] **Step 4: `client/src/components/RankingModal.tsx` 변경**

스펙 문서의 "`client/src/components/RankingModal.tsx`" 섹션(블록 바디로 바꾼 `.map` 포함)을 그대로 적용한다.

- [ ] **Step 5: `client/src/components/ProfileModal.tsx` 변경**

스펙 문서의 "`client/src/components/ProfileModal.tsx`" 섹션(컴포넌트 본문에 `effect` 변수 추가 포함)을 그대로 적용한다.

- [ ] **Step 6: 서버 타입체크**

Run: `cd server && npm run build`
Expected: 에러 없음

- [ ] **Step 7: 클라이언트 빌드 + 동기화**

Run(프로젝트 루트에서): `npm run sync-public`
Expected: 빌드 성공

- [ ] **Step 8: 브라우저로 실제 검증**

1. 레인보우/글로우가 켜진 계정으로 라운드를 올려 랭킹에 오르게 한 뒤(또는 이미 랭킹에 있는 계정에 효과를 켠 뒤) 랭킹 화면에서 확인
2. 대기실/로스터에서 그 계정의 닉네임을 클릭해 프로필 팝업을 열어 효과가 보이는지 확인

Expected: 랭킹과 프로필 팝업 둘 다 효과가 정확히 보임.

- [ ] **Step 9: 커밋**

```bash
git add server/src/createServer.ts client/src/colyseus.ts client/src/game/profile.ts client/src/components/RankingModal.tsx client/src/components/ProfileModal.tsx
git commit -m "랭킹/프로필 팝업에 닉네임 레인보우/글로우 반영"
```

---

### Task 7: 친구창/관전자 목록에 색+효과 신규 추가

**Files:**
- Modify: `client/src/game/friends.ts`
- Modify: `client/src/game/chat.ts`
- Modify: `client/src/game/directMessageToChatMessage.ts`
- Modify: `client/src/components/FriendsModal.tsx`
- Modify: `client/src/components/SpectatorCountBadge.tsx`

**Interfaces:**
- Consumes: Task 2의 서버 데이터(`listFriends`/`listReceivedRequests`/`listSentRequests`/`getMessages`가 이미 반환하는 필드 — `GET /api/friends`/`GET /api/friends/requests`/`GET /api/friends/sent`/`GET /api/chat/:friendUserId/messages` 라우트는 결과를 그대로 스프레드/반환하는 구조라 서버 라우트 코드 변경 불필요, 스펙 문서의 해당 섹션에 이미 명시됨), Task 4의 Colyseus `SpectatorState` 필드, Task 5의 `nicknameStyle()`.

- [ ] **Step 1: `client/src/game/friends.ts` 변경**

스펙 문서의 "`client/src/game/friends.ts`" 섹션을 그대로 적용한다 — `FriendEntry`/`ReceivedRequestEntry`/`SentRequestEntry` 전부.

- [ ] **Step 2: `client/src/game/chat.ts`와 `client/src/game/directMessageToChatMessage.ts` 변경**

스펙 문서의 해당 두 섹션을 그대로 적용한다.

- [ ] **Step 3: `client/src/components/FriendsModal.tsx` 변경**

스펙 문서의 "`client/src/components/FriendsModal.tsx` (색 자체를 이번에 새로 추가, 3개 탭 전부)" 섹션을 그대로 적용한다 — 받은 요청/보낸 요청/친구 목록 세 `.map` 전부 블록 바디로.

- [ ] **Step 4: `client/src/components/SpectatorCountBadge.tsx` 변경**

스펙 문서의 "`client/src/components/SpectatorCountBadge.tsx` (색 자체를 이번에 새로 추가)" 섹션을 그대로 적용한다.

- [ ] **Step 5: 클라이언트 타입체크**

Run: `cd client && npx tsc -b`
Expected: 에러 없음

- [ ] **Step 6: 빌드 + 동기화**

Run(프로젝트 루트에서): `npm run sync-public`
Expected: 빌드 성공

- [ ] **Step 7: 브라우저로 실제 검증**

1. 레인보우/글로우가 켜진 계정과 친구를 맺어 친구창의 친구 목록/받은 요청/보낸 요청 3개 탭 전부에서 효과가 보이는지 확인(요청은 임시로 만들었다가 취소해도 됨)
2. 그 계정으로 다른 사람이 만든 방에 관전자로 들어가 관전자 목록에서 효과가 보이는지 확인
3. 1:1 친구 채팅을 열어 그 계정이 보낸 메시지에도 효과가 보이는지 확인

Expected: 세 곳 모두에서 색+효과가 정확히 보임(이 두 화면은 이번이 색 자체의 첫 적용이므로, 효과 없는 일반 계정은 그냥 무색으로 보이는지도 같이 확인).

- [ ] **Step 8: 커밋**

```bash
git add client/src/game/friends.ts client/src/game/chat.ts client/src/game/directMessageToChatMessage.ts client/src/components/FriendsModal.tsx client/src/components/SpectatorCountBadge.tsx
git commit -m "친구창/관전자 목록에 닉네임 색+레인보우/글로우 신규 추가"
```
