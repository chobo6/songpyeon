# 닉네임 색 변경권 (게임머니 20,000원) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 유저가 게임머니 20,000원을 써서 자기 닉네임 색을 `#RRGGBB`(16^6가지) 중 균등 랜덤으로 재추첨할 수 있게 하고, 로비의 본인 닉네임에도 색/효과를 적용해 클릭하면 본인 프로필 팝업에서 그 재추첨을 할 수 있게 한다.

**Architecture:** 서버(`googleAuth.ts`)에 잔액 확인 + 차감 + 랜덤 색 저장을 한 번에 하는 순수 데이터 함수를 추가하고, 그 위에 세션 인증 라우트 하나(`POST /api/profile/reroll-color`)를 얹는다. 기존 로그인 응답 3곳(`/api/auth/google`, `/api/auth/me`, `/api/auth/nickname`)에 색/효과 필드를 추가해 로비가 본인 스타일을 알 수 있게 한다. 클라이언트는 이미 있는 `nicknameStyle()` 헬퍼와 `ProfileModal`(이미 `friendshipStatus === "self"`를 서버가 내려주는 상태)을 그대로 재사용 — 새 UI 분기 하나와 로비 닉네임의 클릭 가능화만 추가한다.

**Tech Stack:** TypeScript, Express, better-sqlite3, React 19, Vitest, Playwright(MCP, 수동 검증용 — 이 프로젝트엔 라우트 레벨 자동 테스트 인프라가 없음, DB 레이어 함수만 vitest로 커버).

## Global Constraints

- 재추첨 비용은 정확히 20,000원(`NICKNAME_REROLL_COST`), 잔액이 정확히 20,000원이어도 성공(경계값 포함).
- 색은 `#` + 6자리 hex, 16^6가지 중 균등 랜덤 — 검증/거부 로직 불필요(항상 유효한 형식만 생성).
- 실패 UX는 "버튼은 항상 클릭 가능, 서버가 거절하면 에러 메시지만 표시" — 사전 잔액 확인이나 버튼 비활성화 없음(확정된 요구사항).
- 반복 구매 제한 없음 — 버튼 누를 때마다 즉시 차감 + 재추첨.
- 닉네임이 나오는 화면은 반드시 `client/src/game/nicknameStyle.ts`의 `nicknameStyle(color, rainbow, glow)`를 거쳐야 함 — `style={{color: ...}}` 직접 사용 금지.
- SQLite boolean 컬럼(`nickname_rainbow`/`nickname_glow`)은 읽을 때마다 `server/src/db/connection.ts`의 `sqliteBool()`로 명시 변환 — 이번 작업은 이 컬럼들을 새로 읽는 자리가 없어 해당 없음(참고용으로 기재).
- 로컬에서 구글 로그인/세션 쿠키가 필요한 기능을 확인하려면 `npm run sync-public`으로 client를 빌드해 `server/public`에 복사한 뒤 서버가 직접 서빙하는 2567 포트로 접속해야 함(Vite dev 서버의 5173은 다른 오리진이라 쿠키 기반 세션이 안 통함).

---

### Task 1: 서버 데이터 로직 — `rerollNicknameColor`

**Files:**
- Modify: `server/src/auth/googleAuth.ts` (파일 끝, `getTopRanking` 다음)
- Test: `server/src/auth/googleAuth.test.ts` (파일 끝에 새 `describe` 블록 추가)

**Interfaces:**
- Consumes: 기존 `db`(`../db/connection`에서 이미 import됨), 기존 `getUserById`(같은 파일).
- Produces: `NICKNAME_REROLL_COST`(내부 상수, export 안 함), `export type RerollNicknameColorResult = { ok: true; nicknameColor: string; gameMoney: number } | { ok: false; reason: "insufficient_funds" }`, `export function rerollNicknameColor(userId: number): RerollNicknameColorResult`. Task 2가 이 함수와 타입을 그대로 import한다.

- [ ] **Step 1: Write the failing tests**

`server/src/auth/googleAuth.test.ts` 맨 위 import 블록의 `import { ... } from "./googleAuth";`에 `rerollNicknameColor`를 추가하고, 파일 끝에 추가:

```ts
describe("rerollNicknameColor", () => {
  beforeEach(() => {
    db.exec("DELETE FROM users");
  });

  test("deducts exactly 20000 and stores a valid #RRGGBB color when funds are sufficient", () => {
    const user = getOrCreateUser("sub-reroll-1", {});
    addGameMoney(user.id, 25000);

    const result = rerollNicknameColor(user.id);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.gameMoney).toBe(5000);
    expect(result.nicknameColor).toMatch(/^#[0-9a-f]{6}$/);
    expect(getUserById(user.id)).toMatchObject({
      gameMoney: 5000,
      nicknameColor: result.nicknameColor,
    });
  });

  test("succeeds at exactly the cost boundary (20000), leaving 0 left", () => {
    const user = getOrCreateUser("sub-reroll-2", {});
    addGameMoney(user.id, 20000);

    const result = rerollNicknameColor(user.id);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.gameMoney).toBe(0);
    expect(getUserById(user.id)?.gameMoney).toBe(0);
  });

  test("refuses when funds are insufficient and changes nothing", () => {
    const user = getOrCreateUser("sub-reroll-3", {});
    addGameMoney(user.id, 19999);

    const result = rerollNicknameColor(user.id);

    expect(result).toEqual({ ok: false, reason: "insufficient_funds" });
    expect(getUserById(user.id)).toMatchObject({ gameMoney: 19999, nicknameColor: null });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && npm test -- googleAuth` (Windows PowerShell: `cd server; npm test -- googleAuth`)
Expected: FAIL — `rerollNicknameColor is not a function` (or a TypeScript error that it doesn't exist).

- [ ] **Step 3: Write the implementation**

`server/src/auth/googleAuth.ts` 파일 끝(`getTopRanking` 함수 다음)에 추가:

```ts
const NICKNAME_REROLL_COST = 20000;

export type RerollNicknameColorResult =
  | { ok: true; nicknameColor: string; gameMoney: number }
  | { ok: false; reason: "insufficient_funds" };

// 게임머니 20,000원을 차감하고 #RRGGBB(16^6가지) 중 하나를 균등 랜덤으로 뽑아
// nickname_color에 저장한다. 잔액 부족이면 아무것도 바꾸지 않고 실패를 반환한다.
// better-sqlite3는 완전히 동기적이라(이 두 문장 사이에 await 없음) 조회 후 UPDATE
// 사이에 다른 요청이 끼어들 수 없다 — getOrCreateUser의 기존 논리와 동일한 이유로
// 트랜잭션 없이도 원자적이다.
export function rerollNicknameColor(userId: number): RerollNicknameColorResult {
  const row = db.prepare(`SELECT game_money AS gameMoney FROM users WHERE id = ?`).get(userId) as
    | { gameMoney: number }
    | undefined;
  if (!row || row.gameMoney < NICKNAME_REROLL_COST) {
    return { ok: false, reason: "insufficient_funds" };
  }
  const color = randomHexColor();
  db.prepare(`UPDATE users SET game_money = game_money - ?, nickname_color = ? WHERE id = ?`).run(
    NICKNAME_REROLL_COST,
    color,
    userId,
  );
  return { ok: true, nicknameColor: color, gameMoney: row.gameMoney - NICKNAME_REROLL_COST };
}

function randomHexColor(): string {
  const n = Math.floor(Math.random() * 0x1000000);
  return `#${n.toString(16).padStart(6, "0")}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && npm test -- googleAuth`
Expected: PASS — all 3 new tests green, and every pre-existing test in this file still passes (`npm test` with no filter also stays green).

- [ ] **Step 5: Commit**

```bash
git add server/src/auth/googleAuth.ts server/src/auth/googleAuth.test.ts
git commit -m "닉네임 색 변경권(게임머니 20,000원) 데이터 로직 추가"
```

---

### Task 2: 서버 라우트 — 재추첨 API + 로그인 응답 확장

**Files:**
- Modify: `server/src/createServer.ts:1-30`(import 블록), `:342-393`(`/api/auth/google`, `/api/auth/me`, `/api/auth/nickname`), `:712-742`(`/api/profile/:nickname` 바로 뒤에 새 라우트 삽입)

**Interfaces:**
- Consumes: Task 1의 `rerollNicknameColor(userId: number): RerollNicknameColorResult`(`./auth/googleAuth`에서 import). 기존 `verifySession`, `SESSION_COOKIE_NAME`, `getUserById`도 이미 이 파일에서 import되어 있음(그대로 사용).
- Produces: `POST /api/profile/reroll-color` — 성공 시 `200 { nicknameColor: string; gameMoney: number }`, 실패 시 `400 { error: "게임머니가 부족해요." }`, 미로그인 시 `401 { error: "로그인이 필요합니다." }`. `/api/auth/google`, `/api/auth/me`, `/api/auth/nickname`의 JSON 응답에 `nicknameColor: string | null`, `nicknameRainbow: boolean`, `nicknameGlow: boolean` 필드가 추가됨 — Task 3/4가 이 필드들을 소비한다.

- [ ] **Step 1: import 추가**

`server/src/createServer.ts` 상단, 기존 `googleAuth`에서 가져오는 import 문(파일 맨 위, 다른 `from "./auth/googleAuth"` import들이 있는 줄)에 `rerollNicknameColor`를 추가한다. 예를 들어 기존 import가 아래와 같다면:

```ts
import { getOrCreateUser, getUserById, setNickname, touchLastLogin, /* ...기존 항목들... */ } from "./auth/googleAuth";
```

`rerollNicknameColor`를 목록에 추가한다:

```ts
import {
  getOrCreateUser,
  getUserById,
  setNickname,
  touchLastLogin,
  rerollNicknameColor,
  /* ...기존 항목들 그대로 유지... */
} from "./auth/googleAuth";
```

(실제 파일에는 이 라우트 파일에서 이미 쓰고 있는 다른 `googleAuth` export들도 같은 import 문에 있으니, 그 목록은 지우지 말고 `rerollNicknameColor`만 추가할 것.)

- [ ] **Step 2: `/api/auth/google` 응답 확장 (createServer.ts:358-365)**

기존:

```ts
      res.json({
        id: user.id,
        nickname: user.nickname,
        maxRound: user.maxRound,
        pigPlayCount: user.pigPlayCount,
        rabbitPlayCount: user.rabbitPlayCount,
        gameMoney: user.gameMoney,
      });
```

변경 후:

```ts
      res.json({
        id: user.id,
        nickname: user.nickname,
        nicknameColor: user.nicknameColor,
        nicknameRainbow: user.nicknameRainbow,
        nicknameGlow: user.nicknameGlow,
        maxRound: user.maxRound,
        pigPlayCount: user.pigPlayCount,
        rabbitPlayCount: user.rabbitPlayCount,
        gameMoney: user.gameMoney,
      });
```

- [ ] **Step 3: `/api/auth/me` 응답 확장 (createServer.ts:381-392)**

기존:

```ts
    res.json(
      user
        ? {
            id: user.id,
            nickname: user.nickname,
            maxRound: user.maxRound,
            pigPlayCount: user.pigPlayCount,
            rabbitPlayCount: user.rabbitPlayCount,
            gameMoney: user.gameMoney,
          }
        : null,
    );
```

변경 후:

```ts
    res.json(
      user
        ? {
            id: user.id,
            nickname: user.nickname,
            nicknameColor: user.nicknameColor,
            nicknameRainbow: user.nicknameRainbow,
            nicknameGlow: user.nicknameGlow,
            maxRound: user.maxRound,
            pigPlayCount: user.pigPlayCount,
            rabbitPlayCount: user.rabbitPlayCount,
            gameMoney: user.gameMoney,
          }
        : null,
    );
```

- [ ] **Step 4: `/api/auth/nickname` 응답 확장 (createServer.ts:416번 줄 부근, `const user = getUserById(userId); res.json({...})`)**

이 라우트의 마지막 `res.json({ id: userId, nickname: user?.nickname ?? null, ... })` 블록에도 같은 3개 필드를 추가한다 — 정확한 형태는 파일을 열어 `getUserById` 호출 직후의 `res.json` 블록을 찾아 위 두 단계와 동일한 패턴(`nicknameColor: user?.nicknameColor ?? null, nicknameRainbow: user?.nicknameRainbow ?? false, nicknameGlow: user?.nicknameGlow ?? false,`)으로 확장한다. `user`가 옵셔널 체이닝(`?.`)으로 접근되고 있다면 새 필드들도 같은 방식을 따를 것.

- [ ] **Step 5: 새 라우트 추가 (createServer.ts:742번 줄, `/api/profile/:nickname` 라우트 바로 뒤 — `const httpServer = createHttpServer(app);` 바로 앞)**

```ts
  app.post("/api/profile/reroll-color", (req, res) => {
    const cookies = (req as unknown as { cookies?: Record<string, string> }).cookies;
    const userId = verifySession(cookies?.[SESSION_COOKIE_NAME]);
    if (!userId) {
      res.status(401).json({ error: "로그인이 필요합니다." });
      return;
    }
    const result = rerollNicknameColor(userId);
    if (!result.ok) {
      res.status(400).json({ error: "게임머니가 부족해요." });
      return;
    }
    res.json({ nicknameColor: result.nicknameColor, gameMoney: result.gameMoney });
  });
```

- [ ] **Step 6: 타입체크**

Run: `cd server && npm run build`
Expected: 에러 없이 통과 (`tsc --noEmit`).

- [ ] **Step 7: 수동 검증 — 세션 쿠키를 직접 만들어 라우트 호출**

이 프로젝트엔 라우트 레벨 자동 테스트(supertest 등)가 없다 — DB에 테스트 유저를 만들고 `signSession`으로 유효한 세션 쿠키를 직접 서명해 실제 서버에 요청을 보내 확인한다. 서버를 먼저 켠다:

```bash
cd server && npm run dev
```

다른 터미널에서 Node 스크립트로 검증(경로/값은 실제 `server/.env`의 `SESSION_JWT_SECRET`, `server/data`의 sqlite 파일 경로에 맞춰 조정):

```bash
cd server && node -e "
require('dotenv/config');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const db = new Database('./data/songpyeon.db');
db.prepare(\"INSERT INTO users (google_sub, nickname, game_money, created_at, last_login_at) VALUES ('test-reroll-sub', '테스트유저', 25000, datetime('now'), datetime('now'))\").run();
const user = db.prepare('SELECT id FROM users WHERE google_sub = ?').get('test-reroll-sub');
const token = jwt.sign({ userId: user.id }, process.env.SESSION_JWT_SECRET);
console.log('userId=' + user.id + ' cookie=' + token);
"
```

(위 스크립트가 실제 `signSession`의 JWT payload 형태와 다를 수 있으니, 구현 전 반드시 `server/src/auth/session.ts`의 `signSession`/`verifySession` 구현을 읽고 그 payload 모양(`{ userId }`인지 다른 키인지)에 맞춰 스크립트를 조정할 것.)

그 쿠키로 라우트 호출:

```bash
curl -i -X POST http://localhost:2567/api/profile/reroll-color --cookie "session=<위에서 나온 토큰>"
```

Expected: `200`, 응답 본문에 `nicknameColor`가 `#`+6자리 hex, `gameMoney`가 `5000`(25000-20000). 같은 명령을 다시 실행하면 이번엔 `gameMoney`가 20000 미만이므로 `400 {"error":"게임머니가 부족해요."}`가 나와야 한다.

검증이 끝나면 테스트 유저를 정리한다:

```bash
cd server && node -e "
require('dotenv/config');
const Database = require('better-sqlite3');
const db = new Database('./data/songpyeon.db');
db.prepare(\"DELETE FROM users WHERE google_sub = 'test-reroll-sub'\").run();
"
```

그리고 개발 서버(`npm run dev`)를 종료하고 **`netstat -ano | grep :2567`(또는 PowerShell: `netstat -ano | findstr :2567`)로 포트 2567이 실제로 비었는지 확인할 것** — 이전 작업들에서 "종료했다고 보고했지만 실제로는 살아있던" 사례가 반복됐다.

- [ ] **Step 8: Commit**

```bash
git add server/src/createServer.ts
git commit -m "닉네임 색 재추첨 API 추가 + 로그인 응답에 닉네임 색/효과 필드 포함"
```

---

### Task 3: 클라이언트 기반 — `Profile` 타입 + 재추첨 fetch 함수

**Files:**
- Modify: `client/src/game/auth.ts:57-64`(`Profile` 타입)
- Modify: `client/src/game/profile.ts`(파일 끝에 함수 추가)

**Interfaces:**
- Consumes: 없음(순수 타입/fetch 래퍼).
- Produces: `Profile` 타입에 `nicknameColor: string | null`, `nicknameRainbow: boolean`, `nicknameGlow: boolean` 필드 추가. `export async function rerollNicknameColor(): Promise<{ nicknameColor: string; gameMoney: number }>`(`client/src/game/profile.ts`) — Task 4가 이 함수와 확장된 `Profile` 타입을 그대로 import한다.

- [ ] **Step 1: `Profile` 타입 확장**

`client/src/game/auth.ts:57-64`, 기존:

```ts
export type Profile = {
  id: number;
  nickname: string | null;
  maxRound: number;
  pigPlayCount: number;
  rabbitPlayCount: number;
  gameMoney: number;
};
```

변경 후:

```ts
export type Profile = {
  id: number;
  nickname: string | null;
  nicknameColor: string | null;
  nicknameRainbow: boolean;
  nicknameGlow: boolean;
  maxRound: number;
  pigPlayCount: number;
  rabbitPlayCount: number;
  gameMoney: number;
};
```

- [ ] **Step 2: 재추첨 fetch 함수 추가**

`client/src/game/profile.ts` 파일 끝에 추가(기존 `getProfile` 다음):

```ts
export async function rerollNicknameColor(): Promise<{ nicknameColor: string; gameMoney: number }> {
  const res = await fetch("/api/profile/reroll-color", { method: "POST", credentials: "same-origin" });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error ?? "닉색 변경에 실패했어요.");
  return body;
}
```

- [ ] **Step 3: 타입체크**

Run: `cd client && npm run build`
Expected: `tsc -b`가 에러 없이 통과. (이 시점엔 `Profile`을 소비하는 `App.tsx`/`RoomList.tsx`가 아직 새 필드를 안 쓰므로 컴파일 에러가 날 이유가 없다 — 구조적 타입이라 필드가 늘어난 것 자체는 기존 소비처를 깨지 않는다.)

- [ ] **Step 4: Commit**

```bash
git add client/src/game/auth.ts client/src/game/profile.ts
git commit -m "Profile 타입에 닉네임 색/효과 필드 추가, 재추첨 fetch 함수 추가"
```

---

### Task 4: 클라이언트 UI — 로비 본인 닉네임 클릭 + 프로필 팝업의 재추첨 버튼

**Files:**
- Modify: `client/src/components/ProfileModal.tsx`(전체 — 아래 최종 코드 참고)
- Modify: `client/src/components/RoomList.tsx`(props, import, 163번 줄의 닉네임 span, 모달 렌더)
- Modify: `client/src/components/RoomList.module.css:229-232`(`.profileNickname`)
- Modify: `client/src/App.tsx`(`OnlineFlow`의 `<RoomList>` 호출부, 122-134번 줄 부근)

**Interfaces:**
- Consumes: Task 3의 `Profile` 타입(`../game/auth`)과 `rerollNicknameColor()`(`../game/profile`). 기존 `nicknameStyle()`(`../game/nicknameStyle`), 기존 `ProfileModal`, 기존 `getProfile`/`PublicProfile`(이미 `friendshipStatus: "self"`를 서버가 내려줌 — `server/src/friends/friendships.ts`의 `getFriendshipStatus`가 `viewerId === targetId`일 때 이미 `"self"`를 반환하므로 서버 쪽 변경 불필요).
- Produces: 없음(이 프로젝트의 최종 소비 지점 — 더 이상 다른 태스크가 이걸 가져다 쓰지 않음).

- [ ] **Step 1: `ProfileModal.tsx`에 재추첨 버튼 추가**

전체 파일을 아래 내용으로 교체한다(기존 로직은 그대로 두고 import 한 줄, prop 한 개, 핸들러 한 개, 버튼 분기 한 개만 추가):

```tsx
import { useEffect, useState } from "react";
import { getProfile, rerollNicknameColor, type PublicProfile } from "../game/profile";
import { removeFriend, sendFriendRequest } from "../game/friends";
import { nicknameStyle } from "../game/nicknameStyle";
import styles from "./ProfileModal.module.css";

export function ProfileModal({
  nickname,
  onClose,
  onSelfColorChanged,
}: {
  nickname: string;
  onClose: () => void;
  onSelfColorChanged?: () => void;
}) {
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const effect = profile
    ? nicknameStyle(profile.nicknameColor, profile.nicknameRainbow, profile.nicknameGlow)
    : { className: "", style: {} };

  useEffect(() => {
    getProfile(nickname)
      .then(setProfile)
      .catch((err) => setError(err instanceof Error ? err.message : "프로필을 불러오지 못했어요."));
  }, [nickname]);

  async function handleSendRequest() {
    if (!profile) return;
    setBusy(true);
    setMessage(null);
    try {
      const { result } = await sendFriendRequest(profile.nickname);
      setMessage(result === "auto_accepted" ? "서로 요청이 있어서 바로 친구가 됐어요!" : "요청을 보냈어요.");
      const refreshed = await getProfile(nickname);
      setProfile(refreshed);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "요청에 실패했어요.");
      getProfile(nickname).then(setProfile).catch(() => {});
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveFriend() {
    if (!profile?.friendshipId) return;
    setBusy(true);
    setMessage(null);
    try {
      await removeFriend(profile.friendshipId);
      const refreshed = await getProfile(nickname);
      setProfile(refreshed);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "삭제에 실패했어요.");
      getProfile(nickname).then(setProfile).catch(() => {});
    } finally {
      setBusy(false);
    }
  }

  async function handleReroll() {
    setBusy(true);
    setMessage(null);
    try {
      const { nicknameColor } = await rerollNicknameColor();
      setProfile((prev) => (prev ? { ...prev, nicknameColor } : prev));
      onSelfColorChanged?.();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "닉색 변경에 실패했어요.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        {error && <p className={styles.error}>{error}</p>}
        {!error && !profile && <p className={styles.loading}>불러오는 중...</p>}
        {profile && (
          <>
            <h2 className={`${styles.heading} ${effect.className}`} style={effect.style}>
              {profile.nickname}
            </h2>
            <div className={styles.stats}>
              <span className={styles.stat}>
                🐷 {profile.pigPlayCount}판 🐰 {profile.rabbitPlayCount}판
              </span>
              <span className={styles.stat}>최고 {profile.maxRound}라운드</span>
            </div>
            {message && <p className={styles.message}>{message}</p>}
            {profile.friendshipStatus === "self" && (
              <button className={styles.actionButton} onClick={handleReroll} disabled={busy}>
                닉색 변경 (20,000원)
              </button>
            )}
            {profile.friendshipStatus === "none" && (
              <button className={styles.actionButton} onClick={handleSendRequest} disabled={busy}>
                친구 요청 보내기
              </button>
            )}
            {profile.friendshipStatus === "friends" && (
              <button className={styles.removeButton} onClick={handleRemoveFriend} disabled={busy}>
                친구 삭제
              </button>
            )}
            {(profile.friendshipStatus === "pending_sent" || profile.friendshipStatus === "pending_received") && (
              <p className={styles.pending}>요청 대기 중</p>
            )}
          </>
        )}
        <button className={styles.closeButton} onClick={onClose}>
          닫기
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: `RoomList.module.css`의 `.profileNickname`을 버튼으로도 자연스럽게 보이도록 리셋**

`client/src/components/RoomList.module.css:229-232`, 기존:

```css
.profileNickname {
  font-weight: 800;
  font-size: 1.1rem;
}
```

변경 후:

```css
.profileNickname {
  font-weight: 800;
  font-size: 1.1rem;
  background: none;
  border: none;
  padding: 0;
  color: inherit;
  cursor: pointer;
}
```

- [ ] **Step 3: `RoomList.tsx` — props, import, 클릭 가능한 닉네임, 모달 렌더**

`client/src/components/RoomList.tsx` 맨 위 import 블록(1-10번 줄)에 추가:

```ts
import { nicknameStyle } from "../game/nicknameStyle";
import { ProfileModal } from "./ProfileModal";
```

`RoomList` 함수 시그니처(18-36번 줄), 기존:

```ts
export function RoomList({
  nickname,
  maxRound,
  pigPlayCount,
  rabbitPlayCount,
  gameMoney,
  onCreateRoom,
  onJoinRoom,
  onExit,
}: {
  nickname: string;
  maxRound: number;
  pigPlayCount: number;
  rabbitPlayCount: number;
  gameMoney: number;
  onCreateRoom: (title: string, teamCount: number, allowSpectators: boolean, itemsEnabled: boolean) => void;
  onJoinRoom: (roomId: string) => void;
  onExit: () => void;
}) {
```

변경 후:

```ts
export function RoomList({
  nickname,
  nicknameColor,
  nicknameRainbow,
  nicknameGlow,
  maxRound,
  pigPlayCount,
  rabbitPlayCount,
  gameMoney,
  onCreateRoom,
  onJoinRoom,
  onExit,
  onProfileChanged,
}: {
  nickname: string;
  nicknameColor: string | null;
  nicknameRainbow: boolean;
  nicknameGlow: boolean;
  maxRound: number;
  pigPlayCount: number;
  rabbitPlayCount: number;
  gameMoney: number;
  onCreateRoom: (title: string, teamCount: number, allowSpectators: boolean, itemsEnabled: boolean) => void;
  onJoinRoom: (roomId: string) => void;
  onExit: () => void;
  onProfileChanged: () => void;
}) {
```

같은 함수 본문의 `useState` 선언들(38-45번 줄) 바로 뒤에 상태 하나 추가:

```ts
  const [showOwnProfile, setShowOwnProfile] = useState(false);
```

함수 본문 안, `return (` 이전 아무 곳(예: `handleDismissInvite` 함수 다음)에 스타일 계산을 추가:

```ts
  const nicknameEffect = nicknameStyle(nicknameColor, nicknameRainbow, nicknameGlow);
```

163번 줄, 기존:

```tsx
        <span className={styles.profileNickname}>{nickname}</span>
```

변경 후:

```tsx
        <button
          type="button"
          className={`${styles.profileNickname} ${nicknameEffect.className}`}
          style={nicknameEffect.style}
          onClick={() => setShowOwnProfile(true)}
        >
          {nickname}
        </button>
```

다른 모달들이 렌더되는 블록(179-182번 줄, `{showRankingModal && ...}` 근처) 옆에 추가:

```tsx
      {showOwnProfile && (
        <ProfileModal
          nickname={nickname}
          onClose={() => setShowOwnProfile(false)}
          onSelfColorChanged={onProfileChanged}
        />
      )}
```

- [ ] **Step 4: `App.tsx` — `RoomList`에 새 props 전달**

`client/src/App.tsx`의 `OnlineFlow` 함수 안, `<RoomList ...>` 호출부(122-134번 줄 부근), 기존:

```tsx
      <RoomList
        nickname={me.nickname}
        maxRound={me.maxRound}
        pigPlayCount={me.pigPlayCount}
        rabbitPlayCount={me.rabbitPlayCount}
        gameMoney={me.gameMoney}
        onCreateRoom={(roomTitle, teamCount, allowSpectators, itemsEnabled) =>
          setJoinSpec({ type: "create", teamCount, roomTitle, allowSpectators, itemsEnabled })
        }
        onJoinRoom={(roomId) => setJoinSpec({ type: "joinById", roomId })}
        onExit={onExit}
      />
```

변경 후:

```tsx
      <RoomList
        nickname={me.nickname}
        nicknameColor={me.nicknameColor}
        nicknameRainbow={me.nicknameRainbow}
        nicknameGlow={me.nicknameGlow}
        maxRound={me.maxRound}
        pigPlayCount={me.pigPlayCount}
        rabbitPlayCount={me.rabbitPlayCount}
        gameMoney={me.gameMoney}
        onCreateRoom={(roomTitle, teamCount, allowSpectators, itemsEnabled) =>
          setJoinSpec({ type: "create", teamCount, roomTitle, allowSpectators, itemsEnabled })
        }
        onJoinRoom={(roomId) => setJoinSpec({ type: "joinById", roomId })}
        onExit={onExit}
        onProfileChanged={() => fetchMe().then(setMe).catch(() => {})}
      />
```

(`fetchMe`/`setMe`는 이미 이 컴포넌트 안에서 import/선언되어 있음 — 매치 종료 시 이미 같은 패턴이 148번 줄 부근에서 쓰이고 있으니 그대로 재사용.)

- [ ] **Step 5: 타입체크**

Run: `cd client && npm run build`
Expected: `tsc -b && vite build` 에러 없이 통과.

- [ ] **Step 6: Playwright로 수동 검증**

이 프로젝트는 이 기능 레벨의 자동 UI 테스트가 없다 — DB에 테스트 유저를 만들고 세션 쿠키를 브라우저에 주입해 실제로 클릭해본다. 먼저 클라이언트를 빌드해 서버가 서빙하도록 동기화하고 서버를 켠다(Gotchas 참고 — 구글 로그인/세션 쿠키가 필요한 기능은 5173/vite dev로는 확인 불가):

```bash
npm run sync-public
cd server && npm run dev
```

Playwright MCP로:
1. DB에 게임머니 25000원을 가진 테스트 유저를 만들고(Task 2의 Step 7과 같은 방식), `signSession(userId)`으로 세션 토큰을 만든다.
2. `page.context().addCookies([{ name: "session", value: token, url: "http://localhost:2567" }])`로 쿠키 주입 후 `http://localhost:2567`로 이동.
3. 로비 하단 프로필바의 본인 닉네임(테스트 유저 닉네임)을 클릭 → `ProfileModal`이 뜨고 "닉색 변경 (20,000원)" 버튼이 보이는지 확인(다른 사람 프로필에선 이 버튼이 없어야 함 — 필요하면 다른 테스트 유저의 닉네임을 아무 곳에서나 클릭해 대조 확인).
4. 버튼 클릭 → 팝업 안 닉네임 색이 즉시 바뀌는지(色 코드 자체는 랜덤이라 "이전과 다른 색"인지만 확인), 팝업을 닫고 로비로 돌아왔을 때 하단 프로필바의 게임머니가 5000원으로 줄어 있는지, 닉네임 색도 로비에 반영됐는지 확인.
5. 이어서 두 번 더 클릭 → 세 번째 클릭(잔액이 20000원 미만이 된 시점)에서 "게임머니가 부족해요." 메시지가 뜨고 색/게임머니가 그대로인지 확인.
6. 테스트 유저를 DB에서 정리, 브라우저 탭 닫기, 개발 서버 종료 후 **`netstat`으로 2567 포트가 실제로 비었는지 확인**.

- [ ] **Step 7: Commit**

```bash
git add client/src/components/ProfileModal.tsx client/src/components/RoomList.tsx client/src/components/RoomList.module.css client/src/App.tsx
git commit -m "로비 본인 닉네임 클릭 가능화 + 프로필 팝업에 닉색 변경 버튼 추가"
```

---

## Self-Review Notes

- **Spec coverage:** A(데이터/로직) → Task 1. B-1(새 라우트) + B-2(3개 로그인 응답 확장) → Task 2. C-1(`Profile` 타입)/C-2(`profile.ts` 함수) → Task 3. C-3(`ProfileModal`)/C-4(`RoomList`)/C-5(`App.tsx`) → Task 4. 스펙의 모든 섹션이 커버됨.
- **Placeholder scan:** 없음 — 모든 단계에 실제 코드/명령어 포함.
- **Type consistency:** `RerollNicknameColorResult`(Task 1) → 라우트 응답 형태(Task 2) → 클라이언트 `rerollNicknameColor()` 반환 타입(Task 3) → `ProfileModal.handleReroll`의 구조 분해(Task 4)까지 `{ nicknameColor: string; gameMoney: number }` 성공 형태가 일관됨. `Profile`/`PublicProfile` 타입의 `nicknameColor`/`nicknameRainbow`/`nicknameGlow` 필드명도 기존 nickname-effects 기능(`nicknameStyle.ts`, `PublicProfile`)과 동일한 이름을 그대로 씀.
