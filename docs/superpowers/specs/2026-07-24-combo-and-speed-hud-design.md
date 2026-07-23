# 팀 콤보 + 개인 평균속도 표시 설계

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:writing-plans to turn this spec into an implementation plan.

**Goal:** 게임 플레이 화면(`MyTurnScreen`/`SpectatorScreen` 공통, `phase === "playing"`인 동안 항상)에 화면 왼쪽 위로 각 팀의 콤보(연속 성공 프레스 수), 오른쪽 위로 본인의 평균 프레스 간격(속도)을 실시간으로 띄운다. 재대결/재시작을 계속하고 싶게 만드는 즉각적 피드백 장치.

**Architecture:** 팀 콤보는 게임 판정과 직결되는 값이라 서버 권위형으로 간다 — `TeamState`에 `combo` 필드를 추가하고, 기존 프레스 판정 지점(`MatchRoom.handlePressButton`/`applyMortarLoss`)에서 `mortars`와 똑같은 패턴으로 갱신, colyseus schema가 자동으로 모든 클라이언트에 동기화한다. 새 서버 로직은 없음 — 기존 판정 분기에 필드 갱신 한 줄씩만 얹는다.

개인 평균속도는 본인 기기가 이미 가장 먼저 아는 정보(자기 자신의 프레스 타이밍)라 서버를 거치지 않고 클라이언트에서만 계산한다. `Game.tsx`에 상태를 두는 게 핵심 — `MyTurnScreen`은 활성 팀이 바뀔 때마다 언마운트/리마운트되므로(이번 세션에서 채팅 draft가 겪은 것과 동일한 문제), 그 안에 두면 턴이 넘어갈 때마다 누적치가 날아간다.

**Tech Stack:** 서버 `server/src/rooms/MatchState.ts`, `server/src/rooms/MatchRoom.ts`. 클라이언트 `client/src/game/matchTypes.ts`, `client/src/game/usePersonalPressSpeed.ts`(신규), `client/src/components/{Game,MyTurnScreen,TeamComboBadge,MyAverageSpeedBadge}.tsx`(뒤 둘은 신규) + 각각의 `.module.css`.

## Global Constraints

- **팀 콤보**: 팀 단위로 독립적으로 셈(동료가 누른 것도 포함). 그 팀이 오답 또는 시간초과로 턴을 실패했을 때만 0으로 리셋됨. 라운드가 바뀌어도, 다른 팀 턴이 도는 동안에도 유지됨. 재대결(새 매치)마다 팀이 새로 생성되므로 자연히 0부터 시작 — 별도 리셋 코드 불필요.
- **본인 평균속도**: 개인 단위(동료 프레스는 집계 제외), 나의 연속 프레스 간격의 누적 평균. **턴이 바뀌는 공백 시간은 집계에서 제외** — 새 턴이 시작될 때(즉 `MyTurnScreen`이 새로 마운트될 때) 기준 시각을 리셋해서, 그 턴의 첫 프레스는 "직전 프레스와의 간격"으로 안 잡히게 함. 정답/오답 프레스 구분 없이 전부 집계(속도만 측정, 정확도는 팀 콤보가 이미 별도로 보여줌).
- **표시 위치**: 왼쪽 위 = 팀 콤보 리스트(전체 팀), 오른쪽 위 = 본인 평균속도. 오른쪽 위엔 이미 `SpectatorCountBadge`(`top: 0.75rem; right: 0.75rem`)가 있으므로 그 바로 아래에 배치해 겹치지 않게 한다.
- **표시 범위**: `Game.tsx` 레벨에 배치해 `MyTurnScreen`/`SpectatorScreen` 전환과 무관하게 항상 보이게 함. `phase === "playing"`일 때만(로비 화면엔 없음). 팀 콤보는 관전자에게도 보임(공개 정보). 본인 평균속도는 `me`가 있을 때만(순수 관전자는 프레스를 안 하므로 표시 안 함), 그리고 프레스가 최소 1회 이상 간격을 만든 뒤부터 표시(그 전엔 렌더 안 함).

## 서버 설계

### `server/src/rooms/MatchState.ts` — 스키마 확장

```ts
export class TeamState extends Schema {
  @type("string") id: string = "";
  @type("string") pigSessionId: string = "";
  @type("string") rabbitSessionId: string = "";
  @type("number") mortars: number = STARTING_MORTARS;
  @type("boolean") eliminated: boolean = false;
  @type("number") combo: number = 0; // 추가
}
```

### `server/src/rooms/MatchRoom.ts` — 판정 지점에 갱신 추가

**정답 프레스** (`handlePressButton`, 커서 전진 직후):

```ts
this.state.cursor = result.nextCursor;
activeTeam.combo += 1; // 추가
if (result.complete) {
  ...
```

**실패**(오답·시간초과 공통 지점 — `applyMortarLoss`가 두 경로 모두에서 호출되므로 여기 한 곳에만 추가하면 됨):

```ts
private applyMortarLoss(team: TeamState) {
  team.mortars = loseMortar(team.mortars);
  team.combo = 0; // 추가
  if (isEliminated(team.mortars)) {
    ...
```

이 외 변경 없음 — 라운드 전환, 재대결 시 팀 재생성 등 기존 경로가 `combo`도 그대로 따라간다(스키마 기본값 0).

## 클라이언트 설계

### `client/src/game/matchTypes.ts` — 타입 미러링

```ts
export interface TeamState {
  id: string;
  pigSessionId: string;
  rabbitSessionId: string;
  mortars: number;
  eliminated: boolean;
  combo: number; // 추가
}
```

### `client/src/game/usePersonalPressSpeed.ts` (신규)

`Game.tsx`에서 호출해 컴포넌트 생애 동안(즉 턴 전환에 안 죽고) 유지. `resetAnchor`는 매 턴 시작 시(= `MyTurnScreen` 마운트 시) 한 번, `recordPress`는 내가 실제 프레스할 때마다 호출.

```ts
import { useCallback, useRef, useState } from "react";

export function usePersonalPressSpeed() {
  const lastPressAtRef = useRef<number | null>(null);
  const totalMsRef = useRef(0);
  const countRef = useRef(0);
  const [averageMs, setAverageMs] = useState<number | null>(null);

  // 새 턴이 시작될 때 호출 — 턴 사이 공백이 "직전 프레스와의 간격"으로
  // 잡히지 않도록 기준점만 지우고, 누적 합/횟수는 그대로 둔다(매치 전체 누적 평균).
  const resetAnchor = useCallback(() => {
    lastPressAtRef.current = null;
  }, []);

  const recordPress = useCallback(() => {
    const now = Date.now();
    if (lastPressAtRef.current !== null) {
      totalMsRef.current += now - lastPressAtRef.current;
      countRef.current += 1;
      setAverageMs(totalMsRef.current / countRef.current);
    }
    lastPressAtRef.current = now;
  }, []);

  return { averageMs, recordPress, resetAnchor };
}
```

### `client/src/components/Game.tsx`

```tsx
import { usePersonalPressSpeed } from "../game/usePersonalPressSpeed";
import { TeamComboBadge } from "./TeamComboBadge";
import { MyAverageSpeedBadge } from "./MyAverageSpeedBadge";

// Game 컴포넌트 내부, 최상단 hooks 자리:
const { averageMs, recordPress, resetAnchor } = usePersonalPressSpeed();
```

`MyTurnScreen` 렌더 지점에 두 콜백 전달:

```tsx
screen = (
  <MyTurnScreen room={room} me={me} clockOffsetMs={clockOffsetMs} onMyPress={recordPress} onMyTurnStart={resetAnchor} />
);
```

리턴 JSX에 배지 두 개 추가(`BgmPlayer`/`SpectatorCountBadge`와 같은 자리, `phase === "playing"` 조건 안):

```tsx
{phase === "playing" && <TeamComboBadge teams={room.state.teams} />}
{phase === "playing" && me && <MyAverageSpeedBadge averageMs={averageMs} />}
```

### `client/src/components/MyTurnScreen.tsx`

새 props 추가, 마운트 시 `onMyTurnStart` 한 번 호출, `press` 콜백 안에서 `onMyPress` 호출:

```tsx
export function MyTurnScreen({
  room,
  me,
  clockOffsetMs,
  onMyPress,
  onMyTurnStart,
}: {
  room: Room<MatchState>;
  me: PlayerState;
  clockOffsetMs: number;
  onMyPress: () => void;
  onMyTurnStart: () => void;
}) {
  ...
  useEffect(() => {
    onMyTurnStart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // 마운트 1회 = 이 팀의 새 턴 1회

  const press = useCallback(
    (color: Color) => {
      room.send("pressButton", { color });
      onMyPress();
    },
    [room, onMyPress],
  );
```

`onMyPress`/`onMyTurnStart`는 `Game.tsx`의 `usePersonalPressSpeed()`가 반환하는 `useCallback` 산출물이라 참조가 안정적 — `press`의 `useCallback` 의존성 배열에 넣어도 매 렌더 재생성 걱정 없음(`ButtonPanel`의 메모이제이션도 안 깨짐).

### `client/src/components/TeamComboBadge.tsx` (신규)

```tsx
import type { TeamState } from "../game/matchTypes";
import styles from "./TeamComboBadge.module.css";

export function TeamComboBadge({ teams }: { teams: TeamState[] }) {
  return (
    <div className={styles.wrap}>
      {teams.map((t) => (
        <div key={t.id} className={t.eliminated ? `${styles.row} ${styles.eliminated}` : styles.row}>
          {t.id}팀 🔥{t.combo}
        </div>
      ))}
    </div>
  );
}
```

`.wrap`은 `position: fixed; top: 0.75rem; left: 0.75rem; z-index: 5;`(`SpectatorCountBadge.module.css`의 `.badge`와 대칭되는 왼쪽 버전), 각 `.row`는 작은 필(pill) 스타일 재사용. `.eliminated`는 `opacity: 0.5` 정도로 흐리게.

### `client/src/components/MyAverageSpeedBadge.tsx` (신규)

```tsx
import styles from "./MyAverageSpeedBadge.module.css";

export function MyAverageSpeedBadge({ averageMs }: { averageMs: number | null }) {
  if (averageMs === null) return null;
  return <div className={styles.badge}>⚡ {(averageMs / 1000).toFixed(2)}초</div>;
}
```

`.badge`는 `SpectatorCountBadge.module.css`의 `.badge`와 동일한 톤(`position: fixed; right: 0.75rem;`)이되 `top`을 그 배지 높이+간격만큼 내려서(예: `top: 2.6rem`) 겹치지 않게.

## 테스트

- `server/src/rooms/MatchRoom.test.ts`:
  - 연속 정답 프레스마다 활성 팀의 `combo`가 1씩 오르는지.
  - 오답 프레스 시 그 팀의 `combo`가 0으로 리셋되는지(다른 팀의 `combo`는 안 건드리는지).
  - 시간초과(`onTurnTimerExpired`)로 실패해도 동일하게 리셋되는지.
  - 라운드가 넘어가도 `combo`가 유지되는지(리셋 안 됨을 확인).
  - 재대결로 팀이 새로 생성되면 `combo`가 0부터 시작하는지.
- 클라이언트는 이 프로젝트에 테스트 프레임워크가 없으므로(→ CLAUDE.md), Playwright로 수동 시나리오 확인: 연속 프레스 후 오른쪽 위 배지 값이 그럴듯한지, 내 턴이 끝났다 다시 돌아왔을 때 평균값이 유지되는지(초기화 안 됨), 팀 콤보가 왼쪽 위에 실시간으로 오르내리는지.
