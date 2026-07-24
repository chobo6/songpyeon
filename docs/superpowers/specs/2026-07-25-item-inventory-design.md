# 아이템 인벤토리 + 토큰 획득 일반화 설계

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:writing-plans to turn this spec into an implementation plan.

**Goal:** 방금 배포한 "절구회복 전용 0.8% 보너스 토큰"을 일반화해서, 당첨 시 5개 아이템(시간추가/시간감소/반죽공격/슈퍼절구/**절구회복**) 중 하나가 **토큰 생성 시점에 이미 결정**된 채로 시퀀스에 붙는다. 절구회복은 기존처럼 성공 즉시 자동 발동하고, 나머지 4개는 성공시킨 **그 플레이어의 개인 인벤토리**(역할당 2칸)에 담긴다. 이에 따라 이미 배포된 4개 아이템의 `useItem` 권한/사용 규칙도 "우리 팀 아무나 무제한 사용"에서 "실제로 보유한 그 플레이어만, 보유량만큼만"으로 리트로핏된다.

**Architecture:** 순수 로직(어떤 아이템이 뽑히는지, 위치는 어디인지)은 `server/src/game/`에 두고, 실제 인벤토리 데이터/권한 체크/타이머 조작은 `MatchRoom.ts`가 담당한다(기존 아이템 시스템과 동일한 구조). `MatchState`에 새 `@type` 동기화 필드는 추가하지 않는다(클라이언트 UI는 여전히 범위 밖).

**Tech Stack:** `server/src/game/items.ts`(수정), `server/src/game/bonusItemToken.ts`(신규, 기존 `bonusMortarToken.ts` 대체), `server/src/rooms/MatchRoom.ts`.

## Global Constraints

- **토큰 생성 시점에 아이템 확정**: 매 턴 시퀀스 조립이 끝난 직후(반죽공격 프리픽스까지 반영된 뒤) 0.8% 확률로 한 번 굴려서, 당첨되면 그 즉시 **위치**와 **어떤 아이템인지**가 동시에 정해진다. 나중에 누가 어떻게 누르든 이 값은 안 바뀐다(향후 UI에서 그 아이템 아이콘을 토큰에 표시할 때를 위한 전제).
- 5개 아이템 중 선택은 **균등 확률(각 20%)**.
- **절구회복**: 발동 조건/효과는 기존과 동일(성공 시 즉시 절구 1개 회복, FULL이면 무효과) — 보유 단계 없음.
- **나머지 4개(시간추가/시간감소/반죽공격/슈퍼절구)**: 성공시킨 플레이어의 **개인 인벤토리**(역할당 최대 2개, 아이템 종류 무관)에 추가. 이미 2개 차 있으면 새로 획득한 아이템은 소멸(교체 없음).
- **`useItem` 권한**: 이제 "우리 팀 소속이면 아무나"가 아니라 **그 아이템을 실제로 보유한 그 플레이어만** 사용 가능. 보유하지 않은 아이템으로 `useItem`을 보내면 조용히 무시.
- **사용 시 소모**: 유효한 `useItem` 호출은 효과가 실제로 적용되든 안 되든 **무조건 보유량에서 1개 소모**된다.
- **중첩 규칙(아이템별로 다름, 사용 횟수 자체는 제한 없음 — 보유량만큼 자유롭게 사용 가능)**:
  - **방어 아이템(시간추가, 슈퍼절구)**: 여러 개 쓰면 각각 효과 적용(중첩됨). 시간추가 2개 쓰면 +2초. 슈퍼절구는 여러 번 써도 효과가 이미 켜진 상태 그대로라 실질적 차이는 없지만 막지 않음.
  - **공격 아이템(시간감소, 반죽공격)**: 여러 개 써도 효과는 **1회분만** 적용(다음 턴 -1초, 민트 1줄만 — 기존과 동일). 단, 소모는 매번 일어남 — 인벤토리 칸을 비워서 다른 아이템을 받고 싶을 때를 위한 것.
  - 기존 `itemsUsedThisTurn`(턴당 1회 제한 트래커)은 **완전히 제거**된다 — 방어 아이템은 더 이상 이 트래커가 필요 없고(보유량이 자연스러운 제약), 이 트래커가 하던 역할이 없어짐.
  - `pendingItemsForNextTurn`(시간감소/반죽공격의 "다음 턴 1회분만" 이펙트 게이트)은 **그대로 유지** — 소모(인벤토리 차감)와 이펙트 적용 여부는 서로 다른 관심사로 분리된다.
- **재대결(`handleRematch`)**: 개인 인벤토리 전부 비움(기존 트래커들과 동일한 이유).
- **완전 퇴장(`removePlayer`)**: 그 플레이어의 인벤토리 항목도 정리(맵 누수 방지). 재접속 유예 중에는 유지(팀/역할처럼).
- `MatchState`에 새 `@type` 동기화 필드는 추가하지 않는다.

## `server/src/game/items.ts` 변경

`ItemId`에 5번째 값 추가:

```ts
export type ItemId = "timeAdd" | "timeReduce" | "doughAttack" | "superMortar" | "mortarRestore";
```

`ItemUseTracker`/`applyDoughAttack`/`applyTimeReduce`는 그대로(여전히 `pendingItemsForNextTurn`이 씀).

## `server/src/game/bonusItemToken.ts` (신규 — `bonusMortarToken.ts` 대체)

기존 `bonusMortarToken.ts`와 그 테스트 파일은 **삭제**된다(전부 이 파일로 대체).

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
// 순서를 바꾸면 큐에 값을 채워 쓰는 기존 테스트들의 기대값이 깨지므로 고정.
export function rollBonusItemIndex(sequenceLength: number, rng: Rng): BonusItemRoll | null {
  if (rng() >= BONUS_ITEM_CHANCE) return null;
  const index = Math.floor(rng() * sequenceLength);
  const itemId = ALL_ITEM_IDS[Math.floor(rng() * ALL_ITEM_IDS.length)];
  return { index, itemId };
}
```

## `server/src/rooms/MatchRoom.ts` 변경

### 필드/옵션 이름 일반화

`forcedBonusMortarIndex`/`bonusMortarRng`/`bonusMortarIndex` → 각각 `forcedBonusItem`/`bonusItemRng`/`bonusItem`로 교체:

```ts
// MatchRoomOptions
forcedBonusItem?: BonusItemRoll; // 테스트 전용 — { index, itemId }를 강제 지정
bonusItemRng?: Rng; // 테스트 전용 — turnDurationMs 등과 같은 주입 패턴

// class fields
private forcedBonusItem?: BonusItemRoll;
private bonusItem: BonusItemRoll | null = null;
private bonusItemRng: Rng = Math.random;
private playerInventory = new Map<string, ItemId[]>();
```

`itemsUsedThisTurn` 필드는 **삭제**(더 이상 아무도 안 씀).

### `startTurn()` — 롤 일반화

```ts
this.bonusItem =
  this.forcedBonusItem !== undefined
    ? this.forcedBonusItem
    : rollBonusItemIndex(sequence.length, this.bonusItemRng);
```

(기존 `this.itemsUsedThisTurn.reset(); this.superMortarActiveThisTurn = false;` 중 앞줄은 삭제, `superMortarActiveThisTurn` 리셋은 그대로.)

### `handlePressButton()` — 보너스 발동 분기

기존 "무조건 gainMortar" 체크를:

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
    // 2칸 이미 참 → 새로 얻은 아이템은 소멸(아무것도 안 함).
  }
}
```

로 교체. 슈퍼절구 우회 성공 경로도 동일하게 이 분기를 통과한다(기존과 동일한 이유 — "성공은 성공").

### `handleUseItem()` — 권한/소모 리트로핏

```ts
private handleUseItem(client: Client, itemId: ItemId) {
  if (this.state.phase !== "playing" || this.turnDecided) return;

  const player = this.state.players.get(client.sessionId);
  if (!player) return;

  const activeTeam = this.state.teams[this.state.activeTeamIndex];
  if (player.teamId !== activeTeam.id) return;

  const held = this.playerInventory.get(client.sessionId);
  const idx = held?.indexOf(itemId) ?? -1;
  if (idx === -1) return; // 보유하지 않음 — 조용히 무시

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
      // useItem으로는 절대 오지 않아야 함(획득 즉시 발동, 인벤토리에 안 들어감) —
      // 방어적으로 아무 것도 안 함.
      break;
    }
  }
}
```

`superMortar`/`timeAdd`는 더 이상 `itemsUsedThisTurn.tryUse(...)` 게이트를 거치지 않는다(매번 그대로 적용 — 중첩 허용). `timeReduce`/`doughAttack`은 여전히 `pendingItemsForNextTurn.tryUse(...)`로 이펙트를 1회분만 적용하되, 그 반환값과 무관하게 위쪽에서 이미 인벤토리는 소모된 뒤다.

### `handleRematch()` — 리셋

```ts
this.superMortarActiveThisTurn = false;
this.pendingItemsForNextTurn.reset();
this.bonusItem = null;
this.playerInventory.clear();
```

(`this.itemsUsedThisTurn.reset()` 줄은 필드 자체가 삭제되므로 같이 삭제.)

### `removePlayer()` — 인벤토리 정리

기존 `this.playerUserIds.delete(sessionId);` 옆에 추가:

```ts
this.playerInventory.delete(sessionId);
```

## 기존 테스트 마이그레이션

`MatchRoom.test.ts`의 기존 `forcedBonusMortarIndex`/`bonusMortarRng` 사용처(총 8곳 — `fillRolesAndStart` 기본값 + 7개 개별 room 생성)는 전부 `forcedBonusItem: { index, itemId: "mortarRestore" }` / `bonusItemRng`로 바꿔야 한다. 기존 `describe("bonus mortar token", ...)`의 7개 테스트도 새 옵션 모양에 맞게 고치되, **검증하는 동작 자체(절구 회복)는 그대로**다.

## 테스트

- `server/src/game/bonusItemToken.test.ts` (신규, `bonusMortarToken.test.ts` 대체): 미당첨 시 null, 당첨 시 유효 인덱스+5개 중 하나의 itemId 반환, 세 번째 rng 호출로 아이템 종류가 결정되는지(경계값 포함).
- `MatchRoom.test.ts`:
  - 절구회복 외 아이템 토큰 성공 시 그 플레이어의 인벤토리에 담기는지.
  - 이미 2개 보유 중 새 아이템 획득 시 소멸(개수 안 늘어남)하는지.
  - 보유하지 않은 아이템으로 `useItem` 보내면 무시되는지(자신의 인벤토리에 없으면).
  - 팀원 A가 보유한 아이템을 팀원 B가 쓸 수 없는지(개인별 권한).
  - 시간추가 2개 보유 후 둘 다 쓰면 +2초(중첩) 적용되는지.
  - 슈퍼절구 2개 보유 후 둘 다 써도 인벤토리만 2개 소모되고 효과는 그대로인지.
  - 시간감소/반죽공격 2개씩 보유 후 각각 둘 다 써도 다음 턴엔 1초 감소/민트 1줄만 적용되지만, 인벤토리는 각각 2개씩 소모되는지.
  - 재대결 시 인벤토리가 비워지는지.
  - 완전 퇴장 시 그 플레이어의 인벤토리 항목이 정리되는지.
