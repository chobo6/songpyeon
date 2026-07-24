# 아이템 UI + 동기화 설계

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:writing-plans to turn this spec into an implementation plan.

**Goal:** 지금까지 서버 전용(private, 동기화 안 됨)이던 개인 인벤토리와 보너스 토큰 위치/종류를 `MatchState`에 동기화하고, 클라이언트에 아이콘으로 보여준다. 보너스 토큰이 생성되면 시퀀스보드의 그 위치 오른쪽 아래 구석에 작은 아이템 아이콘이 표시되고, 성공해서 인벤토리에 담기면 버튼패널의 빈 슬롯(역할당 2칸)에 그 아이템 아이콘이 표시된다. 온라인 매치에서만 다루는 범위 — 솔로 연습 모드는 아이템 시스템 자체가 없어 대상이 아니다.

**Architecture:** 서버는 지금 있는 `private playerInventory: Map<string, ItemId[]>`를 완전히 없애고 `PlayerState.inventory`(동기화 배열)를 유일한 소스로 삼는다(두 자료구조가 따로 있으면 어긋나는 버그 위험이 있어서). 보너스 토큰 위치/종류도 `MatchState`에 새 필드로 추가한다. 클라이언트는 기존 "손으로 미러링하는 타입"(`matchTypes.ts`) 컨벤션을 그대로 따르고, 아이콘 경로 매핑은 새 작은 파일로 분리한다.

**Tech Stack:** `server/src/rooms/MatchState.ts`, `server/src/rooms/MatchRoom.ts`, `server/src/rooms/MatchRoom.test.ts`, `client/src/game/matchTypes.ts`, `client/src/game/itemIcons.ts`(신규), `client/src/components/SequenceBoard.tsx`, `client/src/components/ButtonPanel.tsx`, `client/src/components/MyTurnScreen.tsx`.

## Global Constraints

- `PlayerState.inventory`(동기화 `ArraySchema<string>`)가 개인 인벤토리의 **유일한 소스**다 — 기존 `private playerInventory: Map<string, ItemId[]>` 필드는 완전히 삭제되고, 그 필드를 읽고 쓰던 모든 지점(`handlePressButton`의 획득, `handleUseItem`의 소모, `handleRematch`의 초기화)이 `this.state.players.get(sessionId).inventory`를 직접 조작하도록 바뀐다. `removePlayer`는 별도 정리 코드가 필요 없다 — `PlayerState` 객체 자체가 `state.players`에서 지워지면서 `inventory`도 같이 사라진다(기존 `this.playerInventory.delete(sessionId)` 줄은 삭제).
- `MatchState`에 보너스 토큰 정보 추가: `bonusItemIndex: number`(보너스 없으면 `-1`), `bonusItemId: string`(보너스 없으면 `""`) — 기존 `missedRole: ""` 컨벤션과 동일한 "빈 값" 표현. `startTurn()`이 `this.bonusItem`을 굴린 직후 이 두 필드도 함께 채운다.
- 클라이언트는 온라인 매치(`MyTurnScreen`)에서만 이 UI를 다룬다 — 솔로 연습 모드(`SoloPlayScreen`/`useSoloMatch`)는 대상 아님.
- 인벤토리 슬롯 매핑: 역할당 버튼패널 6칸 중 색이 없는 2칸(`buttonPanel.ts`의 `SLOT_ORDER` 순서상 먼저 나오는 것부터)에 `inventory[0]`, `inventory[1]`을 순서대로 매핑한다.
- 아이템 아이콘 경로: `timeAdd`→`/game-assets/items/increase_time.png`, `timeReduce`→`/game-assets/items/decrease_time.png`, `doughAttack`→`/game-assets/items/dough_attack.png`, `superMortar`→`/game-assets/items/super_mortar.png`, `mortarRestore`→`/game-assets/ui/thanksgiving_room_heart.png`(기존 절구 목숨 아이콘 재사용).
- 관전자 화면(`SpectatorScreen`)은 같은 `SequenceBoard`를 재사용하므로 보너스 아이콘이 자연히 같이 보인다 — 별도 처리 불필요. 관전자는 버튼패널이 없으므로 인벤토리 표시 대상이 아니다.

## `server/src/rooms/MatchState.ts` 변경

`PlayerState`에 추가(기존 `teamId` 필드 다음):

```ts
@type(["string"]) inventory = new ArraySchema<string>();
```

`MatchState`에 추가(기존 `missedRole` 필드 다음):

```ts
// 이번 턴 보너스 토큰 위치 — 없으면 -1. startTurn()이 굴린 직후 채움.
@type("number") bonusItemIndex: number = -1;
// 그 위치에 어떤 아이템이 붙었는지 — 없으면 "". ItemId 값 중 하나 또는 "".
@type("string") bonusItemId: string = "";
```

## `server/src/rooms/MatchRoom.ts` 변경

- 클래스 필드 `private playerInventory = new Map<string, ItemId[]>();` **삭제**.
- `removePlayer()`의 `this.playerInventory.delete(sessionId);` 줄 **삭제**(PlayerState 자체가 지워지므로 불필요).
- `handleRematch()`의 `this.playerInventory.clear();` 줄을, 모든 플레이어의 `state.players`를 순회하며 각자의 `inventory`를 비우는 코드로 교체(예: `for (const player of this.state.players.values()) player.inventory.clear();` — 기존 팀/역할 초기화 루프 근처에 자연스럽게 들어갈 수 있음).
- `startTurn()`의 보너스 롤 직후에 `this.state.bonusItemIndex`/`this.state.bonusItemId`를 채우는 코드 추가(`this.bonusItem`이 null이면 `-1`/`""`, 아니면 `.index`/`.itemId`).
- `handlePressButton()`의 획득 분기: `this.playerInventory.get(client.sessionId) ?? []` 대신 `this.state.players.get(client.sessionId)!.inventory`(ArraySchema, 이미 항상 존재)를 직접 조작 — `.length < 2`면 `.push(...)`.
- `handleUseItem()`의 소모 로직: `this.playerInventory.get(client.sessionId)` 대신 `player.inventory`(handleUseItem은 이미 `player`를 조회해둔 상태)를 직접 조작 — `.indexOf(itemId)`, `.splice(idx, 1)`.

## 클라이언트 변경

### `client/src/game/matchTypes.ts`

```ts
export type ItemId = "timeAdd" | "timeReduce" | "doughAttack" | "superMortar" | "mortarRestore";
```

`PlayerState` 인터페이스에 `inventory: ItemId[];` 추가. `MatchState` 인터페이스에 `bonusItemIndex: number; bonusItemId: ItemId | "";` 추가.

### `client/src/game/itemIcons.ts` (신규)

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

### `client/src/components/SequenceBoard.tsx`

`SequenceBoard`에 옵셔널 prop 추가: `bonusItemIndex?: number`, `bonusItemId?: ItemId | ""`. `Token`에도 옵셔널 `bonusIcon?: string`(아이콘 URL, 없으면 undefined) prop 추가 — `globalIndex === bonusItemIndex && bonusItemId`일 때만 `ITEM_ICON[bonusItemId]`를 넘긴다. `Token` 내부에서 `bonusIcon`이 있으면 오른쪽 아래 구석에 작은 `<img>` 또는 배경 오버레이 `<div>` 추가(새 CSS 클래스, 기존 토큰 위에 `position: absolute` 배치).

### `client/src/components/ButtonPanel.tsx`

props 추가: `inventory: ItemId[]`, `onUseItem: (itemId: ItemId) => void`. 현재 색이 `null`인 슬롯(`buttonPanelSlots`가 반환하는 값)을 렌더링하는 분기에서, `SLOT_ORDER`를 순회하며 몇 번째 "빈 슬롯"인지 카운트해서 `inventory[그 순번]`이 있으면 아이콘 버튼(`onClick`에서 `onUseItem(item)` 호출)으로, 없으면 기존 빈 `<div>` 그대로.

### `client/src/components/MyTurnScreen.tsx`

`room.state`에서 `bonusItemIndex`/`bonusItemId` 구조분해 추가, `SequenceBoard`에 전달. `me.inventory`를 `ButtonPanel`에 전달. `useCallback`으로 감싼 `useItem` 핸들러 추가(`press`와 같은 패턴): `room.send("useItem", { itemId })`, `ButtonPanel`의 새 `onUseItem` prop으로 연결.

## 테스트

- `server/src/rooms/MatchRoom.test.ts`: 기존에 `(room as unknown as { playerInventory: Map<...> })` 캐스팅으로 읽던 7곳 전부 `room.state.players.get(sessionId)!.inventory`(및 `grantItem` 헬퍼)로 교체 — 검증 내용 자체는 그대로, 읽는 경로만 바뀜.
- 새 테스트: `startTurn()` 직후 보너스가 나왔을 때 `state.bonusItemIndex`/`bonusItemId`가 올바르게 채워지는지, 보너스가 안 나왔을 때 `-1`/`""`인지, 재대결 시 모든 플레이어의 `state.players.get(...).inventory`가 비워지는지.
- 클라이언트는 이 프로젝트 컨벤션대로 테스트 프레임워크 없이 **브라우저로 직접 검증**(4개 클라이언트 시뮬레이션 또는 Playwright) — 보너스 아이콘이 올바른 위치에 뜨는지, 인벤토리 아이콘이 뜨고 클릭하면 실제로 아이템이 발동하는지 눈으로 확인.
