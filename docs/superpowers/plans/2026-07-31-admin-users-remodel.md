# 관리자 유저 페이지 리모델링 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 관리자 유저 정보 페이지에 페이지네이션을 넣고, 인라인 편집 UI를 전용 모달로 분리하고, 게임머니 지급/차감 기능을 추가한다.

**Architecture:** 서버는 게임머니 조정용 라우트 하나와 `addGameMoney`의 0-클램프만 추가하면 끝(나머지 라우트는 기존 그대로 재사용). 클라이언트는 `AdminEditUserModal`이라는 새 컴포넌트가 지금 테이블에 있던 인라인 편집 UI(닉네임/색상/효과/글로우/파티클)를 그대로 옮겨받고 게임머니 섹션을 추가하며, `AdminUsers.tsx`는 테이블을 읽기 전용+페이지네이션으로 바꾸고 "수정" 버튼으로 모달을 연다.

**Tech Stack:** Node.js/TypeScript/Express/better-sqlite3(서버), React/TypeScript/Vite(클라이언트)

## Global Constraints

- 페이지 크기 50명, 서버 라우트 변경 없이 클라이언트에서 필터링된 결과를 슬라이스.
- 검색어가 바뀌면 페이지를 1페이지(인덱스 0)로 리셋.
- 모달 안의 4개 섹션(닉네임/색상/효과·글로우·파티클/게임머니)은 각자 독립적으로 저장 — 하나 실패해도 나머지에 영향 없음.
- 게임머니는 절대값이 아니라 **증감(delta)** 방식 — `+10000`/`-5000`처럼 부호 있는 정수를 입력받아 기존 `addGameMoney(userId, amount)`를 그대로 재사용.
- `addGameMoney`는 차감 시 잔액이 0 밑으로 내려가지 않도록 `MAX(0, game_money + ?)`로 클램프.
- 밴·해제/모니터링 버튼은 테이블 행에 그대로 둔다(모달로 안 옮김).

---

### Task 1: 서버 — 게임머니 클램프 + `AdminUserRow.gameMoney` + 조정 라우트

**Files:**
- Modify: `server/src/auth/googleAuth.ts:252-254` (`addGameMoney`), `AdminUserRow` 타입(약 125-136번 줄), `listUsers()`(약 138-151번 줄)
- Test: `server/src/auth/googleAuth.test.ts`
- Modify: `server/src/createServer.ts` (import 목록 + 새 라우트)

**Interfaces:**
- Produces: `addGameMoney(userId: number, amount: number): void`(기존 시그니처 그대로, 동작만 클램프 추가), `AdminUserRow.gameMoney: number`, `POST /api/admin/users/:id/game-money` (body `{ delta: number }`, 응답 `{ ok: true }`)

- [ ] **Step 1: 클램프 동작에 대한 실패하는 테스트 먼저 작성**

`server/src/auth/googleAuth.test.ts:195-214`의 `describe("addGameMoney", ...)`
블록 안, 두 번째 테스트("accumulates across multiple calls") 뒤/블록을 닫는
`});`(214번 줄) 앞에 추가:

```ts
  test("never lets game_money go below zero even when subtracting more than the balance", () => {
    const user = getOrCreateUser("sub-money-3", {});
    addGameMoney(user.id, 20);
    addGameMoney(user.id, -50);

    expect(getUserById(user.id)).toMatchObject({ gameMoney: 0 });
  });

  test("subtracts normally when the balance stays non-negative", () => {
    const user = getOrCreateUser("sub-money-4", {});
    addGameMoney(user.id, 100);
    addGameMoney(user.id, -30);

    expect(getUserById(user.id)).toMatchObject({ gameMoney: 70 });
  });
```

- [ ] **Step 2: 테스트 실행해서 첫 번째 테스트가 실패하는지 확인**

Run: `cd server && npx vitest run googleAuth -t "never lets game_money go below zero"`
Expected: FAIL — `expected 0 to be -30`(현재 `addGameMoney`엔 클램프가 없어서 마이너스가 그대로 남음)

- [ ] **Step 3: `addGameMoney` 구현 수정**

`server/src/auth/googleAuth.ts:252-254`을 교체:

```ts
export function addGameMoney(userId: number, amount: number): void {
  db.prepare(`UPDATE users SET game_money = MAX(0, game_money + ?) WHERE id = ?`).run(amount, userId);
}
```

- [ ] **Step 4: 테스트 재실행해서 통과 확인**

Run: `cd server && npx vitest run googleAuth -t "addGameMoney"`
Expected: PASS (기존 2개 + 새로 추가한 2개, 총 4개)

- [ ] **Step 5: `AdminUserRow`에 `gameMoney` 추가**

`server/src/auth/googleAuth.ts`의 `AdminUserRow` 타입에 필드 추가(`nicknameParticle: NicknameParticle;` 바로 뒤):

```ts
export type AdminUserRow = {
  id: number;
  email: string | null;
  name: string | null;
  nickname: string | null;
  bannedAt: string | null;
  nicknameColor: string | null;
  createdAt: string;
  lastLoginAt: string | null;
  nicknameEffect: NicknameEffect;
  nicknameGlow: boolean;
  nicknameParticle: NicknameParticle;
  gameMoney: number;
};
```

`listUsers()`의 SELECT에도 `game_money AS gameMoney` 추가:

```ts
export function listUsers(): AdminUserRow[] {
  const rows = db
    .prepare(
      `SELECT id, email, name, nickname, banned_at AS bannedAt, nickname_color AS nicknameColor,
              created_at AS createdAt, last_login_at AS lastLoginAt,
              nickname_effect AS nicknameEffect, nickname_glow AS nicknameGlow,
              nickname_particle AS nicknameParticle, game_money AS gameMoney
       FROM users ORDER BY id DESC`,
    )
    .all() as (Omit<AdminUserRow, "nicknameGlow"> & { nicknameGlow: number })[];
  return rows.map((row) => ({
    ...row,
    nicknameGlow: sqliteBool(row.nicknameGlow),
  }));
}
```

- [ ] **Step 6: 서버 전체 테스트 실행해서 회귀 없는지 확인**

Run: `cd server && npm run build && npm test`
Expected: 타입 에러 없음. 전체 테스트 그린(팀 탈락 관련 기존 2개 무관한 실패는 이 프로젝트에 이미 알려진 pre-existing 이슈라 무시해도 됨 — 그 2개 말고 새로운 실패가 없어야 함).

- [ ] **Step 7: `createServer.ts`에 게임머니 조정 라우트 추가**

`server/src/createServer.ts:16-39`의 `"./auth/googleAuth"` import 블록에서
`adminSetNickname,`(17번 줄) 바로 앞에 `addGameMoney,`를 추가한다(알파벳 순서
유지 — `addGameMoney`가 `adminSetNickname`보다 사전순으로 앞):

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
  NICKNAME_EFFECTS,
  NICKNAME_PARTICLES,
  type NicknameEffect,
  type NicknameParticle,
  NICKNAME_REROLL_COST,
  purchaseEffect,
  rerollNicknameColor,
  setNickname,
  setNicknameColor,
  setNicknameEffect,
  SHOP_PRICES,
  type ShopEffect,
  setUserBanned,
  touchLastLogin,
  verifyGoogleIdToken,
} from "./auth/googleAuth";
```

`server/src/createServer.ts:325-333`의 `unban` 라우트 바로 뒤(334번 줄, 다음
라우트인 `/api/admin/monitor/:userId/stream` 앞의 빈 줄 자리)에 추가:

```ts
  // 증감(delta) 방식 — "새 잔액을 얼마로"가 아니라 "얼마를 더하거나 뺄지"를 받는다.
  // addGameMoney가 이미 0 밑으로 안 내려가게 클램프하므로 여기서 따로 잔액 확인 안 함.
  app.post("/api/admin/users/:id/game-money", requireAdmin, (req, res) => {
    const userId = Number(req.params.id);
    if (!Number.isInteger(userId)) {
      res.status(400).json({ error: "invalid id" });
      return;
    }
    const { delta } = req.body as { delta?: unknown };
    if (typeof delta !== "number" || !Number.isInteger(delta) || delta === 0) {
      res.status(400).json({ error: "delta는 0이 아닌 정수여야 합니다." });
      return;
    }
    const user = getUserById(userId);
    if (!user) {
      res.status(404).json({ error: "존재하지 않는 유저입니다." });
      return;
    }
    addGameMoney(userId, delta);
    res.json({ ok: true });
  });
```

- [ ] **Step 8: 타입체크 + 전체 테스트 재확인**

Run: `cd server && npm run build && npm test`
Expected: 에러 없음, 그린(위와 동일하게 무관한 pre-existing 2개 제외).

- [ ] **Step 9: 커밋**

```bash
git add server/src/auth/googleAuth.ts server/src/auth/googleAuth.test.ts server/src/createServer.ts
git commit -m "서버: 게임머니 0-클램프 + 관리자 조정 라우트 + AdminUserRow.gameMoney 추가"
```

---

### Task 2: 클라이언트 — `AdminEditUserModal` 컴포넌트 신규 생성

**Files:**
- Create: `client/src/components/AdminEditUserModal.tsx`
- Create: `client/src/components/AdminEditUserModal.module.css`

**Interfaces:**
- Consumes: Task 1의 `POST /api/admin/users/:id/game-money`(body `{ delta: number }`), 기존 `POST /api/admin/users/:id/nickname`, `/nickname-color`, `/nickname-effects` 라우트(변경 없음)
- Produces: `export type UserRow` (아래 정의), `export function AdminEditUserModal({ user, onClose, onSaved, onUnauthorized }: { user: UserRow; onClose: () => void; onSaved: () => void; onUnauthorized: () => void })` — Task 3이 이 타입과 컴포넌트를 그대로 가져다 씀.

- [ ] **Step 1: `AdminEditUserModal.tsx` 작성**

```tsx
import { useState } from "react";
import type { NicknameEffect, NicknameParticle } from "../game/nicknameStyle";
import styles from "./AdminEditUserModal.module.css";

const MAX_NICKNAME_LENGTH = 10;
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

export type UserRow = {
  id: number;
  email: string | null;
  name: string | null;
  nickname: string | null;
  bannedAt: string | null;
  nicknameColor: string | null;
  createdAt: string;
  lastLoginAt: string | null;
  nicknameEffect: NicknameEffect;
  nicknameGlow: boolean;
  nicknameParticle: NicknameParticle;
  gameMoney: number;
};

export function AdminEditUserModal({
  user,
  onClose,
  onSaved,
  onUnauthorized,
}: {
  user: UserRow;
  onClose: () => void;
  onSaved: () => void;
  onUnauthorized: () => void;
}) {
  const [error, setError] = useState<string | null>(null);

  const [nicknameValue, setNicknameValue] = useState(user.nickname ?? "");
  const [nicknameSaving, setNicknameSaving] = useState(false);

  const [colorValue, setColorValue] = useState(user.nicknameColor ?? "");
  const [colorSaving, setColorSaving] = useState(false);

  // 로컬 상태로 관리해서 저장 즉시 드롭다운/체크박스가 최신 값을 보여줌
  // (부모가 다시 목록을 fetch할 때까지 안 기다려도 됨).
  const [effect, setEffectValue] = useState<NicknameEffect>(user.nicknameEffect);
  const [glow, setGlowValue] = useState(user.nicknameGlow);
  const [particle, setParticleValue] = useState<NicknameParticle>(user.nicknameParticle);
  const [effectSaving, setEffectSaving] = useState(false);

  const [moneyDelta, setMoneyDelta] = useState("");
  const [moneySaving, setMoneySaving] = useState(false);
  const [currentMoney, setCurrentMoney] = useState(user.gameMoney);

  async function saveNickname() {
    const trimmed = nicknameValue.trim();
    if (!trimmed) return;
    setNicknameSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${user.id}/nickname`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ nickname: trimmed }),
      });
      if (!res.ok) {
        if (res.status === 401) {
          onUnauthorized();
          return;
        }
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "닉네임 변경에 실패했습니다");
        return;
      }
      onSaved();
    } catch {
      setError("닉네임 변경에 실패했습니다");
    } finally {
      setNicknameSaving(false);
    }
  }

  async function saveColor() {
    const trimmed = colorValue.trim();
    if (trimmed && !HEX_COLOR_PATTERN.test(trimmed)) {
      setError("#RRGGBB 형식의 색상 코드를 입력해주세요.");
      return;
    }
    setColorSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${user.id}/nickname-color`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ color: trimmed || null }),
      });
      if (!res.ok) {
        if (res.status === 401) {
          onUnauthorized();
          return;
        }
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "색상 변경에 실패했습니다");
        return;
      }
      onSaved();
    } catch {
      setError("색상 변경에 실패했습니다");
    } finally {
      setColorSaving(false);
    }
  }

  async function saveEffect(nextEffect: NicknameEffect, nextGlow: boolean, nextParticle: NicknameParticle) {
    setEffectSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${user.id}/nickname-effects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ effect: nextEffect, glow: nextGlow, particle: nextParticle }),
      });
      if (!res.ok) {
        if (res.status === 401) {
          onUnauthorized();
          return;
        }
        setError("효과 변경에 실패했습니다");
        return;
      }
      setEffectValue(nextEffect);
      setGlowValue(nextGlow);
      setParticleValue(nextParticle);
      onSaved();
    } catch {
      setError("효과 변경에 실패했습니다");
    } finally {
      setEffectSaving(false);
    }
  }

  async function saveMoney() {
    const delta = Number(moneyDelta);
    if (!Number.isInteger(delta) || delta === 0) {
      setError("0이 아닌 정수를 입력해주세요 (예: 10000 또는 -5000).");
      return;
    }
    setMoneySaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${user.id}/game-money`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ delta }),
      });
      if (!res.ok) {
        if (res.status === 401) {
          onUnauthorized();
          return;
        }
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "게임머니 변경에 실패했습니다");
        return;
      }
      setCurrentMoney((prev) => Math.max(0, prev + delta));
      setMoneyDelta("");
      onSaved();
    } catch {
      setError("게임머니 변경에 실패했습니다");
    } finally {
      setMoneySaving(false);
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h2 className={styles.title}>{user.nickname ?? `유저 ${user.id}`} 수정</h2>
        {error && <p className={styles.error}>{error}</p>}

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>닉네임</h3>
          <div className={styles.row}>
            <input
              className={styles.textInput}
              value={nicknameValue}
              onChange={(e) => setNicknameValue(e.target.value)}
              maxLength={MAX_NICKNAME_LENGTH}
            />
            <button
              className={styles.saveButton}
              onClick={saveNickname}
              disabled={nicknameSaving || !nicknameValue.trim()}
            >
              저장
            </button>
          </div>
        </section>

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>닉네임 색상</h3>
          <div className={styles.row}>
            <span className={styles.colorSwatch} style={{ background: colorValue || "transparent" }} />
            <input
              className={styles.textInput}
              value={colorValue}
              onChange={(e) => setColorValue(e.target.value)}
              placeholder="#ff6b6b"
            />
            <button className={styles.saveButton} onClick={saveColor} disabled={colorSaving}>
              저장
            </button>
          </div>
        </section>

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>효과 / 글로우 / 파티클</h3>
          <div className={styles.row}>
            <select
              value={effect}
              disabled={effectSaving}
              onChange={(e) => saveEffect(e.target.value as NicknameEffect, glow, particle)}
            >
              <option value="none">없음</option>
              <option value="rainbow">레인보우</option>
              <option value="shine">샤인</option>
              <option value="hologram">홀로그램</option>
              <option value="pulse">Pulse</option>
              <option value="neon">네온사인</option>
              <option value="chrome">크롬</option>
            </select>
            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={glow}
                disabled={effectSaving || effect === "pulse" || effect === "neon"}
                onChange={(e) => saveEffect(effect, e.target.checked, particle)}
              />
              글로우
            </label>
            <select
              value={particle}
              disabled={effectSaving}
              onChange={(e) => saveEffect(effect, glow, e.target.value as NicknameParticle)}
            >
              <option value="none">파티클 없음</option>
              <option value="twinkle">반짝임</option>
              <option value="rising">상승</option>
              <option value="orbit">궤도</option>
              <option value="snow">눈</option>
            </select>
          </div>
        </section>

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>게임머니</h3>
          <p className={styles.moneyDisplay}>현재 잔액: {currentMoney.toLocaleString("ko-KR")}원</p>
          <div className={styles.row}>
            <input
              className={styles.textInput}
              value={moneyDelta}
              onChange={(e) => setMoneyDelta(e.target.value)}
              placeholder="+10000 또는 -5000"
            />
            <button className={styles.saveButton} onClick={saveMoney} disabled={moneySaving || !moneyDelta.trim()}>
              적용
            </button>
          </div>
        </section>

        <button className={styles.closeButton} onClick={onClose}>
          닫기
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: `AdminEditUserModal.module.css` 작성**

관리자 페이지 자체가 밝은 배경 톤(`AdminUsers.module.css`의 `.wrap { color: #111827; background: #f9fafb; }`)이라, 게임 안의 어두운 모달(`ShopModal` 등)과 달리 **밝은 테마**로 맞춘다:

```css
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  box-sizing: border-box;
  z-index: 30;
}

.modal {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  width: 100%;
  max-width: 28rem;
  max-height: 85vh;
  overflow-y: auto;
  padding: 1.5rem;
  border-radius: 0.6rem;
  background: #fff;
  color: #111827;
  box-sizing: border-box;
  text-align: left;
}

.title {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 800;
}

.error {
  color: #d33;
  font-size: 0.85rem;
  margin: 0;
}

.section {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding-top: 0.75rem;
  border-top: 1px solid #e5e7eb;
}

.sectionTitle {
  margin: 0;
  font-size: 0.85rem;
  font-weight: 700;
  color: #6b7280;
}

.row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.textInput {
  padding: 0.4rem 0.6rem;
  font-size: 0.9rem;
  border: 1px solid #d1d5db;
  border-radius: 0.4rem;
  flex: 1;
  min-width: 6rem;
  box-sizing: border-box;
}

.colorSwatch {
  display: inline-block;
  width: 1.2rem;
  height: 1.2rem;
  border-radius: 999px;
  border: 1px solid #d1d5db;
  flex-shrink: 0;
}

.checkboxLabel {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.85rem;
  white-space: nowrap;
}

.moneyDisplay {
  margin: 0;
  font-size: 0.9rem;
  font-weight: 700;
}

.saveButton {
  padding: 0.4rem 0.8rem;
  font-size: 0.85rem;
  border-radius: 0.4rem;
  border: 1px solid #d1d5db;
  background: #fff;
  cursor: pointer;
  white-space: nowrap;
}

.saveButton:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.closeButton {
  margin-top: 0.5rem;
  padding: 0.6rem 1rem;
  font-size: 0.95rem;
  border-radius: 0.4rem;
  border: 1px solid #d1d5db;
  background: #f3f4f6;
  cursor: pointer;
}
```

- [ ] **Step 3: 타입체크**

Run: `cd client && npx tsc -b`
Expected: 에러 없음 — 아직 아무 파일도 이 컴포넌트를 import하지 않으므로(Task 3에서 연결) 이 2개 파일 자체는 독립적으로 컴파일 가능해야 함.

- [ ] **Step 4: 커밋**

```bash
git add client/src/components/AdminEditUserModal.tsx client/src/components/AdminEditUserModal.module.css
git commit -m "클라이언트: 관리자 유저 수정 모달(AdminEditUserModal) 신규 생성"
```

---

### Task 3: 클라이언트 — `AdminUsers.tsx` 리모델링 (페이지네이션 + 인라인 편집 제거 + 모달 연결)

**Files:**
- Modify: `client/src/components/AdminUsers.tsx` (전체 교체)
- Modify: `client/src/components/AdminUsers.module.css` (사용 안 하는 클래스 제거 + 페이지네이션 클래스 추가)

**Interfaces:**
- Consumes: Task 2의 `AdminEditUserModal` 컴포넌트와 `UserRow` 타입(`import { AdminEditUserModal, type UserRow } from "./AdminEditUserModal";`)

- [ ] **Step 1: `AdminUsers.tsx` 전체 교체**

```tsx
import { useEffect, useState } from "react";
import { AdminEditUserModal, type UserRow } from "./AdminEditUserModal";
import styles from "./AdminUsers.module.css";

const PAGE_SIZE = 50;

async function fetchJson<T>(url: string): Promise<{ ok: true; data: T } | { ok: false; unauthorized: boolean }> {
  try {
    const res = await fetch(url, { credentials: "same-origin" });
    if (!res.ok) return { ok: false, unauthorized: res.status === 401 };
    return { ok: true, data: (await res.json()) as T };
  } catch {
    return { ok: false, unauthorized: false };
  }
}

const EFFECT_LABELS: Record<UserRow["nicknameEffect"], string> = {
  none: "없음",
  rainbow: "레인보우",
  shine: "샤인",
  hologram: "홀로그램",
  pulse: "Pulse",
  neon: "네온사인",
  chrome: "크롬",
};

const PARTICLE_LABELS: Record<UserRow["nicknameParticle"], string> = {
  none: "없음",
  twinkle: "반짝임",
  rising: "상승",
  orbit: "궤도",
  snow: "눈",
};

export function AdminUsers({
  onUnauthorized,
  onBack,
  onOpenMonitor,
}: {
  onUnauthorized: () => void;
  onBack: () => void;
  onOpenMonitor: (userId: number, nickname: string) => void;
}) {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [banningId, setBanningId] = useState<number | null>(null);
  const [editingUser, setEditingUser] = useState<UserRow | null>(null);

  async function loadUsers() {
    const result = await fetchJson<UserRow[]>("/api/admin/users");
    if (!result.ok) {
      if (result.unauthorized) onUnauthorized();
      return;
    }
    setUsers(result.data);
    setLoading(false);
  }

  useEffect(() => {
    loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSearchChange(value: string) {
    setSearchQuery(value);
    setPage(0);
  }

  async function toggleBan(user: UserRow) {
    setBanningId(user.id);
    setError(null);
    try {
      const endpoint = user.bannedAt ? "unban" : "ban";
      const res = await fetch(`/api/admin/users/${user.id}/${endpoint}`, {
        method: "POST",
        credentials: "same-origin",
      });
      if (!res.ok) {
        if (res.status === 401) {
          onUnauthorized();
          return;
        }
        setError("처리에 실패했습니다");
        return;
      }
      await loadUsers();
    } catch {
      setError("처리에 실패했습니다");
    } finally {
      setBanningId(null);
    }
  }

  const filteredUsers = searchQuery.trim()
    ? users.filter((user) => (user.nickname ?? "").includes(searchQuery.trim()))
    : users;
  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageUsers = filteredUsers.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  return (
    <main className={styles.wrap}>
      <div className={styles.header}>
        <button className={styles.backButton} onClick={onBack}>
          ← 대시보드로
        </button>
        <h1 className={styles.heading}>유저 정보 ({users.length})</h1>
      </div>
      <input
        className={styles.searchInput}
        value={searchQuery}
        onChange={(e) => handleSearchChange(e.target.value)}
        placeholder="닉네임으로 검색 (일부만 입력해도 됨)"
      />
      {error && <p className={styles.error}>{error}</p>}
      {loading ? (
        <p>불러오는 중...</p>
      ) : filteredUsers.length === 0 ? (
        <p className={styles.noResults}>일치하는 유저가 없어요.</p>
      ) : (
        <>
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>id</th>
                  <th>이메일</th>
                  <th>이름</th>
                  <th>닉네임</th>
                  <th>색상</th>
                  <th>효과</th>
                  <th>가입일</th>
                  <th>최근 로그인</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {pageUsers.map((user) => (
                  <tr key={user.id} className={user.bannedAt ? styles.bannedRow : undefined}>
                    <td>{user.id}</td>
                    <td>{user.email ?? "-"}</td>
                    <td>{user.name ?? "-"}</td>
                    <td>{user.nickname ?? "-"}</td>
                    <td>
                      <div className={styles.colorDisplayRow}>
                        <span
                          className={styles.colorSwatch}
                          style={{ background: user.nicknameColor ?? "transparent" }}
                        />
                        <span>{user.nicknameColor ?? "-"}</span>
                      </div>
                    </td>
                    <td>
                      {EFFECT_LABELS[user.nicknameEffect]}
                      {user.nicknameGlow ? " + 글로우" : ""}
                      {user.nicknameParticle !== "none" ? ` + ${PARTICLE_LABELS[user.nicknameParticle]}` : ""}
                    </td>
                    <td>{user.createdAt}</td>
                    <td>{user.lastLoginAt ?? "-"}</td>
                    <td className={styles.actionsCell}>
                      <button className={styles.smallButton} onClick={() => setEditingUser(user)}>
                        수정
                      </button>
                      <button
                        className={styles.smallButton}
                        onClick={() => toggleBan(user)}
                        disabled={banningId === user.id}
                      >
                        {user.bannedAt ? "밴 해제" : "밴"}
                      </button>
                      <button
                        className={styles.smallButton}
                        onClick={() => onOpenMonitor(user.id, user.nickname ?? `유저 ${user.id}`)}
                      >
                        모니터링
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={styles.pagination}>
            <button
              className={styles.smallButton}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={safePage === 0}
            >
              이전
            </button>
            <span className={styles.pageIndicator}>
              {safePage + 1} / {totalPages}
            </span>
            <button
              className={styles.smallButton}
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={safePage >= totalPages - 1}
            >
              다음
            </button>
          </div>
        </>
      )}
      {editingUser && (
        <AdminEditUserModal
          user={editingUser}
          onClose={() => setEditingUser(null)}
          onSaved={loadUsers}
          onUnauthorized={onUnauthorized}
        />
      )}
    </main>
  );
}
```

- [ ] **Step 2: `AdminUsers.module.css`에서 안 쓰는 클래스 제거 + 페이지네이션 클래스 추가**

`.editInput`, `.colorEditRow`, `.colorInput`, `.effectLabel` 규칙을 삭제한다(전부
Task 2에서 `AdminEditUserModal.module.css`로 옮겨갔고, 새 `AdminUsers.tsx`엔 더
이상 참조가 없음). `.colorDisplayRow`/`.colorSwatch`는 테이블의 읽기 전용 표시에
계속 쓰이므로 **그대로 둔다**. 최종 파일 전체 내용:

```css
.wrap {
  padding: 1.5rem;
  display: grid;
  gap: 1rem;
  color: #111827;
  background: #f9fafb;
  min-height: 100svh;
  box-sizing: border-box;
  align-content: start;
  max-width: 75rem;
  margin: 0 auto;
  text-align: left;
}

.header {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.heading {
  margin: 0;
  font-size: 1.2rem;
}

.backButton {
  padding: 0.4rem 0.8rem;
  font-size: 0.85rem;
  border-radius: 0.4rem;
  border: 1px solid #d1d5db;
  background: #fff;
  cursor: pointer;
}

.error {
  color: #d33;
  font-size: 0.85rem;
  margin: 0;
}

.searchInput {
  padding: 0.5rem;
  font-size: 0.9rem;
  border: 1px solid #d1d5db;
  border-radius: 0.4rem;
  width: 100%;
  max-width: 20rem;
  box-sizing: border-box;
}

.noResults {
  color: #6b7280;
  font-size: 0.85rem;
}

.tableScroll {
  max-height: calc(100svh - 8rem);
  overflow-y: auto;
  border: 1px solid #e5e7eb;
  border-radius: 0.4rem;
}

.table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
}

.table th,
.table td {
  text-align: left;
  padding: 0.4rem 0.6rem;
  border-bottom: 1px solid #e5e7eb;
  white-space: nowrap;
}

.table thead th {
  position: sticky;
  top: 0;
  background: #f9fafb;
}

.actionsCell {
  display: flex;
  gap: 0.4rem;
}

.smallButton {
  padding: 0.2rem 0.6rem;
  font-size: 0.8rem;
  border-radius: 0.3rem;
  border: 1px solid #d1d5db;
  background: #fff;
  cursor: pointer;
}

.smallButton:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.bannedRow {
  opacity: 0.5;
}

.colorDisplayRow {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.colorSwatch {
  display: inline-block;
  width: 0.9rem;
  height: 0.9rem;
  border-radius: 999px;
  border: 1px solid #d1d5db;
  flex-shrink: 0;
}

.pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  padding: 0.5rem 0;
}

.pageIndicator {
  font-size: 0.85rem;
  color: #374151;
}
```

- [ ] **Step 3: 타입체크 + 빌드**

Run: `cd client && npx tsc -b && npm run build`
Expected: 에러 없음, 빌드 성공.

- [ ] **Step 4: 로컬에서 동기화 후 수동 확인**

Run: `npm run sync-public` (루트에서)

`http://localhost:2567/admin` → 유저 정보 페이지에서:
- 페이지네이션 버튼으로 다음/이전 페이지 이동이 되는지
- 검색어를 입력하면 1페이지로 리셋되고 필터링된 결과 안에서 페이지네이션이 동작하는지
- "수정" 버튼을 누르면 모달이 뜨고, 닉네임/색상/효과/파티클/게임머니 각각 독립적으로 저장되는지(하나 저장해도 모달이 안 닫히고 나머지도 계속 편집 가능한지)
- 게임머니 섹션에 `+10000`/`-5000` 같은 값을 넣었을 때 잔액이 정확히 반영되고, 잔액보다 큰 금액을 차감해도 0 밑으로 안 내려가는지
- 밴/해제, 모니터링 버튼이 여전히 테이블 행에서 바로 동작하는지

- [ ] **Step 5: 커밋**

```bash
git add client/src/components/AdminUsers.tsx client/src/components/AdminUsers.module.css
git commit -m "클라이언트: 관리자 유저 테이블 페이지네이션 + 수정 모달 연결로 리모델링"
```

---

## 최종 확인

```bash
cd server && npm test && npm run build
cd ../client && npx tsc -b && npm run build
```

전부 그린이면(팀 탈락 관련 기존 무관 실패 2개 제외) `superpowers:finishing-a-development-branch` 스킬로 넘어간다(이 프로젝트는 브랜치 없이 `main`에 직접 커밋하는 컨벤션이므로 "3옵션" 메뉴는 건너뛰고 배포 여부만 확인).
