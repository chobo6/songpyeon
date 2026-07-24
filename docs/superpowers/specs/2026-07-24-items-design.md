# 아이템 시스템 설계 (효과 로직만, 1차)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:writing-plans to turn this spec into an implementation plan.

**Goal:** 시간추가/시간감소/반죽공격/슈퍼절구 네 아이템의 **발동 효과**를 구현한다. 획득 방식(어떻게 아이템을 얻는지)은 아직 미정 — 이번 범위에서는 팀이 네 아이템을 전부 무제한 보유한 것으로 가정하고, `useItem` 메시지만으로 효과가 정확히 적용되는지에 집중한다. 아이콘/클라이언트 UI는 범위 밖(서버 로직 + 메시지 핸들러까지만).

**Architecture:** 새 Colyseus 메시지 `useItem`을 `pressButton`과 동일한 패턴으로 추가한다. 권한 체크(현재 턴을 잡은 팀 소속 + `phase === "playing"` + `!turnDecided`)도 `handlePressButton`과 동일하다. 순수 계산(민트 줄 붙이기, 시간 차감 계산, 턴당 중복사용 방지용 사용 기록)은 `server/src/game/items.ts`에 분리해 vitest로 테스트하고, 실제 Colyseus 타이머/상태 조작은 `MatchRoom.ts`가 담당한다 — `mortar.ts`/`rotation.ts`가 순수 로직이고 `MatchRoom`이 그걸 적용하는 기존 구조와 동일.

**Tech Stack:** `server/src/game/items.ts`(신규), `server/src/rooms/MatchRoom.ts`, `server/src/rooms/MatchState.ts`(동기화 필드는 추가하지 않음 — 서버 전용 private 필드로 충분, 아래 참고).

## Global Constraints

- 아이템 획득/보유 개수 관리는 이번 범위에 없음 — `useItem` 메시지가 오면 "이미 가진 것"으로 취급해 바로 효과를 시도한다.
- **턴당 아이템별 1회만 유효** — 같은 아이템을 같은 턴 안에서 여러 번(또는 여러 명이) 써도 효과는 중첩되지 않는다. 이미 사용된 아이템으로 다시 `useItem`을 보내면 조용히 무시(에러 응답 없음, `pressButton`의 기존 무시 스타일과 동일).
- 네 아이템 모두 **자기 팀이 현재 턴을 잡고 있을 때만**(`activeTeam`) 사용 가능. 로비/관전자/턴 아닌 팀/`turnDecided === true` 상태에서의 `useItem`은 전부 무시.
- **시간추가**: 사용 즉시 **내 팀의 현재 턴** 제한시간을 1초 늘림 (실제 서버 타이머까지 재예약 — 화면 표시만 늘리는 게 아님).
- **시간감소**: 사용 시점이 아니라 **다음으로 시작되는 턴**(팀 인덱스가 아니라 "다음 `startTurn()` 호출 1회"에 거는 예약)의 제한시간에서 1초를 뺌. 최소 1초는 보장(0초/음수 방지 — 아래 근거 참고).
- **반죽공격**: 마찬가지로 다음 `startTurn()`에서, 생성된 시퀀스 **맨 앞에 민트 6개(1줄)를 붙임**(시퀀스 길이 +6). 제한시간은 그대로 — 순수하게 더 어려워지는 공격 효과.
- **슈퍼절구**: 사용한 팀의 **이번 턴 동안** 버튼 색상/역할 검증을 건너뛰고 어떤 버튼을 눌러도 정답 처리(커서 1칸 전진 + 콤보 증가는 정상 케이스와 동일).
- 시간감소와 반죽공격은 서로 다른 아이템이므로 **동시에 걸어둘 수 있다** (같은 다음 턴에 "시퀀스 +6, 시간 -1초"가 함께 적용될 수 있음).

## `server/src/game/items.ts` (신규, 순수 로직)

```ts
import type { Color } from "./colors";
import { mintRun } from "./fragments";

export type ItemId = "timeAdd" | "timeReduce" | "doughAttack" | "superMortar";

const MIN_TURN_DURATION_MS = 1000;

// 같은 창(턴) 안에서 아이템별 1회 사용만 허용하는 최소 단위 — "이번 턴에 이미 쓴 아이템"과
// "다음 턴에 예약된 아이템" 두 군데 모두에서 재사용한다(둘 다 "한 번 쓰면 그걸로 끝, 또 써도
// no-op" 규칙이 동일하므로).
export class ItemUseTracker {
  private used = new Set<ItemId>();

  // 처음 쓰는 아이템이면 true(효과를 적용해야 함), 이미 쓴 아이템이면 false(무시).
  tryUse(itemId: ItemId): boolean {
    if (this.used.has(itemId)) return false;
    this.used.add(itemId);
    return true;
  }

  // 소비하지 않고 "예약/사용됐는지"만 확인 — startTurn()이 pendingItemsForNextTurn을
  // 조회할 때 씀(조회 시점에 지워버리면 같은 tick에서 doughAttack/timeReduce를
  // 순서대로 두 번 조회하는 도중 상태가 바뀌어버림).
  has(itemId: ItemId): boolean {
    return this.used.has(itemId);
  }

  reset(): void {
    this.used.clear();
  }
}

// 반죽공격: 시퀀스 맨 앞에 민트 6개(1줄)를 붙인다. 원본 배열은 건드리지 않음.
export function applyDoughAttack(sequence: Color[]): Color[] {
  return [...mintRun(6), ...sequence];
}

// 시간감소: durationMs에서 1초를 빼되 MIN_TURN_DURATION_MS 밑으로는 안 내려간다.
// 바닥을 두는 이유: turnDurationMs가 테스트에서 아주 짧게(예: 500ms) 설정될 수 있어,
// 그대로 1초를 빼면 음수/0 타이머가 되어 즉시 만료되거나 setTimeout이 오작동할 수 있음.
export function applyTimeReduce(durationMs: number): number {
  return Math.max(MIN_TURN_DURATION_MS, durationMs - 1000);
}
```

## `server/src/rooms/MatchRoom.ts` 변경

### 신규 필드

```ts
private turnTimer?: Delayed; // startTurn()이 스케줄한 타이머 핸들 — timeAdd가 재예약할 때 필요
private itemsUsedThisTurn = new ItemUseTracker(); // 내 턴 동안(시간추가/슈퍼절구)
private pendingItemsForNextTurn = new ItemUseTracker(); // 다음 턴 예약(시간감소/반죽공격)
private superMortarActiveThisTurn = false;
```

`Delayed`는 `colyseus`(`@colyseus/core`가 재노출)에서 타입만 가져온다: `import type { Delayed } from "colyseus";` (이미 쓰고 있는 `Room`/`Client`와 같은 곳에서 import).

### `startTurn()` — 매 턴 초기화 + 예약된 효과 소비

```ts
private startTurn() {
  this.itemsUsedThisTurn.reset();
  this.superMortarActiveThisTurn = false;

  const length = sequenceLengthForRound(this.state.round);
  let sequence = generateSequence(length, Math.random, this.state.round);
  if (this.pendingItemsForNextTurn.has("doughAttack")) {
    sequence = applyDoughAttack(sequence);
  }

  this.state.sequence.clear();
  sequence.forEach((color) => this.state.sequence.push(color));
  this.state.cursor = 0;
  this.state.turnOutcome = "pending";
  this.state.missedRole = "";

  let duration = this.turnDurationMs;
  if (this.pendingItemsForNextTurn.has("timeReduce")) {
    duration = applyTimeReduce(duration);
  }
  this.pendingItemsForNextTurn.reset();

  this.state.turnEndsAt = Date.now() + duration;
  this.turnDecided = false;
  this.lastPressAt = null;

  this.invalidateInFlightTurn();
  const token = this.turnToken;
  this.turnTimer = this.clock.setTimeout(() => {
    if (token === this.turnToken) this.onTurnTimerExpired();
  }, duration);
}
```

`pendingItemsForNextTurn.reset()`은 두 아이템(시간감소/반죽공격) 조회가 끝난 뒤 한 번만 호출.

### `handleUseItem` — 신규 메시지 핸들러

```ts
this.onMessage("useItem", (client, message: { itemId: ItemId }) => {
  this.handleUseItem(client, message.itemId);
});
```

```ts
private handleUseItem(client: Client, itemId: ItemId) {
  if (this.state.phase !== "playing" || this.turnDecided) return;

  const player = this.state.players.get(client.sessionId);
  if (!player) return;

  const activeTeam = this.state.teams[this.state.activeTeamIndex];
  if (player.teamId !== activeTeam.id) return;

  switch (itemId) {
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
    case "superMortar": {
      if (!this.itemsUsedThisTurn.tryUse("superMortar")) return;
      this.superMortarActiveThisTurn = true;
      break;
    }
    case "timeReduce":
    case "doughAttack": {
      this.pendingItemsForNextTurn.tryUse(itemId); // 결과 무시 가능 — 이미 예약돼 있으면 no-op
      break;
    }
  }
}
```

### `handleRematch()` — 다음 매치로 새지 않게 리셋

`team.combo = 0`을 명시적으로 리셋하는 것과 같은 이유(현재는 항상 이미 초기 상태로 도달하지만, 그 가정에 기대지 않기 위해)로, 아이템 트래커 세 개도 여기서 명시적으로 리셋한다 — 안 하면 매치가 끝나던 순간에 예약돼 있던 `timeReduce`/`doughAttack`이 다음 매치 첫 턴으로 새어 들어갈 수 있다.

```ts
this.itemsUsedThisTurn.reset();
this.pendingItemsForNextTurn.reset();
this.superMortarActiveThisTurn = false;
```

(`handleRematch` 본문의 팀 상태 초기화 루프 근처에 추가.)

### `handlePressButton` — 슈퍼절구 분기

```ts
const result = this.superMortarActiveThisTurn
  ? { correct: true, nextCursor: this.state.cursor + 1, complete: this.state.cursor + 1 >= this.state.sequence.length }
  : attemptPress(this.state.sequence as unknown as Color[], this.state.cursor, color, player.role as Role);
```

기존 `if (!result.correct)` / 성공 분기는 그대로 유지 — `result` 모양만 맞으면 이후 로직은 손댈 필요 없음.

## 동기화 상태 (MatchState) 관련 결정

이번 범위에서는 `MatchState`에 새 `@type` 필드를 추가하지 않는다. 위 네 필드(`turnTimer`, `itemsUsedThisTurn`, `pendingItemsForNextTurn`, `superMortarActiveThisTurn`)는 전부 `MatchRoom`의 private 필드로 클라이언트에 동기화되지 않는다 — 이유: 아직 아이콘/버튼 UI가 없어서 "지금 슈퍼절구가 켜져 있다"를 화면에 보여줄 대상 자체가 없고, 시간감소/반죽공격은 "다음 턴이 시작되는 순간" 이미 `state.turnEndsAt`/`state.sequence`에 결과로 반영되므로 별도 필드 없이도 효과 자체는 정상 작동한다. **클라이언트 UI(아이콘, 버튼, "적이 반죽공격을 예약함" 같은 안내)를 나중에 붙일 때는 이 상태들 중 필요한 것만 `@type` 필드로 승격하는 후속 작업이 필요하다** — 지금은 의도적으로 범위 밖.

## 테스트

- `server/src/game/items.test.ts` (신규, vitest):
  - `applyDoughAttack`이 원본 배열을 변경하지 않고 민트 6개를 앞에 붙이는지.
  - `applyTimeReduce`가 정상 범위에서 1000ms를 빼는지, `MIN_TURN_DURATION_MS` 밑으로는 안 내려가는지(예: 500ms 입력 시 1000ms를 반환하는지).
  - `ItemUseTracker`가 같은 아이템 두 번째 `tryUse`부터 `false`를 반환하는지, `reset()` 후 다시 `true`를 반환하는지.
- `server/src/rooms/MatchRoom.test.ts` (통합, `@colyseus/testing`):
  - `timeAdd` 사용 후 `state.turnEndsAt`이 실제로 늘어나고, 실제 턴 종료(타이머 발동)도 그만큼 늦게 일어나는지(늘리기 전 원래 시각에는 아직 턴이 안 끝나 있는지까지 확인).
  - `timeAdd`/`superMortar`를 같은 턴에 두 번 써도 효과가 한 번만 적용되는지.
  - `timeReduce` 사용 후, **다음** `startTurn()`의 `turnEndsAt`이 1초 짧아지는지(사용한 턴 자체는 영향 없는지도 확인).
  - `doughAttack` 사용 후 다음 턴 `state.sequence`의 앞 6개가 전부 mint이고 길이가 6 늘어났는지, 제한시간은 그대로인지.
  - `timeReduce` + `doughAttack`을 같은 턴에 함께 써서 다음 턴에 두 효과가 동시에 반영되는지.
  - `superMortar` 사용 중에는 명백히 틀린 색을 눌러도 `turnOutcome`이 "fail"이 되지 않고 커서가 전진하는지.
  - 턴을 안 잡은 팀/관전자가 `useItem`을 보내도 아무 효과가 없는지.
