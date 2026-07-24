# 아이템 UI + 동기화 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 서버 전용이던 개인 인벤토리와 보너스 토큰 위치/종류를 `MatchState`에 동기화하고, 클라이언트에서 시퀀스보드 토큰의 보너스 아이콘 오버레이 + 버튼패널 빈 슬롯의 인벤토리 아이콘으로 보여준다. 온라인 매치(`MyTurnScreen`)만 대상 — 솔로 연습 모드는 범위 밖.

**Architecture:** 서버는 기존 `private playerInventory: Map<string, ItemId[]>`를 완전히 없애고 `PlayerState.inventory`(동기화 배열)를 유일한 소스로 삼는다. 자세한 설계 근거는 `docs/superpowers/specs/2026-07-25-item-ui-sync-design.md` 참고.

**Tech Stack:** TypeScript, `@colyseus/schema`, vitest, React, 기존 "손으로 미러링하는 타입"(`matchTypes.ts`) 컨벤션.

## Global Constraints

- `PlayerState.inventory`(동기화 `ArraySchema<string>`)가 개인 인벤토리의 유일한 소스 — 기존 private Map은 완전히 삭제.
- `MatchState.bonusItemIndex: number`(없으면 -1), `bonusItemId: string`(없으면 "") — `missedRole: ""` 컨벤션과 동일.
- 온라인 매치(`MyTurnScreen`)만 대상, 솔로 연습 모드는 범위 밖.
- 인벤토리 슬롯 매핑: 역할당 버튼패널 6칸 중 색이 없는 2칸(`SLOT_ORDER` 순서상 먼저 나오는 것부터)에 `inventory[0]`, `inventory[1]` 순서대로.
- 아이템 아이콘: `timeAdd`→`/game-assets/items/increase_time.png`, `timeReduce`→`/game-assets/items/decrease_time.png`, `doughAttack`→`/game-assets/items/dough_attack.png`, `superMortar`→`/game-assets/items/super_mortar.png`, `mortarRestore`→`/game-assets/ui/thanksgiving_room_heart.png`(재사용).
- 관전자 화면은 같은 `SequenceBoard`를 재사용하므로 보너스 아이콘이 자연히 같이 보임 — 버튼패널이 없어 인벤토리 표시 대상 아님.
- 클라이언트는 테스트 프레임워크 없음 — 브라우저로 직접 검증(이 프로젝트 컨벤션).

---

### Task 1: 서버 — `MatchState` 동기화 필드 + `MatchRoom.ts` 리팩터링 + 기존 테스트 마이그레이션

**Files:**
- Modify: `server/src/rooms/MatchState.ts`
- Modify: `server/src/rooms/MatchRoom.ts`
- Modify: `server/src/rooms/MatchRoom.test.ts`

**Interfaces:**
- Produces: `PlayerState.inventory: ArraySchema<string>`, `MatchState.bonusItemIndex: number`, `MatchState.bonusItemId: string` — consumed by Task 2/3's client work (client reads these off `room.state`).

- [ ] **Step 1: Add the new synced fields to `MatchState.ts`**

`PlayerState`'s existing:

```ts
export class PlayerState extends Schema {
  @type("string") sessionId: string = "";
  @type("string") nickname: string = "";
  @type("string") nicknameColor: string = "";
  @type("string") role: RoleChoice = "";
  @type("string") teamId: string = "";
}
```

Change to:

```ts
export class PlayerState extends Schema {
  @type("string") sessionId: string = "";
  @type("string") nickname: string = "";
  @type("string") nicknameColor: string = "";
  @type("string") role: RoleChoice = "";
  @type("string") teamId: string = "";
  @type(["string"]) inventory = new ArraySchema<string>();
}
```

`MatchState`'s existing:

```ts
  @type("string") missedRole: RoleChoice = "";
```

Change to (add two new fields right after it):

```ts
  @type("string") missedRole: RoleChoice = "";
  // 이번 턴 보너스 토큰 위치 — 없으면 -1. startTurn()이 굴린 직후 채움.
  @type("number") bonusItemIndex: number = -1;
  // 그 위치에 어떤 아이템이 붙었는지 — 없으면 "". ItemId 값 중 하나 또는 "".
  @type("string") bonusItemId: string = "";
```

- [ ] **Step 2: Write the failing tests for the new sync fields**

Add to `MatchRoom.test.ts`'s `describe("bonus item token (mortarRestore)", ...)` block:

```ts
    test("state.bonusItemIndex/bonusItemId are synced to the forced values when a bonus is present", async () => {
      const { room } = await fillRolesAndStart({
        turnDurationMs: PRESS_HEAVY_TURN_MS,
        forcedBonusItem: { index: 3, itemId: "timeAdd" },
      });

      expect(room.state.bonusItemIndex).toBe(3);
      expect(room.state.bonusItemId).toBe("timeAdd");
    });

    test("state.bonusItemIndex/bonusItemId are -1/\"\" when no bonus is rolled this turn", async () => {
      const { room } = await fillRolesAndStart({ turnDurationMs: PRESS_HEAVY_TURN_MS });

      expect(room.state.bonusItemIndex).toBe(-1);
      expect(room.state.bonusItemId).toBe("");
    });
```

Add to the `describe("items", ...)` block:

```ts
    test("a non-mortarRestore bonus item is visible on the pressing player's synced PlayerState.inventory", async () => {
      const { room, clients } = await fillRolesAndStart({
        turnDurationMs: PRESS_HEAVY_TURN_MS,
        forcedBonusItem: { index: 0, itemId: "timeAdd" },
      });
      const { dueColor, actingClient } = actingClientFor(room, clients);

      actingClient.send("pressButton", { color: dueColor });
      await flush();

      const player = room.state.players.get(actingClient.sessionId)!;
      expect(Array.from(player.inventory)).toEqual(["timeAdd"]);
    });

    test("handleRematch clears every player's synced inventory", async () => {
      const room = await colyseus.createRoom<MatchState>("match", {
        teamCount: 1,
        turnDurationMs: SHORT_TURN_MS,
        countdownTickMs: COUNTDOWN_TICK_MS,
        forcedBonusItem: { index: 0, itemId: "timeAdd" },
      });
      const clients: ClientRoom<MatchState>[] = [];
      for (const [i, role] of (["pig", "rabbit"] as const).entries()) {
        const client = await connectAsUser(colyseus, room, `플레이어${i}`);
        client.send("chooseRole", { role });
        clients.push(client);
      }
      await flush();
      await waitForCountdown();

      const { dueColor, actingClient } = actingClientFor(room, clients);
      actingClient.send("pressButton", { color: dueColor });
      await flush();
      expect(Array.from(room.state.players.get(actingClient.sessionId)!.inventory)).toEqual(["timeAdd"]);

      // fail every turn (no presses) until the single team is eliminated.
      while (room.state.teams.some((t) => !t.eliminated)) {
        await wait(SHORT_TURN_MS + 200);
      }

      clients[0].send("rematch");
      await flush();

      for (const player of room.state.players.values()) {
        expect(Array.from(player.inventory)).toEqual([]);
      }
    }, 15000);
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test --workspace server -- MatchRoom.test.ts -t "bonusItemIndex"`
Run: `npm test --workspace server -- MatchRoom.test.ts -t "synced PlayerState.inventory"`
Run: `npm test --workspace server -- MatchRoom.test.ts -t "clears every player"`
Expected: FAIL — `state.bonusItemIndex`/`bonusItemId`/`player.inventory` don't exist on the schema yet (undefined), and nothing currently writes to them.

- [ ] **Step 4: Delete the private `playerInventory` field and its usages**

Class field declaration (delete this line entirely):

```ts
  // 역할당 최대 2개(아이템 종류 무관) — 절구회복을 제외한 보너스 토큰 획득분이
  // 여기 담긴다. sessionId로 키(팀이 아니라 개인별 소유).
  private playerInventory = new Map<string, ItemId[]>();
```

`removePlayer()`'s existing line (delete it — the whole `PlayerState`, `inventory` included, is already removed by the `this.state.players.delete(sessionId);` line right above it):

```ts
    this.playerInventory.delete(sessionId);
```

`handleRematch()`'s existing line:

```ts
    this.bonusItem = null;
    this.playerInventory.clear();
```

Change to:

```ts
    this.bonusItem = null;
```

and add `player.inventory.clear();` inside the EXISTING loop just above it (currently):

```ts
    for (const player of this.state.players.values()) {
      player.role = "";
      player.teamId = "";
    }
```

becomes:

```ts
    for (const player of this.state.players.values()) {
      player.role = "";
      player.teamId = "";
      player.inventory.clear();
    }
```

- [ ] **Step 5: Sync `bonusItemIndex`/`bonusItemId` in `startTurn()`**

Existing:

```ts
    this.bonusItem =
      this.forcedBonusItem !== undefined
        ? this.forcedBonusItem
        : rollBonusItemIndex(sequence.length, this.bonusItemRng);
```

Change to (add the two sync lines right after):

```ts
    this.bonusItem =
      this.forcedBonusItem !== undefined
        ? this.forcedBonusItem
        : rollBonusItemIndex(sequence.length, this.bonusItemRng);
    this.state.bonusItemIndex = this.bonusItem?.index ?? -1;
    this.state.bonusItemId = this.bonusItem?.itemId ?? "";
```

- [ ] **Step 6: Rewire `handleUseItem()`'s consumption to use the synced field**

Existing:

```ts
    const held = this.playerInventory.get(client.sessionId);
    const idx = held?.indexOf(itemId) ?? -1;
    if (idx === -1) return; // 보유하지 않은 아이템 — 조용히 무시

    held!.splice(idx, 1); // 효과 적용 여부와 무관하게 무조건 1개 소모
```

Change to:

```ts
    const idx = player.inventory.indexOf(itemId);
    if (idx === -1) return; // 보유하지 않은 아이템 — 조용히 무시

    player.inventory.splice(idx, 1); // 효과 적용 여부와 무관하게 무조건 1개 소모
```

(`player` is already looked up earlier in this same method via `const player = this.state.players.get(client.sessionId); if (!player) return;` — no new lookup needed.)

- [ ] **Step 7: Rewire `handlePressButton()`'s grant branch to use the synced field**

Existing:

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

Change to:

```ts
    if (this.bonusItem !== null && this.state.cursor === this.bonusItem.index) {
      if (this.bonusItem.itemId === "mortarRestore") {
        activeTeam.mortars = gainMortar(activeTeam.mortars);
      } else if (player.inventory.length < 2) {
        player.inventory.push(this.bonusItem.itemId);
        // 이미 2개 차 있으면 새로 획득한 아이템은 소멸 — 아무 것도 하지 않는다.
      }
    }
```

- [ ] **Step 8: Migrate the `grantItem` test helper**

Existing:

```ts
  function grantItem(room: ServerRoom<MatchState>, sessionId: string, itemId: string) {
    const inventory = (room as unknown as { playerInventory: Map<string, string[]> }).playerInventory;
    const held = inventory.get(sessionId) ?? [];
    held.push(itemId);
    inventory.set(sessionId, held);
  }
```

Change to:

```ts
  function grantItem(room: ServerRoom<MatchState>, sessionId: string, itemId: string) {
    room.state.players.get(sessionId)!.inventory.push(itemId);
  }
```

- [ ] **Step 9: Migrate the remaining 6 direct `playerInventory` test usages**

Each of the following reads `(room as unknown as { playerInventory: Map<string, string[]> }).playerInventory` and then calls `.get(sessionId)` or `.set(sessionId, [...])` on it. Replace each with the equivalent read/write on `room.state.players.get(sessionId)!.inventory` (a real `ArraySchema<string>`), wrapping READS in `Array.from(...)` before `.toEqual(...)` (matching this file's existing convention for comparing `ArraySchema` values, e.g. `Array.from(room.state.sequence)` elsewhere in this file):

1. `"holding and using superMortar twice both consume a copy but the effect is unchanged either time"` — existing:

   ```ts
   const inventory = (room as unknown as { playerInventory: Map<string, string[]> }).playerInventory;
   expect(inventory.get(actingClient.sessionId)).toEqual([]);
   ```

   becomes:

   ```ts
   expect(Array.from(room.state.players.get(actingClient.sessionId)!.inventory)).toEqual([]);
   ```

2. `"useItem consumes exactly one held copy of the item, regardless of effect"` — existing:

   ```ts
   grantItem(room, actingClient.sessionId, "timeReduce");
   grantItem(room, actingClient.sessionId, "timeReduce");
   const inventory = (room as unknown as { playerInventory: Map<string, string[]> }).playerInventory;

   actingClient.send("useItem", { itemId: "timeReduce" });
   await flush();

   expect(inventory.get(actingClient.sessionId)).toEqual(["timeReduce"]);
   ```

   Delete the `const inventory = ...` line entirely (no longer needed as a separate binding), and change the final assertion to:

   ```ts
   expect(Array.from(room.state.players.get(actingClient.sessionId)!.inventory)).toEqual(["timeReduce"]);
   ```

3. `"holding two doughAttack and using both consumes both but only one 6-mint row applies next turn"` — same pattern as #2: delete the standalone `const inventory = ...` line, and change:

   ```ts
   expect(inventory.get(actingClient.sessionId)).toEqual([]);
   ```

   to:

   ```ts
   expect(Array.from(room.state.players.get(actingClient.sessionId)!.inventory)).toEqual([]);
   ```

4. `"a permanent (consented) leave clears that player's inventory"` — existing:

   ```ts
   const inventory = (room as unknown as { playerInventory: Map<string, string[]> }).playerInventory;
   expect(inventory.get(sessionId)).toBeUndefined();
   ```

   becomes (the whole `PlayerState` is gone after a permanent leave, not just its inventory — this is actually a more direct assertion of the same intent):

   ```ts
   expect(room.state.players.has(sessionId)).toBe(false);
   ```

5. `"a non-mortarRestore bonus item is granted to the pressing player's own inventory"` — existing:

   ```ts
   const inventory = (room as unknown as { playerInventory: Map<string, string[]> }).playerInventory;
   expect(inventory.get(actingClient.sessionId)).toEqual(["timeAdd"]);
   ```

   becomes:

   ```ts
   expect(Array.from(room.state.players.get(actingClient.sessionId)!.inventory)).toEqual(["timeAdd"]);
   ```

6. `"acquiring a 3rd item while already holding 2 discards the new one"` — existing:

   ```ts
   const inventory = (room as unknown as { playerInventory: Map<string, string[]> }).playerInventory;
   inventory.set(actingClient.sessionId, ["doughAttack", "superMortar"]);

   actingClient.send("pressButton", { color: dueColor });
   await flush();

   expect(inventory.get(actingClient.sessionId)).toEqual(["doughAttack", "superMortar"]);
   ```

   becomes:

   ```ts
   const player = room.state.players.get(actingClient.sessionId)!;
   player.inventory.push("doughAttack", "superMortar");

   actingClient.send("pressButton", { color: dueColor });
   await flush();

   expect(Array.from(player.inventory)).toEqual(["doughAttack", "superMortar"]);
   ```

- [ ] **Step 10: Run the tests to verify they pass**

Run: `npm test --workspace server -- MatchRoom.test.ts -t "bonus item token"`
Run: `npm test --workspace server -- MatchRoom.test.ts -t "items"`
Expected: PASS for all (the new tests from Step 2, plus every migrated test).

- [ ] **Step 11: Run the full server test suite to check for regressions**

Run: `npm test --workspace server`
Expected: PASS — no leftover `playerInventory` reference anywhere (grep to confirm: `grep -rn "playerInventory" server/src` should return nothing).

- [ ] **Step 12: Run typecheck**

Run: `npm run build --workspace server`
Expected: no errors.

- [ ] **Step 13: Commit**

```bash
git add server/src/rooms/MatchState.ts server/src/rooms/MatchRoom.ts server/src/rooms/MatchRoom.test.ts
git commit -m "$(cat <<'EOF'
개인 인벤토리와 보너스 토큰 위치/종류를 MatchState에 동기화, private Map 제거하고 PlayerState.inventory를 유일한 소스로

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: 클라이언트 — 타입/아이콘 + 시퀀스보드 보너스 아이콘

**Files:**
- Modify: `client/src/game/matchTypes.ts`
- Create: `client/src/game/itemIcons.ts`
- Modify: `client/src/components/SequenceBoard.tsx`
- Modify: `client/src/components/SequenceBoard.module.css`
- Modify: `client/src/components/SpectatorScreen.tsx`

**Interfaces:**
- Produces: `ItemId` type, `ITEM_ICON: Record<ItemId, string>` — consumed by Task 3's `ButtonPanel`/`MyTurnScreen` work.

- [ ] **Step 1: Add `ItemId` and the new fields to `matchTypes.ts`**

Add near the top (after the existing `TurnOutcome` type):

```ts
export type ItemId = "timeAdd" | "timeReduce" | "doughAttack" | "superMortar" | "mortarRestore";
```

`PlayerState` interface's existing:

```ts
export interface PlayerState {
  sessionId: string;
  nickname: string;
  nicknameColor: string;
  role: RoleChoice;
  teamId: string;
}
```

Change to:

```ts
export interface PlayerState {
  sessionId: string;
  nickname: string;
  nicknameColor: string;
  role: RoleChoice;
  teamId: string;
  inventory: ItemId[];
}
```

`MatchState` interface's existing:

```ts
  missedRole: RoleChoice;
```

Change to (add two fields right after):

```ts
  missedRole: RoleChoice;
  bonusItemIndex: number;
  bonusItemId: ItemId | "";
```

- [ ] **Step 2: Create `itemIcons.ts`**

```ts
import type { ItemId } from "./matchTypes";

export const ITEM_ICON: Record<ItemId, string> = {
  timeAdd: "/game-assets/items/increase_time.png",
  timeReduce: "/game-assets/items/decrease_time.png",
  doughAttack: "/game-assets/items/dough_attack.png",
  superMortar: "/game-assets/items/super_mortar.png",
  mortarRestore: "/game-assets/ui/thanksgiving_room_heart.png",
};
```

- [ ] **Step 3: Add the bonus icon overlay to `SequenceBoard.tsx`**

`SequenceBoard.tsx` already imports from `matchTypes` — existing line:

```ts
import type { RoleChoice, TurnOutcome } from "../game/matchTypes";
```

Change to (add `ItemId` to the same import):

```ts
import type { ItemId, RoleChoice, TurnOutcome } from "../game/matchTypes";
```

Add a new import line right after it:

```ts
import { ITEM_ICON } from "../game/itemIcons";
```

`Token`'s existing prop destructure:

```ts
const Token = memo(function Token({
  color,
  isDone,
  isMissed,
  missedRole,
  showCursor,
  isLastInRow,
}: {
  color: Color;
  isDone: boolean;
  isMissed: boolean;
  missedRole: RoleChoice;
  showCursor: boolean;
  isLastInRow: boolean;
}) {
```

Change to (add the new optional prop):

```ts
const Token = memo(function Token({
  color,
  isDone,
  isMissed,
  missedRole,
  showCursor,
  isLastInRow,
  bonusIcon,
}: {
  color: Color;
  isDone: boolean;
  isMissed: boolean;
  missedRole: RoleChoice;
  showCursor: boolean;
  isLastInRow: boolean;
  // Set only for the one token (if any) carrying this turn's bonus item —
  // undefined for every other token.
  bonusIcon?: string;
}) {
```

Token's existing return statement:

```ts
  return (
    <div className={styles.tokenWrap}>
      {showCursor && !isMissed && <div className={styles.cursor} />}
      {isMissed && missedRole ? (
        <MissFrame role={missedRole} />
      ) : (
        <div
          className={isDone ? `${styles.token} ${styles.done}` : styles.token}
          data-color={color}
          style={{ backgroundImage: `url(${isDone ? COLOR_TOKEN_OFF[color] : COLOR_TOKEN[color]})` }}
        />
      )}
      {!isLastInRow && <div className={styles.link} />}
    </div>
  );
});
```

Change to (add the bonus icon overlay right after the color-token `<div>`, still inside the same `else` branch so it never overlaps the miss animation):

```ts
  return (
    <div className={styles.tokenWrap}>
      {showCursor && !isMissed && <div className={styles.cursor} />}
      {isMissed && missedRole ? (
        <MissFrame role={missedRole} />
      ) : (
        <div
          className={isDone ? `${styles.token} ${styles.done}` : styles.token}
          data-color={color}
          style={{ backgroundImage: `url(${isDone ? COLOR_TOKEN_OFF[color] : COLOR_TOKEN[color]})` }}
        >
          {bonusIcon && <div className={styles.bonusIcon} style={{ backgroundImage: `url(${bonusIcon})` }} />}
        </div>
      )}
      {!isLastInRow && <div className={styles.link} />}
    </div>
  );
});
```

`SequenceBoard`'s existing prop destructure and signature:

```ts
export function SequenceBoard({
  sequence,
  cursor,
  turnOutcome,
  missedRole,
}: {
  sequence: Color[];
  cursor: number;
  turnOutcome?: TurnOutcome;
  missedRole?: RoleChoice;
}) {
```

Change to (add two optional props):

```ts
export function SequenceBoard({
  sequence,
  cursor,
  turnOutcome,
  missedRole,
  bonusItemIndex,
  bonusItemId,
}: {
  sequence: Color[];
  cursor: number;
  turnOutcome?: TurnOutcome;
  missedRole?: RoleChoice;
  // Optional: online-only, same reasoning as missedRole above. -1/"" (or
  // omitted entirely) means no bonus token this turn.
  bonusItemIndex?: number;
  bonusItemId?: ItemId | "";
}) {
```

The `Token` invocation inside `SequenceBoard`'s existing:

```ts
              return (
                <Token
                  key={i}
                  color={color}
                  isDone={globalIndex < cursor}
                  isMissed={globalIndex === missedIndex}
                  missedRole={missedRole ?? ""}
                  showCursor={globalIndex === cursor}
                  isLastInRow={i === row.length - 1}
                />
              );
```

Change to:

```ts
              return (
                <Token
                  key={i}
                  color={color}
                  isDone={globalIndex < cursor}
                  isMissed={globalIndex === missedIndex}
                  missedRole={missedRole ?? ""}
                  showCursor={globalIndex === cursor}
                  isLastInRow={i === row.length - 1}
                  bonusIcon={
                    bonusItemId && globalIndex === bonusItemIndex ? ITEM_ICON[bonusItemId] : undefined
                  }
                />
              );
```

- [ ] **Step 4: Add the `.bonusIcon` CSS class**

Add to `SequenceBoard.module.css`, after the existing `.token`/`.done` rules:

```css
/* 보너스 아이템이 붙은 토큰 오른쪽 아래 구석에 작게 표시하는 아이콘 배지. */
.bonusIcon {
  position: absolute;
  bottom: -0.15rem;
  right: -0.15rem;
  width: 45%;
  aspect-ratio: 1 / 1;
  background-size: contain;
  background-repeat: no-repeat;
  background-position: center;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.5));
}
```

`.token` needs `position: relative` for this absolute-positioned child to anchor correctly — check its current rule; if it doesn't already have `position: relative` (it doesn't, per the current file), add it:

```css
.token {
  position: relative;
  width: var(--token-width);
  aspect-ratio: 140 / 160;
  background-size: contain;
  background-repeat: no-repeat;
  background-position: center bottom;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.4));
  transition: opacity 0.15s ease;
}
```

- [ ] **Step 5: Pass the new props through `SpectatorScreen.tsx` too**

`SequenceBoard` is also used by `client/src/components/SpectatorScreen.tsx` (the read-only mirror spectators watch) — passing `bonusItemIndex`/`bonusItemId` down is NOT automatic just because the component is shared; without this step spectators simply won't see the bonus icon (harmless — `SequenceBoard`'s new props are optional and default to no icon — but it misses the design intent that spectators see the same board).

`SpectatorScreen.tsx`'s existing state destructure:

```ts
  const { sequence, cursor, turnOutcome, missedRole, round, teams, turnEndsAt, players, matchChat } = room.state;
```

Change to:

```ts
  const {
    sequence,
    cursor,
    turnOutcome,
    missedRole,
    round,
    teams,
    turnEndsAt,
    players,
    matchChat,
    bonusItemIndex,
    bonusItemId,
  } = room.state;
```

Its existing `SequenceBoard` usage:

```ts
            <SequenceBoard sequence={sequence} cursor={cursor} turnOutcome={turnOutcome} missedRole={missedRole} />
```

Change to:

```ts
            <SequenceBoard
              sequence={sequence}
              cursor={cursor}
              turnOutcome={turnOutcome}
              missedRole={missedRole}
              bonusItemIndex={bonusItemIndex}
              bonusItemId={bonusItemId}
            />
```

- [ ] **Step 6: Manual browser verification**

This project has no client test framework — verify by running the app and forcing a bonus token to appear. Use this project's established debug-route convention (see `docs/TROUBLESHOOTING.md` for prior examples of a throwaway debug route, e.g. `DebugComboHud`) OR temporarily set the server's `BONUS_ITEM_CHANCE` very high (e.g. edit `server/src/game/bonusItemToken.ts`'s constant to `0.9` locally, NOT committed) to make a bonus token appear within a few turns during local `npm run dev` testing. Confirm:
- The small icon badge appears in the bottom-right corner of exactly one token, matching whichever item was rolled (check `room.state.bonusItemId` via browser devtools or a console.log).
- The badge doesn't visually break the existing token layout (row spacing, cursor arrow, done/miss states).
- The same badge is visible from the spectator screen too (Step 5's wiring).
- Revert any temporary debug changes (the chance constant, any debug route) before moving on — do not commit them.

- [ ] **Step 7: Commit**

```bash
git add client/src/game/matchTypes.ts client/src/game/itemIcons.ts client/src/components/SequenceBoard.tsx client/src/components/SequenceBoard.module.css client/src/components/SpectatorScreen.tsx
git commit -m "$(cat <<'EOF'
시퀀스보드/관전화면에 보너스 토큰 아이템 아이콘 오버레이 표시

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: 클라이언트 — 버튼패널 인벤토리 슬롯 + `MyTurnScreen` 배선 + 브라우저 검증

**Files:**
- Modify: `client/src/components/ButtonPanel.tsx`
- Modify: `client/src/components/ButtonPanel.module.css`
- Modify: `client/src/components/MyTurnScreen.tsx`

**Interfaces:**
- Consumes: `ItemId`, `ITEM_ICON` (Task 2).
- Produces: nothing consumed by later work — this is the last task in this plan.

- [ ] **Step 1: Add inventory rendering + `onUseItem` to `ButtonPanel.tsx`**

Add the import at the top:

```ts
import type { ItemId } from "../game/matchTypes";
import { ITEM_ICON } from "../game/itemIcons";
```

**Note:** `ButtonPanel` is also used by `client/src/components/SoloPlayScreen.tsx` (solo practice mode, out of scope per this plan's Global Constraints — no item system there). Make the two new props **optional** with safe defaults so `SoloPlayScreen.tsx` needs zero changes, matching this codebase's existing pattern for online-only concepts (e.g. `SequenceBoard`'s `missedRole`/`turnOutcome` props).

`ButtonPanel`'s existing prop destructure:

```ts
export const ButtonPanel = memo(function ButtonPanel({
  role,
  disabled,
  onPress,
}: {
  role: Role;
  disabled: boolean;
  onPress: (color: Color) => void;
}) {
```

Change to:

```ts
export const ButtonPanel = memo(function ButtonPanel({
  role,
  disabled,
  onPress,
  inventory = [],
  onUseItem,
}: {
  role: Role;
  disabled: boolean;
  onPress: (color: Color) => void;
  // Optional: online-only, no item system in solo practice mode (see
  // SoloPlayScreen.tsx, which omits both these props entirely).
  inventory?: ItemId[];
  onUseItem?: (itemId: ItemId) => void;
}) {
```

The existing render loop (inside `<div className={styles.panel}>`):

```ts
        {SLOT_ORDER.map((position) => {
          const color = slots[position];
          const positionClass = styles[position];
          if (!color) {
            return <div key={position} className={`${styles.empty} ${positionClass}`} />;
          }
          return (
            <button
              key={position}
              type="button"
              aria-label={color}
              disabled={disabled}
              onTouchStart={() => handleTouchStart(color)}
              onClick={() => handleClick(color)}
              className={`${styles.button} ${positionClass}`}
              style={{ backgroundImage: `url(${COLOR_TOKEN[color]})` }}
            />
          );
        })}
```

Replace this entire block with (wrapped in an IIFE so `emptySlotIndex` can be tracked across iterations — the color-button branch at the bottom is byte-identical to the original):

```ts
        {(() => {
          let emptySlotIndex = 0;
          return SLOT_ORDER.map((position) => {
            const color = slots[position];
            const positionClass = styles[position];
            if (!color) {
              const item = inventory[emptySlotIndex];
              emptySlotIndex += 1;
              if (!item) {
                return <div key={position} className={`${styles.empty} ${positionClass}`} />;
              }
              return (
                <button
                  key={position}
                  type="button"
                  aria-label={item}
                  disabled={disabled}
                  onClick={() => onUseItem?.(item)}
                  className={`${styles.itemButton} ${positionClass}`}
                  style={{ backgroundImage: `url(${ITEM_ICON[item]})` }}
                />
              );
            }
            return (
              <button
                key={position}
                type="button"
                aria-label={color}
                disabled={disabled}
                onTouchStart={() => handleTouchStart(color)}
                onClick={() => handleClick(color)}
                className={`${styles.button} ${positionClass}`}
                style={{ backgroundImage: `url(${COLOR_TOKEN[color]})` }}
              />
            );
          });
        })()}
```

- [ ] **Step 2: Add the `.itemButton` CSS class**

Add to `ButtonPanel.module.css`, after the existing `.empty` rule:

```css
.itemButton {
  position: absolute;
  top: 0;
  left: 0;
  width: 18%;
  aspect-ratio: 65 / 67;
  transform: translate(-50%, -50%);
  border: none;
  border-radius: 999px;
  touch-action: none;
  background-color: rgba(0, 0, 0, 0.25);
  background-size: 70%;
  background-repeat: no-repeat;
  background-position: center;
  cursor: pointer;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.4));
}

.itemButton:active:not(:disabled) {
  transform: translate(-50%, -50%) scale(0.93);
}

.itemButton:disabled {
  cursor: not-allowed;
  filter: grayscale(0.85) brightness(0.55);
}
```

- [ ] **Step 3: Wire `useItem` in `MyTurnScreen.tsx`**

Existing state destructure:

```ts
  const { sequence, cursor, turnOutcome, missedRole, round, turnEndsAt, teams } = room.state;
```

Change to:

```ts
  const { sequence, cursor, turnOutcome, missedRole, round, turnEndsAt, teams, bonusItemIndex, bonusItemId } =
    room.state;
```

Existing `press` callback:

```ts
  const press = useCallback(
    (color: Color) => {
      room.send("pressButton", { color });
      onMyPress();
    },
    [room, onMyPress],
  );
```

Add right after it:

```ts
  const useItem = useCallback(
    (itemId: ItemId) => {
      room.send("useItem", { itemId });
    },
    [room],
  );
```

`MyTurnScreen.tsx`'s existing import line:

```ts
import type { MatchState, PlayerState } from "../game/matchTypes";
```

Change to (add `ItemId` to the same import — do NOT add a separate new import line for it, this file already imports from `matchTypes`):

```ts
import type { MatchState, PlayerState, ItemId } from "../game/matchTypes";
```

Existing `SequenceBoard` usage:

```ts
          <SequenceBoard sequence={sequence} cursor={cursor} turnOutcome={turnOutcome} missedRole={missedRole} />
```

Change to:

```ts
          <SequenceBoard
            sequence={sequence}
            cursor={cursor}
            turnOutcome={turnOutcome}
            missedRole={missedRole}
            bonusItemIndex={bonusItemIndex}
            bonusItemId={bonusItemId}
          />
```

Existing `ButtonPanel` usage:

```ts
      <ButtonPanel role={me.role as "pig" | "rabbit"} disabled={disabled} onPress={press} />
```

Change to:

```ts
      <ButtonPanel
        role={me.role as "pig" | "rabbit"}
        disabled={disabled}
        onPress={press}
        inventory={me.inventory}
        onUseItem={useItem}
      />
```

- [ ] **Step 4: Manual browser verification**

Same debug approach as Task 2's Step 6 (temporarily raise `BONUS_ITEM_CHANCE`, revert before committing). With 4 simulated clients (or Playwright), confirm end-to-end:
- A bonus token's icon appears on the board (Task 2).
- Successfully pressing that position (for a non-`mortarRestore` item) makes the icon appear in one of that player's own empty button-panel slots.
- Clicking that new item button actually sends `useItem` and produces the item's real effect (e.g. `timeAdd` visibly extends the timer bar; `doughAttack` prepends mint tokens to the next turn).
- The item button disappears from the panel once used (inventory now empty for that slot).
- A teammate does NOT see the item appear in their own panel (per-player inventory, not team-wide).
- Revert any temporary debug changes before finishing.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/ButtonPanel.tsx client/src/components/ButtonPanel.module.css client/src/components/MyTurnScreen.tsx
git commit -m "$(cat <<'EOF'
버튼패널 빈 슬롯에 인벤토리 아이템 아이콘 표시 및 클릭 시 useItem 전송 배선

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## 이 계획에서 의도적으로 빠진 것 (스펙에 이미 명시된 범위 밖)

- 솔로 연습 모드 — 아이템 시스템 자체가 없어 대상 아님.
- 인벤토리 슬롯 아이콘에 대한 애니메이션/효과음 등 추가 폴리시 — 이번 범위는 "표시 + 클릭 시 발동"까지만.
