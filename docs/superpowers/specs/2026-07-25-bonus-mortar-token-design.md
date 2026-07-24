# 절구(목숨) 회복 보너스 토큰 설계

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:writing-plans to turn this spec into an implementation plan.

**Goal:** 매 턴 시퀀스 생성 시 낮은 확률(0.8%)로 시퀀스 안 랜덤 한 위치에 "보너스" 플래그가 붙는다. 그 위치를 성공적으로 누르면 즉시 그 팀의 절구(목숨)가 1개 회복된다(이미 FULL이면 아무 효과 없음). `docs/superpowers/specs/2026-07-24-items-design.md`에서 이미 구현된 시간추가/시간감소/반죽공격/슈퍼절구 4개 아이템(`useItem` 메시지로 보유 후 사용)과는 완전히 다른 경로 — "보유" 단계가 없고, 토큰을 성공시키는 행위 자체가 곧 발동이다.

**Architecture:** 보너스가 붙을 색상 자체는 기존 8색 중 하나 그대로(역할/색 매칭 로직 변경 없음) — "보너스"는 그 위에 얹히는 순수 플래그다. 시퀀스가 몇 번째 위치인지(인덱스)만 서버가 기억하면 되므로, `MatchState`에 새 동기화 필드를 추가하지 않고 `MatchRoom`의 private 필드로 관리한다(기존 아이템 시스템과 동일한 원칙 — 클라이언트 UI는 이번 범위 밖).

**Tech Stack:** `server/src/game/mortar.ts`(기존 파일에 함수 추가), `server/src/game/bonusMortarToken.ts`(신규), `server/src/rooms/MatchRoom.ts`.

## Global Constraints

- 발동 확률: 턴당(시퀀스 하나당) **0.8%**, 최대 1개까지만 붙는다(붙을지 말지 자체가 확률이라 아예 안 나오는 턴이 대부분).
- 확률에 당첨되면 시퀀스 전체 길이 중 **균등 랜덤** 인덱스 하나가 보너스로 지정된다. 특정 위치(첫 토큰 등)를 배제하지 않는다.
- 발동 조건은 **그 위치를 "성공"으로 통과하는 것** — 색상이 맞아서 정상적으로 통과하든, 슈퍼절구 효과로 색상 무관하게 성공 처리되든 상관없이 "성공"이면 발동한다(사용자 확인됨).
- 발동 효과: **사용한 팀 자신**(그 시퀀스를 실제로 플레이 중인 활성 팀)의 절구를 1개 회복. 이미 `STARTING_MORTARS`(5, FULL)면 회복 없이 그대로 유지 — 에러도 아니고 별도 처리도 없음, 그냥 상한에서 멈춤.
- 반죽공격으로 다음 턴 시퀀스 앞에 민트 6개가 붙는 경우, 보너스 인덱스는 **그 민트 6개를 포함한 최종 시퀀스** 기준으로 뽑는다(사용자 확인됨) — 즉 시퀀스 조립(길이 결정 + 반죽공격 프리픽스 적용)이 다 끝난 뒤에 인덱스를 뽑아야 한다.
- 시간감소/시간추가(제한시간 관련 두 아이템)와는 아무 상호작용이 없다 — 순수하게 시퀀스 내용/판정에만 관여한다.
- 재대결(`handleRematch`) 시 보너스 인덱스도 리셋해서 다음 매치로 새지 않게 한다(기존 아이템 트래커들과 동일한 이유).

## `server/src/game/mortar.ts` 변경

기존 파일에 `loseMortar`와 대칭되는 함수 추가:

```ts
export function gainMortar(mortars: number): number {
  return Math.min(STARTING_MORTARS, mortars + 1);
}
```

## `server/src/game/bonusMortarToken.ts` (신규, 순수 로직)

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

## `server/src/rooms/MatchRoom.ts` 변경

### 신규 필드 + 테스트 전용 옵션

```ts
private bonusMortarIndex: number | null = null;
```

`MatchRoomOptions`에 테스트 전용 강제 오버라이드 추가(기존 `turnDurationMs?`/`countdownTickMs?` 등과 같은 자리):

```ts
// 테스트 전용 — 0.8%라는 낮은 확률을 실제 rng로 재현하지 않고 강제 지정하기 위함.
// production에서는 항상 undefined.
forcedBonusMortarIndex?: number;
```

`onCreate`에서 저장(다른 옵션들과 같은 패턴):

```ts
private forcedBonusMortarIndex?: number;
// ...
if (options.forcedBonusMortarIndex !== undefined) {
  this.forcedBonusMortarIndex = options.forcedBonusMortarIndex;
}
```

### `startTurn()` — 시퀀스 최종 확정 후 인덱스 굴리기

기존(Task 5까지 반영된) `startTurn()`의 시퀀스 조립 부분:

```ts
const length = sequenceLengthForRound(this.state.round);
let sequence = generateSequence(length, Math.random, this.state.round);
if (this.pendingItemsForNextTurn.has("doughAttack")) {
  sequence = applyDoughAttack(sequence);
}
```

이 블록 바로 다음(즉 `this.state.sequence.clear()`로 넘어가기 전)에 추가:

```ts
this.bonusMortarIndex =
  this.forcedBonusMortarIndex !== undefined
    ? this.forcedBonusMortarIndex
    : rollBonusMortarIndex(sequence.length, Math.random);
```

### `handleRematch()` — 리셋

기존 아이템 트래커 리셋 줄들 옆에 추가:

```ts
this.bonusMortarIndex = null;
```

### `handlePressButton()` — 발동 체크

기존(Task 2에서 추가된) 성공 판정 부분:

```ts
this.state.cursor = result.nextCursor;
activeTeam.combo += 1;
if (result.complete) {
  ...
}
```

이 블록 **바로 위**(즉 `this.state.cursor`가 아직 press 이전 값을 들고 있는 시점)에 추가:

```ts
if (this.bonusMortarIndex !== null && this.state.cursor === this.bonusMortarIndex) {
  activeTeam.mortars = gainMortar(activeTeam.mortars);
}
```

`result.correct`가 false인 경우(오답)는 이미 그 위쪽의 `if (!result.correct) { ...; return; }` 블록에서 `return`되므로, 이 체크에 도달하는 시점엔 항상 "성공"(정상 판정이든 슈퍼절구 우회든)이 보장된다 — 별도로 `result.correct`를 다시 확인할 필요 없음.

## 테스트

- `server/src/game/mortar.test.ts`에 추가:
  - `gainMortar(3)`이 `4`를 반환하는지.
  - `gainMortar(STARTING_MORTARS)`(이미 FULL)가 그대로 `STARTING_MORTARS`를 반환하는지(상한 확인).
- `server/src/game/bonusMortarToken.test.ts` (신규):
  - rng가 항상 `BONUS_MORTAR_CHANCE` 이상만 반환하면(당첨 안 됨) 항상 `null`.
  - rng의 첫 호출이 `BONUS_MORTAR_CHANCE` 미만이면(당첨) `[0, sequenceLength)` 범위의 정수를 반환.
  - 반환된 인덱스가 항상 `Math.floor`된 정수인지, 그리고 경계값(두 번째 rng 호출이 거의 1에 가까울 때도 `sequenceLength`를 넘지 않는지).
- `server/src/rooms/MatchRoom.test.ts` (통합, `forcedBonusMortarIndex` 사용):
  - 강제 지정한 인덱스 위치를 성공시키면 `activeTeam.mortars`가 1 증가하는지.
  - 이미 `STARTING_MORTARS`(5)인 상태에서 보너스를 발동시켜도 5 그대로인지.
  - 보너스 위치에서 오답을 내면(정상 실패 처리되고) 보너스가 발동하지 않는지 — mortars가 오히려 1 감소(정상 실패 페널티)하는지 확인.
  - 슈퍼절구를 켠 상태에서 보너스 위치에 아무 색이나 눌러도(색상 무관 성공) 보너스가 발동하는지.
  - 보너스가 아닌 다른 위치를 성공시켰을 땐 mortars가 그대로인지(오탐 없는지).
