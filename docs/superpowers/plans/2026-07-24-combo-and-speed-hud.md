# 팀 콤보 + 개인 평균속도 HUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 게임 플레이 화면(`phase === "playing"`인 동안, `MyTurnScreen`/`SpectatorScreen` 공통)에 왼쪽 위로 각 팀의 콤보(연속 성공 프레스 수), 오른쪽 위로 본인의 평균 프레스 간격을 실시간으로 띄운다.

**Architecture:** 팀 콤보는 판정과 직결되므로 서버 권위형 — `TeamState.combo` 필드를 추가하고 기존 프레스 판정 지점(`MatchRoom.handlePressButton`/`applyMortarLoss`)에 갱신 한 줄씩만 얹는다(`mortars`와 동일 패턴, colyseus schema가 자동 동기화). 개인 평균속도는 클라이언트 전용 — 본인 프레스 타이밍은 본인 기기가 이미 가장 먼저 아는 정보라 서버 왕복이 불필요하고, `Game.tsx`에 상태를 둬서 `MyTurnScreen`이 턴마다 언마운트/리마운트돼도(활성 팀이 바뀔 때마다) 누적치가 안 날아가게 한다.

**Tech Stack:** 서버(Colyseus/vitest) `server/src/rooms/{MatchState,MatchRoom}.ts`, `server/src/rooms/MatchRoom.test.ts`. 클라이언트(React/TS, 이 프로젝트엔 클라이언트 테스트 프레임워크 없음 — `tsc -b`/`oxlint`/Playwright 수동 검증으로 대체) `client/src/game/{matchTypes,usePersonalPressSpeed}.ts`, `client/src/components/{Game,MyTurnScreen,TeamComboBadge,MyAverageSpeedBadge}.tsx` + 각 컴포넌트의 `.module.css`.

## Global Constraints

- 팀 콤보는 팀 단위 독립 카운터(동료 프레스 포함), 그 팀이 오답/시간초과로 턴을 실패했을 때만 0으로 리셋. 라운드가 바뀌어도, 다른 팀 턴이 도는 동안에도 유지됨. 재대결마다 팀이 새로 생성되므로 자연히 0부터 시작.
- 본인 평균속도는 개인 단위(동료 프레스 집계 제외), 연속 프레스 간격의 누적 평균. 턴이 바뀌는 공백은 집계에서 제외(새 턴 시작 시 기준점만 리셋, 누적 합/횟수는 유지). 정답/오답 구분 없이 전부 집계.
- 왼쪽 위 = 팀 콤보 리스트, 오른쪽 위 = 본인 평균속도(기존 `SpectatorCountBadge`와 안 겹치게 그 아래). `Game.tsx` 레벨에 배치해 화면 전환과 무관하게 항상 보이게 함. `phase === "playing"`일 때만. 팀 콤보는 관전자에게도 보임. 본인 평균속도는 `me`가 있고 최소 1회 간격이 기록된 뒤부터.

---

### Task 1: 서버 — `TeamState.combo` 필드 + 판정 로직 + 테스트

**Files:**
- Modify: `server/src/rooms/MatchState.ts` (`TeamState` 클래스)
- Modify: `server/src/rooms/MatchRoom.ts:681` (`handlePressButton`의 정답 분기), `server/src/rooms/MatchRoom.ts:701-702` (`applyMortarLoss`)
- Test: `server/src/rooms/MatchRoom.test.ts`

**Interfaces:**
- Produces: `TeamState.combo: number`(colyseus schema 필드, 기본값 0) — Task 2에서 클라이언트 `matchTypes.ts`가 그대로 미러링.

- [ ] **Step 1: 실패하는 테스트 작성**

`server/src/rooms/MatchRoom.test.ts`에 `describe("team combo", ...)` 블록을 새로 추가한다. 파일 안의 `describe("nickname color propagation", () => {` 바로 위(같은 들여쓰기 레벨, `describe("MatchRoom", () => {` 안쪽)에 삽입:

```ts
  describe("team combo", () => {
    test("each correct press increments the active team's combo by 1", async () => {
      const { room, clients } = await fillRolesAndStart({ turnDurationMs: PRESS_HEAVY_TURN_MS });
      const { activeTeam } = actingClientFor(room, clients);
      expect(activeTeam.combo).toBe(0);

      for (let i = 0; i < 3; i++) {
        const { dueColor, actingClient } = actingClientFor(room, clients);
        actingClient.send("pressButton", { color: dueColor });
        await wait(70);
      }

      expect(activeTeam.combo).toBe(3);
    });

    test("a wrong press resets only the failing team's combo, leaving other teams' combos untouched", async () => {
      const { room, clients } = await fillRolesAndStart({ turnDurationMs: SHORT_TURN_MS });
      const { activeTeam, dueColor, actingClient } = actingClientFor(room, clients);
      const otherTeam = room.state.teams.find((t) => t.id !== activeTeam.id)!;
      otherTeam.combo = 7; // 관련 없는 팀의 기존 콤보를 시뮬레이션

      actingClient.send("pressButton", { color: dueColor });
      await wait(70);
      expect(activeTeam.combo).toBe(1);

      const { dueColor: nextDue, actingClient: nextActing } = actingClientFor(room, clients);
      const wrongColor = ALL_COLORS.find((c) => c !== nextDue)!;
      nextActing.send("pressButton", { color: wrongColor });
      await flush();

      expect(activeTeam.combo).toBe(0);
      expect(otherTeam.combo).toBe(7);
    });

    test("a timeout failure also resets the active team's combo", async () => {
      const { room, clients } = await fillRolesAndStart({ turnDurationMs: SHORT_TURN_MS });
      const { activeTeam, dueColor, actingClient } = actingClientFor(room, clients);

      actingClient.send("pressButton", { color: dueColor });
      await wait(70);
      expect(activeTeam.combo).toBe(1);

      await wait(SHORT_TURN_MS + 200); // 추가 프레스 없이 턴이 시간초과되도록 둠

      expect(activeTeam.combo).toBe(0);
    });

    test("combo survives a round change (only resets on failure, not on round rollover)", async () => {
      const { room, clients } = await fillRolesAndStart({ turnDurationMs: PRESS_HEAVY_TURN_MS });
      const firstTeamId = room.state.teams[room.state.activeTeamIndex].id;
      const firstSequenceLen = room.state.sequence.length;
      const startingRound = room.state.round;

      await completeActiveTurn(room, clients, PRESS_HEAVY_TURN_MS);
      const firstTeamAfterOwnTurn = room.state.teams.find((t) => t.id === firstTeamId)!;
      expect(firstTeamAfterOwnTurn.combo).toBe(firstSequenceLen);
      // round-robin: 2팀 중 1팀만 이번 라운드에 턴을 마쳤으므로 아직 라운드 안 넘어감.
      expect(room.state.round).toBe(startingRound);

      // 이제 활성인(두 번째) 팀도 자기 턴을 완료 — 두 팀 다 한 번씩 돌았으므로 라운드가 넘어감.
      await completeActiveTurn(room, clients, PRESS_HEAVY_TURN_MS);

      expect(room.state.round).toBe(startingRound + 1);
      const firstTeamAfterRoundChange = room.state.teams.find((t) => t.id === firstTeamId)!;
      expect(firstTeamAfterRoundChange.combo).toBe(firstSequenceLen); // 라운드 롤오버로는 안 건드려짐
    });
  });
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npm test --workspace server -- MatchRoom.test.ts -t "team combo"`
Expected: FAIL — `TeamState`에 `combo` 프로퍼티가 없어서 `activeTeam.combo`가 전부 `undefined`로 나와 `toBe(0)`/`toBe(3)`/`toBe(1)` 등 단언이 깨짐 (`expected undefined to be 0` 류 메시지).

- [ ] **Step 3: 최소 구현**

`server/src/rooms/MatchState.ts`의 `TeamState` 클래스에 필드 추가:

```ts
export class TeamState extends Schema {
  @type("string") id: string = "";
  @type("string") pigSessionId: string = "";
  @type("string") rabbitSessionId: string = "";
  @type("number") mortars: number = STARTING_MORTARS;
  @type("boolean") eliminated: boolean = false;
  @type("number") combo: number = 0;
}
```

`server/src/rooms/MatchRoom.ts`의 `handlePressButton`에서 커서 전진 직후(기존 `this.state.cursor = result.nextCursor;` 다음 줄, `if (result.complete) {` 앞):

```ts
    this.state.cursor = result.nextCursor;
    activeTeam.combo += 1;
    if (result.complete) {
```

같은 파일의 `applyMortarLoss` 안, `team.mortars = loseMortar(team.mortars);` 다음 줄:

```ts
  private applyMortarLoss(team: TeamState) {
    team.mortars = loseMortar(team.mortars);
    team.combo = 0;
    if (isEliminated(team.mortars)) {
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test --workspace server -- MatchRoom.test.ts -t "team combo"`
Expected: PASS (4개 테스트 전부)

- [ ] **Step 5: 전체 서버 테스트 스위트 회귀 확인**

Run: `npm test --workspace server`
Expected: PASS (기존 테스트 전부 그대로 통과 — `mortars` 판정 로직 자체는 안 건드렸으므로 회귀 없어야 함)

- [ ] **Step 6: 커밋**

```bash
git add server/src/rooms/MatchState.ts server/src/rooms/MatchRoom.ts server/src/rooms/MatchRoom.test.ts
git commit -m "팀별 콤보(연속 성공 프레스 수) 서버 상태 추가"
```

---

### Task 2: 클라이언트 — 타입 미러링 + `usePersonalPressSpeed` 훅

**Files:**
- Modify: `client/src/game/matchTypes.ts` (`TeamState` interface)
- Create: `client/src/game/usePersonalPressSpeed.ts`

**Interfaces:**
- Consumes: 없음(신규 독립 모듈).
- Produces: `TeamState.combo: number`(타입 미러링, Task 3의 `TeamComboBadge`가 사용). `usePersonalPressSpeed(): { averageMs: number | null; recordPress: () => void; resetAnchor: () => void }` — Task 5(`MyTurnScreen`/`Game.tsx`)가 사용.

- [ ] **Step 1: `matchTypes.ts`에 `combo` 필드 추가**

`client/src/game/matchTypes.ts`의 `TeamState` interface를 다음과 같이 수정:

```ts
export interface TeamState {
  id: string;
  pigSessionId: string;
  rabbitSessionId: string;
  mortars: number;
  eliminated: boolean;
  combo: number;
}
```

- [ ] **Step 2: 타입체크로 서버/클라이언트 필드 불일치 여부 확인**

Run: `npx tsc -b` (in `client/`)
Expected: 이 시점에선 `combo`를 실제로 읽는 코드가 아직 없으므로 에러 없이 통과. (Task 1에서 서버 스키마에 이미 `combo`를 추가했고, 이 인터페이스는 그 필드를 그대로 미러링한 것 — 이름 불일치가 있었다면 이후 태스크의 컴파일이 깨지는 방식으로 드러남.)

- [ ] **Step 3: `usePersonalPressSpeed` 훅 작성**

`client/src/game/usePersonalPressSpeed.ts` 새로 생성:

```ts
import { useCallback, useRef, useState } from "react";

// 본인이 직접 누른 프레스끼리의 연속 간격 누적 평균 — 동료 프레스는 집계
// 대상이 아니고(이 훅은 MyTurnScreen 쪽에서만 호출됨), 턴 사이 공백도 안
// 섞이도록 resetAnchor()로 매 턴 시작 시 기준점만 지운다(누적 합/횟수는
// 매치 전체 유지). Game.tsx에서 호출해 MyTurnScreen이 턴마다 언마운트/
// 리마운트돼도 누적치가 안 날아가게 한다 — 채팅 draft 유지와 동일한 이유.
export function usePersonalPressSpeed() {
  const lastPressAtRef = useRef<number | null>(null);
  const totalMsRef = useRef(0);
  const countRef = useRef(0);
  const [averageMs, setAverageMs] = useState<number | null>(null);

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

- [ ] **Step 4: 타입체크 + lint**

Run: `npx tsc -b && npm run lint` (in `client/`)
Expected: 에러 없음 (아직 아무도 이 훅을 쓰지 않으므로 "unused" 경고가 날 수 있는데, oxlint는 export된 함수를 unused로 잡지 않으므로 통과해야 함 — 잡히면 Step 5로 넘어가지 말고 원인 확인).

- [ ] **Step 5: 커밋**

```bash
git add client/src/game/matchTypes.ts client/src/game/usePersonalPressSpeed.ts
git commit -m "TeamState.combo 타입 미러링, 본인 프레스 간격 훅(usePersonalPressSpeed) 추가"
```

---

### Task 3: 클라이언트 — `TeamComboBadge` 컴포넌트

**Files:**
- Create: `client/src/components/TeamComboBadge.tsx`
- Create: `client/src/components/TeamComboBadge.module.css`

**Interfaces:**
- Consumes: `TeamState`(Task 2에서 `combo` 필드 추가된 타입) 배열.
- Produces: `TeamComboBadge({ teams }: { teams: TeamState[] })` — Task 5에서 `Game.tsx`가 `room.state.teams`를 그대로 넘겨 사용.

- [ ] **Step 1: 컴포넌트 작성**

`client/src/components/TeamComboBadge.tsx`:

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

- [ ] **Step 2: 스타일 작성**

`client/src/components/TeamComboBadge.module.css` — `SpectatorCountBadge.module.css`의 `.badge`와 대칭되는 왼쪽 위 배치, 팀이 여럿이면 세로로 쌓임:

```css
.wrap {
  position: fixed;
  top: 0.75rem;
  left: 0.75rem;
  z-index: 5;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.row {
  padding: 0.35rem 0.7rem;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.5);
  color: #fff;
  font-size: 0.85rem;
  font-weight: 700;
  white-space: nowrap;
}

.eliminated {
  opacity: 0.5;
}
```

- [ ] **Step 3: 타입체크 + lint**

Run: `npx tsc -b && npm run lint` (in `client/`)
Expected: 에러 없음 (아직 어디서도 import 안 하므로 unused 관련 문제는 없어야 함 — export된 컴포넌트라 oxlint가 unused로 잡지 않음).

- [ ] **Step 4: 커밋**

```bash
git add client/src/components/TeamComboBadge.tsx client/src/components/TeamComboBadge.module.css
git commit -m "팀별 콤보를 왼쪽 위에 보여주는 TeamComboBadge 컴포넌트 추가"
```

---

### Task 4: 클라이언트 — `MyAverageSpeedBadge` 컴포넌트

**Files:**
- Create: `client/src/components/MyAverageSpeedBadge.tsx`
- Create: `client/src/components/MyAverageSpeedBadge.module.css`

**Interfaces:**
- Consumes: `averageMs: number | null` (Task 2의 `usePersonalPressSpeed`가 반환하는 값).
- Produces: `MyAverageSpeedBadge({ averageMs }: { averageMs: number | null })` — Task 5에서 `Game.tsx`가 사용.

- [ ] **Step 1: 컴포넌트 작성**

`client/src/components/MyAverageSpeedBadge.tsx`:

```tsx
import styles from "./MyAverageSpeedBadge.module.css";

// averageMs가 null이면(아직 연속 프레스 간격이 한 번도 안 잡힘) 아무것도
// 안 그림 — 의미 없는 "0.00초" 플레이스홀더를 보여주지 않기 위함.
export function MyAverageSpeedBadge({ averageMs }: { averageMs: number | null }) {
  if (averageMs === null) return null;
  return <div className={styles.badge}>⚡ {(averageMs / 1000).toFixed(2)}초</div>;
}
```

- [ ] **Step 2: 스타일 작성**

`client/src/components/MyAverageSpeedBadge.module.css` — `SpectatorCountBadge.module.css`의 `.badge`와 같은 톤, `top`만 내려서 그 배지(관전자 수) 바로 아래에 오도록:

```css
.badge {
  position: fixed;
  top: 2.6rem;
  right: 0.75rem;
  z-index: 5;
  padding: 0.35rem 0.7rem;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.5);
  color: #fff;
  font-size: 0.85rem;
  font-weight: 700;
  white-space: nowrap;
}
```

- [ ] **Step 3: 타입체크 + lint**

Run: `npx tsc -b && npm run lint` (in `client/`)
Expected: 에러 없음.

- [ ] **Step 4: 커밋**

```bash
git add client/src/components/MyAverageSpeedBadge.tsx client/src/components/MyAverageSpeedBadge.module.css
git commit -m "본인 평균 프레스 간격을 오른쪽 위에 보여주는 MyAverageSpeedBadge 컴포넌트 추가"
```

---

### Task 5: 클라이언트 — `MyTurnScreen.tsx` + `Game.tsx` 배선, Playwright로 실제 동작 검증

props를 만드는 쪽(`MyTurnScreen`)과 넘기는 쪽(`Game.tsx`)이 같이 있어야 빌드가 성립하므로(둘 중 하나만 커밋하면 `tsc -b`가 깨진 채로 남음) 한 태스크로 묶는다.

**Files:**
- Modify: `client/src/components/MyTurnScreen.tsx`
- Modify: `client/src/components/Game.tsx`

**Interfaces:**
- Consumes: `usePersonalPressSpeed()`(Task 2), `TeamComboBadge`(Task 3), `MyAverageSpeedBadge`(Task 4).

- [ ] **Step 1: props 추가 + 마운트 시 `onMyTurnStart` 호출 + `press`에서 `onMyPress` 호출**

`client/src/components/MyTurnScreen.tsx` 전체를 다음으로 교체:

```tsx
import { useCallback, useEffect } from "react";
import type { Room } from "colyseus.js";
import type { MatchState, PlayerState } from "../game/matchTypes";
import type { Color } from "../game/colors";
import { useSequencePressSound } from "../game/useSequencePressSound";
import { useColorKeyPress } from "../game/useColorKeyPress";
import { SequenceBoard } from "./SequenceBoard";
import { ButtonPanel } from "./ButtonPanel";
import { TurnOutcomeBanner } from "./TurnOutcomeBanner";
import { TimerBar } from "./TimerBar";
import styles from "./PlayingScreen.module.css";

// Mirrors server/src/game/mortar.ts's STARTING_MORTARS — see
// TeamRosterPanel.tsx for the same constant and reasoning.
const MAX_MORTARS = 5;

// Keyboard button presses (useColorKeyPress) are restricted to this one
// nickname while the feature's still being tried out online — everyone else
// keeps playing touch/click-only. Solo mode (SoloPlayScreen) doesn't have
// this restriction because it dropped keyboard support entirely instead.
const KEYBOARD_PRESS_ALLOWED_NICKNAME = "홍바들";

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
  // Game.tsx의 usePersonalPressSpeed()가 반환하는 recordPress/resetAnchor —
  // 이 화면은 활성 팀이 바뀔 때마다 언마운트/리마운트되므로, 누적 평균
  // 자체는 이 컴포넌트 밖(Game.tsx)에 살아있어야 턴이 넘어가도 안 날아간다.
  onMyPress: () => void;
  onMyTurnStart: () => void;
}) {
  const { sequence, cursor, turnOutcome, missedRole, round, turnEndsAt, teams } = room.state;
  const myTeam = teams.find((team) => team.id === me.teamId);
  const disabled = turnOutcome !== "pending";
  // My own presses already get instant local feedback (ButtonPanel plays on
  // press, before the server round-trip) — this is for hearing my
  // teammate's presses, which I'd otherwise only see, never hear.
  useSequencePressSound(sequence, cursor, me.role as "pig" | "rabbit");

  // 이 화면이 마운트되는 건 정확히 "내 팀의 새 턴이 시작될 때"뿐이므로,
  // 마운트 1회 = 턴 시작 1회. 턴 사이 공백이 평균속도 계산에 안 섞이도록
  // 여기서 기준점을 리셋한다(usePersonalPressSpeed.ts 참고).
  useEffect(() => {
    onMyTurnStart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // room is a stable reference for the lifetime of the connection (set once
  // by useMatchRoom, never reassigned) — memoized so ButtonPanel's own
  // React.memo isn't defeated by a fresh onPress function every render.
  const press = useCallback(
    (color: Color) => {
      room.send("pressButton", { color });
      onMyPress();
    },
    [room, onMyPress],
  );

  const keyboardPressDisabled = disabled || me.nickname !== KEYBOARD_PRESS_ALLOWED_NICKNAME;
  useColorKeyPress(me.role as "pig" | "rabbit", keyboardPressDisabled, press);

  return (
    <div className={styles.wrap}>
      <div className={styles.content}>
        <p className={styles.round}>ROUND {round}</p>
        {myTeam && (
          <div className={styles.myMortars}>
            {Array.from({ length: MAX_MORTARS }, (_, i) => (
              <img
                key={i}
                className={styles.myMortarHeart}
                alt=""
                src={
                  i < myTeam.mortars
                    ? "/game-assets/ui/thanksgiving_room_heart.png"
                    : "/game-assets/ui/thanksgiving_room_heart_off.png"
                }
              />
            ))}
          </div>
        )}
        <TimerBar turnEndsAt={turnEndsAt} clockOffsetMs={clockOffsetMs} />
        <p className={styles.myTurn}>내 차례! ({me.role === "pig" ? "돼지" : "토끼"})</p>
        <div className={styles.boardArea}>
          <SequenceBoard sequence={sequence} cursor={cursor} turnOutcome={turnOutcome} missedRole={missedRole} />
          <TurnOutcomeBanner outcome={turnOutcome} />
        </div>
      </div>
      <ButtonPanel role={me.role as "pig" | "rabbit"} disabled={disabled} onPress={press} />
    </div>
  );
}
```

- [ ] **Step 2: `Game.tsx`에 훅 사용 + 배지 렌더링 + `MyTurnScreen`에 prop 전달**

`client/src/components/Game.tsx` 전체를 다음으로 교체:

```tsx
import { useCallback, useEffect, useRef } from "react";
import type { Room } from "colyseus.js";
import type { MatchState } from "../game/matchTypes";
import { usePersonalPressSpeed } from "../game/usePersonalPressSpeed";
import { RoleSelect } from "./RoleSelect";
import { MyTurnScreen } from "./MyTurnScreen";
import { SpectatorScreen } from "./SpectatorScreen";
import { SpectatorCountBadge } from "./SpectatorCountBadge";
import { TeamComboBadge } from "./TeamComboBadge";
import { MyAverageSpeedBadge } from "./MyAverageSpeedBadge";
import { BgmPlayer } from "./BgmPlayer";

export function Game({
  room,
  clockOffsetMs,
  onLeave,
  onExit,
}: {
  room: Room<MatchState>;
  clockOffsetMs: number;
  onLeave: () => void;
  onExit: () => void;
}) {
  const { phase } = room.state;
  const isSpectator = room.state.spectators.has(room.sessionId);

  // Survives SpectatorScreen unmounting/remounting every time the active
  // turn hands off to/from the player's own team (Game itself doesn't
  // unmount on that switch, only which screen it renders) — see
  // ChatBox.tsx's initialDraft/onDraftChange doc comment. A ref, not state:
  // nothing here needs to re-render when the draft changes, only to read
  // the latest value back whenever SpectatorScreen next mounts.
  const chatDraftRef = useRef("");
  const handleChatDraftChange = useCallback((text: string) => {
    chatDraftRef.current = text;
  }, []);

  // 본인 평균 프레스 간격 — MyTurnScreen이 턴마다 언마운트/리마운트돼도
  // 여기(Game.tsx)에 살아있으므로 누적치가 유지됨. usePersonalPressSpeed.ts 참고.
  const { averageMs, recordPress, resetAnchor } = usePersonalPressSpeed();

  // 매치가 끝나 재경기 로비로 돌아가는 순간, 관전자는 그 로비(플레이어들끼리의 재경기
  // 대기실)에 남아있을 이유가 없다 — 자동으로 방을 나가 방 목록으로 돌아간다.
  useEffect(() => {
    if (isSpectator && phase === "lobby") {
      onLeave();
    }
  }, [isSpectator, phase, onLeave]);

  if (phase === "lobby") {
    // 관전자가 여기 도달하는 건 위 effect가 아직 반영되기 전의 찰나뿐이므로, 그 사이엔
    // 로비 화면을 보여줄 필요 없이 아무것도 렌더링하지 않는다.
    if (isSpectator) return null;
    return <RoleSelect room={room} onExit={onExit} />;
  }

  const me = room.state.players.get(room.sessionId);
  const activeTeam = room.state.teams[room.state.activeTeamIndex];
  // activeTeam can itself be eliminated once every team has been wiped out
  // (the server freezes turns at that point instead of ending the match) —
  // that team's own players fall through to SpectatorScreen too, since
  // there's no turn left for anyone to take.
  const isMyTeamActive = me?.teamId === activeTeam?.id && !activeTeam?.eliminated;

  let screen = null;
  if (me && activeTeam && isMyTeamActive) {
    screen = (
      <MyTurnScreen
        room={room}
        me={me}
        clockOffsetMs={clockOffsetMs}
        onMyPress={recordPress}
        onMyTurnStart={resetAnchor}
      />
    );
  } else if (activeTeam) {
    const myTeam = room.state.teams.find((t) => t.id === me?.teamId);
    screen = (
      <SpectatorScreen
        room={room}
        activeTeam={activeTeam}
        eliminated={myTeam?.eliminated ?? false}
        isSpectator={isSpectator}
        clockOffsetMs={clockOffsetMs}
        onLeave={onLeave}
        initialChatDraft={chatDraftRef.current}
        onChatDraftChange={handleChatDraftChange}
      />
    );
  }

  // BgmPlayer stays at this fixed position in the tree across every
  // MyTurnScreen <-> SpectatorScreen switch (every turn), so React never
  // remounts it while phase stays "playing" — that's what keeps the BGM
  // from restarting each turn.
  return (
    <>
      <BgmPlayer />
      {phase === "playing" && <SpectatorCountBadge room={room} />}
      {phase === "playing" && <TeamComboBadge teams={room.state.teams} />}
      {phase === "playing" && me && <MyAverageSpeedBadge averageMs={averageMs} />}
      {screen}
    </>
  );
}
```

- [ ] **Step 3: 타입체크 + lint**

Run: `npx tsc -b && npm run lint` (in `client/`)
Expected: 에러 없음.

- [ ] **Step 4: 서버 dev 실행 + Playwright로 실제 동작 확인**

임시로 debug 라우트를 만들지 않고, 실제 온라인 매치 플로우로 검증한다(이 기능은 서버 상태를 실시간으로 반영해야 하므로 더미 데이터 조립보다 실제 룸이 더 정확함).

1. `npm run dev`(루트에서, server+client 동시 실행)
2. Playwright로 브라우저 탭 2개(또는 4개, teamCount 기본 2팀×2인)를 열어 각각 다른 역할(pig/rabbit)로 입장, 방 하나에 4명 채워 매치 시작
3. 첫 턴 진행 중인 탭에서: 왼쪽 위에 `team-1팀 🔥0`/`team-2팀 🔥0`(또는 실제 team id) 배지가 보이는지 스크린샷으로 확인
4. 정답 색을 2~3번 연속으로 눌러(해당 역할 탭에서) 왼쪽 위 콤보 숫자가 올라가는지 확인
5. 오답을 한 번 눌러 그 팀 콤보가 0으로 리셋되는지 확인
6. 오른쪽 위에 본인 평균속도 배지(`⚡ 0.xx초`)가 뜨는지, 관전자 수 배지와 안 겹치는지 확인
7. 턴이 다른 팀으로 넘어갔다가 다시 이 팀 턴이 됐을 때(SpectatorScreen ↔ MyTurnScreen 전환), 오른쪽 위 평균속도 값이 초기화 안 되고 유지되는지 확인

문제 발견 시 원인 파악 후 해당 태스크로 돌아가 수정 — 이 단계는 새 코드 작성 없이 확인만.

- [ ] **Step 5: 커밋**

```bash
git add client/src/components/MyTurnScreen.tsx client/src/components/Game.tsx
git commit -m "MyTurnScreen/Game.tsx에 팀 콤보/본인 평균속도 배지 배선"
```
