# 혼자 연습 모드 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 로비에서 "온라인"/"혼자 연습"을 고를 수 있게 하고, "혼자 연습"을 고르면 역할(돼지/토끼)을 선택해 서버 접속 없이 클라이언트에서 완전히 로컬로 무한 라운드를 연습할 수 있게 한다.

**Architecture:** 서버의 순수 함수(시퀀스 생성/판정/길이 계산)를 역할 하나로 제한한 버전으로 클라이언트에 손으로 포팅하고, `MatchRoom`의 턴 진행 타이밍(오답 시 원래 4초까지 실패 배너 유지, 타임아웃/정답 시 즉시 다음 턴)을 재현하는 React 훅으로 감싼다. `App.tsx`가 `mode` 상태로 화면을 분기하며, `useMatchRoom()`을 호출하는 온라인 흐름은 "온라인"을 고를 때까지 아예 마운트되지 않아 서버 접속 자체가 지연된다.

**Tech Stack:** React 19 + TypeScript (client 워크스페이스만, 서버/Colyseus 관여 없음)

## Global Constraints

- 클라이언트 패키지는 자동화 테스트가 없음 — 검증은 `npx tsc -b`, `npm run lint`, 그리고 브라우저 수동 확인으로 한다.
- 클라이언트/서버는 별개 npm 워크스페이스라 서버 코드를 직접 import할 수 없다 — 순수 함수를 손으로 포팅하고 "mirrors server/src/game/X.ts" 주석을 남기는 기존 패턴(`matchTypes.ts`, `colors.ts`)을 따른다.
- 솔로 모드는 Colyseus/서버와 절대 통신하지 않는다 — `soloEngine.ts`, `useSoloMatch.ts`, `SoloRoleSelect.tsx`, `SoloPlayScreen.tsx`에서 `colyseus.js`/`Room` 관련 import가 있으면 안 된다.
- 턴 타이밍은 `server/src/rooms/MatchRoom.ts`의 `handlePressButton`/`onTurnTimerExpired`와 동일해야 한다: 오답을 일찍 누르면 그 즉시 실패 상태로 바뀌지만 다음 턴 시작은 원래 턴의 4초 마크까지 미룸. 타임아웃(무입력)이나 시퀀스 완료(정답)는 그 즉시 다음 턴으로 넘어감.
- 절구(생명)/게임오버 없음 — 실패해도 라운드가 무한히 계속됨.
- 기존 컴포넌트 `SequenceBoard`, `ButtonPanel`, `TurnOutcomeBanner`, `TimerBar`는 수정하지 않고 그대로 재사용한다.
- 레이블: "온라인" / "혼자 연습".

---

## Task 1: 솔로 게임 엔진 (순수 로직 포팅)

**Files:**
- Create: `client/src/game/soloEngine.ts`

**Interfaces:**
- Consumes: `Color`, `Role` 타입 (`client/src/game/colors.ts`, 이미 존재)
- Produces:
  - `sequenceLengthForRound(round: number): number`
  - `generateSoloSequence(totalLength: number, rng: () => number, role: Role): Color[]`
  - `attemptSoloPress(sequence: Color[], cursor: number, pressedColor: Color): { correct: true; nextCursor: number; complete: boolean } | { correct: false }`

- [ ] **Step 1: `server/src/game/sequence.ts`, `fragments.ts`, `turnOrder.ts`, `sequenceLength.ts`, `rng.ts`를 역할 하나로 제한해서 클라이언트에 포팅한다**

`client/src/game/soloEngine.ts`를 새로 만든다:

```typescript
import type { Color, Role } from "./colors";

// Manually ported from server/src/game/{rng,fragments,sequence,sequenceLength,turnOrder}.ts,
// restricted to a single role — solo practice mode has no teammate to
// cover the other role's colors, so the sequence only ever contains the
// chosen role's pieces. Client and server are separate npm workspaces
// with no shared-types package, kept in sync by hand (see
// client/src/game/matchTypes.ts for the same pattern).

type Rng = () => number;

function pick<T>(options: readonly T[], rng: Rng): T {
  return options[Math.floor(rng() * options.length)];
}

const MINT_RUN_LENGTHS = [2, 4, 6];
const PIG_BASE_COLORS: Color[] = ["red", "orange", "yellow"];
const RABBIT_PAIR_COLORS: Color[] = ["green", "blue", "pink"];

function mintRun(length: number): Color[] {
  return Array.from({ length }, () => "mint");
}

function generatePigFragment(rng: Rng): Color[] {
  return [pick(PIG_BASE_COLORS, rng), "purple"];
}

function generateRabbitPairFragment(rng: Rng): Color[] {
  return [pick(RABBIT_PAIR_COLORS, rng), pick(RABBIT_PAIR_COLORS, rng)];
}

type FragmentChoice = () => Color[];

function fragmentChoicesForRole(remaining: number, rng: Rng, role: Role): FragmentChoice[] {
  if (role === "pig") {
    return [() => generatePigFragment(rng)];
  }

  const choices: FragmentChoice[] = [];
  const validMintLengths = MINT_RUN_LENGTHS.filter((length) => length <= remaining);
  if (validMintLengths.length > 0) {
    choices.push(() => mintRun(pick(validMintLengths, rng)));
  }
  if (remaining >= 2) {
    choices.push(() => generateRabbitPairFragment(rng));
  }
  return choices;
}

export function generateSoloSequence(totalLength: number, rng: Rng, role: Role): Color[] {
  const sequence: Color[] = [];
  let remaining = totalLength;

  while (remaining > 0) {
    const choices = fragmentChoicesForRole(remaining, rng, role);
    const fragment = pick(choices, rng)();
    sequence.push(...fragment);
    remaining -= fragment.length;
  }

  return sequence;
}

const BUTTONS_PER_ROW = 6;
const STARTING_ROWS = 3;
const ROUNDS_PER_ROW_INCREASE = 10;

export function sequenceLengthForRound(round: number): number {
  const rows = STARTING_ROWS + Math.floor((round - 1) / ROUNDS_PER_ROW_INCREASE);
  return rows * BUTTONS_PER_ROW;
}

export type PressResult = { correct: true; nextCursor: number; complete: boolean } | { correct: false };

export function attemptSoloPress(sequence: Color[], cursor: number, pressedColor: Color): PressResult {
  if (cursor >= sequence.length) return { correct: false };

  const dueColor = sequence[cursor];
  if (pressedColor !== dueColor) return { correct: false };

  const nextCursor = cursor + 1;
  return { correct: true, nextCursor, complete: nextCursor === sequence.length };
}
```

- [ ] **Step 2: 타입체크로 확인한다**

Run: `cd client && npx tsc -b`
Expected: 에러 없이 종료.

- [ ] **Step 3: 브라우저 콘솔로 역할 제한이 실제로 지켜지는지 눈으로 확인한다 (자동화 테스트가 없으므로 수동 스모크 체크)**

`client && npm run dev`로 개발 서버를 띄우고, 브라우저에서 `http://localhost:5173`을 연 뒤 개발자 도구 콘솔에서:

```js
const mod = await import("/src/game/soloEngine.ts");
const seq = mod.generateSoloSequence(60, Math.random, "pig");
console.log(seq.every((c) => ["red", "orange", "yellow", "purple"].includes(c)));
// true가 나와야 함 — 돼지 시퀀스에 토끼 색상(mint/green/blue/pink)이 절대 안 섞임
const seq2 = mod.generateSoloSequence(60, Math.random, "rabbit");
console.log(seq2.every((c) => ["mint", "green", "blue", "pink"].includes(c)));
// true가 나와야 함
```

Expected: 둘 다 `true`.

- [ ] **Step 4: 커밋**

```bash
git add client/src/game/soloEngine.ts
git commit -m "$(cat <<'EOF'
혼자 연습 모드용 역할 제한 시퀀스 엔진 추가

server/src/game/{sequence,fragments,turnOrder,sequenceLength,rng}.ts를
역할 하나로 제한한 버전으로 클라이언트에 포팅. 솔로 모드는 팀원이
없어서 상대 역할 조각을 섞지 않고, 고른 역할의 조각 생성 규칙만
반복한다.
EOF
)"
```

---

## Task 2: 솔로 매치 상태 훅

**Files:**
- Create: `client/src/game/useSoloMatch.ts`

**Interfaces:**
- Consumes: `generateSoloSequence`, `sequenceLengthForRound`, `attemptSoloPress` (Task 1, `client/src/game/soloEngine.ts`), `TurnOutcome` (`client/src/game/matchTypes.ts`, 이미 존재), `Color`/`Role` (`client/src/game/colors.ts`)
- Produces: `useSoloMatch(role: Role): { round: number; sequence: Color[]; cursor: number; turnOutcome: TurnOutcome; turnEndsAt: number; press: (color: Color) => void }`

- [ ] **Step 1: `client/src/game/useSoloMatch.ts`를 만든다**

```typescript
import { useEffect, useRef, useState } from "react";
import type { Color, Role } from "./colors";
import type { TurnOutcome } from "./matchTypes";
import { attemptSoloPress, generateSoloSequence, sequenceLengthForRound } from "./soloEngine";

// Mirrors server/src/rooms/MatchRoom.ts's DEFAULT_TURN_DURATION_MS.
const TURN_DURATION_MS = 4000;

export function useSoloMatch(role: Role) {
  const [round, setRound] = useState(1);
  const [sequence, setSequence] = useState<Color[]>(() =>
    generateSoloSequence(sequenceLengthForRound(1), Math.random, role),
  );
  const [cursor, setCursor] = useState(0);
  const [turnOutcome, setTurnOutcome] = useState<TurnOutcome>("pending");
  const [turnEndsAt, setTurnEndsAt] = useState(() => Date.now() + TURN_DURATION_MS);

  const roundRef = useRef(1);
  const turnDecidedRef = useRef(false);
  const turnTokenRef = useRef(0);

  function scheduleExpiry() {
    turnTokenRef.current += 1;
    const token = turnTokenRef.current;
    setTimeout(() => {
      if (token === turnTokenRef.current) onTimerExpired();
    }, TURN_DURATION_MS);
  }

  function startTurn(nextRound: number) {
    roundRef.current = nextRound;
    setRound(nextRound);
    setSequence(generateSoloSequence(sequenceLengthForRound(nextRound), Math.random, role));
    setCursor(0);
    setTurnOutcome("pending");
    setTurnEndsAt(Date.now() + TURN_DURATION_MS);
    turnDecidedRef.current = false;
    scheduleExpiry();
  }

  function onTimerExpired() {
    if (!turnDecidedRef.current) {
      turnDecidedRef.current = true;
      setTurnOutcome("fail");
    }
    // timeout means nothing is left to hold on screen — hand off right away,
    // same as MatchRoom.onTurnTimerExpired.
    startTurn(roundRef.current + 1);
  }

  useEffect(() => {
    // Arms the timer for the very first turn (already generated by the
    // useState initializers above) — startTurn() itself arms the timer for
    // every subsequent round.
    scheduleExpiry();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function press(color: Color) {
    if (turnDecidedRef.current) return;

    const result = attemptSoloPress(sequence, cursor, color);
    if (!result.correct) {
      turnDecidedRef.current = true;
      setTurnOutcome("fail");
      // Wrong press holds the fail state on screen until the original 4s
      // mark (scheduleExpiry's pending timeout), same as
      // MatchRoom.handlePressButton.
      return;
    }

    setCursor(result.nextCursor);
    if (result.complete) {
      turnDecidedRef.current = true;
      setTurnOutcome("success");
      startTurn(roundRef.current + 1);
    }
  }

  return { round, sequence, cursor, turnOutcome, turnEndsAt, press };
}
```

- [ ] **Step 2: 타입체크로 확인한다**

Run: `cd client && npx tsc -b`
Expected: 에러 없이 종료. (아직 아무도 이 훅을 쓰지 않아도 에러 아님 — export만 하고 있으면 됨.)

- [ ] **Step 3: 커밋**

```bash
git add client/src/game/useSoloMatch.ts
git commit -m "$(cat <<'EOF'
혼자 연습 모드 상태 훅 추가

MatchRoom의 턴 진행 타이밍(오답은 원래 4초 마크까지 실패 상태 유지,
타임아웃/정답은 즉시 다음 턴)을 React 훅으로 재현. 절구/게임오버
없이 라운드가 무한히 계속됨.
EOF
)"
```

---

## Task 3: 모드 선택 + 솔로 역할 선택 화면

**Files:**
- Create: `client/src/components/ModeSelect.tsx`
- Create: `client/src/components/ModeSelect.module.css`
- Create: `client/src/components/SoloRoleSelect.tsx`
- Create: `client/src/components/SoloRoleSelect.module.css`

**Interfaces:**
- Consumes: `Role` (`client/src/game/colors.ts`)
- Produces:
  - `ModeSelect({ onSelectOnline: () => void; onSelectOffline: () => void })`
  - `SoloRoleSelect({ onChoose: (role: Role) => void; onBack: () => void })`

- [ ] **Step 1: `client/src/components/ModeSelect.tsx`를 만든다**

```tsx
import styles from "./ModeSelect.module.css";

export function ModeSelect({
  onSelectOnline,
  onSelectOffline,
}: {
  onSelectOnline: () => void;
  onSelectOffline: () => void;
}) {
  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <h1 className={styles.title}>송편 만들기</h1>
      </div>
      <div className={styles.choices}>
        <button className={styles.modeButton} onClick={onSelectOnline}>
          온라인
        </button>
        <button className={`${styles.modeButton} ${styles.offline}`} onClick={onSelectOffline}>
          혼자 연습
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: `client/src/components/ModeSelect.module.css`를 만든다**

```css
.wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1.5rem;
  color: #fff;
  text-align: center;
  flex: 1;
}

.header {
  width: 100%;
  background-image: url("/game-assets/ui/thanksgiving_room_header.webp");
  background-size: cover;
  background-position: center;
  padding: 2.5rem 1rem 1.75rem;
  box-sizing: border-box;
}

.title {
  margin: 0;
  font-size: 2rem;
  font-weight: 800;
  letter-spacing: 0.02em;
  color: #fff;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.6), 0 0 24px rgba(255, 235, 180, 0.55);
}

.choices {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 2rem 1rem;
  width: 100%;
  max-width: 18rem;
  box-sizing: border-box;
}

.modeButton {
  padding: 1rem 1.5rem;
  font-size: 1.1rem;
  font-weight: 700;
  color: #fff;
  border: none;
  border-radius: 0.75rem;
  cursor: pointer;
  background: linear-gradient(135deg, #f2994a, #e5484d);
  transition: transform 0.15s ease;
}

.modeButton:hover {
  transform: translateY(-2px);
}

.modeButton:active {
  transform: translateY(0) scale(0.97);
}

.offline {
  background: linear-gradient(135deg, #2ec4b6, #3b82f6);
}
```

- [ ] **Step 3: `client/src/components/SoloRoleSelect.tsx`를 만든다**

```tsx
import type { Role } from "../game/colors";
import styles from "./SoloRoleSelect.module.css";

export function SoloRoleSelect({
  onChoose,
  onBack,
}: {
  onChoose: (role: Role) => void;
  onBack: () => void;
}) {
  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <h1 className={styles.title}>혼자 연습</h1>
      </div>
      <div className={styles.choices}>
        <button className={`${styles.roleButton} ${styles.pigButton}`} onClick={() => onChoose("pig")}>
          <img
            className={styles.roleIcon}
            src="/game-assets/ui/thanksgiving_room_start_player_pig.png"
            alt=""
          />
          <span>돼지</span>
        </button>
        <button className={`${styles.roleButton} ${styles.rabbitButton}`} onClick={() => onChoose("rabbit")}>
          <img
            className={styles.roleIcon}
            src="/game-assets/ui/thanksgiving_room_start_player_rabbit.png"
            alt=""
          />
          <span>토끼</span>
        </button>
      </div>
      <button className={styles.backLink} onClick={onBack}>
        ← 뒤로
      </button>
    </div>
  );
}
```

- [ ] **Step 4: `client/src/components/SoloRoleSelect.module.css`를 만든다**

```css
.wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1.5rem;
  color: #fff;
  text-align: center;
  flex: 1;
}

.header {
  width: 100%;
  background-image: url("/game-assets/ui/thanksgiving_room_header.webp");
  background-size: cover;
  background-position: center;
  padding: 2.5rem 1rem 1.75rem;
  box-sizing: border-box;
}

.title {
  margin: 0;
  font-size: 2rem;
  font-weight: 800;
  letter-spacing: 0.02em;
  color: #fff;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.6), 0 0 24px rgba(255, 235, 180, 0.55);
}

.choices {
  display: flex;
  gap: 2.5rem;
  padding: 1rem;
}

.roleButton {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.6rem;
  background: none;
  border: none;
  cursor: pointer;
  color: #fff;
  font-weight: 700;
  font-size: 1.05rem;
  padding: 0.5rem;
  transition: transform 0.15s ease;
}

.roleButton:hover {
  transform: translateY(-4px);
}

.roleButton:active {
  transform: translateY(-1px) scale(0.97);
}

.roleIcon {
  width: 7rem;
  height: 7rem;
  border-radius: 999px;
}

.pigButton .roleIcon {
  filter: drop-shadow(0 0 14px rgba(242, 153, 74, 0.65));
}

.rabbitButton .roleIcon {
  filter: drop-shadow(0 0 14px rgba(59, 130, 246, 0.65));
}

.backLink {
  background: none;
  border: none;
  color: #fff;
  opacity: 0.75;
  font-size: 0.9rem;
  cursor: pointer;
  padding-bottom: 2rem;
}

.backLink:hover {
  opacity: 1;
}
```

- [ ] **Step 5: 타입체크와 린트로 확인한다**

Run: `cd client && npx tsc -b && npm run lint`
Expected: 둘 다 에러 없이 종료.

- [ ] **Step 6: 커밋**

```bash
git add client/src/components/ModeSelect.tsx client/src/components/ModeSelect.module.css client/src/components/SoloRoleSelect.tsx client/src/components/SoloRoleSelect.module.css
git commit -m "$(cat <<'EOF'
모드 선택 화면과 솔로 역할 선택 화면 추가

로비 진입점을 "온라인"/"혼자 연습"으로 나누는 ModeSelect와, 혼자
연습용 돼지/토끼 선택 화면 SoloRoleSelect. 둘 다 서버 통신 없이
로컬 콜백만 호출. 비주얼은 기존 RoleSelect와 같은 스타일(달+청사초롱
헤더, 역할 아이콘)을 따름.
EOF
)"
```

---

## Task 4: 솔로 플레이 화면

**Files:**
- Create: `client/src/components/SoloPlayScreen.tsx`

**Interfaces:**
- Consumes: `useSoloMatch` (Task 2), `Role` (`client/src/game/colors.ts`), `SequenceBoard`/`ButtonPanel`/`TurnOutcomeBanner`/`TimerBar` (기존, 수정 없이 재사용), `styles`(`client/src/components/PlayingScreen.module.css`, 기존 — `.leaveButton` 클래스 재사용)
- Produces: `SoloPlayScreen({ role: Role; onExit: () => void })`

- [ ] **Step 1: `client/src/components/SoloPlayScreen.tsx`를 만든다**

```tsx
import type { Color, Role } from "../game/colors";
import { useSoloMatch } from "../game/useSoloMatch";
import { SequenceBoard } from "./SequenceBoard";
import { ButtonPanel } from "./ButtonPanel";
import { TurnOutcomeBanner } from "./TurnOutcomeBanner";
import { TimerBar } from "./TimerBar";
import styles from "./PlayingScreen.module.css";

export function SoloPlayScreen({ role, onExit }: { role: Role; onExit: () => void }) {
  const { round, sequence, cursor, turnOutcome, turnEndsAt, press } = useSoloMatch(role);
  const dueColor = cursor < sequence.length ? (sequence[cursor] as Color) : undefined;
  const disabled = turnOutcome !== "pending";

  return (
    <div className={styles.wrap}>
      <p className={styles.round}>ROUND {round}</p>
      <TimerBar turnEndsAt={turnEndsAt} />
      <button className={styles.leaveButton} onClick={onExit}>
        나가기
      </button>
      <div className={styles.boardArea}>
        <SequenceBoard sequence={sequence} cursor={cursor} />
        <TurnOutcomeBanner outcome={turnOutcome} />
      </div>
      <ButtonPanel role={role} dueColor={dueColor} disabled={disabled} onPress={press} />
    </div>
  );
}
```

- [ ] **Step 2: 타입체크와 린트로 확인한다**

Run: `cd client && npx tsc -b && npm run lint`
Expected: 둘 다 에러 없이 종료.

- [ ] **Step 3: 커밋**

```bash
git add client/src/components/SoloPlayScreen.tsx
git commit -m "$(cat <<'EOF'
혼자 연습 플레이 화면 추가

useSoloMatch 훅과 기존 SequenceBoard/ButtonPanel/TurnOutcomeBanner/
TimerBar를 조합. 새 컴포넌트 로직은 없고 기존 컴포넌트를 그대로
재사용해서 조립만 함.
EOF
)"
```

---

## Task 5: App.tsx 모드 라우팅 연결 + 수동 검증

**Files:**
- Modify: `client/src/App.tsx`

**Interfaces:**
- Consumes: `useMatchRoom`(기존), `Game`(기존), `ModeSelect`/`SoloRoleSelect`/`SoloPlayScreen`(Task 3, 4), `Role`(`client/src/game/colors.ts`)
- Produces: 없음 (최상위 조립 지점)

- [ ] **Step 1: `client/src/App.tsx`를 모드 분기 구조로 교체한다**

`client/src/App.tsx` 전체를 아래로 교체한다:

```tsx
import { useState } from "react";
import { useMatchRoom } from "./game/useMatchRoom";
import { Game } from "./components/Game";
import { ModeSelect } from "./components/ModeSelect";
import { SoloRoleSelect } from "./components/SoloRoleSelect";
import { SoloPlayScreen } from "./components/SoloPlayScreen";
import type { Role } from "./game/colors";
import "./App.css";

type Mode = "select" | "online" | "offline";

function OnlineFlow() {
  const { room, status, leaveAndRejoin } = useMatchRoom();

  if (status !== "connected" || !room) {
    return (
      <main className="connecting">
        <h1>송편 만들기</h1>
        <p>server connection: {status}</p>
      </main>
    );
  }

  return <Game room={room} onLeave={leaveAndRejoin} />;
}

function OfflineFlow({ onExit }: { onExit: () => void }) {
  const [role, setRole] = useState<Role | null>(null);

  if (!role) {
    return <SoloRoleSelect onChoose={setRole} onBack={onExit} />;
  }

  return <SoloPlayScreen role={role} onExit={onExit} />;
}

function App() {
  const [mode, setMode] = useState<Mode>("select");

  if (mode === "online") return <OnlineFlow />;
  if (mode === "offline") return <OfflineFlow onExit={() => setMode("select")} />;

  return <ModeSelect onSelectOnline={() => setMode("online")} onSelectOffline={() => setMode("offline")} />;
}

export default App;
```

이 변경의 핵심: `useMatchRoom()`을 호출하던 코드가 `OnlineFlow`라는 별도 컴포넌트로 옮겨졌고, `App`은 `mode === "online"`일 때만 `<OnlineFlow />`를 렌더링한다. React는 마운트되지 않은 컴포넌트의 `useEffect`를 실행하지 않으므로, 사용자가 "온라인"을 고르기 전까지는 `joinMatch()`(서버 접속)가 아예 호출되지 않는다.

- [ ] **Step 2: 타입체크와 린트로 확인한다**

Run: `cd client && npx tsc -b && npm run lint`
Expected: 둘 다 에러 없이 종료.

- [ ] **Step 3: 개발 서버를 띄우고 브라우저로 전체 흐름을 확인한다**

Run (루트에서): `npm run dev`

브라우저에서 `http://localhost:5173`을 연다.

확인 항목:
1. **처음 화면이 "온라인"/"혼자 연습" 두 버튼인지** (자동으로 서버에 접속하는 이전 동작이 사라졌는지)
2. **"혼자 연습" 클릭 → 돼지/토끼 선택 화면**이 뜨는지, "← 뒤로"를 누르면 다시 모드 선택으로 돌아가는지
3. **돼지 선택 후**: ROUND 1부터 시작해서 시퀀스에 빨강/주황/노랑/보라만 나오는지 (초록/파랑/민트/분홍이 절대 안 섞이는지), 버튼패널도 왼쪽 삼각형만 채워지고 오른쪽 역삼각형은 보라 하나만 채워지는지
4. **일부러 오답을 눌러본다**: "실패" 배너가 뜨고, 그 배너가 원래 턴의 4초가 다 될 때까지 화면에 남아있다가 그 다음에 새 라운드로 넘어가는지 (바로 넘어가버리면 타이밍이 틀린 것)
5. **아무것도 안 누르고 4초를 기다려본다**: 실패 배너가 길게 안 뜨고 다음 라운드로 바로 넘어가는지 (타임아웃은 온라인 모드처럼 즉시 전환)
6. **정답을 전부 맞혀본다**: "성공!" 배너가 뜨고 바로 다음 라운드로 넘어가는지
7. **여러 라운드를 반복해도** 절구/생명이 안 보이고 게임오버 없이 계속 ROUND 숫자만 올라가는지
8. **"나가기"를 누르면** 모드 선택 화면으로 돌아가는지
9. **토끼로도 위 1~8을 반복**해서 민트/초록/파랑/분홍만 나오는지, 버튼패널이 오른쪽 역삼각형 전부 + 왼쪽 삼각형 하단좌(민트)만 채워지는지
10. **"온라인"을 눌렀을 때** 기존과 동일하게 서버에 접속해서 역할 선택(돼지 0/2 · 토끼 0/2)이 뜨는지 — 온라인 흐름이 이번 변경으로 깨지지 않았는지 확인

- [ ] **Step 4: 커밋**

```bash
git add client/src/App.tsx
git commit -m "$(cat <<'EOF'
로비에 온라인/혼자 연습 모드 분기 연결

App이 mode 상태로 ModeSelect/OnlineFlow/OfflineFlow를 분기. 기존
useMatchRoom() 호출은 OnlineFlow로 옮겨져서, "온라인"을 고르기 전까지는
서버 접속 자체가 일어나지 않음 (마운트 안 된 컴포넌트의 이펙트는
실행되지 않으므로). 브라우저로 온라인/솔로 양쪽 흐름 전체 수동 검증
완료.
EOF
)"
```

---

## Self-Review Notes

- **Spec coverage:** 요구사항 1(온라인/혼자 연습 분기) → Task 5. 요구사항 2(온라인 고르기 전 서버 미접속) → Task 5 (OnlineFlow 지연 마운트). 요구사항 3(역할 선택 후 역할 제한 시퀀스) → Task 1, 3. 요구사항 4(절구 없음, 무한 반복) → Task 2. 요구사항 5(4초 타이머/성공·실패 피드백) → Task 2, 4 (TimerBar/TurnOutcomeBanner 재사용). 요구사항 6("나가기") → Task 4, 5. 요구사항 7(기록 저장 안 함) → 별도 저장 로직을 아예 안 만듦으로써 충족(Task 2의 상태가 컴포넌트 언마운트 시 사라짐). 모두 커버됨.
- **Placeholder scan:** 없음 — 모든 스텝에 실제 코드/명령어 포함.
- **Type consistency:** `generateSoloSequence`/`sequenceLengthForRound`/`attemptSoloPress`(Task 1에서 정의) → `useSoloMatch`(Task 2)에서 동일한 이름으로 import. `useSoloMatch`의 반환 타입(`round, sequence, cursor, turnOutcome, turnEndsAt, press`) → `SoloPlayScreen`(Task 4)에서 구조분해로 그대로 사용. `SoloRoleSelect`의 `onChoose`/`onBack` prop명(Task 3) → `App.tsx`(Task 5)의 `OfflineFlow`에서 `onChoose={setRole} onBack={onExit}`로 일치. `ModeSelect`의 `onSelectOnline`/`onSelectOffline`(Task 3) → `App.tsx`(Task 5)에서 동일하게 연결.
