# 닉네임변경권 + 확성기 상점 아이템 + 판당 기본 지급액 인상 — 설계 문서

## 배경

기존 닉네임은 "최초 1회 설정 후 변경 불가"라 실수로 지은 닉네임을 바꿀 방법이 없었다.
유료 아이템(닉네임변경권)으로 그 제한을 우회할 수 있게 한다. 또한 유저들이 서로에게
전체 방송 메시지를 보낼 수 있는 확성기 아이템을 추가한다. 겸사겸사 턴 성공 시 지급되는
기본 게임머니도 10원 → 20원으로 올린다.

## 1. 판당 기본 지급액 인상

`server/src/rooms/MatchRoom.ts`의 `creditTurnSuccess`(약 912번 줄):

```ts
private creditTurnSuccess(team: TeamState) {
  const reward = 20 * this.state.teams.length;
  for (const sessionId of [team.pigSessionId, team.rabbitSessionId]) {
    const userId = this.playerUserIds.get(sessionId);
    if (userId) addGameMoney(userId, reward);
  }
}
```

`10` → `20`으로 바뀌는 것 외 로직 변경 없음. 팀 수를 곱하는 기존 계산식은 그대로 유지
(예: 4팀 방이면 턴 성공마다 팀당 40원 → 80원).

## 2. 닉네임변경권 (30,000원)

기존 `setNickname`(`googleAuth.ts`)은 `nickname IS NULL`인 계정에만 동작해서 "최초
1회"를 강제한다. 닉네임변경권은 이 제한과 무관하게 이미 닉네임이 있는 계정도 유료로
바꿀 수 있게 하는 소모성 아이템 — 구매 즉시 사용되며 "보유 아이템"으로 남지 않는다
(레인보우 같은 효과와 달리 인벤토리 개념이 없음).

### 서버 — `server/src/auth/googleAuth.ts`

```ts
export const NICKNAME_TICKET_COST = 30000;

export type UseNicknameTicketResult = "ok" | "taken" | "insufficient_funds";

// setNickname과 같은 유니크 체크를 쓰되, "이미 설정된 닉네임"이라는 이유로 막지 않는다
// (그게 이 아이템의 존재 이유). 유니크 확인 → 잔액 확인 → 차감+변경 순서 — 유니크 확인이
// 공짜라 먼저 걸러서, 어차피 실패할 요청 때문에 돈부터 빠지는 일이 없게 한다.
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

### 라우트 — `server/src/createServer.ts`

`POST /api/shop/nickname-ticket` — `/api/auth/nickname`과 같은 입력 검증(빈 문자열/비문자열
400), 결과 매핑만 다름(`taken`→409, `insufficient_funds`→400). 성공 시 갱신된
`nickname`/`gameMoney`를 응답에 포함(클라이언트가 화면 전체의 닉네임 표시를 즉시 갱신할 수
있도록).

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

### 클라이언트

- `client/src/game/shop.ts`에 `useNicknameTicket(nickname: string): Promise<{ nickname: string; gameMoney: number }>` 추가 (`POST /api/shop/nickname-ticket` 호출).
- `ShopModal.tsx`에 기존 "닉네임 색 변경" 카드(`rerollCard`) 옆에 새 카드 추가. "구매" 버튼을
  누르면 그 카드 안에 텍스트 입력창(`maxLength=10`, 기존 `MAX_NICKNAME_LENGTH`와 동일) +
  "변경" 버튼이 나타나는 인라인 방식(네이티브 `prompt()` 미사용 — 이 앱의 다른 입력 UI와
  통일). 성공하면 입력창을 닫고 `onProfileChanged()`를 호출해 화면 전체(로비, 게임 내
  닉네임 표시 등)의 닉네임을 갱신한다.

## 3. 확성기 (3,000원, 2026-08-01 2,500→3,000 조정)

관리자 "전체 공지"(`server/src/admin/announcements.ts` + `AnnouncementBanner.tsx`)와 같은
SSE 배너 방식을 재사용하되, **관리자 공지와 겹쳐쓰지 않도록 완전히 별도 채널**로 만든다.

### 서버 — `server/src/game/megaphone.ts` (신규)

`admin/announcements.ts`와 거의 동일한 구조, 메시지 형태만 `{ nickname, message, timestamp }`:

```ts
import type { Request, Response } from "express";

const MAX_MEGAPHONE_LENGTH = 40;
const RESEND_WINDOW_MS = 5 * 60 * 1000;

export type MegaphoneMessage = { nickname: string; message: string; timestamp: number };

// 채팅(sanitizeChatText)과 같은 자리 — trim + 길이 제한, 빈 문자열이면 null.
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

### `googleAuth.ts`에 추가

```ts
export const MEGAPHONE_COST = 3000;

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

### 라우트 — `server/src/createServer.ts`

```ts
app.get("/api/megaphone/stream", (req, res) => {
  megaphoneSubscribe(req, res);
});

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
  megaphoneBroadcast(user.nickname, clean);
  res.json({ gameMoney: result.gameMoney });
});
```

(`megaphoneSubscribe`/`megaphoneBroadcast`는 `game/megaphone.ts`의 `subscribe`/`broadcast`를
이름 충돌 없이 import하기 위한 별칭 — `admin/announcements.ts`의 `subscribe`/`broadcast`가
이미 같은 파일에서 쓰이고 있으므로.)

### 클라이언트

- `client/src/components/MegaphoneBanner.tsx` + `.module.css` (신규) — `AnnouncementBanner`와
  거의 동일한 구조(20초 자동 소멸, 닫기 버튼, 5분 재전송 윈도우 대응 로직)를 그대로 복제하되:
  - `/api/megaphone/stream` 구독.
  - 메시지 형태가 `{ nickname, message, timestamp }` — `<b>{nickname}</b>: {message}` 형태로 렌더링.
  - 배경색을 관리자 공지(짙은 남색 `#1f2937`)와 다르게 주황/황토색 계열로 지정하고 앞에
    📢 아이콘을 붙여 시각적으로 구분.
- `App.tsx`에 `<AnnouncementBanner />` 바로 옆에 `<MegaphoneBanner />` 추가.
  - **알려진 한계**: 두 배너 모두 화면 맨 위에 `position: fixed`라, 관리자 공지와 확성기가
    정확히 같은 타이밍에 뜨면 겹칠 수 있음. 관리자가 수동으로 보내는 공지와 유저가 유료로
    보내는 확성기가 동시에 뜰 확률은 낮다고 보고 이번 스코프에서는 감수 — 필요해지면 두
    배너를 한 flex 컨테이너로 묶어 자동으로 위아래 스택되도록 나중에 손본다.
- `client/src/game/shop.ts`에 `sendMegaphone(message: string): Promise<{ gameMoney: number }>` 추가.
- `ShopModal.tsx`에 확성기 카드 추가(닉네임변경권 카드 옆). "구매" 클릭 시 메시지 입력창
  (`maxLength=40`) + "보내기" 버튼이 나타나는 인라인 방식. 전송 성공 시 입력창을 닫고
  `onProfileChanged()`로 잔액을 갱신한다(배너 자체는 `MegaphoneBanner`가 SSE로 이미 받아
  자동으로 뜨므로 `ShopModal`이 직접 배너를 띄우지 않는다).

### `GET /api/shop` 응답 확장

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

`ShopState`(client `game/shop.ts`) 타입에 `nicknameTicketPrice: number`, `megaphonePrice: number` 추가.

## 테스트

- 서버: `googleAuth.test.ts`에 `useNicknameTicket`(정상 변경, 중복 닉네임 거부, 잔액 부족
  거부, 유니크 체크가 잔액 확인보다 먼저라 실패 시 돈이 안 빠지는지) + `useMegaphone`(정상
  차감, 잔액 부족 거부) 테스트 추가 — 기존 `addGameMoney`/`rerollNicknameColor` 테스트와
  같은 컨벤션(TDD, `toMatchObject`).
- 서버: `game/megaphone.test.ts` 신규 — `admin/announcements.test.ts`와 같은 패턴으로
  `sanitizeMegaphoneMessage`(빈 문자열/40자 초과 자르기) + subscribe/broadcast(구독자에게
  전달, 5분 재전송 윈도우) 테스트.
- 클라이언트: 이 프로젝트 컨벤션대로 UI 로직은 타입체크 + 수동 확인(Playwright)으로
  검증 — 상점에서 두 아이템 구매 플로우, 확성기 배너가 실제로 뜨는지 브라우저로 확인.

## 범위 제외

- 확성기/닉네임변경권 모두 사용 내역 로그(누가 언제 얼마에 무엇을 보냈는지) — 필요해지면
  별도 스펙.
- 확성기 메시지에 대한 욕설/도배 필터링 — 3,000원이라는 비용 자체가 약한 스팸 방지 역할을
  하고, 40자 제한도 있어 이번 스코프에서는 별도 필터를 만들지 않음. 문제가 실제로 생기면
  관리자 페이지에 신고/차단 기능을 추가로 검토.
- 관리자 공지 배너와 확성기 배너의 동시 노출 시 자동 스택(겹침 방지) — 위 "알려진 한계"
  참고, 나중에 필요해지면 별도로 손봄.
