# 절구(목숨) 회복 보너스 토큰 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 매 턴 시퀀스 생성 시 0.8% 확률로 시퀀스 안 랜덤 위치 하나에 "보너스" 플래그가 붙고, 그 위치를 성공적으로 통과하면 즉시 그 팀의 절구(목숨)가 1개 회복된다(이미 FULL이면 효과 없음). 기존 4개 아이템(`useItem` 메시지로 보유 후 사용)과 달리 "보유" 단계 없이 성공 자체가 곧 발동이다.

**Architecture:** 순수 계산(확률 굴리기, 절구 회복 상한 계산)은 `server/src/game/`에 분리해 vitest로 테스트하고, 실제 시퀀스 조립/타이밍/상태 조작은 `MatchRoom.ts`에서 처리한다(기존 아이템 시스템과 동일한 구조). 자세한 설계 근거는 `docs/superpowers/specs/2026-07-25-bonus-mortar-token-design.md` 참고.

**Tech Stack:** TypeScript, vitest, `@colyseus/testing` + `colyseus.js`(기존 `MatchRoom.test.ts` 컨벤션).

## Global Constraints

- 발동 확률: 턴당 0.8%, 최대 1개까지만 붙는다.
- 확률에 당첨되면 시퀀스 전체 길이 중 균등 랜덤 인덱스 하나가 보너스로 지정된다.
- 발동 조건: 그 위치를 "성공"으로 통과(정상 판정이든 슈퍼절구로 인한 색상 무관 성공이든 상관없음).
- 발동 효과: 그 시퀀스를 플레이 중인 활성 팀 자신의 절구를 1개 회복. 이미 `STARTING_MORTARS`(5)면 그대로 유지(에러 아님).
- 반죽공격으로 다음 턴 시퀀스 앞에 민트 6개가 붙는 경우, 보너스 인덱스는 그 민트 6개를 포함한 최종 시퀀스 기준으로 뽑는다 — 즉 시퀀스 조립(길이 결정 + 반죽공격 프리픽스 적용)이 끝난 뒤에 인덱스를 뽑는다.
- 시간감소/시간추가와는 아무 상호작용이 없다.
- 재대결(`handleRematch`) 시 보너스 인덱스도 리셋한다.
- `MatchState`에 새 `@type` 동기화 필드는 추가하지 않는다 — `MatchRoom`의 private 필드로 충분(클라이언트 UI는 범위 밖).

---

### Task 1: 순수 로직 (`mortar.ts`에 `gainMortar` 추가, 신규 `bonusMortarToken.ts`)

**Files:**
- Modify: `server/src/game/mortar.ts`
- Modify: `server/src/game/mortar.test.ts`
- Create: `server/src/game/bonusMortarToken.ts`
- Create: `server/src/game/bonusMortarToken.test.ts`

**Interfaces:**
- Consumes: `Rng` type from `server/src/game/rng.ts` (existing, already used by `sequence.ts`/`fragments.ts`).
- Produces (used by Task 2 in `MatchRoom.ts`):
  - `export function gainMortar(mortars: number): number` (added to `mortar.ts`, alongside existing `STARTING_MORTARS`/`loseMortar`/`isEliminated`)
  - `export const BONUS_MORTAR_CHANCE = 0.008` (`bonusMortarToken.ts`)
  - `export function rollBonusMortarIndex(sequenceLength: number, rng: Rng): number | null` (`bonusMortarToken.ts`)

- [ ] **Step 1: Write the failing tests for `gainMortar`**

Add to `server/src/game/mortar.test.ts` (existing file — add these `test()` calls inside the existing `describe("mortar (team-shared lives)", ...)` block, alongside the existing `loseMortar`/`isEliminated` tests):

```ts
test("gaining a mortar increments the count", () => {
  expect(gainMortar(3)).toBe(4);
});

test("mortars never exceed STARTING_MORTARS (already full has no effect)", () => {
  expect(gainMortar(STARTING_MORTARS)).toBe(STARTING_MORTARS);
});
```

Update the existing import line at the top of the file from:

```ts
import { STARTING_MORTARS, isEliminated, loseMortar } from "./mortar";
```

to:

```ts
import { STARTING_MORTARS, gainMortar, isEliminated, loseMortar } from "./mortar";
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test --workspace server -- mortar.test.ts`
Expected: FAIL — `gainMortar` is not exported from `./mortar` yet.

- [ ] **Step 3: Implement `gainMortar`**

Add to `server/src/game/mortar.ts` (the whole current file is just 9 lines — add this function after `loseMortar`, before `isEliminated`):

```ts
export function gainMortar(mortars: number): number {
  return Math.min(STARTING_MORTARS, mortars + 1);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test --workspace server -- mortar.test.ts`
Expected: PASS (7 tests total: 5 existing + 2 new).

- [ ] **Step 5: Write the failing tests for `rollBonusMortarIndex`**

Create `server/src/game/bonusMortarToken.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { BONUS_MORTAR_CHANCE, rollBonusMortarIndex } from "./bonusMortarToken";

function queueRng(values: number[]): () => number {
  let i = 0;
  return () => values[i++];
}

describe("rollBonusMortarIndex", () => {
  test("returns null when the chance roll misses (>= BONUS_MORTAR_CHANCE)", () => {
    const rng = queueRng([BONUS_MORTAR_CHANCE]);
    expect(rollBonusMortarIndex(18, rng)).toBeNull();
  });

  test("returns null for any roll clearly above the chance", () => {
    const rng = queueRng([0.5]);
    expect(rollBonusMortarIndex(18, rng)).toBeNull();
  });

  test("returns a valid index when the chance roll hits (< BONUS_MORTAR_CHANCE)", () => {
    // chance roll hits (0), then the index-position roll picks index 0 of 18
    const rng = queueRng([0, 0]);
    expect(rollBonusMortarIndex(18, rng)).toBe(0);
  });

  test("the index roll is scaled to the sequence length and floored to an integer", () => {
    // chance roll hits (0), then index-position roll 0.5 of a 20-length
    // sequence -> floor(0.5 * 20) = 10
    const rng = queueRng([0, 0.5]);
    expect(rollBonusMortarIndex(20, rng)).toBe(10);
  });

  test("an index roll just under 1 never reaches sequenceLength itself", () => {
    // chance roll hits (0), then index-position roll 0.999999 of a
    // 10-length sequence -> floor(0.999999 * 10) = 9, not 10
    const rng = queueRng([0, 0.999999]);
    expect(rollBonusMortarIndex(10, rng)).toBe(9);
  });
});
```

- [ ] **Step 6: Run the tests to verify they fail**

Run: `npm test --workspace server -- bonusMortarToken.test.ts`
Expected: FAIL — `Cannot find module './bonusMortarToken'` (file doesn't exist yet).

- [ ] **Step 7: Implement `bonusMortarToken.ts`**

Create `server/src/game/bonusMortarToken.ts`:

```ts
import type { Rng } from "./rng";

export const BONUS_MORTAR_CHANCE = 0.008;

// 0.8% 확률로 [0, sequenceLength) 범위의 균등 랜덤 인덱스 하나를 반환하고,
// 당첨되지 않으면 null. 시퀀스당 최대 1개라는 규칙은 호출부(MatchRoom.startTurn)가
// 이 함수를 턴마다 정확히 한 번만 호출하는 것으로 자연스럽게 지켜진다 — 이 함수
// 자체는 "여러 번 호출하면 여러 개 나올 수 있다"는 제약이 없는 단순 단발 룰렛이다.
export function rollBonusMortarIndex(sequenceLength: number, rng: Rng): number | null {
  if (rng() >= BONUS_MORTAR_CHANCE) return null;
  return Math.floor(rng() * sequenceLength);
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npm test --workspace server -- bonusMortarToken.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 9: Commit**

```bash
git add server/src/game/mortar.ts server/src/game/mortar.test.ts server/src/game/bonusMortarToken.ts server/src/game/bonusMortarToken.test.ts
git commit -m "$(cat <<'EOF'
절구 회복 순수 로직(gainMortar, 보너스 토큰 확률 굴리기) 추가

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `MatchRoom.ts` 배선 (시퀀스 생성 시 보너스 인덱스 굴리기 + 성공 시 발동)

**Files:**
- Modify: `server/src/rooms/MatchRoom.ts`
- Modify: `server/src/rooms/MatchRoom.test.ts`

**Interfaces:**
- Consumes: `gainMortar` from `../game/mortar` (Task 1), `rollBonusMortarIndex` from `../game/bonusMortarToken` (Task 1).
- Produces: nothing consumed by later work — this is the only remaining task in this plan.

- [ ] **Step 1: Write the failing tests**

`server/src/rooms/MatchRoom.test.ts`의 `describe("MatchRoom", ...)` 블록 안, 기존 `items` describe 블록 옆(형제 블록)에 추가:

```ts
  describe("bonus mortar token", () => {
    test("successfully pressing the forced bonus index restores one mortar", async () => {
      const { room, clients } = await fillRolesAndStart({
        turnDurationMs: PRESS_HEAVY_TURN_MS,
        forcedBonusMortarIndex: 0,
      });
      const { activeTeam, dueColor, actingClient } = actingClientFor(room, clients);
      activeTeam.mortars = 3;

      actingClient.send("pressButton", { color: dueColor });
      await flush();

      expect(activeTeam.mortars).toBe(4);
    });

    test("pressing the bonus index while already at full mortars has no effect", async () => {
      const { room, clients } = await fillRolesAndStart({
        turnDurationMs: PRESS_HEAVY_TURN_MS,
        forcedBonusMortarIndex: 0,
      });
      const { activeTeam, dueColor, actingClient } = actingClientFor(room, clients);
      // activeTeam.mortars is already STARTING_MORTARS (5) from room setup.

      actingClient.send("pressButton", { color: dueColor });
      await flush();

      expect(activeTeam.mortars).toBe(5);
    });

    test("a WRONG press at the bonus index does not restore a mortar (normal fail applies instead)", async () => {
      const { room, clients } = await fillRolesAndStart({
        turnDurationMs: PRESS_HEAVY_TURN_MS,
        forcedBonusMortarIndex: 0,
      });
      const { activeTeam, dueColor, actingClient } = actingClientFor(room, clients);
      activeTeam.mortars = 3;
      const wrongColor: Color = ALL_COLORS.find((c) => c !== dueColor)!;

      actingClient.send("pressButton", { color: wrongColor });
      await flush();

      expect(activeTeam.mortars).toBe(2);
      expect(room.state.turnOutcome).toBe("fail");
    });

    test("superMortar-bypassed success at the bonus index still restores a mortar", async () => {
      const { room, clients } = await fillRolesAndStart({
        turnDurationMs: PRESS_HEAVY_TURN_MS,
        forcedBonusMortarIndex: 0,
      });
      const { activeTeam, dueColor, actingClient } = actingClientFor(room, clients);
      activeTeam.mortars = 3;
      actingClient.send("useItem", { itemId: "superMortar" });
      await flush();

      const wrongColor: Color = ALL_COLORS.find((c) => c !== dueColor)!;
      actingClient.send("pressButton", { color: wrongColor });
      await flush();

      expect(activeTeam.mortars).toBe(4);
    });

    test("succeeding at a non-bonus position does not restore a mortar", async () => {
      const { room, clients } = await fillRolesAndStart({
        turnDurationMs: PRESS_HEAVY_TURN_MS,
        forcedBonusMortarIndex: 5,
      });
      const { activeTeam, dueColor, actingClient } = actingClientFor(room, clients);
      activeTeam.mortars = 3;

      actingClient.send("pressButton", { color: dueColor });
      await flush();

      expect(activeTeam.mortars).toBe(3);
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test --workspace server -- MatchRoom.test.ts -t "bonus mortar token"`
Expected: FAIL — `forcedBonusMortarIndex` isn't a recognized option yet (ignored), so no bonus is ever active and all five tests fail their `mortars`/`turnOutcome` assertions.

- [ ] **Step 3: Add the `forcedBonusMortarIndex` option and `bonusMortarIndex` field**

`server/src/rooms/MatchRoom.ts`'s existing mortar import:

```ts
import { loseMortar, isEliminated, STARTING_MORTARS } from "../game/mortar";
```

Change to:

```ts
import { loseMortar, isEliminated, STARTING_MORTARS, gainMortar } from "../game/mortar";
```

Add a new import line right after it:

```ts
import { rollBonusMortarIndex } from "../game/bonusMortarToken";
```

Add to the `MatchRoomOptions` interface (after the existing `allowSpectators?: unknown;` field):

```ts
  // 테스트 전용 — 0.8%라는 낮은 확률을 실제 rng로 재현하지 않고 강제 지정하기
  // 위함. production에서는 항상 undefined(정상적인 확률 롤 사용).
  forcedBonusMortarIndex?: number;
```

Add a new class field, right after `private pendingItemsForNextTurn = new ItemUseTracker();`:

```ts
  private forcedBonusMortarIndex?: number;
  private bonusMortarIndex: number | null = null;
```

In `onCreate`, right after the existing `this.allowSpectators = options.allowSpectators !== false;` line:

```ts
    if (options.forcedBonusMortarIndex !== undefined) {
      this.forcedBonusMortarIndex = options.forcedBonusMortarIndex;
    }
```

- [ ] **Step 4: Roll the bonus index in `startTurn()`, after the sequence is fully assembled**

In `startTurn()`, the existing:

```ts
    const length = sequenceLengthForRound(this.state.round);
    let sequence = generateSequence(length, Math.random, this.state.round);
    if (this.pendingItemsForNextTurn.has("doughAttack")) {
      sequence = applyDoughAttack(sequence);
    }

    this.state.sequence.clear();
```

Insert a new line between the `if (this.pendingItemsForNextTurn.has("doughAttack")) { ... }` block and `this.state.sequence.clear();`:

```ts
    const length = sequenceLengthForRound(this.state.round);
    let sequence = generateSequence(length, Math.random, this.state.round);
    if (this.pendingItemsForNextTurn.has("doughAttack")) {
      sequence = applyDoughAttack(sequence);
    }

    this.bonusMortarIndex =
      this.forcedBonusMortarIndex !== undefined
        ? this.forcedBonusMortarIndex
        : rollBonusMortarIndex(sequence.length, Math.random);

    this.state.sequence.clear();
```

- [ ] **Step 5: Reset on rematch**

In `handleRematch()`, add this line alongside the existing three tracker-reset lines (`this.itemsUsedThisTurn.reset(); this.superMortarActiveThisTurn = false; this.pendingItemsForNextTurn.reset();`):

```ts
    this.bonusMortarIndex = null;
```

- [ ] **Step 6: Check for the bonus on a successful press**

In `handlePressButton()`, the existing success path:

```ts
    this.state.cursor = result.nextCursor;
    activeTeam.combo += 1;
    if (result.complete) {
```

Insert a new check right before `this.state.cursor = result.nextCursor;` (at this point `this.state.cursor` still holds the PRE-press value — the position that was just satisfied):

```ts
    if (this.bonusMortarIndex !== null && this.state.cursor === this.bonusMortarIndex) {
      activeTeam.mortars = gainMortar(activeTeam.mortars);
    }

    this.state.cursor = result.nextCursor;
    activeTeam.combo += 1;
    if (result.complete) {
```

(This check sits after the `if (!result.correct) { ...; return; }` block above it, so by the time execution reaches here, `result.correct` is always true — no need to check it again.)

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm test --workspace server -- MatchRoom.test.ts -t "bonus mortar token"`
Expected: PASS (5 tests).

- [ ] **Step 8: Run the full server test suite to check for regressions**

Run: `npm test --workspace server`
Expected: PASS — this is a pure addition (new option, new field, one new check ahead of the existing cursor/combo update); no existing test sets `forcedBonusMortarIndex`, so `bonusMortarIndex` stays `null` for every pre-existing test and the new check is always a no-op for them.

- [ ] **Step 9: Run typecheck**

Run: `npm run build --workspace server`
Expected: no errors (`tsc --noEmit`).

- [ ] **Step 10: Commit**

```bash
git add server/src/rooms/MatchRoom.ts server/src/rooms/MatchRoom.test.ts
git commit -m "$(cat <<'EOF'
절구 회복 보너스 토큰 배선 — 턴당 0.8% 확률로 시퀀스에 보너스 위치 지정, 성공 시 절구 1개 회복

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## 이 계획에서 의도적으로 빠진 것 (스펙에 이미 명시된 범위 밖)

- 클라이언트 UI(보너스 위치 시각적 표시) — `MatchState`에 동기화 필드가 없으므로 클라이언트가 지금 당장 뭘 그릴 방법이 없다. 나중에 UI를 붙일 때 `bonusMortarIndex`를 어떤 형태로 동기화할지부터 다시 설계해야 한다.
- 기존 4개 아이템의 "시퀀스보드 토큰 기반 획득" 시스템 — 사용자가 언급한 더 큰 미래 계획이지만, 이번 범위는 이 보너스 절구 토큰 하나뿐이다.
