# 닉네임 상점 설계

## 배경

지금까지 만든 닉네임 효과 6종(레인보우/샤인/홀로그램/Pulse/네온사인/크롬)은 관리자만 `/admin`에서 지급할 수 있었다. 이번엔 유저가 게임머니로 직접 사서 자유롭게 장착/해제할 수 있는 "상점"을 만든다. 닉네임 색 변경권(`ProfileModal`의 "닉색 변경(10,000원)" 버튼)도 프로필 팝업에서 상점으로 옮긴다.

## 확정된 결정

- **인벤토리 방식**: 효과를 사면 영구 소유하고, 이후엔 무료로 자유롭게 바꿔 낄 수 있다. "구매"(소유권 획득)와 "장착"(현재 표시 효과 변경)이 별개 동작.
- **효과별 차등 가격**(임시값, 나중에 직접 조정 예정): 레인보우 20,000 / 샤인 15,000 / 홀로그램 25,000 / Pulse 12,000 / 네온사인 15,000 / 크롬 12,000. 닉네임 색 변경권은 기존 10,000원 그대로.
- **글로우는 이번 스코프에서 제외** — 여전히 관리자만 체크박스로 지급.
- **관리자가 지급한 효과도 자동으로 소유 처리** — 안 그러면 관리자가 준 효과를 유저가 나중에 다른 걸로 바꿨다가 스스로 되돌릴 수 없는 모순이 생긴다.
- **상점에서 구매 전에도 실시간 미리보기** — 모든 카드(보유 여부 무관)에 본인 닉네임을 그 효과로 렌더링해서 보여준다.

## A. 데이터 계층

### A-1. 새 테이블 (`server/src/db/connection.ts`)

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

복합 PK로 중복 구매 자체를 DB 레벨에서도 막는다(애플리케이션 레벨 체크와 이중 방어). 기존 테이블들처럼 외래키 제약은 명시하지 않음(이 프로젝트의 기존 관례 — `friendships`/`direct_messages` 등도 FK 선언 없음).

### A-2. `server/src/auth/googleAuth.ts` — 가격 상수 + 3개 함수

`NICKNAME_REROLL_COST` 앞에 export 키워드 추가(기존 `const NICKNAME_REROLL_COST = 10000;` → `export const NICKNAME_REROLL_COST = 10000;`) — 상점 라우트가 이 값을 응답에 포함해야 함.

`setNicknameEffect` 함수를 찾아 끝에 소유권 자동 부여 추가:

```ts
// 색(setNicknameColor)과 완전히 같은 자리 — 관리자가 /admin에서 select+체크박스로
// 즉시 바꾼다. effect 유효성 검증은 라우트 레벨(NICKNAME_EFFECTS 화이트리스트)에서
// 이미 끝나므로 이 함수 자체는 실패 케이스가 없어 결과 타입도 없음(항상 성공).
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

파일 끝(또는 `rerollNicknameColor` 근처)에 추가:

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

## B. 라우트 (`server/src/createServer.ts`)

`/api/profile/reroll-color` 라우트 근처에 3개 추가:

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

`createServer.ts` 상단 import에 `SHOP_PRICES`, `getOwnedEffects`, `purchaseEffect`, `type ShopEffect`, `equipEffect`, `NICKNAME_REROLL_COST` 추가(기존 `./auth/googleAuth` import 목록에 합류).

닉네임 색 변경 자체는 기존 `/api/profile/reroll-color`를 그대로 재사용 — 이 라우트는 변경 없음.

## C. 클라이언트

### C-1. `client/src/game/shop.ts` (신규)

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

### C-2. `client/src/components/ShopModal.tsx` (신규)

`RoomList.tsx`가 이미 갖고 있는 `nickname`/`nicknameColor`/`nicknameGlow`를 그대로 props로 받아 미리보기에 쓴다(서버 왕복 없이 `nicknameStyle()`로 클라이언트에서 바로 렌더링). 효과 6개 + 색 변경권을 카드로 나열:

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

("없음" 카드는 가격 없이 항상 무료로 장착 해제 가능 — 미리보기는 `nicknameStyle(null, undefined, false)` 없이 그냥 기본 텍스트로 둠, 별도 스타일 계산 불필요.)

`ShopModal.module.css`는 기존 `FriendsModal.module.css`/`ProfileModal.module.css`와 같은 오버레이/카드 패턴을 그대로 따라 새로 작성(overlay, modal, grid, card, actionButton, closeButton 등 — 기존 모달들의 클래스 구조를 참고).

### C-3. `RoomList.tsx` — 상점 버튼 추가

`topButtons`(방 만들기/랭킹/친구 버튼이 있는 곳)에 "상점" 버튼 추가, `showShopModal` state 추가, `<ShopModal>`을 다른 모달들처럼 조건부 렌더링(props: `nickname`, `nicknameColor`, `nicknameGlow`, `onClose`, `onProfileChanged={onProfileChanged}` — 이미 있는 prop 그대로 전달).

### C-4. `ProfileModal.tsx` — 닉색 변경 버튼 제거

`friendshipStatus === "self"` 분기(96-98번 줄, "닉색 변경 (10,000원)" 버튼) 전체 삭제, 이제 안 쓰는 `handleReroll` 함수와 `rerollNicknameColor` import도 같이 제거. self 프로필을 열면 이제 통계만 보이고 액션 버튼은 없음(상점은 로비의 새 "상점" 버튼으로 감).

## 테스트

- `server/src/auth/googleAuth.test.ts`: `purchaseEffect`(성공/잔액부족/중복구매), `equipEffect`(성공/미보유 거부/"none" 항상 허용), `getOwnedEffects`, `setNicknameEffect`가 소유권도 같이 부여하는지(회귀 확인).
- 라우트 3개는 이 프로젝트 관례대로 수동 curl 검증(자동 라우트 테스트 없음).
- Playwright: 게임머니를 넉넉히 준 테스트 유저로 로비 "상점" 버튼 → 효과 하나 구매(잔액 차감 확인) → 장착(로비 닉네임에 즉시 반영) → 다시 "없음"으로 해제 → 닉네임 색 변경권도 확인. 잔액 부족 시 에러 메시지. 관리자가 지급한 효과를 유저가 상점에서 "보유중"으로 보고 장착할 수 있는지(B의 회귀 확인 포인트).

## 셀프 리뷰

- **플레이스홀더**: 없음. 가격은 사용자가 명시적으로 "임시로 다르게 넣어두라"고 확인한 값.
- **일관성**: `EquipEffectResult`가 `equipEffect`에서만, `PurchaseEffectResult`가 `purchaseEffect`에서만 쓰임 — 이름과 반환값 일치. 클라이언트 `shop.ts`의 `ShopState`/`ShopEffect`가 서버 라우트 응답 모양과 정확히 대응.
- **범위**: 서버 데이터 계층(1개 테이블 + 3개 함수 + 기존 함수 수정 1곳) + 라우트 3개 + 클라이언트 신규 파일 2개(shop.ts, ShopModal.tsx + css) + 기존 파일 수정 2개(RoomList.tsx, ProfileModal.tsx) — 이전 "닉네임 색 변경권" 기능과 비슷한 규모, 단일 계획으로 충분.
