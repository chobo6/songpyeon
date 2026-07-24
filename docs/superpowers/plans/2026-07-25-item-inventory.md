# 아이템 인벤토리 + 토큰 획득 일반화 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 절구회복 전용이던 0.8% 보너스 토큰 롤을 일반화해서, 당첨 시 5개 아이템(시간추가/시간감소/반죽공격/슈퍼절구/절구회복) 중 하나가 **토큰 생성 시점**에 이미 결정된다. 절구회복은 기존처럼 즉시 발동, 나머지 4개는 성공시킨 플레이어의 개인 인벤토리(역할당 2칸)에 담긴다. `useItem`의 권한/소모 규칙도 "우리 팀 아무나 무제한"에서 "실제 보유한 그 플레이어만, 보유량만큼"으로 리트로핏된다.

**Architecture:** 순수 로직은 `server/src/game/`, 실제 인벤토리/타이머/권한은 `MatchRoom.ts`. 자세한 설계 근거는 `docs/superpowers/specs/2026-07-25-item-inventory-design.md` 참고.

**Tech Stack:** TypeScript, vitest, `@colyseus/testing` + `colyseus.js`(기존 `MatchRoom.test.ts` 컨벤션).

## Global Constraints

- 토큰 생성 시점(시퀀스 조립 완료 직후)에 0.8% 확률로 위치+아이템이 동시에 확정된다. 이후 누가 누르든 값은 안 바뀐다.
- 5개 아이템 중 선택은 균등 확률(각 20%).
- 절구회복: 성공 즉시 발동, 인벤토리 없음, FULL이면 무효과 — 기존과 동일.
- 나머지 4개: 성공시킨 플레이어의 개인 인벤토리(최대 2개, 종류 무관)에 추가. 이미 2개면 신규 획득분 소멸.
- `useItem` 권한: 그 아이템을 실제 보유한 그 플레이어만. 미보유 시 조용히 무시.
- 유효한 `useItem` 호출은 효과 적용 여부와 무관하게 무조건 보유량 1개 소모.
- 방어 아이템(시간추가/슈퍼절구): 여러 개 쓰면 중첩 적용(시간추가 2개=+2초). 기존 `itemsUsedThisTurn`(턴당 1회 제한)은 완전히 제거된다.
- 공격 아이템(시간감소/반죽공격): 여러 개 써도 효과는 1회분만(기존 `pendingItemsForNextTurn` 그대로), 소모는 매번.
- 재대결 시 개인 인벤토리 전부 비움. 완전 퇴장 시 그 플레이어의 인벤토리 항목 정리.
- `MatchState`에 새 `@type` 동기화 필드는 추가하지 않는다.

---

### Task 1: 순수 로직 일반화 (`ItemId` 확장, `bonusItemToken.ts` 신규)

이 태스크는 순수하게 추가만 한다 — 기존 `bonusMortarToken.ts`나 `MatchRoom.ts`는 건드리지 않는다(Task 2에서 교체).

**Files:**
- Modify: `server/src/game/items.ts`
- Create: `server/src/game/bonusItemToken.ts`
- Create: `server/src/game/bonusItemToken.test.ts`

**Interfaces:**
- Consumes: `Rng` type from `server/src/game/rng.ts` (existing).
- Produces (used by Task 2):
  - `export type ItemId = "timeAdd" | "timeReduce" | "doughAttack" | "superMortar" | "mortarRestore"` (extended union, `items.ts`)
  - `export interface BonusItemRoll { index: number; itemId: ItemId }` (`bonusItemToken.ts`)
  - `export const BONUS_ITEM_CHANCE = 0.008` (`bonusItemToken.ts`)
  - `export function rollBonusItemIndex(sequenceLength: number, rng: Rng): BonusItemRoll | null` (`bonusItemToken.ts`)

- [ ] **Step 1: Extend `ItemId`**

`server/src/game/items.ts`'s existing line:

```ts
export type ItemId = "timeAdd" | "timeReduce" | "doughAttack" | "superMortar";
```

Change to:

```ts
export type ItemId = "timeAdd" | "timeReduce" | "doughAttack" | "superMortar" | "mortarRestore";
```

(Nothing else in `items.ts` changes — `ItemUseTracker`/`applyDoughAttack`/`applyTimeReduce` are unaffected.)

- [ ] **Step 2: Write the failing tests for `rollBonusItemIndex`**

Create `server/src/game/bonusItemToken.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { BONUS_ITEM_CHANCE, rollBonusItemIndex } from "./bonusItemToken";
import type { ItemId } from "./items";

function queueRng(values: number[]): () => number {
  let i = 0;
  return () => values[i++];
}

const ALL_ITEM_IDS: ItemId[] = ["timeAdd", "timeReduce", "doughAttack", "superMortar", "mortarRestore"];

describe("rollBonusItemIndex", () => {
  test("returns null when the chance roll misses (>= BONUS_ITEM_CHANCE)", () => {
    const rng = queueRng([BONUS_ITEM_CHANCE]);
    expect(rollBonusItemIndex(18, rng)).toBeNull();
  });

  test("returns null for any roll clearly above the chance", () => {
    const rng = queueRng([0.5]);
    expect(rollBonusItemIndex(18, rng)).toBeNull();
  });

  test("on a hit, returns a valid index and one of the 5 known item ids", () => {
    // chance roll hits (0), index roll picks position 0 of 18, item roll picks index 0 -> "timeAdd"
    const rng = queueRng([0, 0, 0]);
    expect(rollBonusItemIndex(18, rng)).toEqual({ index: 0, itemId: "timeAdd" });
  });

  test("the index roll is scaled to sequence length and floored", () => {
    // chance hits (0), index roll 0.5 of a 20-length sequence -> floor(0.5*20)=10,
    // item roll 0.5 of 5 items -> floor(0.5*5)=2 -> "doughAttack"
    const rng = queueRng([0, 0.5, 0.5]);
    expect(rollBonusItemIndex(20, rng)).toEqual({ index: 10, itemId: "doughAttack" });
  });

  test("the item roll picks the LAST item id (mortarRestore) for a roll just under 1", () => {
    // chance hits (0), index roll 0 -> position 0, item roll 0.999999 of 5 ->
    // floor(0.999999*5)=4 -> ALL_ITEM_IDS[4] = "mortarRestore"
    const rng = queueRng([0, 0, 0.999999]);
    expect(rollBonusItemIndex(10, rng)).toEqual({ index: 0, itemId: "mortarRestore" });
  });

  test("every possible item roll maps to one of the 5 known ids", () => {
    for (let i = 0; i < 5; i++) {
      const rng = queueRng([0, 0, i / 5]);
      const result = rollBonusItemIndex(10, rng);
      expect(ALL_ITEM_IDS).toContain(result?.itemId);
    }
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test --workspace server -- bonusItemToken.test.ts`
Expected: FAIL — `Cannot find module './bonusItemToken'` (file doesn't exist yet).

- [ ] **Step 4: Implement `bonusItemToken.ts`**

Create `server/src/game/bonusItemToken.ts`:

```ts
import type { ItemId } from "./items";
import type { Rng } from "./rng";

export const BONUS_ITEM_CHANCE = 0.008;

const ALL_ITEM_IDS: ItemId[] = ["timeAdd", "timeReduce", "doughAttack", "superMortar", "mortarRestore"];

export interface BonusItemRoll {
  index: number;
  itemId: ItemId;
}

// 0.8% 확률로 시퀀스 안 랜덤 위치 하나에 5개 아이템 중 균등 랜덤으로 하나를 붙인다.
// 당첨되지 않으면 null. rng 호출 순서: (1) 당첨 여부, (2) 위치, (3) 어떤 아이템인지 —
// 순서를 바꾸면 큐에 값을 채워 쓰는 테스트들의 기대값이 깨지므로 고정.
export function rollBonusItemIndex(sequenceLength: number, rng: Rng): BonusItemRoll | null {
  if (rng() >= BONUS_ITEM_CHANCE) return null;
  const index = Math.floor(rng() * sequenceLength);
  const itemId = ALL_ITEM_IDS[Math.floor(rng() * ALL_ITEM_IDS.length)];
  return { index, itemId };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test --workspace server -- bonusItemToken.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Run the full server test suite to check for regressions**

Run: `npm test --workspace server`
Expected: PASS — this is a pure addition (new file + a widened union type that nothing else references yet), no existing code path is affected.

- [ ] **Step 7: Commit**

```bash
git add server/src/game/items.ts server/src/game/bonusItemToken.ts server/src/game/bonusItemToken.test.ts
git commit -m "$(cat <<'EOF'
ItemId에 절구회복 추가, 보너스 토큰 롤을 5개 아이템 중 하나 고르는 방식으로 일반화(순수 로직)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `MatchRoom.ts` 획득 쪽 배선 (롤 일반화 + 개인 인벤토리 도입)

`handleUseItem`은 이 태스크에서 건드리지 않는다(여전히 기존 `itemsUsedThisTurn` 기반 — Task 3에서 리트로핏). 이 태스크는 순수하게 "보너스 토큰이 어떻게 생성되고, 성공 시 어디로 가는지"만 바꾼다.

**Files:**
- Modify: `server/src/rooms/MatchRoom.ts`
- Modify: `server/src/rooms/MatchRoom.test.ts`
- Delete: `server/src/game/bonusMortarToken.ts`
- Delete: `server/src/game/bonusMortarToken.test.ts`

**Interfaces:**
- Consumes: `BonusItemRoll`, `rollBonusItemIndex` from `../game/bonusItemToken` (Task 1), `ItemId` from `../game/items` (Task 1's extended union).
- Produces: `private playerInventory = new Map<string, ItemId[]>()` — consumed by Task 3's `handleUseItem` retrofit.

- [ ] **Step 1: Delete the superseded files**

```bash
rm server/src/game/bonusMortarToken.ts server/src/game/bonusMortarToken.test.ts
```

(This will make `MatchRoom.ts` fail to compile until Step 2 below rewires its import — that's expected mid-task, not a stopping point.)

- [ ] **Step 2: Swap the import and rename fields/options in `MatchRoom.ts`**

Existing import line:

```ts
import { rollBonusMortarIndex } from "../game/bonusMortarToken";
```

Change to:

```ts
import { rollBonusItemIndex, type BonusItemRoll } from "../game/bonusItemToken";
```

Existing `MatchRoomOptions` fields:

```ts
  // 테스트 전용 — 0.8%라는 낮은 확률을 실제 rng로 재현하지 않고 강제 지정하기
  // 위함. production에서는 항상 undefined(정상적인 확률 롤 사용).
  forcedBonusMortarIndex?: number;
  // 테스트 전용 — startTurn()이 보너스 박격포 인덱스를 굴릴 때 쓰는 rng를 교체
  // 하기 위함(turnDurationMs 등 기존 옵션들과 같은 주입 패턴). forcedBonusMortarIndex가
  // 지정돼 있으면 이 rng는 아예 호출되지 않는다. production에서는 항상 undefined
  // (Math.random 사용).
  bonusMortarRng?: Rng;
```

Change to:

```ts
  // 테스트 전용 — 0.8%라는 낮은 확률을 실제 rng로 재현하지 않고 강제 지정하기
  // 위함. production에서는 항상 undefined(정상적인 확률 롤 사용).
  forcedBonusItem?: BonusItemRoll;
  // 테스트 전용 — startTurn()이 보너스 토큰을 굴릴 때 쓰는 rng를 교체하기 위함
  // (turnDurationMs 등 기존 옵션들과 같은 주입 패턴). forcedBonusItem이 지정돼
  // 있으면 이 rng는 아예 호출되지 않는다. production에서는 항상 undefined
  // (Math.random 사용).
  bonusItemRng?: Rng;
```

Existing class fields:

```ts
  private forcedBonusMortarIndex?: number;
  private bonusMortarIndex: number | null = null;
  private bonusMortarRng: Rng = Math.random;
```

Change to:

```ts
  private forcedBonusItem?: BonusItemRoll;
  private bonusItem: BonusItemRoll | null = null;
  private bonusItemRng: Rng = Math.random;
  // 역할당 최대 2개(아이템 종류 무관) — 절구회복을 제외한 보너스 토큰 획득분이
  // 여기 담긴다. sessionId로 키(팀이 아니라 개인별 소유).
  private playerInventory = new Map<string, ItemId[]>();
```

Existing `onCreate` lines:

```ts
    if (options.forcedBonusMortarIndex !== undefined) {
      this.forcedBonusMortarIndex = options.forcedBonusMortarIndex;
    }
    if (options.bonusMortarRng) this.bonusMortarRng = options.bonusMortarRng;
```

Change to:

```ts
    if (options.forcedBonusItem !== undefined) {
      this.forcedBonusItem = options.forcedBonusItem;
    }
    if (options.bonusItemRng) this.bonusItemRng = options.bonusItemRng;
```

- [ ] **Step 3: Rewire `startTurn()`'s roll**

Existing:

```ts
    this.bonusMortarIndex =
      this.forcedBonusMortarIndex !== undefined
        ? this.forcedBonusMortarIndex
        : rollBonusMortarIndex(sequence.length, this.bonusMortarRng);
```

Change to:

```ts
    this.bonusItem =
      this.forcedBonusItem !== undefined
        ? this.forcedBonusItem
        : rollBonusItemIndex(sequence.length, this.bonusItemRng);
```

- [ ] **Step 4: Rewire `handlePressButton()`'s success branch**

Existing:

```ts
    if (this.bonusMortarIndex !== null && this.state.cursor === this.bonusMortarIndex) {
      activeTeam.mortars = gainMortar(activeTeam.mortars);
    }
```

Change to:

```ts
    if (this.bonusItem !== null && this.state.cursor === this.bonusItem.index) {
      if (this.bonusItem.itemId === "mortarRestore") {
        activeTeam.mortars = gainMortar(activeTeam.mortars);
      } else {
        const held = this.playerInventory.get(client.sessionId) ?? [];
        if (held.length < 2) {
          held.push(this.bonusItem.itemId);
          this.playerInventory.set(client.sessionId, held);
        }
        // 이미 2개 차 있으면 새로 획득한 아이템은 소멸 — 아무 것도 하지 않는다.
      }
    }
```

- [ ] **Step 5: Update `handleRematch()`'s reset**

Existing line:

```ts
    this.bonusMortarIndex = null;
```

Change to:

```ts
    this.bonusItem = null;
    this.playerInventory.clear();
```

(`itemsUsedThisTurn.reset()`/`pendingItemsForNextTurn.reset()` lines directly above this stay exactly as they are — untouched by this task.)

- [ ] **Step 6: Clean up inventory on permanent leave**

`removePlayer(sessionId: string)`'s existing line:

```ts
    this.playerUserIds.delete(sessionId);
```

Add right after it:

```ts
    this.playerInventory.delete(sessionId);
```

- [ ] **Step 7: Migrate every existing `bonusMortarRng: NEVER_BONUS_RNG` site in the test file**

`server/src/rooms/MatchRoom.test.ts` has 8 occurrences of `bonusMortarRng: NEVER_BONUS_RNG` (the shared `fillRolesAndStart` default plus 7 direct `colyseus.createRoom("match", ...)` calls). Replace **every one** with `bonusItemRng: NEVER_BONUS_RNG` (the constant itself, defined near the top of the file as `const NEVER_BONUS_RNG: Rng = () => 1;`, doesn't need to change — only the option key name changes at each call site).

- [ ] **Step 8: Rename and migrate the `describe("bonus mortar token", ...)` block**

Rename the block to `describe("bonus item token (mortarRestore)", ...)`.

In the first 6 tests (`"successfully pressing the forced bonus index restores one mortar"`, `"pressing the bonus index while already at full mortars has no effect"`, `"a WRONG press at the bonus index does not restore a mortar..."`, `"superMortar-bypassed success at the bonus index still restores a mortar"`, `"succeeding at positions before the forced bonus index..."`, `"a bonus index landing inside doughAttack's 6-mint prefix..."`), replace each occurrence of:

```ts
        forcedBonusMortarIndex: 0,
```

with:

```ts
        forcedBonusItem: { index: 0, itemId: "mortarRestore" },
```

— using the SAME numeric value each test already had (0 for the first four, `5` for `"succeeding at positions before the forced bonus index..."`, `3` for `"a bonus index landing inside doughAttack's 6-mint prefix..."`). For example, the `"succeeding at positions..."` test's option becomes:

```ts
        forcedBonusItem: { index: 5, itemId: "mortarRestore" },
```

and the doughAttack-prefix test's becomes:

```ts
        forcedBonusItem: { index: 3, itemId: "mortarRestore" },
```

For the 7th test (`"a rematch after the match ends resets the private bonusMortarIndex tracker back to null"`), make these changes:

1. Rename the test to `"a rematch after the match ends resets the private bonusItem tracker back to null"`.
2. Its room-creation options:

   ```ts
         forcedBonusMortarIndex: 0,
   ```

   becomes:

   ```ts
         forcedBonusItem: { index: 0, itemId: "mortarRestore" },
   ```

3. Its internal-field-cast assertions:

   ```ts
        const internalRoom = room as unknown as { bonusMortarIndex: number | null };
        // The forced index took effect the moment the first turn started —
        // confirms there's something non-null here for the rematch reset to
        // actually be resetting.
        expect(internalRoom.bonusMortarIndex).toBe(0);
   ```

   becomes:

   ```ts
        const internalRoom = room as unknown as { bonusItem: { index: number; itemId: string } | null };
        // The forced item took effect the moment the first turn started —
        // confirms there's something non-null here for the rematch reset to
        // actually be resetting.
        expect(internalRoom.bonusItem).toEqual({ index: 0, itemId: "mortarRestore" });
   ```

   and its final assertion:

   ```ts
        expect(internalRoom.bonusMortarIndex).toBeNull();
   ```

   becomes:

   ```ts
        expect(internalRoom.bonusItem).toBeNull();
   ```

- [ ] **Step 9: Add tests for the new "grant to inventory" behavior**

Add these two tests to the (renamed) `describe("bonus item token (mortarRestore)", ...)` block:

```ts
    test("a non-mortarRestore bonus item is granted to the pressing player's own inventory", async () => {
      const { room, clients } = await fillRolesAndStart({
        turnDurationMs: PRESS_HEAVY_TURN_MS,
        forcedBonusItem: { index: 0, itemId: "timeAdd" },
      });
      const { dueColor, actingClient } = actingClientFor(room, clients);

      actingClient.send("pressButton", { color: dueColor });
      await flush();

      const inventory = (room as unknown as { playerInventory: Map<string, string[]> }).playerInventory;
      expect(inventory.get(actingClient.sessionId)).toEqual(["timeAdd"]);
    });

    test("acquiring a 3rd item while already holding 2 discards the new one", async () => {
      const { room, clients } = await fillRolesAndStart({
        turnDurationMs: PRESS_HEAVY_TURN_MS,
        forcedBonusItem: { index: 0, itemId: "timeAdd" },
      });
      const { dueColor, actingClient } = actingClientFor(room, clients);
      const inventory = (room as unknown as { playerInventory: Map<string, string[]> }).playerInventory;
      inventory.set(actingClient.sessionId, ["doughAttack", "superMortar"]);

      actingClient.send("pressButton", { color: dueColor });
      await flush();

      expect(inventory.get(actingClient.sessionId)).toEqual(["doughAttack", "superMortar"]);
    });
```

- [ ] **Step 10: Run the migrated/new tests**

Run: `npm test --workspace server -- MatchRoom.test.ts -t "bonus item token"`
Expected: PASS (9 tests: the 7 migrated + 2 new).

- [ ] **Step 11: Run the full server test suite to check for regressions**

Run: `npm test --workspace server`
Expected: PASS. In particular, every test in the `items` describe block (superMortar/timeAdd/timeReduce/doughAttack) is UNCHANGED by this task and must still pass exactly as before — this task doesn't touch `handleUseItem` at all.

- [ ] **Step 12: Run typecheck**

Run: `npm run build --workspace server`
Expected: no errors.

- [ ] **Step 13: Commit**

```bash
git add server/src/rooms/MatchRoom.ts server/src/rooms/MatchRoom.test.ts
git add -u server/src/game/bonusMortarToken.ts server/src/game/bonusMortarToken.test.ts
git commit -m "$(cat <<'EOF'
보너스 토큰 롤을 5개 아이템 중 하나로 일반화, 절구회복 외 아이템은 성공시킨 플레이어의 개인 인벤토리로

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `handleUseItem` 권한/소모 리트로핏 (개인 인벤토리 기반)

**Files:**
- Modify: `server/src/rooms/MatchRoom.ts`
- Modify: `server/src/rooms/MatchRoom.test.ts`

**Interfaces:**
- Consumes: `playerInventory` (Task 2).
- Produces: nothing consumed by later work — this is the last task in this plan.

- [ ] **Step 1: Add a `grantItem` test helper**

Add near the top of `server/src/rooms/MatchRoom.test.ts`, alongside the other test helpers (e.g. near `actingClientFor`):

```ts
// Grants an item directly into a player's private inventory, bypassing the
// 0.8% bonus-token roll entirely — for tests that only care about useItem's
// permission/consumption behavior, not how the item was acquired.
function grantItem(room: ServerRoom<MatchState>, sessionId: string, itemId: string) {
  const inventory = (room as unknown as { playerInventory: Map<string, string[]> }).playerInventory;
  const held = inventory.get(sessionId) ?? [];
  held.push(itemId);
  inventory.set(sessionId, held);
}
```

- [ ] **Step 2: Write the new failing tests for permission/consumption/stacking**

Add these tests to the `describe("items", ...)` block (alongside the existing ones):

```ts
    test("useItem is a no-op if the sending player doesn't hold that item", async () => {
      const { room, clients } = await fillRolesAndStart({ turnDurationMs: PRESS_HEAVY_TURN_MS });
      const { dueColor, actingClient } = actingClientFor(room, clients);

      actingClient.send("useItem", { itemId: "superMortar" });
      await flush();

      const wrongColor: Color = ALL_COLORS.find((c) => c !== dueColor)!;
      const cursorBefore = room.state.cursor;
      actingClient.send("pressButton", { color: wrongColor });
      await flush();

      // superMortar never activated (never held), so a genuinely wrong press
      // still fails normally.
      expect(room.state.cursor).toBe(cursorBefore);
      expect(room.state.turnOutcome).toBe("fail");
    });

    test("a teammate cannot use an item held by the OTHER teammate on the active team", async () => {
      const { room, clients } = await fillRolesAndStart({ turnDurationMs: PRESS_HEAVY_TURN_MS });
      const { activeTeam, dueColor, actingClient } = actingClientFor(room, clients);
      const teammateSessionId =
        actingClient.sessionId === activeTeam.pigSessionId ? activeTeam.rabbitSessionId : activeTeam.pigSessionId;
      grantItem(room, teammateSessionId, "superMortar");

      actingClient.send("useItem", { itemId: "superMortar" });
      await flush();

      const wrongColor: Color = ALL_COLORS.find((c) => c !== dueColor)!;
      actingClient.send("pressButton", { color: wrongColor });
      await flush();

      // actingClient never held superMortar themselves, so it never activated.
      expect(room.state.turnOutcome).toBe("fail");
    });

    test("useItem consumes exactly one held copy of the item, regardless of effect", async () => {
      const { room, clients } = await fillRolesAndStart({ turnDurationMs: PRESS_HEAVY_TURN_MS });
      const { actingClient } = actingClientFor(room, clients);
      grantItem(room, actingClient.sessionId, "timeReduce");
      grantItem(room, actingClient.sessionId, "timeReduce");
      const inventory = (room as unknown as { playerInventory: Map<string, string[]> }).playerInventory;

      actingClient.send("useItem", { itemId: "timeReduce" });
      await flush();

      expect(inventory.get(actingClient.sessionId)).toEqual(["timeReduce"]);
    });

    test("holding two timeAdd and using both stacks the extension to +2 seconds", async () => {
      const { room, clients } = await fillRolesAndStart({ turnDurationMs: PRESS_HEAVY_TURN_MS });
      const { actingClient } = actingClientFor(room, clients);
      grantItem(room, actingClient.sessionId, "timeAdd");
      grantItem(room, actingClient.sessionId, "timeAdd");
      const turnEndsAtBefore = room.state.turnEndsAt;

      actingClient.send("useItem", { itemId: "timeAdd" });
      await flush();
      actingClient.send("useItem", { itemId: "timeAdd" });
      await flush();

      expect(room.state.turnEndsAt).toBe(turnEndsAtBefore + 2000);
    });

    test("holding two doughAttack and using both consumes both but only one 6-mint row applies next turn", async () => {
      const { room, clients } = await fillRolesAndStart({ turnDurationMs: PRESS_HEAVY_TURN_MS });
      const activeTeamIndexBefore = room.state.activeTeamIndex;
      const { actingClient } = actingClientFor(room, clients);
      grantItem(room, actingClient.sessionId, "doughAttack");
      grantItem(room, actingClient.sessionId, "doughAttack");
      const inventory = (room as unknown as { playerInventory: Map<string, string[]> }).playerInventory;

      actingClient.send("useItem", { itemId: "doughAttack" });
      await flush();
      actingClient.send("useItem", { itemId: "doughAttack" });
      await flush();

      expect(inventory.get(actingClient.sessionId)).toEqual([]);

      const lengthBefore = room.state.sequence.length;
      await waitUntil(
        () => room.state.activeTeamIndex !== activeTeamIndexBefore,
        PRESS_HEAVY_TURN_MS + 1000,
      );
      const newSequence = Array.from(room.state.sequence);
      expect(newSequence.slice(0, 6)).toEqual(["mint", "mint", "mint", "mint", "mint", "mint"]);
      // Only ONE 6-mint row, not twelve — the effect doesn't stack even
      // though both copies were consumed.
      expect(newSequence.length).toBe(lengthBefore + 6);
    });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test --workspace server -- MatchRoom.test.ts -t "items"`
Expected: FAIL — `grantItem` populates `playerInventory`, but `handleUseItem` doesn't check it yet (still gated on team membership only), so the new "no-op if not held" test fails (item activates despite never being granted), and the "consumes exactly one" / stacking tests fail (inventory never decreases since nothing reads it yet).

- [ ] **Step 4: Retrofit `handleUseItem`**

Replace the entire existing method body:

```ts
  private handleUseItem(client: Client, itemId: ItemId) {
    if (this.state.phase !== "playing" || this.turnDecided) return;

    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const activeTeam = this.state.teams[this.state.activeTeamIndex];
    if (player.teamId !== activeTeam.id) return;

    switch (itemId) {
      case "superMortar": {
        if (!this.itemsUsedThisTurn.tryUse("superMortar")) return;
        this.superMortarActiveThisTurn = true;
        break;
      }
      case "timeAdd": {
        if (!this.itemsUsedThisTurn.tryUse("timeAdd")) return;
        this.turnTimer?.clear();
        this.state.turnEndsAt += 1000;
        const remaining = this.state.turnEndsAt - Date.now();
        const token = this.turnToken;
        this.turnTimer = this.clock.setTimeout(() => {
          if (token === this.turnToken) this.onTurnTimerExpired();
        }, remaining);
        break;
      }
      case "timeReduce": {
        this.pendingItemsForNextTurn.tryUse("timeReduce");
        break;
      }
      case "doughAttack": {
        this.pendingItemsForNextTurn.tryUse("doughAttack");
        break;
      }
    }
  }
```

with:

```ts
  private handleUseItem(client: Client, itemId: ItemId) {
    if (this.state.phase !== "playing" || this.turnDecided) return;

    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const activeTeam = this.state.teams[this.state.activeTeamIndex];
    if (player.teamId !== activeTeam.id) return;

    const held = this.playerInventory.get(client.sessionId);
    const idx = held?.indexOf(itemId) ?? -1;
    if (idx === -1) return; // 보유하지 않은 아이템 — 조용히 무시

    held!.splice(idx, 1); // 효과 적용 여부와 무관하게 무조건 1개 소모

    switch (itemId) {
      case "superMortar": {
        this.superMortarActiveThisTurn = true;
        break;
      }
      case "timeAdd": {
        this.turnTimer?.clear();
        this.state.turnEndsAt += 1000;
        const remaining = this.state.turnEndsAt - Date.now();
        const token = this.turnToken;
        this.turnTimer = this.clock.setTimeout(() => {
          if (token === this.turnToken) this.onTurnTimerExpired();
        }, remaining);
        break;
      }
      case "timeReduce": {
        this.pendingItemsForNextTurn.tryUse("timeReduce");
        break;
      }
      case "doughAttack": {
        this.pendingItemsForNextTurn.tryUse("doughAttack");
        break;
      }
      case "mortarRestore": {
        // useItem으로는 절대 오지 않아야 함 — 절구회복은 획득 즉시 발동하며
        // 인벤토리에 들어가지 않는다(handlePressButton 참고). 방어적으로 no-op.
        break;
      }
    }
  }
```

- [ ] **Step 5: Remove the now-unused `itemsUsedThisTurn` field**

Class field declaration (delete this line entirely):

```ts
  private itemsUsedThisTurn = new ItemUseTracker();
```

`startTurn()`'s existing first two lines:

```ts
    this.itemsUsedThisTurn.reset();
    this.superMortarActiveThisTurn = false;
```

Change to (delete the first line):

```ts
    this.superMortarActiveThisTurn = false;
```

`handleRematch()`'s existing lines:

```ts
    this.itemsUsedThisTurn.reset();
    this.superMortarActiveThisTurn = false;
```

Change to (delete the first line):

```ts
    this.superMortarActiveThisTurn = false;
```

Check the top-of-file import — `ItemUseTracker` is still used by `pendingItemsForNextTurn`, so the import line itself (`import { ItemUseTracker, applyDoughAttack, applyTimeReduce, type ItemId } from "../game/items";`) does NOT change.

- [ ] **Step 6: Migrate the 8 EXISTING tests in the `items` describe block to grant items before using them**

Each of the following existing tests currently calls `actingClient.send("useItem", {...})` (or `benchedClient.send(...)`) assuming free/unlimited access. Add a `grantItem(room, <sessionId>, "<itemId>")` call immediately before each `useItem` send (right after the destructuring that gives you `room`/`actingClient`, before the first `.send("useItem", ...)`), granting exactly the item(s) that test goes on to use:

1. `"superMortar makes an objectively wrong button press still succeed"` — before `actingClient.send("useItem", { itemId: "superMortar" })`, add `grantItem(room, actingClient.sessionId, "superMortar");`.
2. `"using superMortar twice in the same turn is a no-op the second time..."` — grant `"superMortar"` **twice** (`grantItem(room, actingClient.sessionId, "superMortar"); grantItem(room, actingClient.sessionId, "superMortar");`) before the two sends, since each send now consumes one held copy — without granting two, the second send would be silently ignored (not held) rather than exercising the "no-op even though it activates again" case the test's name describes. Update the test name to `"holding and using superMortar twice both consume a copy but the effect is unchanged either time"`, and add an inventory assertion right after the two sends (before the existing `cursorBefore`/`pressButton` lines):

   ```ts
   const inventory = (room as unknown as { playerInventory: Map<string, string[]> }).playerInventory;
   expect(inventory.get(actingClient.sessionId)).toEqual([]);
   ```

   confirming both copies were actually consumed, not just that the second use didn't crash.
3. `"a player on the team NOT currently active cannot use an item"` — grant `"superMortar"` to `benchedClient.sessionId` (not `actingClient`) before `benchedClient.send(...)`, since this test is specifically about TEAM membership, not item ownership — it must still hold the item to isolate that this specific guard (not the inventory guard) is what blocks it.
4. `"timeAdd extends the actual turn deadline, not just its displayed value"` — grant `"timeAdd"` to `actingClient.sessionId` before its `useItem` send.
5. `"using timeAdd twice in the same turn only extends the deadline once"` — this test's ORIGINAL premise (using the same item twice only extends once) no longer holds per the new stacking rule (Task 3's own spec) — timeAdd now stacks. **Rewrite this test** to grant only ONE `"timeAdd"` and change its second `useItem` send's expectation: since only one is held, the second send is now a no-op (nothing to consume), so the net effect is still +1000ms — but for the RIGHT reason (no held copy left), not because of a per-turn cap. Rename it to `"using timeAdd when none is held left is a no-op — holding only one still only extends once"` and grant just one `"timeAdd"` before the two sends.
6. `"timeReduce shortens only the NEXT turn's duration, not the current one"` — grant `"timeReduce"` before its send.
7. `"timeReduce used twice in the same turn only reduces the next turn by 1 second, not 2"` — grant `"timeReduce"` **twice** before the two sends (this one's premise DOES still hold under the new rules — attack items don't stack even when both copies are consumed). Test name and assertions stay as-is.
8. `"doughAttack prepends a 6-mint row to the NEXT turn's sequence, without changing its duration"` — grant `"doughAttack"` before its send.
9. `"timeReduce and doughAttack used in the same turn both apply to the next turn together"` — grant BOTH `"timeReduce"` and `"doughAttack"` (one each) to `actingClient.sessionId` before their respective sends.

Additionally, in the `describe("bonus item token (mortarRestore)", ...)` block (Task 2's renamed block), the test `"superMortar-bypassed success at the bonus index still restores a mortar"` also calls `actingClient.send("useItem", { itemId: "superMortar" })` — add `grantItem(room, actingClient.sessionId, "superMortar");` right before that send, same pattern as above. This test wasn't affected by Task 2 (which never touched `handleUseItem`'s permission logic), but breaks under this task's retrofit without it.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm test --workspace server -- MatchRoom.test.ts -t "items"`
Expected: PASS (13 tests: the original 8, with #2 and #5 renamed/adjusted per Step 6, plus the 5 new ones from Step 2).

- [ ] **Step 8: Run the full server test suite to check for regressions**

Run: `npm test --workspace server`
Expected: PASS — in particular, the `"bonus item token (mortarRestore)"` describe block's `"superMortar-bypassed success..."` test (patched in Step 6 above) and every test in the `items` describe block must pass.

- [ ] **Step 9: Run typecheck**

Run: `npm run build --workspace server`
Expected: no errors — in particular, confirm nothing outside this file still references `ItemUseTracker`'s removed usage or the deleted `itemsUsedThisTurn` field.

- [ ] **Step 10: Commit**

```bash
git add server/src/rooms/MatchRoom.ts server/src/rooms/MatchRoom.test.ts
git commit -m "$(cat <<'EOF'
useItem을 개인 인벤토리 기반 권한/소모 방식으로 전환 — 방어 아이템은 중첩 허용, 턴당 1회 제한 트래커 제거

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## 이 계획에서 의도적으로 빠진 것 (스펙에 이미 명시된 범위 밖)

- 클라이언트 UI(인벤토리 슬롯 표시, 아이템 아이콘) — `MatchState`에 동기화 필드가 없으므로 클라이언트가 지금 당장 뭘 그릴 방법이 없다.
- 인벤토리 개수/보유 현황을 클라이언트에 알려주는 것 — 서버 전용 private 상태로 남는다.
