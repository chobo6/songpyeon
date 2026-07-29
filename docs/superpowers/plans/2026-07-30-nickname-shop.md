# 닉네임 상점 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 닉네임 효과 6종(레인보우/샤인/홀로그램/Pulse/네온사인/크롬)을 게임머니로 구매해 영구 소유하고 자유롭게 장착/해제할 수 있는 상점을 만들고, 닉네임 색 변경권을 프로필 팝업에서 상점으로 옮긴다.

**Architecture:** 새 테이블 `owned_nickname_effects(user_id, effect)`로 "누가 무엇을 소유했는지"만 기록한다. 구매(소유권 획득 + 차감)와 장착(현재 표시 효과 변경, 무료)이 별개 동작이고, 관리자가 `/admin`에서 지급한 효과도 자동으로 소유 처리해 정합성을 맞춘다. 클라이언트는 새 `ShopModal`에서 6개 효과 카드(각각 본인 닉네임으로 실시간 미리보기) + 색 변경권 카드를 보여준다.

**Tech Stack:** TypeScript, better-sqlite3, React 19, Vitest.

## Global Constraints

- 인벤토리 방식: 효과를 사면 영구 소유, 이후 무료로 자유롭게 장착/해제(`"none"`으로 해제 포함).
- 가격(임시값, 사용자가 나중에 직접 조정 예정): 레인보우 20,000 / 샤인 15,000 / 홀로그램 25,000 / Pulse 12,000 / 네온사인 15,000 / 크롬 12,000. 닉네임 색 변경권은 기존 10,000원 그대로(변경 없음).
- 글로우는 이번 스코프에서 제외 — 여전히 관리자만 지급, 상점에서 안 팜.
- 관리자가 `/admin`에서 지급한 효과는 자동으로 `owned_nickname_effects`에 추가되어야 함(장착 변경 로직과 별개로, 소유권만).
- 상점의 모든 효과 카드(보유 여부 무관)는 본인 닉네임으로 실시간 미리보기를 보여줘야 함(서버 왕복 없이 클라이언트에서 `nicknameStyle()`로 즉시 렌더링).
- 장착(`equip`)은 `nickname_glow` 컬럼을 건드리지 않는다 — 관리자가 지급한 글로우 상태가 장착 변경으로 실수로 꺼지면 안 됨.

---

### Task 1: 서버 데이터 계층

**Files:**
- Modify: `server/src/db/connection.ts` (새 테이블)
- Modify: `server/src/auth/googleAuth.ts` (`NICKNAME_REROLL_COST` export, `setNicknameEffect` 수정, 신규 함수 3개)
- Test: `server/src/auth/googleAuth.test.ts`

**Interfaces:**
- Consumes: 없음(최하위 계층).
- Produces: `export const NICKNAME_REROLL_COST = 10000`, `export type ShopEffect = Exclude<NicknameEffect, "none">`, `export const SHOP_PRICES: Record<ShopEffect, number>`, `export function getOwnedEffects(userId: number): NicknameEffect[]`, `export function purchaseEffect(userId: number, effect: ShopEffect): "ok" | "insufficient_funds" | "already_owned"`, `export function equipEffect(userId: number, effect: NicknameEffect): "ok" | "not_owned"`.기존 `setNicknameEffect`가 이제 소유권도 같이 부여함. Task 2가 이 전부를 그대로 가져다 쓴다.

- [ ] **Step 1: `connection.ts`에 새 테이블 추가**

`chat_read_state` 테이블 정의 다음에 추가:

```ts
  db.exec(`
    CREATE TABLE IF NOT EXISTS owned_nickname_effects (
      user_id INTEGER NOT NULL,
      effect TEXT NOT NULL,
      purchased_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
      PRIMARY KEY (user_id, effect)
    )
  `);
```

- [ ] **Step 2: Write the failing tests**

`googleAuth.test.ts` 상단 import에 `equipEffect`, `getOwnedEffects`, `purchaseEffect` 추가, 파일 끝에 추가:

```ts
describe("purchaseEffect / equipEffect / getOwnedEffects", () => {
  beforeEach(() => {
    db.exec("DELETE FROM users");
    db.exec("DELETE FROM owned_nickname_effects");
  });

  test("purchasing deducts the exact price and records ownership", () => {
    const user = getOrCreateUser("sub-shop-1", {});
    addGameMoney(user.id, 15000);

    const result = purchaseEffect(user.id, "chrome");

    expect(result).toBe("ok");
    expect(getUserById(user.id)?.gameMoney).toBe(3000);
    expect(getOwnedEffects(user.id)).toEqual(["chrome"]);
  });

  test("refuses purchase when funds are insufficient and changes nothing", () => {
    const user = getOrCreateUser("sub-shop-2", {});
    addGameMoney(user.id, 5000);

    const result = purchaseEffect(user.id, "chrome");

    expect(result).toBe("insufficient_funds");
    expect(getUserById(user.id)?.gameMoney).toBe(5000);
    expect(getOwnedEffects(user.id)).toEqual([]);
  });

  test("refuses a duplicate purchase and doesn't charge twice", () => {
    const user = getOrCreateUser("sub-shop-3", {});
    addGameMoney(user.id, 100000);
    purchaseEffect(user.id, "chrome");

    const result = purchaseEffect(user.id, "chrome");

    expect(result).toBe("already_owned");
    expect(getUserById(user.id)?.gameMoney).toBe(100000 - 12000);
    expect(getOwnedEffects(user.id)).toEqual(["chrome"]);
  });

  test("equipping an owned effect updates nicknameEffect without touching glow", () => {
    const user = getOrCreateUser("sub-shop-4", {});
    addGameMoney(user.id, 100000);
    purchaseEffect(user.id, "neon");
    setNicknameEffect(user.id, "rainbow", true); // sets glow=true and also owns rainbow

    const result = equipEffect(user.id, "neon");

    expect(result).toBe("ok");
    const profile = getUserById(user.id);
    expect(profile?.nicknameEffect).toBe("neon");
    expect(profile?.nicknameGlow).toBe(true); // untouched by equip
  });

  test("refuses to equip an effect that isn't owned", () => {
    const user = getOrCreateUser("sub-shop-5", {});

    const result = equipEffect(user.id, "hologram");

    expect(result).toBe("not_owned");
    expect(getUserById(user.id)?.nicknameEffect).toBe("none");
  });

  test("equipping 'none' is always allowed even with nothing owned", () => {
    const user = getOrCreateUser("sub-shop-6", {});

    const result = equipEffect(user.id, "none");

    expect(result).toBe("ok");
    expect(getUserById(user.id)?.nicknameEffect).toBe("none");
  });

  test("setNicknameEffect (admin grant) also records ownership", () => {
    const user = getOrCreateUser("sub-shop-7", {});

    setNicknameEffect(user.id, "shine", false);

    expect(getOwnedEffects(user.id)).toEqual(["shine"]);
    expect(getUserById(user.id)?.nicknameEffect).toBe("shine");
  });

  test("setNicknameEffect with 'none' does not add a bogus ownership row", () => {
    const user = getOrCreateUser("sub-shop-8", {});

    setNicknameEffect(user.id, "none", false);

    expect(getOwnedEffects(user.id)).toEqual([]);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd server && npm test -- googleAuth`
Expected: FAIL — `purchaseEffect`/`equipEffect`/`getOwnedEffects` not defined.

- [ ] **Step 4: `googleAuth.ts` — `NICKNAME_REROLL_COST` export**

기존:
```ts
const NICKNAME_REROLL_COST = 10000;
```
교체 후:
```ts
export const NICKNAME_REROLL_COST = 10000;
```

- [ ] **Step 5: `setNicknameEffect` — 소유권 자동 부여**

기존:
```ts
export function setNicknameEffect(userId: number, effect: NicknameEffect, glow: boolean): void {
  db.prepare(`UPDATE users SET nickname_effect = ?, nickname_glow = ? WHERE id = ?`).run(
    effect,
    glow ? 1 : 0,
    userId,
  );
}
```
교체 후:
```ts
// 관리자가 지급한 효과는 상점에서 산 것과 동일하게 소유 처리한다 — 안 그러면 유저가
// 나중에 다른 효과로 장착을 바꿨다가 이걸로 스스로 되돌아올 수 없다.
export function setNicknameEffect(userId: number, effect: NicknameEffect, glow: boolean): void {
  db.prepare(`UPDATE users SET nickname_effect = ?, nickname_glow = ? WHERE id = ?`).run(
    effect,
    glow ? 1 : 0,
    userId,
  );
  if (effect !== "none") {
    db.prepare(`INSERT OR IGNORE INTO owned_nickname_effects (user_id, effect) VALUES (?, ?)`).run(userId, effect);
  }
}
```

- [ ] **Step 6: 신규 함수 3개 + 가격 상수 (파일 끝에 추가)**

```ts
export type ShopEffect = Exclude<NicknameEffect, "none">;

// 임시 가격 — 나중에 이 숫자들만 바꾸면 됨.
export const SHOP_PRICES: Record<ShopEffect, number> = {
  rainbow: 20000,
  shine: 15000,
  hologram: 25000,
  pulse: 12000,
  neon: 15000,
  chrome: 12000,
};

export function getOwnedEffects(userId: number): NicknameEffect[] {
  const rows = db.prepare(`SELECT effect FROM owned_nickname_effects WHERE user_id = ?`).all(userId) as {
    effect: NicknameEffect;
  }[];
  return rows.map((row) => row.effect);
}

export type PurchaseEffectResult = "ok" | "insufficient_funds" | "already_owned";

// 이미 소유했는지부터 확인(중복 결제 방지) — 그다음 잔액 확인 후 차감+INSERT.
// better-sqlite3는 완전히 동기적이라 이 세 문장 사이에 다른 요청이 끼어들 수 없다.
export function purchaseEffect(userId: number, effect: ShopEffect): PurchaseEffectResult {
  const alreadyOwned = db
    .prepare(`SELECT 1 FROM owned_nickname_effects WHERE user_id = ? AND effect = ?`)
    .get(userId, effect);
  if (alreadyOwned) return "already_owned";

  const price = SHOP_PRICES[effect];
  const row = db.prepare(`SELECT game_money AS gameMoney FROM users WHERE id = ?`).get(userId) as
    | { gameMoney: number }
    | undefined;
  if (!row || row.gameMoney < price) return "insufficient_funds";

  db.prepare(`UPDATE users SET game_money = game_money - ? WHERE id = ?`).run(price, userId);
  db.prepare(`INSERT INTO owned_nickname_effects (user_id, effect) VALUES (?, ?)`).run(userId, effect);
  return "ok";
}

export type EquipEffectResult = "ok" | "not_owned";

// glow는 안 건드린다(이번 스코프 제외 — 관리자가 지급한 글로우 상태를 장착 변경이
// 실수로 꺼버리면 안 됨). "none"은 항상 허용(장착 해제).
export function equipEffect(userId: number, effect: NicknameEffect): EquipEffectResult {
  if (effect !== "none") {
    const owned = db
      .prepare(`SELECT 1 FROM owned_nickname_effects WHERE user_id = ? AND effect = ?`)
      .get(userId, effect);
    if (!owned) return "not_owned";
  }
  db.prepare(`UPDATE users SET nickname_effect = ? WHERE id = ?`).run(effect, userId);
  return "ok";
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd server && npm test -- googleAuth`
Expected: PASS — 전부(기존 39개 + 신규 8개).

- [ ] **Step 8: 서버 타입체크**

Run: `cd server && npm run build`
Expected: 에러 없이 통과.

- [ ] **Step 9: Commit**

```bash
git add server/src/db/connection.ts server/src/auth/googleAuth.ts server/src/auth/googleAuth.test.ts
git commit -m "닉네임 상점 데이터 계층 추가 (소유/구매/장착)"
```

---

### Task 2: 서버 라우트

**Files:**
- Modify: `server/src/createServer.ts`

**Interfaces:**
- Consumes: Task 1의 `NICKNAME_REROLL_COST`, `SHOP_PRICES`, `getOwnedEffects`, `purchaseEffect`, `equipEffect`, `type ShopEffect`(모두 `./auth/googleAuth`에서 import). 기존 `NICKNAME_EFFECTS`, `getUserById`, `verifySession`, `SESSION_COOKIE_NAME`도 이미 이 파일에서 import되어 있음.
- Produces: `GET /api/shop`(`{ gameMoney, prices, owned, equipped, rerollColorPrice }`), `POST /api/shop/purchase`(`{effect}` → `{ok:true}`), `POST /api/shop/equip`(`{effect}` → `{ok:true}`). Task 3의 클라이언트 `shop.ts`가 이 3개를 그대로 소비한다.

- [ ] **Step 1: import 추가**

기존 `from "./auth/googleAuth"` import 목록에 추가: `NICKNAME_REROLL_COST`, `SHOP_PRICES`, `getOwnedEffects`, `purchaseEffect`, `equipEffect`, `type ShopEffect`.

- [ ] **Step 2: 라우트 3개 추가**

`/api/profile/reroll-color` 라우트 뒤에 추가:

```ts
  app.get("/api/shop", (req, res) => {
    const cookies = (req as unknown as { cookies?: Record<string, string> }).cookies;
    const userId = verifySession(cookies?.[SESSION_COOKIE_NAME]);
    if (!userId) {
      res.status(401).json({ error: "로그인이 필요합니다." });
      return;
    }
    const user = getUserById(userId);
    if (!user) {
      res.status(404).json({ error: "존재하지 않는 유저예요." });
      return;
    }
    res.json({
      gameMoney: user.gameMoney,
      prices: SHOP_PRICES,
      owned: getOwnedEffects(userId),
      equipped: user.nicknameEffect,
      rerollColorPrice: NICKNAME_REROLL_COST,
    });
  });

  app.post("/api/shop/purchase", (req, res) => {
    const cookies = (req as unknown as { cookies?: Record<string, string> }).cookies;
    const userId = verifySession(cookies?.[SESSION_COOKIE_NAME]);
    if (!userId) {
      res.status(401).json({ error: "로그인이 필요합니다." });
      return;
    }
    const { effect } = req.body as { effect?: unknown };
    if (typeof effect !== "string" || effect === "none" || !NICKNAME_EFFECTS.includes(effect as NicknameEffect)) {
      res.status(400).json({ error: "잘못된 효과예요." });
      return;
    }
    const result = purchaseEffect(userId, effect as ShopEffect);
    if (result === "insufficient_funds") {
      res.status(400).json({ error: "게임머니가 부족해요." });
      return;
    }
    if (result === "already_owned") {
      res.status(409).json({ error: "이미 보유한 효과예요." });
      return;
    }
    res.json({ ok: true });
  });

  app.post("/api/shop/equip", (req, res) => {
    const cookies = (req as unknown as { cookies?: Record<string, string> }).cookies;
    const userId = verifySession(cookies?.[SESSION_COOKIE_NAME]);
    if (!userId) {
      res.status(401).json({ error: "로그인이 필요합니다." });
      return;
    }
    const { effect } = req.body as { effect?: unknown };
    if (typeof effect !== "string" || !NICKNAME_EFFECTS.includes(effect as NicknameEffect)) {
      res.status(400).json({ error: "잘못된 효과예요." });
      return;
    }
    const result = equipEffect(userId, effect as NicknameEffect);
    if (result === "not_owned") {
      res.status(403).json({ error: "보유하지 않은 효과예요." });
      return;
    }
    res.json({ ok: true });
  });
```

- [ ] **Step 3: 서버 타입체크**

Run: `cd server && npm run build`
Expected: 에러 없이 통과.

- [ ] **Step 4: 수동 검증 — 세션 쿠키로 라우트 호출**

이 프로젝트엔 라우트 레벨 자동 테스트가 없다 — 기존 컨벤션대로 DB에 테스트 유저를 만들고 세션 쿠키를 직접 서명해 검증한다. 서버 실행:

```bash
cd server && npm run dev
```

다른 터미널:

```bash
cd server && node -e "
require('dotenv/config');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const db = new Database('./data/songpyeon.db');
db.prepare(\"INSERT INTO users (google_sub, nickname, game_money, created_at, last_login_at) VALUES ('test-shop-route', '상점라우트테스트', 50000, datetime('now'), datetime('now'))\").run();
const user = db.prepare('SELECT id FROM users WHERE google_sub = ?').get('test-shop-route');
const token = jwt.sign({ userId: user.id }, process.env.SESSION_JWT_SECRET);
console.log('userId=' + user.id);
console.log('cookie=' + token);
"
```

그 쿠키로:

```bash
curl -s http://localhost:2567/api/shop --cookie "session=<위 토큰>"
# gameMoney: 50000, owned: [], equipped: "none" 확인

curl -s -X POST http://localhost:2567/api/shop/purchase -H "Content-Type: application/json" --cookie "session=<위 토큰>" -d '{"effect":"chrome"}'
# {"ok":true} 확인, gameMoney가 38000(50000-12000)으로 줄었는지 /api/shop 다시 호출해서 확인

curl -s -X POST http://localhost:2567/api/shop/equip -H "Content-Type: application/json" --cookie "session=<위 토큰>" -d '{"effect":"chrome"}'
# {"ok":true}

curl -s -X POST http://localhost:2567/api/shop/equip -H "Content-Type: application/json" --cookie "session=<위 토큰>" -d '{"effect":"hologram"}'
# 403 {"error":"보유하지 않은 효과예요."} — 안 산 효과는 장착 거부되는지 확인
```

검증 끝나면 테스트 유저 정리:

```bash
cd server && node -e "
const Database = require('better-sqlite3');
const db = new Database('./data/songpyeon.db');
db.prepare(\"DELETE FROM owned_nickname_effects WHERE user_id = (SELECT id FROM users WHERE google_sub = 'test-shop-route')\").run();
db.prepare(\"DELETE FROM users WHERE google_sub = 'test-shop-route'\").run();
"
```

개발 서버 종료 후 `netstat -ano | grep :2567`로 포트가 실제로 비었는지 확인.

- [ ] **Step 5: Commit**

```bash
git add server/src/createServer.ts
git commit -m "닉네임 상점 라우트 추가 (/api/shop, /api/shop/purchase, /api/shop/equip)"
```

---

### Task 3: 클라이언트 상점 데이터 계층 + `ShopModal`

**Files:**
- Create: `client/src/game/shop.ts`
- Create: `client/src/components/ShopModal.tsx`
- Create: `client/src/components/ShopModal.module.css`

**Interfaces:**
- Consumes: Task 2의 3개 라우트. 기존 `nicknameStyle()`(`../game/nicknameStyle`), `rerollNicknameColor()`(`../game/profile`).
- Produces: `export function ShopModal(props: { nickname: string; nicknameColor: string | null; nicknameGlow: boolean; onClose: () => void; onProfileChanged: () => void })`. Task 4가 이 컴포넌트를 `RoomList.tsx`에서 렌더링한다.

- [ ] **Step 1: `client/src/game/shop.ts`**

```ts
import type { NicknameEffect } from "./nicknameStyle";

export type ShopEffect = Exclude<NicknameEffect, "none">;

export type ShopState = {
  gameMoney: number;
  prices: Record<ShopEffect, number>;
  owned: NicknameEffect[];
  equipped: NicknameEffect;
  rerollColorPrice: number;
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
```

- [ ] **Step 2: `client/src/components/ShopModal.tsx`**

```tsx
import { useEffect, useState } from "react";
import { equipEffect, getShop, purchaseEffect, type ShopState } from "../game/shop";
import { rerollNicknameColor } from "../game/profile";
import { nicknameStyle, type NicknameEffect } from "../game/nicknameStyle";
import styles from "./ShopModal.module.css";

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
  onClose,
  onProfileChanged,
}: {
  nickname: string;
  nicknameColor: string | null;
  nicknameGlow: boolean;
  onClose: () => void;
  onProfileChanged: () => void;
}) {
  const [shop, setShop] = useState<ShopState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyEffect, setBusyEffect] = useState<string | null>(null);

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
              {SHOP_EFFECTS.map((effect) => {
                const isOwned = shop.owned.includes(effect);
                const isEquipped = shop.equipped === effect;
                const preview = nicknameStyle(nicknameColor, effect, nicknameGlow);
                return (
                  <div key={effect} className={styles.card}>
                    <span className={`${styles.preview} ${preview.className}`} style={preview.style}>
                      {nickname}
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
              <span className={styles.effectName}>닉네임 색 변경권</span>
              <button
                className={styles.actionButton}
                disabled={busyEffect === "reroll-color"}
                onClick={handleRerollColor}
              >
                재추첨 ({shop.rerollColorPrice.toLocaleString("ko-KR")}원)
              </button>
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

- [ ] **Step 3: `client/src/components/ShopModal.module.css`**

기존 `ProfileModal.module.css`와 같은 시각 언어(어두운 모달, 그라데이션 액션 버튼)를 따르되 카드 그리드로 확장:

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
  z-index: 20;
}

.modal {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
  width: 100%;
  max-width: 30rem;
  max-height: 85vh;
  overflow-y: auto;
  padding: 1.5rem;
  border-radius: 0.8rem;
  background: #1f2937;
  color: #fff;
  box-sizing: border-box;
  text-align: center;
}

.title {
  margin: 0;
  font-size: 1.3rem;
  font-weight: 800;
}

.money {
  margin: 0;
  font-size: 1rem;
  font-weight: 700;
  opacity: 0.9;
}

.loading,
.error {
  text-align: center;
  opacity: 0.8;
  font-size: 0.9rem;
  margin: 0;
}

.grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.75rem;
}

.card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 0.9rem 0.6rem;
  border-radius: 0.6rem;
  background: rgba(255, 255, 255, 0.06);
}

.preview {
  font-size: 1.1rem;
  font-weight: 800;
}

.effectName {
  font-size: 0.85rem;
  opacity: 0.85;
}

.rerollCard {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 0.9rem 0.6rem;
  border-radius: 0.6rem;
  background: rgba(255, 255, 255, 0.06);
}

.actionButton {
  padding: 0.5rem 0.9rem;
  font-size: 0.85rem;
  border-radius: 0.6rem;
  border: none;
  cursor: pointer;
  color: #fff;
  font-weight: 700;
  background: linear-gradient(135deg, #3b82f6, #2563eb);
}

.actionButton:disabled {
  cursor: not-allowed;
  opacity: 0.6;
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

- [ ] **Step 4: 클라이언트 타입체크**

Run: `cd client && npm run build`
Expected: 이 시점엔 `ShopModal`이 아직 아무 데서도 안 쓰여서(Task 4에서 배선) "선언됐지만 사용 안 됨" 경고는 안 남(export된 컴포넌트라 미사용 경고 대상 아님) — `tsc -b && vite build` 에러 없이 통과해야 함.

- [ ] **Step 5: Commit**

```bash
git add client/src/game/shop.ts client/src/components/ShopModal.tsx client/src/components/ShopModal.module.css
git commit -m "닉네임 상점 클라이언트 데이터 계층 + ShopModal 추가"
```

---

### Task 4: 로비 배선 + 프로필 팝업 정리 + 최종 검증

**Files:**
- Modify: `client/src/components/RoomList.tsx`
- Modify: `client/src/components/RoomList.module.css`
- Modify: `client/src/components/ProfileModal.tsx`

**Interfaces:**
- Consumes: Task 3의 `ShopModal`(`../components/ShopModal` — 같은 디렉토리라 `./ShopModal`).
- Produces: 없음(최종 UI 배선).

- [ ] **Step 1: `RoomList.tsx` — import + state + 버튼 + 모달 렌더**

파일 상단 import에 추가:
```ts
import { ShopModal } from "./ShopModal";
```

`useState` 선언 블록(`const [showFriendsModal, setShowFriendsModal] = useState(false);` 다음 줄)에 추가:
```ts
  const [showShopModal, setShowShopModal] = useState(false);
```

`topButtons` div(120-131번 줄) 안, `friendsButton` 다음에 추가:
```tsx
          <button className={styles.shopButton} onClick={() => setShowShopModal(true)}>
            상점
          </button>
```

모달 렌더 블록(`{showFriendsModal && (...)}` 다음)에 추가:
```tsx
      {showShopModal && (
        <ShopModal
          nickname={nickname}
          nicknameColor={nicknameColor}
          nicknameGlow={nicknameGlow}
          onClose={() => setShowShopModal(false)}
          onProfileChanged={onProfileChanged}
        />
      )}
```

- [ ] **Step 2: `RoomList.module.css` — `.shopButton`**

`.friendsButton` 블록 다음에 추가:
```css
.shopButton {
  padding: 0.6rem 1.2rem;
  font-size: 1rem;
  border-radius: 0.6rem;
  border: none;
  cursor: pointer;
  color: #1c1d3a;
  font-weight: 700;
  background: linear-gradient(135deg, #ffd76e, #f7a541);
}
```

- [ ] **Step 3: `ProfileModal.tsx` — 닉색 변경 버튼 제거**

import 문에서 `rerollNicknameColor` 제거:
```ts
import { getProfile, type PublicProfile } from "../game/profile";
```

`handleReroll` 함수 전체 삭제(63-75번 줄):
```ts
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
```

`friendshipStatus === "self"` 버튼 분기 삭제(94-98번 줄):
```tsx
            {profile.friendshipStatus === "self" && (
              <button className={styles.actionButton} onClick={handleReroll} disabled={busy}>
                닉색 변경 (10,000원)
              </button>
            )}
```

(`onSelfColorChanged` prop 자체는 그대로 남겨둔다 — 삭제하면 `RoomList.tsx`가 `<ProfileModal onSelfColorChanged={onProfileChanged} />`로 넘기는 부분도 손봐야 하는데, self 프로필에서 더 이상 아무것도 안 바꾸니 그냥 안 쓰이는 optional prop으로 남아도 무해함. 다만 TypeScript가 "선언됐지만 안 쓰임" 에러를 내는 strict 옵션이 있는지 Step 4에서 확인.)

- [ ] **Step 4: 클라이언트 타입체크**

Run: `cd client && npm run build`
Expected: 에러 없이 통과. 만약 `onSelfColorChanged`가 미사용 변수로 에러가 나면(destructured prop이라 보통은 안 남), `ProfileModal`의 함수 시그니처에서 그 prop을 아예 지우고 `RoomList.tsx`의 `<ProfileModal>` 호출부에서도 `onSelfColorChanged={onProfileChanged}` 줄을 같이 지운다.

- [ ] **Step 5: 서버 전체 테스트 재실행 (최종 확인)**

Run: `cd server && npm test`
Expected: 전부 PASS.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/RoomList.tsx client/src/components/RoomList.module.css client/src/components/ProfileModal.tsx
git commit -m "로비에 상점 버튼 추가, 프로필 팝업의 닉색 변경 버튼을 상점으로 이전"
```

- [ ] **Step 7: Playwright로 실제 화면 검증**

`npm run sync-public` → `cd server && npm run dev`(포트 2567). DB에 게임머니를 넉넉히(예: 100000) 가진 테스트 유저를 만들고 세션 쿠키를 서명해 브라우저에 주입하는 기존 방식 그대로:

1. 로비에서 "상점" 버튼 클릭 → 모달이 뜨고 6개 효과 카드 + "없음" 카드 + 색 변경권 카드가 보이는지. 각 카드에 본인 닉네임이 해당 효과로 미리보기되는지(예: 크롬 카드의 미리보기 텍스트에 `chrome-sweep` 애니메이션이 걸려있는지 컴퓨티드 스타일로 확인).
2. 미보유 효과 하나(예: "크롬") 구매 → 게임머니가 정확히 차감되는지, 카드가 "보유중(장착하기)" 상태로 바뀌는지.
3. 장착하기 클릭 → 로비 하단 프로필바의 본인 닉네임에 즉시 크롬 효과가 반영되는지(페이지 새로고침 없이).
4. "없음" 카드로 장착 해제 → 로비 닉네임이 원래대로 돌아오는지.
5. 게임머니가 부족한 효과 구매 시도 → "게임머니가 부족해요." 에러 메시지 확인, 잔액/보유 목록 변화 없는지.
6. 관리자 페이지(`/admin` → 유저 정보)에서 같은 테스트 유저에게 "네온사인"을 지급(select) → 상점 모달을 다시 열어 네온사인이 "보유중"으로 뜨는지(B의 회귀 확인 — 관리자 지급도 소유 처리되는지).
7. 닉네임 색 변경권 카드에서 "재추첨" 클릭 → 색이 바뀌고 게임머니가 차감되는지, 로비에 반영되는지.
8. `ProfileModal`을 자기 자신에 대해 열어(로비 닉네임 클릭) 더 이상 "닉색 변경" 버튼이 없는지(통계만 보이는지) 확인.
9. 테스트 유저 DB에서 정리(users + owned_nickname_effects 양쪽), 브라우저 탭 닫기, 개발 서버 종료 후 `netstat`으로 포트 2567이 실제로 비었는지 확인.

## Self-Review Notes

- **Spec coverage**: 스펙의 A(데이터 계층) → Task 1. B(라우트) → Task 2. C-1/C-2(shop.ts, ShopModal) → Task 3. C-3/C-4(RoomList 배선, ProfileModal 정리) → Task 4. 스펙의 모든 섹션이 커버됨.
- **Placeholder scan**: 없음 — 모든 단계에 실제 코드/명령어.
- **Type consistency**: `ShopEffect`(Task 1 정의) → 라우트 바디 타입(Task 2) → 클라이언트 `shop.ts`의 `ShopEffect`(Task 3, 서버와 동일한 `Exclude<NicknameEffect, "none">` 정의)까지 일관. `purchaseEffect`/`equipEffect`의 반환 문자열(`"ok"`/`"insufficient_funds"`/`"already_owned"`/`"not_owned"`)이 Task 1(정의)과 Task 2(라우트의 분기 처리) 사이에 정확히 일치.
- **범위**: 서버 데이터 계층 1개 파일 + 라우트 1개 파일 + 클라이언트 신규 3개 파일 + 기존 2개 파일 수정 — 이전 "닉네임 색 변경권" 계획과 비슷한 규모, 태스크 4개로 적절히 분해됨.
