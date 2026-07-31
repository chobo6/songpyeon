# 닉네임변경권 + 확성기 상점 아이템 + 판당 기본 지급액 인상 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 상점에 닉네임변경권(30,000원)과 확성기(2,500원) 아이템을 추가하고, 턴 성공 시 지급되는 기본 게임머니를 10원에서 20원으로 올린다.

**Architecture:** 닉네임변경권/확성기 모두 "보유 아이템" 개념 없이 구매 즉시 소비되는 원샷 액션이다. 닉네임변경권은 기존 `setNickname`의 "최초 1회" 제한을 유료로 우회하는 새 함수, 확성기는 기존 관리자 "전체 공지" SSE 배너와 같은 메커니즘을 별도 채널로 복제한 새 모듈이다. 판당 지급액은 `MatchRoom.ts`의 상수 하나만 바뀐다.

**Tech Stack:** Node.js/TypeScript/Express/better-sqlite3(서버, SSE), React/TypeScript/Vite(클라이언트)

## Global Constraints

- 닉네임변경권 가격: 30,000원. 확성기 가격: 2,500원.
- 확성기 메시지 최대 길이: 40자.
- 판당 기본 지급액(턴 성공 시, 팀 수 곱하기 전 기본값): 10원 → 20원. 팀 수를 곱하는 계산식 자체는 유지.
- 확성기는 관리자 "전체 공지"와 **별도의 SSE 채널**로 분리 — 서로 겹쳐쓰지 않는다.
- 닉네임변경권/확성기 모두 인벤토리(소유 목록) 없이 구매 즉시 효과가 적용되는 소모성 아이템.

---

### Task 1: 판당 기본 지급액 10원 → 20원

**Files:**
- Modify: `server/src/rooms/MatchRoom.ts:909-913`
- Modify: `server/src/rooms/MatchRoom.test.ts:922-946`, `948-972`

**Interfaces:**
- Consumes: 없음(기존 `creditTurnSuccess`/`addGameMoney` 그대로).
- Produces: 없음(이 태스크는 상수 값만 바꿈, 다른 태스크가 의존하는 새 인터페이스 없음).

- [ ] **Step 1: 기존 테스트를 새 기대값으로 먼저 고쳐서 "실패하는 테스트"로 만든다**

`server/src/rooms/MatchRoom.test.ts:942-944`을 교체:

```ts
      // 2팀 방이므로 20 × 2 = 40원.
      expect(gameMoneyOf(pigNickname)).toBe(40);
      expect(gameMoneyOf(rabbitNickname)).toBe(40);
```

`server/src/rooms/MatchRoom.test.ts:948`(테스트 이름)과 `970-971`을 교체:

```ts
  test("a successful turn in a 1-team room pays no multiplier (20 won)", async () => {
```

```ts
    expect(gameMoneyOf("외팀0")).toBe(20);
    expect(gameMoneyOf("외팀1")).toBe(20);
```

- [ ] **Step 2: 테스트 실행해서 실패하는지 확인 (현재 코드는 아직 10원 기준)**

Run: `cd server && npx vitest run MatchRoom -t "scaled by team count"`
Expected: FAIL — `expected 20 to be 40` (아직 `10 * teams.length`라서 2팀 방은 20원만 지급됨)

- [ ] **Step 3: `MatchRoom.ts`의 지급액 상수를 20으로 바꾼다**

`server/src/rooms/MatchRoom.ts:909-913`을 교체:

```ts
  // 팀이 자기 차례(턴)를 성공적으로 완료할 때마다 호출 — 팀 소속 두 플레이어
  // (돼지, 토끼) 각각에게 "20원 × 이 방의 팀 수"를 지급한다. creditRound와
  // 동일한 이유로 playerUserIds에 없으면(빈 슬롯) 조용히 건너뛴다.
  private creditTurnSuccess(team: TeamState) {
    const reward = 20 * this.state.teams.length;
```

- [ ] **Step 4: 두 테스트 다시 실행해서 통과 확인**

Run: `cd server && npx vitest run MatchRoom -t "scaled by team count|pays no multiplier"`
Expected: PASS (둘 다)

- [ ] **Step 5: 서버 전체 테스트 실행해서 다른 회귀 없는지 확인**

Run: `cd server && npx vitest run`
Expected: 이 두 테스트 외엔 결과 변화 없음(팀 탈락 관련 기존 pre-existing 실패가 있다면 이 태스크와 무관하니 무시).

- [ ] **Step 6: 커밋**

```bash
git add server/src/rooms/MatchRoom.ts server/src/rooms/MatchRoom.test.ts
git commit -m "판당 기본 지급액을 10원에서 20원으로 인상"
```

---

### Task 2: 서버 — 닉네임변경권 (30,000원)

**Files:**
- Modify: `server/src/auth/googleAuth.ts:314-318` (사이에 새 코드 삽입)
- Test: `server/src/auth/googleAuth.test.ts`
- Modify: `server/src/createServer.ts`

**Interfaces:**
- Consumes: 기존 `sanitizeNickname`(`../game/nickname`, 이미 `googleAuth.ts` 1-3번 줄에 import되어 있음), 기존 `db`.
- Produces: `export const NICKNAME_TICKET_COST = 30000`, `export type UseNicknameTicketResult = "ok" | "taken" | "insufficient_funds"`, `export function useNicknameTicket(userId: number, nickname: string): UseNicknameTicketResult` — Task 4(클라이언트)가 이 이름과 반환값을 그대로 가정하고 라우트를 호출함.

- [ ] **Step 1: 실패하는 테스트부터 작성**

`server/src/auth/googleAuth.test.ts` 3번 줄의 import 목록(`{`로 시작해 `} from "./googleAuth";`로 끝나는 블록, 현재 4-22번 줄)에 `NICKNAME_TICKET_COST,`와 `useNicknameTicket,`를 알파벳 순서에 맞게 추가한다. 현재 블록:

```ts
import {
  addGameMoney,
  adminSetNickname,
  equipEffect,
  getOrCreateUser,
  getOwnedEffects,
  getTopRanking,
  getUserById,
  listUsers,
  NICKNAME_REROLL_COST,
  purchaseEffect,
  recordRolePlayed,
  recordRoundAchievement,
  rerollNicknameColor,
  setNickname,
  setNicknameColor,
  setNicknameEffect,
  SHOP_PRICES,
  setUserBanned,
  touchLastLogin,
} from "./googleAuth";
```

교체 후:

```ts
import {
  addGameMoney,
  adminSetNickname,
  equipEffect,
  getOrCreateUser,
  getOwnedEffects,
  getTopRanking,
  getUserById,
  listUsers,
  NICKNAME_REROLL_COST,
  NICKNAME_TICKET_COST,
  purchaseEffect,
  recordRolePlayed,
  recordRoundAchievement,
  rerollNicknameColor,
  setNickname,
  setNicknameColor,
  setNicknameEffect,
  SHOP_PRICES,
  setUserBanned,
  touchLastLogin,
  useNicknameTicket,
} from "./googleAuth";
```

파일 끝(`describe("rerollNicknameColor", ...)` 블록 뒤, 파일이 그 블록으로 끝난다면 맨 끝)에 새 `describe` 블록을 추가:

```ts
describe("useNicknameTicket", () => {
  beforeEach(() => {
    db.exec("DELETE FROM users");
  });

  test("changes an already-set nickname and deducts NICKNAME_TICKET_COST when funds are sufficient", () => {
    const user = getOrCreateUser("sub-ticket-1", {});
    setNickname(user.id, "옛날닉네임");
    addGameMoney(user.id, NICKNAME_TICKET_COST + 5000);

    const result = useNicknameTicket(user.id, "새닉네임");

    expect(result).toBe("ok");
    expect(getUserById(user.id)).toMatchObject({ nickname: "새닉네임", gameMoney: 5000 });
  });

  test("refuses when funds are insufficient and changes nothing", () => {
    const user = getOrCreateUser("sub-ticket-2", {});
    setNickname(user.id, "그대로닉네임");
    addGameMoney(user.id, NICKNAME_TICKET_COST - 1);

    const result = useNicknameTicket(user.id, "바뀔뻔한닉네임");

    expect(result).toBe("insufficient_funds");
    expect(getUserById(user.id)).toMatchObject({
      nickname: "그대로닉네임",
      gameMoney: NICKNAME_TICKET_COST - 1,
    });
  });

  test("refuses a nickname already taken by another user and does not deduct money", () => {
    const first = getOrCreateUser("sub-ticket-3", {});
    setNickname(first.id, "먼저찜한닉네임");
    const second = getOrCreateUser("sub-ticket-4", {});
    setNickname(second.id, "내닉네임");
    addGameMoney(second.id, NICKNAME_TICKET_COST + 5000);

    const result = useNicknameTicket(second.id, "먼저찜한닉네임");

    expect(result).toBe("taken");
    expect(getUserById(second.id)).toMatchObject({
      nickname: "내닉네임",
      gameMoney: NICKNAME_TICKET_COST + 5000,
    });
  });
});
```

- [ ] **Step 2: 테스트 실행해서 실패하는지 확인 (아직 `useNicknameTicket`이 없음)**

Run: `cd server && npx vitest run googleAuth -t "useNicknameTicket"`
Expected: FAIL — `useNicknameTicket` is not exported / not a function

- [ ] **Step 3: `googleAuth.ts`에 `NICKNAME_TICKET_COST`와 `useNicknameTicket` 구현**

`server/src/auth/googleAuth.ts:314-318`(`randomHexColor` 함수 뒤, `export type ShopEffect` 앞)에 삽입:

```ts
export const NICKNAME_TICKET_COST = 30000;

export type UseNicknameTicketResult = "ok" | "taken" | "insufficient_funds";

// setNickname과 같은 유니크 체크를 쓰되, "이미 설정된 닉네임"이라는 이유로 막지 않는다
// (그게 이 아이템의 존재 이유 — 최초 1회 제한을 유료로 우회). 유니크 확인 → 잔액 확인 →
// 차감+변경 순서 — 유니크 확인이 공짜라 먼저 걸러서, 어차피 실패할 요청 때문에 돈부터
// 빠지는 일이 없게 한다.
export function useNicknameTicket(userId: number, nickname: string): UseNicknameTicketResult {
  const clean = sanitizeNickname(nickname);
  const taken = db.prepare(`SELECT 1 FROM users WHERE nickname = ? AND id != ?`).get(clean, userId);
  if (taken) return "taken";
  const row = db.prepare(`SELECT game_money AS gameMoney FROM users WHERE id = ?`).get(userId) as
    | { gameMoney: number }
    | undefined;
  if (!row || row.gameMoney < NICKNAME_TICKET_COST) return "insufficient_funds";
  db.prepare(`UPDATE users SET game_money = game_money - ?, nickname = ? WHERE id = ?`).run(
    NICKNAME_TICKET_COST,
    clean,
    userId,
  );
  return "ok";
}
```

- [ ] **Step 4: 테스트 재실행해서 통과 확인**

Run: `cd server && npx vitest run googleAuth -t "useNicknameTicket"`
Expected: PASS (3개 전부)

- [ ] **Step 5: `createServer.ts`에 라우트 추가**

import 블록(`"./auth/googleAuth"`에서 가져오는 곳, `NICKNAME_REROLL_COST,` 다음 줄 근처)에 `NICKNAME_TICKET_COST,`와 `useNicknameTicket,`를 알파벳 순서에 맞게 추가.

`app.post("/api/profile/reroll-color", ...)` 라우트(`server/src/createServer.ts:799-812`) 바로 뒤에 추가:

```ts
  app.post("/api/shop/nickname-ticket", (req, res) => {
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
    const result = useNicknameTicket(userId, nickname);
    if (result === "taken") {
      res.status(409).json({ error: "이미 사용 중인 닉네임이에요." });
      return;
    }
    if (result === "insufficient_funds") {
      res.status(400).json({ error: "게임머니가 부족해요." });
      return;
    }
    const user = getUserById(userId);
    res.json({ nickname: user?.nickname ?? null, gameMoney: user?.gameMoney ?? 0 });
  });
```

- [ ] **Step 6: 타입체크 + 서버 전체 테스트**

Run: `cd server && npm run build && npx vitest run`
Expected: 에러 없음, 이 태스크에서 추가한 테스트 전부 PASS, 기존 테스트 회귀 없음.

- [ ] **Step 7: 커밋**

```bash
git add server/src/auth/googleAuth.ts server/src/auth/googleAuth.test.ts server/src/createServer.ts
git commit -m "서버: 닉네임변경권(30,000원) 추가 — 최초 1회 제한을 유료로 우회"
```

---

### Task 3: 서버 — 확성기 (2,500원)

**Files:**
- Create: `server/src/game/megaphone.ts`
- Test: `server/src/game/megaphone.test.ts`
- Modify: `server/src/auth/googleAuth.ts` (같은 자리, Task 2가 추가한 코드 뒤)
- Test: `server/src/auth/googleAuth.test.ts`
- Modify: `server/src/createServer.ts`

**Interfaces:**
- Consumes: 없음(새 독립 모듈).
- Produces: `game/megaphone.ts`에서 `export const MAX_MEGAPHONE_LENGTH = 40`, `export type MegaphoneMessage = { nickname: string; message: string; timestamp: number }`, `export function sanitizeMegaphoneMessage(input: unknown): string | null`, `export function subscribe(req: Request, res: Response): void`, `export function broadcast(nickname: string, message: string): void`, `export function _resetForTest(): void`, `export function _subscriberCountForTest(): number`. `googleAuth.ts`에서 `export const MEGAPHONE_COST = 2500`, `export type UseMegaphoneResult = { ok: true; gameMoney: number } | { ok: false; reason: "insufficient_funds" }`, `export function useMegaphone(userId: number): UseMegaphoneResult` — Task 4(클라이언트)가 이 이름들을 그대로 가정함.

- [ ] **Step 1: `game/megaphone.ts`에 대한 실패하는 테스트부터 작성**

`server/src/game/megaphone.test.ts` 신규 생성(`server/src/admin/pressMonitor.test.ts`의 mock req/res 패턴을 그대로 따름):

```ts
import { beforeEach, describe, expect, test } from "vitest";
import type { Request, Response } from "express";
import { _resetForTest, _subscriberCountForTest, broadcast, sanitizeMegaphoneMessage, subscribe } from "./megaphone";

// server/src/admin/pressMonitor.test.ts의 makeReqRes()와 동일한 최소 stand-in.
function makeReqRes() {
  const written: string[] = [];
  const closeHandlers: (() => void)[] = [];
  const req = {
    on: (event: string, handler: () => void) => {
      if (event === "close") closeHandlers.push(handler);
    },
  } as unknown as Request;
  const res = {
    setHeader: () => {},
    flushHeaders: () => {},
    write: (chunk: string) => {
      written.push(chunk);
    },
    on: () => {},
  } as unknown as Response;
  return { req, res, written, triggerClose: () => closeHandlers.forEach((h) => h()) };
}

describe("sanitizeMegaphoneMessage", () => {
  test("trims whitespace and rejects an empty result", () => {
    expect(sanitizeMegaphoneMessage("   ")).toBeNull();
  });

  test("rejects non-string input", () => {
    expect(sanitizeMegaphoneMessage(123)).toBeNull();
  });

  test("truncates to 40 characters", () => {
    const long = "가".repeat(50);
    expect(sanitizeMegaphoneMessage(long)).toHaveLength(40);
  });

  test("passes through a normal short message unchanged", () => {
    expect(sanitizeMegaphoneMessage("안녕하세요")).toBe("안녕하세요");
  });
});

describe("megaphone subscribe/broadcast", () => {
  beforeEach(() => {
    _resetForTest();
  });

  test("broadcast delivers the nickname and message to all subscribers", () => {
    const a = makeReqRes();
    const b = makeReqRes();
    subscribe(a.req, a.res);
    subscribe(b.req, b.res);

    broadcast("공지왕", "안녕하세요");

    expect(a.written).toHaveLength(1);
    expect(a.written[0]).toContain('"nickname":"공지왕"');
    expect(a.written[0]).toContain('"message":"안녕하세요"');
    expect(b.written).toHaveLength(1);
  });

  test("a closed connection is removed and no longer receives broadcasts", () => {
    const client = makeReqRes();
    subscribe(client.req, client.res);
    expect(_subscriberCountForTest()).toBe(1);

    client.triggerClose();
    expect(_subscriberCountForTest()).toBe(0);

    broadcast("아무개", "메시지");
    expect(client.written).toHaveLength(0);
  });

  test("a newly-subscribing client immediately receives the most recent broadcast within the resend window", () => {
    broadcast("먼저온사람", "5분 전 메시지");

    const late = makeReqRes();
    subscribe(late.req, late.res);

    expect(late.written).toHaveLength(1);
    expect(late.written[0]).toContain('"nickname":"먼저온사람"');
  });
});
```

- [ ] **Step 2: 테스트 실행해서 실패하는지 확인 (아직 `./megaphone` 파일 자체가 없음)**

Run: `cd server && npx vitest run megaphone`
Expected: FAIL — Cannot find module './megaphone' (또는 동일 취지의 import 에러)

- [ ] **Step 3: `server/src/game/megaphone.ts` 구현**

`server/src/admin/announcements.ts`와 거의 동일한 구조, 메시지 형태만 다름:

```ts
import type { Request, Response } from "express";

const MAX_MEGAPHONE_LENGTH = 40;
const RESEND_WINDOW_MS = 5 * 60 * 1000;

export type MegaphoneMessage = { nickname: string; message: string; timestamp: number };

// 채팅(sanitizeChatText, ../game/chat.ts)과 같은 자리 — trim + 길이 제한, 빈 문자열이면
// null(닉네임과 달리 확성기 메시지엔 그럴듯한 기본값이 없으므로 호출부가 그냥 버림).
export function sanitizeMegaphoneMessage(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim().slice(0, MAX_MEGAPHONE_LENGTH);
  return trimmed || null;
}

const subscribers = new Set<Response>();
let lastMessage: MegaphoneMessage | null = null;

function shouldResend(message: MegaphoneMessage | null, now: number): message is MegaphoneMessage {
  return message !== null && now - message.timestamp <= RESEND_WINDOW_MS;
}

function formatSseMessage(message: MegaphoneMessage): string {
  return `data: ${JSON.stringify(message)}\n\n`;
}

export function subscribe(req: Request, res: Response): void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  if (shouldResend(lastMessage, Date.now())) {
    res.write(formatSseMessage(lastMessage));
  }

  subscribers.add(res);
  req.on("close", () => subscribers.delete(res));
  res.on("error", () => subscribers.delete(res));
}

export function broadcast(nickname: string, message: string): void {
  const payload: MegaphoneMessage = { nickname, message, timestamp: Date.now() };
  lastMessage = payload;
  const sse = formatSseMessage(payload);
  for (const res of subscribers) {
    try {
      res.write(sse);
    } catch {
      subscribers.delete(res);
    }
  }
}

export function _resetForTest(): void {
  subscribers.clear();
  lastMessage = null;
}

export function _subscriberCountForTest(): number {
  return subscribers.size;
}
```

- [ ] **Step 4: 테스트 재실행해서 통과 확인**

Run: `cd server && npx vitest run megaphone`
Expected: PASS (전부)

- [ ] **Step 5: `useMegaphone`에 대한 실패하는 테스트 작성 (`googleAuth.test.ts`)**

Task 2에서 수정한 import 블록에 `MEGAPHONE_COST,`와 `useMegaphone,`를 알파벳 순서에 맞게 추가(최종 블록):

```ts
import {
  addGameMoney,
  adminSetNickname,
  equipEffect,
  getOrCreateUser,
  getOwnedEffects,
  getTopRanking,
  getUserById,
  listUsers,
  MEGAPHONE_COST,
  NICKNAME_REROLL_COST,
  NICKNAME_TICKET_COST,
  purchaseEffect,
  recordRolePlayed,
  recordRoundAchievement,
  rerollNicknameColor,
  setNickname,
  setNicknameColor,
  setNicknameEffect,
  SHOP_PRICES,
  setUserBanned,
  touchLastLogin,
  useMegaphone,
  useNicknameTicket,
} from "./googleAuth";
```

Task 2에서 추가한 `describe("useNicknameTicket", ...)` 블록 뒤에 새 블록 추가:

```ts
describe("useMegaphone", () => {
  beforeEach(() => {
    db.exec("DELETE FROM users");
  });

  test("deducts exactly MEGAPHONE_COST when funds are sufficient", () => {
    const user = getOrCreateUser("sub-megaphone-1", {});
    addGameMoney(user.id, MEGAPHONE_COST + 1000);

    const result = useMegaphone(user.id);

    expect(result).toEqual({ ok: true, gameMoney: 1000 });
    expect(getUserById(user.id)?.gameMoney).toBe(1000);
  });

  test("refuses when funds are insufficient and changes nothing", () => {
    const user = getOrCreateUser("sub-megaphone-2", {});
    addGameMoney(user.id, MEGAPHONE_COST - 1);

    const result = useMegaphone(user.id);

    expect(result).toEqual({ ok: false, reason: "insufficient_funds" });
    expect(getUserById(user.id)?.gameMoney).toBe(MEGAPHONE_COST - 1);
  });
});
```

- [ ] **Step 6: 테스트 실행해서 실패하는지 확인 (아직 `useMegaphone`이 없음)**

Run: `cd server && npx vitest run googleAuth -t "useMegaphone"`
Expected: FAIL — `useMegaphone` is not exported / not a function

- [ ] **Step 7: `googleAuth.ts`에 `MEGAPHONE_COST`와 `useMegaphone` 구현**

Task 2에서 추가한 `useNicknameTicket` 함수 바로 뒤에 삽입:

```ts
export const MEGAPHONE_COST = 2500;

export type UseMegaphoneResult = { ok: true; gameMoney: number } | { ok: false; reason: "insufficient_funds" };

// 방송 자체(누구에게 보여줄지)는 이 함수의 관심사가 아님 — 여기서는 잔액만 확인/차감하고,
// 실제 SSE 방송은 라우트가 game/megaphone.ts의 broadcast()를 따로 호출한다.
export function useMegaphone(userId: number): UseMegaphoneResult {
  const row = db.prepare(`SELECT game_money AS gameMoney FROM users WHERE id = ?`).get(userId) as
    | { gameMoney: number }
    | undefined;
  if (!row || row.gameMoney < MEGAPHONE_COST) return { ok: false, reason: "insufficient_funds" };
  db.prepare(`UPDATE users SET game_money = game_money - ? WHERE id = ?`).run(MEGAPHONE_COST, userId);
  return { ok: true, gameMoney: row.gameMoney - MEGAPHONE_COST };
}
```

- [ ] **Step 8: 테스트 재실행해서 통과 확인**

Run: `cd server && npx vitest run googleAuth -t "useMegaphone"`
Expected: PASS (2개 전부)

- [ ] **Step 9: `createServer.ts`에 라우트 추가 + `GET /api/shop` 응답 확장**

`import { broadcast, subscribe } from "./admin/announcements";`(`server/src/createServer.ts:13`) 바로 뒤에 별칭을 준 import 추가:

```ts
import {
  broadcast as broadcastMegaphone,
  sanitizeMegaphoneMessage,
  subscribe as subscribeMegaphone,
} from "./game/megaphone";
```

googleAuth import 블록에 `MEGAPHONE_COST,`와 `useMegaphone,`를 알파벳 순서에 맞게 추가.

`GET /api/shop` 라우트(`server/src/createServer.ts:814-833`)의 `res.json({...})` 내부를 교체:

```ts
    res.json({
      gameMoney: user.gameMoney,
      prices: SHOP_PRICES,
      owned: getOwnedEffects(userId),
      equipped: user.nicknameEffect,
      rerollColorPrice: NICKNAME_REROLL_COST,
      nicknameTicketPrice: NICKNAME_TICKET_COST,
      megaphonePrice: MEGAPHONE_COST,
    });
```

Task 2에서 추가한 `POST /api/shop/nickname-ticket` 라우트 바로 뒤에 추가:

```ts
  app.post("/api/shop/megaphone", (req, res) => {
    const cookies = (req as unknown as { cookies?: Record<string, string> }).cookies;
    const userId = verifySession(cookies?.[SESSION_COOKIE_NAME]);
    if (!userId) {
      res.status(401).json({ error: "로그인이 필요합니다." });
      return;
    }
    const { message } = req.body as { message?: unknown };
    const clean = sanitizeMegaphoneMessage(message);
    if (!clean) {
      res.status(400).json({ error: "메시지를 입력해주세요." });
      return;
    }
    const user = getUserById(userId);
    if (!user?.nickname) {
      res.status(400).json({ error: "닉네임을 먼저 설정해주세요." });
      return;
    }
    const result = useMegaphone(userId);
    if (!result.ok) {
      res.status(400).json({ error: "게임머니가 부족해요." });
      return;
    }
    broadcastMegaphone(user.nickname, clean);
    res.json({ gameMoney: result.gameMoney });
  });

  app.get("/api/megaphone/stream", (req, res) => {
    subscribeMegaphone(req, res);
  });
```

- [ ] **Step 10: 타입체크 + 서버 전체 테스트**

Run: `cd server && npm run build && npx vitest run`
Expected: 에러 없음, 이 태스크에서 추가한 테스트 전부 PASS, 기존 테스트 회귀 없음.

- [ ] **Step 11: 커밋**

```bash
git add server/src/game/megaphone.ts server/src/game/megaphone.test.ts server/src/auth/googleAuth.ts server/src/auth/googleAuth.test.ts server/src/createServer.ts
git commit -m "서버: 확성기(2,500원) 추가 — 관리자 공지와 별도 SSE 채널"
```

---

### Task 4: 클라이언트 — 상점에 두 아이템 카드 추가

**Files:**
- Modify: `client/src/game/shop.ts`
- Modify: `client/src/components/ShopModal.tsx`
- Modify: `client/src/components/ShopModal.module.css`

**Interfaces:**
- Consumes: Task 2의 `POST /api/shop/nickname-ticket`(body `{ nickname }`, 응답 `{ nickname, gameMoney }`, 실패 시 `{ error }` + 409/400), Task 3의 `POST /api/shop/megaphone`(body `{ message }`, 응답 `{ gameMoney }`, 실패 시 `{ error }` + 400), Task 3이 `GET /api/shop` 응답에 추가한 `nicknameTicketPrice`/`megaphonePrice` 필드.
- Produces: 없음(이 태스크가 이 기능의 마지막 클라이언트 조각은 아님 — Task 5가 별도로 배너를 만듦).

- [ ] **Step 1: `client/src/game/shop.ts`에 `ShopState` 타입 확장 + 새 함수 2개 추가**

`client/src/game/shop.ts` 전체를 교체:

```ts
import type { NicknameEffect } from "./nicknameStyle";

export type ShopEffect = Exclude<NicknameEffect, "none">;

export type ShopState = {
  gameMoney: number;
  prices: Record<ShopEffect, number>;
  owned: NicknameEffect[];
  equipped: NicknameEffect;
  rerollColorPrice: number;
  nicknameTicketPrice: number;
  megaphonePrice: number;
};

async function shopFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: "same-origin", ...init });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error ?? "요청에 실패했어요.");
  return body as T;
}

export function getShop(): Promise<ShopState> {
  return shopFetch("/api/shop");
}

export function purchaseEffect(effect: ShopEffect): Promise<{ ok: true }> {
  return shopFetch("/api/shop/purchase", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ effect }),
  });
}

export function equipEffect(effect: NicknameEffect): Promise<{ ok: true }> {
  return shopFetch("/api/shop/equip", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ effect }),
  });
}

export function useNicknameTicket(nickname: string): Promise<{ nickname: string; gameMoney: number }> {
  return shopFetch("/api/shop/nickname-ticket", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nickname }),
  });
}

export function sendMegaphone(message: string): Promise<{ gameMoney: number }> {
  return shopFetch("/api/shop/megaphone", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
}
```

- [ ] **Step 2: 클라이언트 타입체크로 `ShopModal.tsx`가 아직 안 깨졌는지 확인**

Run: `cd client && npx tsc -b`
Expected: 에러 없음(`ShopState`에 필드가 늘었을 뿐 기존 필드는 그대로라 `ShopModal.tsx`는 아직 안 건드려도 컴파일됨)

- [ ] **Step 3: `ShopModal.tsx`에 두 아이템 카드 + 인라인 입력 폼 추가**

`client/src/components/ShopModal.tsx` 전체를 교체:

```tsx
import { useEffect, useState } from "react";
import {
  equipEffect,
  getShop,
  purchaseEffect,
  sendMegaphone,
  useNicknameTicket,
  type ShopState,
} from "../game/shop";
import { rerollNicknameColor } from "../game/profile";
import { nicknameStyle, type NicknameEffect, type NicknameParticle } from "../game/nicknameStyle";
import styles from "./ShopModal.module.css";

const MAX_NICKNAME_LENGTH = 10;
const MAX_MEGAPHONE_LENGTH = 40;

const SHOP_EFFECTS: Exclude<NicknameEffect, "none">[] = ["rainbow", "shine", "hologram", "pulse", "neon", "chrome"];
const EFFECT_LABELS: Record<Exclude<NicknameEffect, "none">, string> = {
  rainbow: "레인보우",
  shine: "샤인",
  hologram: "홀로그램",
  pulse: "Pulse",
  neon: "네온사인",
  chrome: "크롬",
};

export function ShopModal({
  nickname,
  nicknameColor,
  nicknameGlow,
  nicknameParticle,
  onClose,
  onProfileChanged,
}: {
  nickname: string;
  nicknameColor: string | null;
  nicknameGlow: boolean;
  nicknameParticle: NicknameParticle;
  onClose: () => void;
  onProfileChanged: () => void;
}) {
  const [shop, setShop] = useState<ShopState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyEffect, setBusyEffect] = useState<string | null>(null);

  const [nicknameTicketOpen, setNicknameTicketOpen] = useState(false);
  const [nicknameTicketValue, setNicknameTicketValue] = useState("");
  const [megaphoneOpen, setMegaphoneOpen] = useState(false);
  const [megaphoneValue, setMegaphoneValue] = useState("");

  function refresh() {
    getShop()
      .then(setShop)
      .catch((err) => setError(err instanceof Error ? err.message : "상점을 불러오지 못했어요."));
  }

  useEffect(refresh, []);

  async function handlePurchase(effect: Exclude<NicknameEffect, "none">) {
    setBusyEffect(effect);
    setError(null);
    try {
      await purchaseEffect(effect);
      refresh();
      onProfileChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "구매에 실패했어요.");
    } finally {
      setBusyEffect(null);
    }
  }

  async function handleEquip(effect: NicknameEffect) {
    setBusyEffect(effect);
    setError(null);
    try {
      await equipEffect(effect);
      refresh();
      onProfileChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "장착에 실패했어요.");
    } finally {
      setBusyEffect(null);
    }
  }

  async function handleRerollColor() {
    setBusyEffect("reroll-color");
    setError(null);
    try {
      await rerollNicknameColor();
      refresh();
      onProfileChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "닉색 변경에 실패했어요.");
    } finally {
      setBusyEffect(null);
    }
  }

  async function handleNicknameTicket() {
    const trimmed = nicknameTicketValue.trim();
    if (!trimmed) return;
    setBusyEffect("nickname-ticket");
    setError(null);
    try {
      await useNicknameTicket(trimmed);
      setNicknameTicketOpen(false);
      setNicknameTicketValue("");
      refresh();
      onProfileChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "닉네임 변경에 실패했어요.");
    } finally {
      setBusyEffect(null);
    }
  }

  async function handleMegaphone() {
    const trimmed = megaphoneValue.trim();
    if (!trimmed) return;
    setBusyEffect("megaphone");
    setError(null);
    try {
      await sendMegaphone(trimmed);
      setMegaphoneOpen(false);
      setMegaphoneValue("");
      refresh();
      onProfileChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "확성기 전송에 실패했어요.");
    } finally {
      setBusyEffect(null);
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h2 className={styles.title}>상점</h2>
        {!shop && !error && <p className={styles.loading}>불러오는 중...</p>}
        {error && <p className={styles.error}>{error}</p>}
        {shop && (
          <>
            <p className={styles.money}>🪙 {shop.gameMoney.toLocaleString("ko-KR")}원</p>
            <div className={styles.grid}>
              {[...SHOP_EFFECTS].sort((a, b) => shop.prices[a] - shop.prices[b]).map((effect) => {
                const isOwned = shop.owned.includes(effect);
                const isEquipped = shop.equipped === effect;
                const preview = nicknameStyle(nicknameColor, effect, nicknameGlow, nicknameParticle);
                return (
                  <div key={effect} className={styles.card}>
                    <span className={`${styles.preview} ${preview.className}`} style={preview.style}>
                      {nickname}
                      {preview.particles.map((p) => (
                        <span key={p.key} className={p.className} style={p.style} />
                      ))}
                    </span>
                    <span className={styles.effectName}>{EFFECT_LABELS[effect]}</span>
                    {isOwned ? (
                      <button
                        className={styles.actionButton}
                        disabled={isEquipped || busyEffect === effect}
                        onClick={() => handleEquip(effect)}
                      >
                        {isEquipped ? "장착됨" : "장착하기"}
                      </button>
                    ) : (
                      <button
                        className={styles.actionButton}
                        disabled={busyEffect === effect}
                        onClick={() => handlePurchase(effect)}
                      >
                        구매 ({shop.prices[effect].toLocaleString("ko-KR")}원)
                      </button>
                    )}
                  </div>
                );
              })}
              <div className={styles.card}>
                <span className={styles.preview}>{nickname}</span>
                <span className={styles.effectName}>없음</span>
                <button
                  className={styles.actionButton}
                  disabled={shop.equipped === "none" || busyEffect === "none"}
                  onClick={() => handleEquip("none")}
                >
                  {shop.equipped === "none" ? "장착됨" : "장착하기"}
                </button>
              </div>
            </div>
            <div className={styles.rerollCard}>
              <span className={styles.effectName}>닉네임 색 변경</span>
              <button
                className={styles.actionButton}
                disabled={busyEffect === "reroll-color"}
                onClick={handleRerollColor}
              >
                구매 ({shop.rerollColorPrice.toLocaleString("ko-KR")}원)
              </button>
            </div>
            <div className={styles.rerollCard}>
              <span className={styles.effectName}>닉네임변경권</span>
              {nicknameTicketOpen ? (
                <div className={styles.inlineForm}>
                  <input
                    className={styles.inlineInput}
                    value={nicknameTicketValue}
                    onChange={(e) => setNicknameTicketValue(e.target.value)}
                    maxLength={MAX_NICKNAME_LENGTH}
                    placeholder="새 닉네임"
                    autoFocus
                  />
                  <button
                    className={styles.actionButton}
                    disabled={busyEffect === "nickname-ticket" || !nicknameTicketValue.trim()}
                    onClick={handleNicknameTicket}
                  >
                    변경
                  </button>
                </div>
              ) : (
                <button className={styles.actionButton} onClick={() => setNicknameTicketOpen(true)}>
                  구매 ({shop.nicknameTicketPrice.toLocaleString("ko-KR")}원)
                </button>
              )}
            </div>
            <div className={styles.rerollCard}>
              <span className={styles.effectName}>확성기</span>
              {megaphoneOpen ? (
                <div className={styles.inlineForm}>
                  <input
                    className={styles.inlineInput}
                    value={megaphoneValue}
                    onChange={(e) => setMegaphoneValue(e.target.value)}
                    maxLength={MAX_MEGAPHONE_LENGTH}
                    placeholder="전체에 보낼 메시지"
                    autoFocus
                  />
                  <button
                    className={styles.actionButton}
                    disabled={busyEffect === "megaphone" || !megaphoneValue.trim()}
                    onClick={handleMegaphone}
                  >
                    보내기
                  </button>
                </div>
              ) : (
                <button className={styles.actionButton} onClick={() => setMegaphoneOpen(true)}>
                  구매 ({shop.megaphonePrice.toLocaleString("ko-KR")}원)
                </button>
              )}
            </div>
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

- [ ] **Step 4: `ShopModal.module.css`에 인라인 폼 스타일 추가**

`client/src/components/ShopModal.module.css` 끝(`.closeButton` 규칙 뒤)에 추가:

```css
.inlineForm {
  display: flex;
  gap: 0.4rem;
  align-items: center;
}

.inlineInput {
  padding: 0.4rem 0.5rem;
  font-size: 0.85rem;
  border-radius: 0.4rem;
  border: 1px solid rgba(255, 255, 255, 0.3);
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
  width: 8rem;
  box-sizing: border-box;
}
```

- [ ] **Step 5: 타입체크 + 빌드**

Run: `cd client && npx tsc -b && npm run build`
Expected: 에러 없음, 빌드 성공.

- [ ] **Step 6: 커밋**

```bash
git add client/src/game/shop.ts client/src/components/ShopModal.tsx client/src/components/ShopModal.module.css
git commit -m "클라이언트: 상점에 닉네임변경권/확성기 카드 추가"
```

---

### Task 5: 클라이언트 — 확성기 배너

**Files:**
- Create: `client/src/components/MegaphoneBanner.tsx`
- Create: `client/src/components/MegaphoneBanner.module.css`
- Modify: `client/src/App.tsx`

**Interfaces:**
- Consumes: Task 3의 `GET /api/megaphone/stream`(SSE, 각 이벤트 데이터가 `{ nickname: string; message: string; timestamp: number }` JSON).
- Produces: `export function MegaphoneBanner()` — `App.tsx`가 렌더링.

- [ ] **Step 1: `MegaphoneBanner.tsx` 작성**

`client/src/components/AnnouncementBanner.tsx`와 거의 동일한 구조(20초 자동 소멸, 닫기
버튼, 같은 타임스탬프 재수신 시 안 다시 열리는 로직)를 그대로 복제하되 메시지 형태와
표시 방식만 다름:

```tsx
import { useEffect, useRef, useState } from "react";
import styles from "./MegaphoneBanner.module.css";

type MegaphoneMessage = { nickname: string; message: string; timestamp: number };

const AUTO_DISMISS_MS = 20_000;

export function MegaphoneBanner() {
  const [payload, setPayload] = useState<MegaphoneMessage | null>(null);
  const [dismissed, setDismissed] = useState(false);
  // AnnouncementBanner와 같은 이유 — SSE 재연결로 같은 메시지가 다시 오더라도
  // 이미 닫은 배너가 도로 열리면 안 되고, 타임스탬프가 실제로 바뀐 새 메시지만
  // 다시 연다.
  const lastTimestampRef = useRef<number | null>(null);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const source = new EventSource("/api/megaphone/stream");
    source.onmessage = (event) => {
      const data = JSON.parse(event.data) as MegaphoneMessage;
      setPayload(data);
      if (data.timestamp !== lastTimestampRef.current) {
        setDismissed(false);
        if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
        dismissTimerRef.current = setTimeout(() => setDismissed(true), AUTO_DISMISS_MS);
      }
      lastTimestampRef.current = data.timestamp;
    };
    return () => {
      source.close();
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    };
  }, []);

  if (!payload || dismissed) return null;

  return (
    <div className={styles.banner} role="status">
      <span>
        📢 <b>{payload.nickname}</b>: {payload.message}
      </span>
      <button type="button" onClick={() => setDismissed(true)} aria-label="확성기 메시지 닫기">
        ×
      </button>
    </div>
  );
}
```

- [ ] **Step 2: `MegaphoneBanner.module.css` 작성**

관리자 공지 배너(짙은 남색 `#1f2937`)와 시각적으로 구분되는 주황/황토색 계열:

```css
.banner {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 999;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  padding: 0.6rem 1rem;
  background: #92400e;
  color: #fff7ed;
  font-size: 0.85rem;
  text-align: center;
}

.banner button {
  background: none;
  border: none;
  color: #fff7ed;
  font-size: 1.1rem;
  line-height: 1;
  cursor: pointer;
  padding: 0 0.25rem;
}
```

(`z-index: 999` — 관리자 공지 배너의 `1000`보다 한 단계 낮게 둬서, 두 배너가 동시에 뜨는
드문 경우에도 관리자 공지가 항상 위로 오도록 함. 두 배너가 겹치는 문제 자체는 알려진
한계로 남김 — 설계 문서 참고.)

- [ ] **Step 3: `App.tsx`에 렌더링 추가**

`client/src/App.tsx:13`(`import { AnnouncementBanner } from "./components/AnnouncementBanner";`) 다음 줄에 추가:

```ts
import { MegaphoneBanner } from "./components/MegaphoneBanner";
```

`<AnnouncementBanner />`가 렌더링되는 자리(`client/src/App.tsx:175`) 바로 뒤에 추가:

```tsx
      <AnnouncementBanner />
      <MegaphoneBanner />
```

- [ ] **Step 4: 타입체크 + 빌드**

Run: `cd client && npx tsc -b && npm run build`
Expected: 에러 없음, 빌드 성공.

- [ ] **Step 5: 로컬에서 동기화 후 수동 확인**

Run: `npm run sync-public` (루트에서)

`http://localhost:2567`에서 로그인 상태로 상점을 열어:
- 닉네임변경권 "구매" 클릭 → 입력창이 나타나는지, 다른 닉네임 입력 후 "변경" 클릭 시
  실제로 닉네임이 바뀌고 게임머니가 30,000원 차감되는지.
- 중복된 닉네임을 입력하면 에러 메시지가 뜨고 아무것도 안 바뀌는지.
- 확성기 "구매" 클릭 → 메시지 입력 후 "보내기" 클릭 시 화면 상단에 주황색 배너로
  "📢 닉네임: 메시지"가 뜨는지(다른 브라우저 탭/창에서도 동시에 뜨는지 — 두 개의 브라우저
  탭을 열어 확인).
- 20초 후 배너가 자동으로 사라지는지, 닫기(×) 버튼으로 먼저 닫을 수 있는지.
- 관리자 페이지에서 "전체 공지"를 보냈을 때 확성기 배너와 서로 겹쳐쓰지 않고 별도로
  뜨는지(거의 동시에 보내면 화면 상단에서 살짝 겹칠 수 있음 — 알려진 한계이므로 정상).

- [ ] **Step 6: 커밋**

```bash
git add client/src/components/MegaphoneBanner.tsx client/src/components/MegaphoneBanner.module.css client/src/App.tsx
git commit -m "클라이언트: 확성기 배너(MegaphoneBanner) 추가"
```

---

## 최종 확인

```bash
cd server && npx vitest run && npm run build
cd ../client && npx tsc -b && npm run build
```

전부 그린이면(팀 탈락 관련 기존 무관 실패가 있다면 이 플랜과 무관하니 무시) 배포 여부를
확인한다(이 프로젝트는 브랜치 없이 `main`에 직접 커밋하는 컨벤션이므로 finishing-a-development-branch의
"3옵션" 메뉴는 건너뜀).
