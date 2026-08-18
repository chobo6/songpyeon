# 초보모드/돼지전/토끼전 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** songpyeon에 랭킹 미집계 + 게임머니 절반인 신규 대결 모드 3종(초보모드/돼지전/토끼전)을 추가한다.

**Architecture:** 방 생성 옵션에 `gameMode: "normal" | "beginner" | "pigOnly" | "rabbitOnly"` 축을 추가하고, 기존 `aiPracticeMode`가 이미 쓰는 "모드별 가드" 패턴(팀 생성 수, 시작 판정, 보상/랭킹 스킵)을 그대로 확장한다. 돼지전/토끼전은 "팀 = 참가자 1명"으로 모델링해서 기존 절구/탈락/턴순환 로직을 코드 변경 없이 재사용한다.

**Tech Stack:** Colyseus(서버 권위형 상태 동기화), TypeScript, Vitest, React 19.

**Spec:** `docs/superpowers/specs/2026-08-18-beginner-single-role-modes-design.md`

## Global Constraints

- 랭킹(TOP10, `users.max_round`) 집계: `normal`을 제외한 세 모드 전부 미집계.
- 게임머니(턴 성공 보상): `normal` 20원×팀수, 그 외 세 모드 10원×팀수(배율 공식은 공통).
- 판수(`pig_play_count`/`rabbit_play_count`): 네 모드 전부 정상 집계(가드 없음).
- 시작 줄수: normal 3 / beginner 2 / pigOnly 4 / rabbitOnly 2 (10라운드마다 +1줄, 공통).
- `pigOnly`/`rabbitOnly`는 참가 인원 2~4명(팀=1인), `aiPracticeMode`와 동시 사용 불가(서버가 강제로 끔).
- 서버가 클라이언트가 보낸 역할(`chooseRole`의 `role`)을 신뢰하지 않고, `pigOnly`/`rabbitOnly` 방에서는 항상 방의 고정 역할로 덮어쓴다.

---

## 서버 태스크

### Task 1: `gameMode` 타입 + sanitize 함수

**Files:**
- Create: `server/src/game/gameMode.ts`
- Test: `server/src/game/gameMode.test.ts`

**Interfaces:**
- Produces: `export type GameMode = "normal" | "beginner" | "pigOnly" | "rabbitOnly";`, `export function sanitizeGameMode(input: unknown): GameMode`

- [ ] **Step 1: Write the failing test**

```typescript
// server/src/game/gameMode.test.ts
import { describe, expect, test } from "vitest";
import { sanitizeGameMode } from "./gameMode";

describe("sanitizeGameMode", () => {
  test("accepts the four valid modes as-is", () => {
    expect(sanitizeGameMode("normal")).toBe("normal");
    expect(sanitizeGameMode("beginner")).toBe("beginner");
    expect(sanitizeGameMode("pigOnly")).toBe("pigOnly");
    expect(sanitizeGameMode("rabbitOnly")).toBe("rabbitOnly");
  });

  test("defaults to normal for missing/invalid input", () => {
    expect(sanitizeGameMode(undefined)).toBe("normal");
    expect(sanitizeGameMode(null)).toBe("normal");
    expect(sanitizeGameMode("banana")).toBe("normal");
    expect(sanitizeGameMode(123)).toBe("normal");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/game/gameMode.test.ts`
Expected: FAIL with "Cannot find module './gameMode'"

- [ ] **Step 3: Write minimal implementation**

```typescript
// server/src/game/gameMode.ts
export type GameMode = "normal" | "beginner" | "pigOnly" | "rabbitOnly";

const VALID_MODES: readonly GameMode[] = ["normal", "beginner", "pigOnly", "rabbitOnly"];

export function sanitizeGameMode(input: unknown): GameMode {
  return VALID_MODES.includes(input as GameMode) ? (input as GameMode) : "normal";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/game/gameMode.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/game/gameMode.ts server/src/game/gameMode.test.ts
git commit -m "gameMode 타입과 sanitizeGameMode 추가"
```

---

### Task 2: `sequenceLengthForRound`에 시작 줄수 파라미터 추가

**Files:**
- Modify: `server/src/game/sequenceLength.ts`
- Test: `server/src/game/sequenceLength.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces: `export function sequenceLengthForRound(round: number, startingRows?: number): number` (호출부가 두 번째 인자를 생략하면 기존과 동일하게 3줄 시작)

- [ ] **Step 1: Write the failing test**

`server/src/game/sequenceLength.test.ts`에 아래 테스트를 추가(기존 4개 테스트는 그대로 둠):

```typescript
  test("a custom startingRows overrides the default (2 rows = 12 buttons at round 1)", () => {
    expect(sequenceLengthForRound(1, 2)).toBe(12);
  });

  test("a custom startingRows still grows by one row every 10 rounds", () => {
    expect(sequenceLengthForRound(11, 4)).toBe(30); // 4행 시작 + 1행 = 5행 * 6
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/game/sequenceLength.test.ts`
Expected: FAIL — `sequenceLengthForRound(1, 2)`가 두 번째 인자를 무시하고 여전히 18을 반환.

- [ ] **Step 3: Write minimal implementation**

`server/src/game/sequenceLength.ts` 전체를 아래로 교체:

```typescript
const BUTTONS_PER_ROW = 6;
const DEFAULT_STARTING_ROWS = 3;
const ROUNDS_PER_ROW_INCREASE = 10;

export function sequenceLengthForRound(round: number, startingRows: number = DEFAULT_STARTING_ROWS): number {
  const rows = startingRows + Math.floor((round - 1) / ROUNDS_PER_ROW_INCREASE);
  return rows * BUTTONS_PER_ROW;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/game/sequenceLength.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/game/sequenceLength.ts server/src/game/sequenceLength.test.ts
git commit -m "sequenceLengthForRound에 시작 줄수 파라미터 추가"
```

---

### Task 3: 단일 역할 전용 시퀀스 생성기

**Files:**
- Modify: `server/src/game/sequence.ts`
- Test: `server/src/game/sequence.test.ts`

**Interfaces:**
- Consumes: `fragments.ts`의 `generatePigFragment`, `generateRabbitPairFragment`, `MINT_RUN_LENGTHS`, `mintRun`; `rng.ts`의 `pick`, `Rng`; `colors.ts`의 `Role`, `Color`
- Produces: `export function generateSingleRoleSequence(totalLength: number, rng: Rng, role: Role): Color[]`

- [ ] **Step 1: Write the failing test**

`server/src/game/sequence.test.ts`에 새 `describe` 블록을 파일 끝에 추가:

```typescript
describe("generateSingleRoleSequence", () => {
  test("pig role only ever produces base-color + purple pig fragments", () => {
    // 돼지 역할의 fragmentChoicesForRole은 선택지가 항상 1개뿐이라 pick(choices, rng)가
    // 값을 소비해도 결과는 항상 고정(0번째)이다 — 그래도 rng() 호출 자체는 일어난다.
    // 조각 하나(길이 2)당: [choice-pick(결과 무시, 0번 고정), base-color pick] 순서로 rng
    // 2번 소비. 4길이 = 조각 2개 = rng 4번: [0(choice, 무시), 0(red), 0.5(choice, 무시), 0(red)]
    const rng = queueRng([0, 0, 0.5, 0]);
    expect(generateSingleRoleSequence(4, rng, "pig")).toEqual(["red", "purple", "red", "purple"]);
  });

  test("rabbit role only ever produces mint runs or rabbit-pair fragments, never pig colors", () => {
    const sequence = generateSingleRoleSequence(300, Math.random, "rabbit");
    const validRabbitColors: Color[] = ["mint", "green", "blue", "pink"];
    sequence.forEach((color) => {
      expect(validRabbitColors).toContain(color);
    });
  });

  test("produces exactly the requested length for both roles", () => {
    expect(generateSingleRoleSequence(24, Math.random, "pig")).toHaveLength(24);
    expect(generateSingleRoleSequence(24, Math.random, "rabbit")).toHaveLength(24);
    expect(generateSingleRoleSequence(12, Math.random, "rabbit")).toHaveLength(12);
  });

  test("every pig base color is immediately followed by purple", () => {
    const sequence = generateSingleRoleSequence(300, Math.random, "pig");
    sequence.forEach((color, i) => {
      if (color === "red" || color === "orange" || color === "yellow") {
        expect(sequence[i + 1]).toBe("purple");
      }
    });
  });
});
```

`describe`/`test`와 함께 `generateSingleRoleSequence`, `type Role`, `Color`를 이미 있는 import 줄에 추가해야 함:

```typescript
import { generateSequence, generateSingleRoleSequence } from "./sequence";
import type { Color, Role } from "./colors";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/game/sequence.test.ts`
Expected: FAIL with "generateSingleRoleSequence is not exported" (또는 undefined 호출 에러)

- [ ] **Step 3: Write minimal implementation**

`server/src/game/sequence.ts`의 import 줄을 아래로 교체:

```typescript
import type { Color, Role } from "./colors";
import { generatePigFragment, generateRabbitPairFragment, MINT_RUN_LENGTHS, mintRun } from "./fragments";
import { pick, type Rng } from "./rng";
```

그리고 파일 맨 끝에 추가:

```typescript
// 돼지전/토끼전 전용 — 한 역할의 조각만으로 시퀀스를 채운다. 정상모드 generateSequence와
// 달리 역할 전환/스티키니스 개념 자체가 없다(팀에 반대 역할 플레이어가 없으므로).
function fragmentChoicesForRole(remaining: number, rng: Rng, role: Role): FragmentChoice[] {
  if (role === "pig") {
    return [() => generatePigFragment(rng)];
  }

  const choices: FragmentChoice[] = [];
  const validMintLengths = MINT_RUN_LENGTHS.filter((length) => length <= remaining);
  if (validMintLengths.length > 0) {
    choices.push(() => mintRun(pick(validMintLengths, rng)));
  }
  choices.push(() => generateRabbitPairFragment(rng));
  return choices;
}

export function generateSingleRoleSequence(totalLength: number, rng: Rng, role: Role): Color[] {
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/game/sequence.test.ts`
Expected: PASS (모든 기존 테스트 + 새 4개)

- [ ] **Step 5: Commit**

```bash
git add server/src/game/sequence.ts server/src/game/sequence.test.ts
git commit -m "돼지전/토끼전용 단일 역할 시퀀스 생성기 추가"
```

---

### Task 4: `MatchState.gameMode` 필드 + `MatchRoom.onCreate` 모드 반영

**Files:**
- Modify: `server/src/rooms/MatchState.ts`
- Modify: `server/src/rooms/MatchRoom.ts:1-22`(imports), `:51-100`(필드), `:139-192`(onCreate)
- Test: `server/src/rooms/MatchRoom.test.ts`

**Interfaces:**
- Consumes: Task 1의 `GameMode`, `sanitizeGameMode`
- Produces: `MatchState.gameMode: GameMode`(동기화됨), `MatchRoom.gameMode`(private), room 생성 옵션 `gameMode?: unknown`

- [ ] **Step 1: Write the failing test**

`server/src/rooms/MatchRoom.test.ts`에 새 `describe` 블록 추가(파일 끝, 기존 `describe("press monitoring", ...)` 다음):

```typescript
  describe("game modes", () => {
    test("gameMode defaults to normal and matches the requested mode otherwise", async () => {
      const normalRoom = await colyseus.createRoom<MatchState>("match");
      expect(normalRoom.state.gameMode).toBe("normal");

      const beginnerRoom = await colyseus.createRoom<MatchState>("match", { gameMode: "beginner" });
      expect(beginnerRoom.state.gameMode).toBe("beginner");
    });

    test("an invalid gameMode falls back to normal", async () => {
      const room = await colyseus.createRoom<MatchState>("match", { gameMode: "banana" });
      expect(room.state.gameMode).toBe("normal");
    });

    test("pigOnly/rabbitOnly rooms treat teamCount as headcount, clamped to a minimum of 2", async () => {
      const oneRequested = await colyseus.createRoom<MatchState>("match", {
        gameMode: "pigOnly",
        teamCount: 1,
      });
      expect(oneRequested.state.teams).toHaveLength(2);
      expect((oneRequested.metadata as { playerCapacity?: number })?.playerCapacity).toBe(2);

      const threeRequested = await colyseus.createRoom<MatchState>("match", {
        gameMode: "rabbitOnly",
        teamCount: 3,
      });
      expect(threeRequested.state.teams).toHaveLength(3);
      expect((threeRequested.metadata as { playerCapacity?: number })?.playerCapacity).toBe(3);
    });

    test("pigOnly/rabbitOnly ignore aiPracticeMode entirely", async () => {
      const room = await colyseus.createRoom<MatchState>("match", {
        gameMode: "pigOnly",
        aiPracticeMode: true,
        teamCount: 2,
      });
      expect(room.state.teams).toHaveLength(2);
      expect((room.metadata as { aiPracticeMode?: boolean })?.aiPracticeMode).toBe(false);
    });

    test("room title is prefixed per mode", async () => {
      const beginner = await colyseus.createRoom<MatchState>("match", {
        gameMode: "beginner",
        roomTitle: "제목",
      });
      expect((beginner.metadata as { roomTitle?: string })?.roomTitle).toBe("(초보모드) 제목");

      const pigOnly = await colyseus.createRoom<MatchState>("match", {
        gameMode: "pigOnly",
        roomTitle: "제목",
      });
      expect((pigOnly.metadata as { roomTitle?: string })?.roomTitle).toBe("(돼지전) 제목");

      const rabbitOnly = await colyseus.createRoom<MatchState>("match", {
        gameMode: "rabbitOnly",
        roomTitle: "제목",
      });
      expect((rabbitOnly.metadata as { roomTitle?: string })?.roomTitle).toBe("(토끼전) 제목");

      const both = await colyseus.createRoom<MatchState>("match", {
        gameMode: "beginner",
        aiPracticeMode: true,
        roomTitle: "제목",
      });
      expect((both.metadata as { roomTitle?: string })?.roomTitle).toBe("(연습모드) (초보모드) 제목");
    });
  });
```

(위 `room.metadata as { field?: type }` 캐스팅 패턴은 이 파일에 이미 있는
`"onCreate sets the room title in metadata immediately, before anyone joins"` 등 기존
테스트와 완전히 동일한 방식 — 그대로 따라 쓴 것.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/rooms/MatchRoom.test.ts -t "game modes"`
Expected: FAIL — `state.gameMode`가 `undefined`, `teams`가 기본 2개(요청한 인원수 무시), 제목에 접두사 없음.

- [ ] **Step 3: Write minimal implementation**

`server/src/rooms/MatchState.ts` — `import`에 `GameMode`, `phase` 필드 바로 아래에 필드 추가:

```typescript
import type { GameMode } from "../game/gameMode";
```

```typescript
export class MatchState extends Schema {
  @type("string") phase: Phase = "lobby";
  @type("string") gameMode: GameMode = "normal";
  // ...나머지 필드는 그대로
```

`server/src/rooms/MatchRoom.ts` — import 블록에 추가:

```typescript
import { sanitizeGameMode, type GameMode } from "../game/gameMode";
```

private 필드 블록(`private aiPracticeMode = false;` 바로 아래)에 추가:

```typescript
  private gameMode: GameMode = "normal";
```

`MatchRoomOptions` 인터페이스에 `teamCount?: unknown;` 바로 아래 추가:

```typescript
  gameMode?: unknown;
```

`onCreate`의 아래 블록:

```typescript
    this.aiPracticeMode = options.aiPracticeMode === true;
```

을 아래로 교체:

```typescript
    this.gameMode = sanitizeGameMode(options.gameMode);
    // pigOnly/rabbitOnly는 "봇이 반대 역할을 채운다"는 aiPracticeMode의 전제 자체가 성립하지
    // 않는다(방 전체가 같은 역할) — 무조건 꺼서 무시한다.
    this.aiPracticeMode =
      options.aiPracticeMode === true && this.gameMode !== "pigOnly" && this.gameMode !== "rabbitOnly";
```

그 아래 팀 생성 블록:

```typescript
    const teamCount = this.aiPracticeMode ? 1 : sanitizeTeamCount(options.teamCount);
    this.playerCapacity = teamCount * 2;
```

을 아래로 교체:

```typescript
    const isSingleRoleMode = this.gameMode === "pigOnly" || this.gameMode === "rabbitOnly";
    const rawTeamCount = this.aiPracticeMode ? 1 : sanitizeTeamCount(options.teamCount);
    // pigOnly/rabbitOnly는 "팀 = 참가자 1명"이라, 정상모드의 최소 1팀(=2명)이 아니라
    // 최소 2명(=2팀)을 보장해야 한다 — 1명짜리는 이미 있는 혼자연습 모드와 겹친다.
    const teamCount = isSingleRoleMode ? Math.max(2, rawTeamCount) : rawTeamCount;
    // 정상/초보모드는 팀당 2명(돼지+토끼)이라 인원 상한이 teamCount*2, pigOnly/rabbitOnly는
    // 팀당 1명이라 teamCount 그대로가 인원 상한.
    this.playerCapacity = isSingleRoleMode ? teamCount : teamCount * 2;
```

제목 접두사 블록:

```typescript
    const roomTitle = sanitizeRoomTitle(options.roomTitle);
    // AI 연습모드 방은 로비 목록에서 한눈에 구분되도록 제목 앞에 표시를 붙인다.
    this.roomTitle = (this.aiPracticeMode ? "(연습모드) " : "") + (roomTitle || "이름 없는 방");
```

을 아래로 교체:

```typescript
    const roomTitle = sanitizeRoomTitle(options.roomTitle);
    const gameModePrefix =
      this.gameMode === "beginner" ? "(초보모드) " :
      this.gameMode === "pigOnly" ? "(돼지전) " :
      this.gameMode === "rabbitOnly" ? "(토끼전) " : "";
    // AI 연습모드/게임모드 방은 로비 목록에서 한눈에 구분되도록 제목 앞에 표시를 붙인다.
    this.roomTitle = (this.aiPracticeMode ? "(연습모드) " : "") + gameModePrefix + (roomTitle || "이름 없는 방");
```

`state.gameMode`는 `setState(state)` 호출 전에 채워야 하므로, `const state = new MatchState();` 바로 다음 줄에 추가:

```typescript
    state.gameMode = this.gameMode;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/rooms/MatchRoom.test.ts -t "game modes"`
Expected: PASS (5 tests)

Run 전체 회귀도 확인: `cd server && npx vitest run src/rooms/MatchRoom.test.ts`
Expected: 기존 테스트 전부 그대로 PASS(특히 `onCreate defaults to 2 teams...`, `aiPracticeMode matches award no game money...` 등 teamCount/aiPracticeMode 관련 테스트).

- [ ] **Step 5: Commit**

```bash
git add server/src/rooms/MatchState.ts server/src/rooms/MatchRoom.ts server/src/rooms/MatchRoom.test.ts
git commit -m "gameMode 옵션을 방 생성에 반영(팀 생성 수, 제목 접두사, aiPracticeMode 배제)"
```

---

### Task 5: 준비 판정 + 역할 강제

**Files:**
- Modify: `server/src/rooms/MatchRoom.ts`(`maybeStartGame`, `handleChooseRole`)
- Test: `server/src/rooms/MatchRoom.test.ts`

**Interfaces:**
- Consumes: Task 4의 `this.gameMode`
- Produces: 없음(내부 동작 변경만)

- [ ] **Step 1: Write the failing test**

`describe("game modes", ...)` 블록 안에 추가:

```typescript
    test("pigOnly room auto-assigns the pig role and starts once every slot fills, with no explicit chooseRole", async () => {
      const room = await colyseus.createRoom<MatchState>("match", {
        gameMode: "pigOnly",
        teamCount: 2,
        countdownTickMs: COUNTDOWN_TICK_MS,
        bonusItemRng: NEVER_BONUS_RNG,
      });
      const clients: ClientRoom<MatchState>[] = [];
      for (const i of [0, 1]) {
        const client = await connectAsUser(colyseus, room, `돼지전${i}`);
        // rabbit을 보내도 서버가 무시하고 pig로 강제해야 한다.
        client.send("chooseRole", { role: "rabbit" });
        clients.push(client);
      }
      await flush();

      room.state.players.forEach((p) => {
        expect(p.role).toBe("pig");
      });
      room.state.teams.forEach((t) => {
        expect(t.pigSessionId).not.toBe("");
        expect(t.rabbitSessionId).toBe("");
      });

      await waitForCountdown();
      expect(room.state.phase).toBe("playing");
    });

    test("rabbitOnly room forces the rabbit role regardless of what the client sends", async () => {
      const room = await colyseus.createRoom<MatchState>("match", {
        gameMode: "rabbitOnly",
        teamCount: 2,
        countdownTickMs: COUNTDOWN_TICK_MS,
        bonusItemRng: NEVER_BONUS_RNG,
      });
      const client = await connectAsUser(colyseus, room, "토끼전0");
      client.send("chooseRole", { role: "pig" });
      await flush();

      expect(room.state.players.get(client.sessionId)!.role).toBe("rabbit");
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/rooms/MatchRoom.test.ts -t "game modes"`
Expected: FAIL — 역할이 여전히 "rabbit"/"pig"로 요청한 그대로 들어가고, `rabbitSessionId`도 채워져서 정상모드처럼 동작(2번째 클라이언트가 없어서 준비도 안 됨).

- [ ] **Step 3: Write minimal implementation**

`handleChooseRole` 맨 앞(`if (this.state.phase !== "lobby") return;` 이전)에 추가:

```typescript
  private handleChooseRole(client: Client, role: "pig" | "rabbit") {
    // 돼지전/토끼전은 역할이 방 전체에 고정돼 있다 — 클라이언트가 뭘 보내든 서버가
    // 무시하고 강제한다(스푸핑 방지, 서버 권위 원칙).
    if (this.gameMode === "pigOnly") role = "pig";
    else if (this.gameMode === "rabbitOnly") role = "rabbit";

    if (this.state.phase !== "lobby") return;
    // ...나머지 기존 로직 그대로
```

`maybeStartGame`의 준비 판정 줄:

```typescript
  private async maybeStartGame() {
    const ready = this.state.teams.every((t) => t.pigSessionId !== "" && t.rabbitSessionId !== "");
```

을 아래로 교체:

```typescript
  private async maybeStartGame() {
    const ready = this.state.teams.every((t) =>
      this.gameMode === "pigOnly"
        ? t.pigSessionId !== ""
        : this.gameMode === "rabbitOnly"
          ? t.rabbitSessionId !== ""
          : t.pigSessionId !== "" && t.rabbitSessionId !== "",
    );
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/rooms/MatchRoom.test.ts -t "game modes"`
Expected: PASS (7 tests)

전체 회귀: `cd server && npx vitest run src/rooms/MatchRoom.test.ts`
Expected: 전부 PASS — 특히 정상모드 role-switch/aiPracticeMode 관련 기존 테스트들이 `this.gameMode === "normal"`(기본값)이라 `t.pigSessionId !== "" && t.rabbitSessionId !== ""` 분기 그대로 타서 영향 없어야 함.

- [ ] **Step 5: Commit**

```bash
git add server/src/rooms/MatchRoom.ts server/src/rooms/MatchRoom.test.ts
git commit -m "돼지전/토끼전: 역할 강제 및 1슬롯 기준 시작 판정"
```

---

### Task 6: 모드별 시퀀스 생성 분기

**Files:**
- Modify: `server/src/rooms/MatchRoom.ts:5-6`(imports), `:837-841`(startTurn)
- Test: `server/src/rooms/MatchRoom.test.ts`

**Interfaces:**
- Consumes: Task 3의 `generateSingleRoleSequence`, Task 2의 `sequenceLengthForRound(round, startingRows)`
- Produces: 없음(내부 동작 변경만)

- [ ] **Step 1: Write the failing test**

`describe("game modes", ...)` 안에 추가:

```typescript
    test("pigOnly round 1 sequence is 24 buttons (4 rows) and contains only pig colors", async () => {
      const room = await colyseus.createRoom<MatchState>("match", {
        gameMode: "pigOnly",
        teamCount: 2,
        countdownTickMs: COUNTDOWN_TICK_MS,
        bonusItemRng: NEVER_BONUS_RNG,
      });
      for (const i of [0, 1]) {
        const client = await connectAsUser(colyseus, room, `돼지길이${i}`);
        client.send("chooseRole", { role: "pig" });
      }
      await flush();
      await waitForCountdown();

      expect(room.state.sequence).toHaveLength(24);
      const pigColors = ["red", "orange", "yellow", "purple"];
      room.state.sequence.forEach((color) => {
        expect(pigColors).toContain(color as string);
      });
    });

    test("rabbitOnly round 1 sequence is 12 buttons (2 rows) and contains only rabbit colors", async () => {
      const room = await colyseus.createRoom<MatchState>("match", {
        gameMode: "rabbitOnly",
        teamCount: 2,
        countdownTickMs: COUNTDOWN_TICK_MS,
        bonusItemRng: NEVER_BONUS_RNG,
      });
      for (const i of [0, 1]) {
        const client = await connectAsUser(colyseus, room, `토끼길이${i}`);
        client.send("chooseRole", { role: "rabbit" });
      }
      await flush();
      await waitForCountdown();

      expect(room.state.sequence).toHaveLength(12);
      const rabbitColors = ["mint", "green", "blue", "pink"];
      room.state.sequence.forEach((color) => {
        expect(rabbitColors).toContain(color as string);
      });
    });

    test("beginner round 1 sequence is 12 buttons (2 rows)", async () => {
      const room = await fillRolesAndStart({ gameMode: "beginner", teamCount: 1 });
      expect(room.room.state.sequence).toHaveLength(12);
    });
```

> `fillRolesAndStart`는 기본 2팀(4명)을 채우는 헬퍼라 위처럼 `teamCount: 1`을 넘기면 2명만
> 채워지는데, 이 헬퍼는 항상 `["pig", "rabbit", "pig", "rabbit"]` 4명을 시도하므로
> `teamCount: 1`과 함께 쓰면 3번째 클라이언트부터 빈 슬롯이 없어 실패한다 — 대신 아래처럼
> 직접 2명만 연결하는 방식으로 고쳐 쓸 것:

```typescript
    test("beginner round 1 sequence is 12 buttons (2 rows)", async () => {
      const room = await colyseus.createRoom<MatchState>("match", {
        gameMode: "beginner",
        teamCount: 1,
        countdownTickMs: COUNTDOWN_TICK_MS,
        bonusItemRng: NEVER_BONUS_RNG,
      });
      for (const [i, role] of (["pig", "rabbit"] as const).entries()) {
        const client = await connectAsUser(colyseus, room, `초보${i}`);
        client.send("chooseRole", { role });
      }
      await flush();
      await waitForCountdown();

      expect(room.state.sequence).toHaveLength(12);
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/rooms/MatchRoom.test.ts -t "game modes"`
Expected: FAIL — 세 테스트 다 길이가 18(기본 3줄)로 나옴, pigOnly/rabbitOnly는 상대 역할 색도 섞여 나옴.

- [ ] **Step 3: Write minimal implementation**

import 줄:

```typescript
import { generateSequence } from "../game/sequence";
```

을:

```typescript
import { generateSequence, generateSingleRoleSequence } from "../game/sequence";
```

로 교체. `startTurn()`의 아래 두 줄:

```typescript
    const length = sequenceLengthForRound(this.state.round);
    let sequence = generateSequence(length, Math.random, this.state.round);
```

을 아래로 교체:

```typescript
    const startingRows =
      this.gameMode === "beginner" ? 2 : this.gameMode === "pigOnly" ? 4 : this.gameMode === "rabbitOnly" ? 2 : 3;
    const length = sequenceLengthForRound(this.state.round, startingRows);
    let sequence =
      this.gameMode === "pigOnly"
        ? generateSingleRoleSequence(length, Math.random, "pig")
        : this.gameMode === "rabbitOnly"
          ? generateSingleRoleSequence(length, Math.random, "rabbit")
          : generateSequence(length, Math.random, this.state.round);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/rooms/MatchRoom.test.ts -t "game modes"`
Expected: PASS (10 tests)

전체 회귀: `cd server && npx vitest run src/rooms/MatchRoom.test.ts`
Expected: 전부 PASS — 정상모드(`this.gameMode === "normal"`)는 `startingRows=3`이라 기존 `sequenceLengthForRound(round)`(파라미터 생략)와 동일한 값이 나와야 함.

- [ ] **Step 5: Commit**

```bash
git add server/src/rooms/MatchRoom.ts server/src/rooms/MatchRoom.test.ts
git commit -m "모드별 시작 줄수 및 단일역할 시퀀스 분기 적용"
```

---

### Task 7: 게임머니/랭킹 가드

**Files:**
- Modify: `server/src/rooms/MatchRoom.ts`(`creditTurnSuccess`, `creditRound`)
- Test: `server/src/rooms/MatchRoom.test.ts`

**Interfaces:**
- Consumes: Task 4의 `this.gameMode`
- Produces: 없음(내부 동작 변경만)

- [ ] **Step 1: Write the failing test**

`describe("game modes", ...)` 안에 추가:

```typescript
    test("beginner/pigOnly/rabbitOnly pay 10 won per team instead of 20, but still credit play count", async () => {
      const room = await colyseus.createRoom<MatchState>("match", {
        gameMode: "pigOnly",
        teamCount: 2,
        turnDurationMs: PRESS_HEAVY_TURN_MS,
        countdownTickMs: COUNTDOWN_TICK_MS,
        bonusItemRng: NEVER_BONUS_RNG,
      });
      const clients: ClientRoom<MatchState>[] = [];
      for (const i of [0, 1]) {
        const client = await connectAsUser(colyseus, room, `보상${i}`);
        client.send("chooseRole", { role: "pig" });
        clients.push(client);
      }
      await flush();
      await waitForCountdown();

      await completeActiveTurn(room, clients, PRESS_HEAVY_TURN_MS);

      const row = db
        .prepare(`SELECT game_money, pig_play_count FROM users WHERE nickname = ?`)
        .get("보상0") as { game_money: number; pig_play_count: number };
      // 2팀 방이므로 10 * 2 = 20원.
      expect(row.game_money).toBe(20);
      expect(row.pig_play_count).toBe(1);
    });

    test("beginner/pigOnly/rabbitOnly never credit ranking (max_round)", async () => {
      const room = await colyseus.createRoom<MatchState>("match", {
        gameMode: "rabbitOnly",
        teamCount: 2,
        turnDurationMs: PRESS_HEAVY_TURN_MS,
        countdownTickMs: COUNTDOWN_TICK_MS,
        bonusItemRng: NEVER_BONUS_RNG,
      });
      const clients: ClientRoom<MatchState>[] = [];
      for (const i of [0, 1]) {
        const client = await connectAsUser(colyseus, room, `랭킹제외${i}`);
        client.send("chooseRole", { role: "rabbit" });
        clients.push(client);
      }
      await flush();
      await waitForCountdown();

      await completeActiveTurn(room, clients, PRESS_HEAVY_TURN_MS);

      const maxRound = (
        db.prepare(`SELECT max_round FROM users WHERE nickname = ?`).get("랭킹제외0") as { max_round: number }
      ).max_round;
      expect(maxRound).toBe(0);
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/rooms/MatchRoom.test.ts -t "game modes"`
Expected: FAIL — 보상이 40원(기존 20×2 그대로), `max_round`도 1로 집계됨.

- [ ] **Step 3: Write minimal implementation**

`creditTurnSuccess`:

```typescript
  private creditTurnSuccess(team: TeamState) {
    if (this.aiPracticeMode) return;
    const reward = 20 * this.state.teams.length;
```

을 아래로 교체:

```typescript
  private creditTurnSuccess(team: TeamState) {
    if (this.aiPracticeMode) return;
    const rate = this.gameMode === "normal" ? 20 : 10;
    const reward = rate * this.state.teams.length;
```

`private creditRound(team: TeamState, round: number)` 메서드 맨 앞 가드:

```typescript
  private creditRound(team: TeamState, round: number) {
    if (this.aiPracticeMode) return;
```

을 아래로 교체:

```typescript
  private creditRound(team: TeamState, round: number) {
    if (this.aiPracticeMode || this.gameMode !== "normal") return;
```

(`creditTurnSuccess`도 같은 이름의 가드 줄 `if (this.aiPracticeMode) return;`로 시작하므로,
에디터에서 두 메서드를 혼동하지 않도록 메서드 선언 줄(`private creditRound(team: TeamState, round: number) {`)까지
포함해서 정확히 찾을 것 — `creditRound`가 먼저, `creditTurnSuccess`가 파일에서 바로 그 다음에
나온다.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/rooms/MatchRoom.test.ts -t "game modes"`
Expected: PASS (12 tests)

전체 회귀: `cd server && npx vitest run src/rooms/MatchRoom.test.ts`
Expected: 전부 PASS — 특히 `"a successful turn credits game_money to both team members, scaled by team count"`(정상모드 40원)와 `"aiPracticeMode matches award no game money, round credit, or play count"`가 그대로 통과해야 함.

- [ ] **Step 5: Commit**

```bash
git add server/src/rooms/MatchRoom.ts server/src/rooms/MatchRoom.test.ts
git commit -m "초보/돼지전/토끼전: 게임머니 절반, 랭킹 미집계"
```

---

## 클라이언트 태스크

이 프로젝트의 클라이언트 컨벤션(CLAUDE.md)상 UI 배선(prop 전달) 자체에는 유닛 테스트를
안 쓰고 타입체크 + 수동 확인으로 검증한다. 아래 태스크들은 그 관례를 따른다 — 각 태스크
끝의 "검증"은 `npm run build --workspace client`(타입체크)로 대체한다.

### Task 8: 클라이언트 `GameMode` 타입

**Files:**
- Create: `client/src/game/gameMode.ts`
- Modify: `client/src/game/matchTypes.ts`

**Interfaces:**
- Produces: `export type GameMode = "normal" | "beginner" | "pigOnly" | "rabbitOnly";`, `MatchState.gameMode: GameMode`

- [ ] **Step 1: 파일 생성**

```typescript
// client/src/game/gameMode.ts
// Manually mirrors server/src/game/gameMode.ts's GameMode union — see
// matchTypes.ts's own comment for why (separate npm workspaces, no shared
// types package).
export type GameMode = "normal" | "beginner" | "pigOnly" | "rabbitOnly";
```

- [ ] **Step 2: `matchTypes.ts`에 필드 추가**

`client/src/game/matchTypes.ts` 맨 위 import 블록에 추가:

```typescript
import type { GameMode } from "./gameMode";
```

`MatchState` 인터페이스의 `phase: Phase;` 바로 아래에 추가:

```typescript
  gameMode: GameMode;
```

- [ ] **Step 3: 타입체크**

Run: `cd client && npx tsc -b`
Expected: 에러 없음(이 필드를 아직 아무도 안 읽으므로 새 에러가 날 이유가 없음).

- [ ] **Step 4: Commit**

```bash
git add client/src/game/gameMode.ts client/src/game/matchTypes.ts
git commit -m "클라이언트에 GameMode 타입 및 MatchState.gameMode 필드 추가"
```

---

### Task 9: 방 생성 시 `gameMode` 전달 배선

**Files:**
- Modify: `client/src/colyseus.ts`(`JoinSpec`, `connectToMatch`)

**Interfaces:**
- Consumes: Task 8의 `GameMode`
- Produces: `JoinSpec`의 `"create"` variant에 `gameMode: GameMode` 추가

- [ ] **Step 1: import 추가**

`client/src/colyseus.ts` 맨 위에 추가:

```typescript
import type { GameMode } from "./game/gameMode";
```

- [ ] **Step 2: `JoinSpec` 타입 수정**

```typescript
export type JoinSpec =
  | {
      type: "create";
      teamCount: number;
      roomTitle: string;
      allowSpectators: boolean;
      itemsEnabled: boolean;
      aiPracticeMode: boolean;
    }
```

을 아래로 교체:

```typescript
export type JoinSpec =
  | {
      type: "create";
      teamCount: number;
      roomTitle: string;
      allowSpectators: boolean;
      itemsEnabled: boolean;
      aiPracticeMode: boolean;
      gameMode: GameMode;
    }
```

- [ ] **Step 3: `connectToMatch`에서 서버로 전달**

```typescript
    const room = await client.create<T>("match", {
      teamCount: spec.teamCount,
      roomTitle: spec.roomTitle,
      allowSpectators: spec.allowSpectators,
      itemsEnabled: spec.itemsEnabled,
      aiPracticeMode: spec.aiPracticeMode,
    });
```

을 아래로 교체:

```typescript
    const room = await client.create<T>("match", {
      teamCount: spec.teamCount,
      roomTitle: spec.roomTitle,
      allowSpectators: spec.allowSpectators,
      itemsEnabled: spec.itemsEnabled,
      aiPracticeMode: spec.aiPracticeMode,
      gameMode: spec.gameMode,
    });
```

- [ ] **Step 4: 타입체크**

Run: `cd client && npx tsc -b`
Expected: **에러 발생** — `JoinSpec`의 `"create"` variant를 만드는 곳(`App.tsx`)이 아직
`gameMode`를 안 채워서 타입 에러가 남. 이게 정상이며, Task 11에서 App.tsx를 고치면 해소됨
(이 태스크 자체는 커밋 전 `App.tsx` 관련 에러만 있는지 확인하고 넘어갈 것).

- [ ] **Step 5: Commit**

```bash
git add client/src/colyseus.ts
git commit -m "JoinSpec에 gameMode 필드 추가, 방 생성 시 서버로 전달"
```

---

### Task 10: 방 생성 모달 — 모드 선택 UI

**Files:**
- Modify: `client/src/components/CreateRoomModal.tsx`

**Interfaces:**
- Consumes: Task 8의 `GameMode`
- Produces: `onCreate` 콜백 시그니처에 `gameMode: GameMode` 6번째 인자 추가

- [ ] **Step 1: 전체 파일 교체**

`client/src/components/CreateRoomModal.tsx` 전체를 아래로 교체:

```typescript
import { useState, type FormEvent } from "react";
import type { GameMode } from "../game/gameMode";
import styles from "./CreateRoomModal.module.css";

const MAX_TITLE_LENGTH = 20;
const MIN_TEAM_COUNT = 1;
const MAX_TEAM_COUNT = 4;
const MIN_SINGLE_ROLE_HEADCOUNT = 2;

const GAME_MODE_LABEL: Record<GameMode, string> = {
  normal: "일반",
  beginner: "초보",
  pigOnly: "돼지전",
  rabbitOnly: "토끼전",
};

export function CreateRoomModal({
  onCreate,
  onClose,
}: {
  onCreate: (
    title: string,
    teamCount: number,
    allowSpectators: boolean,
    itemsEnabled: boolean,
    aiPracticeMode: boolean,
    gameMode: GameMode,
  ) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [teamCount, setTeamCount] = useState(2);
  const [allowSpectators, setAllowSpectators] = useState(true);
  const [itemsEnabled, setItemsEnabled] = useState(true);
  const [aiPracticeMode, setAiPracticeMode] = useState(false);
  const [gameMode, setGameMode] = useState<GameMode>("normal");

  const isSingleRoleMode = gameMode === "pigOnly" || gameMode === "rabbitOnly";

  // 정상/초보모드는 "팀 수"(1~4), 돼지전/토끼전은 "인원수"(2~4, 팀=1인)라는 다른 의미를
  // 같은 입력칸이 표현한다 — 모드를 바꾸면 현재 값을 그 모드의 유효 범위로 다시 클램프한다.
  function handleGameModeChange(next: GameMode) {
    setGameMode(next);
    const nextIsSingleRole = next === "pigOnly" || next === "rabbitOnly";
    if (nextIsSingleRole) {
      setAiPracticeMode(false);
      setTeamCount((prev) => Math.max(MIN_SINGLE_ROLE_HEADCOUNT, prev));
    }
  }

  // Digits only, then clamp to the valid range for the current mode.
  function handleTeamCountChange(raw: string) {
    const digits = raw.replace(/\D/g, "");
    const min = isSingleRoleMode ? MIN_SINGLE_ROLE_HEADCOUNT : MIN_TEAM_COUNT;
    if (!digits) {
      setTeamCount(min);
      return;
    }
    const lastDigit = Number(digits[digits.length - 1]);
    setTeamCount(Math.min(MAX_TEAM_COUNT, Math.max(min, lastDigit)));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    onCreate(trimmed, teamCount, allowSpectators, itemsEnabled, aiPracticeMode, gameMode);
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <form className={styles.modal} onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <h2 className={styles.heading}>방 만들기</h2>
        <label className={styles.field}>
          <span>방 제목</span>
          <input
            className={styles.input}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={MAX_TITLE_LENGTH}
            placeholder="방 제목을 입력하세요"
            autoFocus
          />
        </label>
        <div className={styles.field}>
          <span>게임 모드</span>
          <div className={styles.checkboxField}>
            {(Object.keys(GAME_MODE_LABEL) as GameMode[]).map((mode) => (
              <label key={mode} className={styles.checkboxField}>
                <input
                  type="radio"
                  name="gameMode"
                  checked={gameMode === mode}
                  onChange={() => handleGameModeChange(mode)}
                />
                <span>{GAME_MODE_LABEL[mode]}</span>
              </label>
            ))}
          </div>
        </div>
        <label className={styles.field}>
          <span>{isSingleRoleMode ? `인원수 (${MIN_SINGLE_ROLE_HEADCOUNT}~${MAX_TEAM_COUNT})` : "팀 수 (1~4)"}</span>
          <input
            className={styles.input}
            type="text"
            inputMode="numeric"
            maxLength={1}
            value={teamCount}
            onChange={(e) => handleTeamCountChange(e.target.value)}
            onFocus={(e) => e.target.select()}
            disabled={aiPracticeMode}
          />
        </label>
        <label className={styles.checkboxField}>
          <input
            type="checkbox"
            checked={allowSpectators}
            onChange={(e) => setAllowSpectators(e.target.checked)}
          />
          <span>관전 허용</span>
        </label>
        <label className={styles.checkboxField}>
          <input type="checkbox" checked={itemsEnabled} onChange={(e) => setItemsEnabled(e.target.checked)} />
          <span>아이템전</span>
        </label>
        {!isSingleRoleMode && (
          <label className={styles.checkboxField}>
            <input
              type="checkbox"
              checked={aiPracticeMode}
              onChange={(e) => {
                setAiPracticeMode(e.target.checked);
                if (e.target.checked) setTeamCount(1);
              }}
            />
            <span>AI 연습모드</span>
          </label>
        )}
        <div className={styles.actions}>
          <button type="button" className={styles.cancelButton} onClick={onClose}>
            취소
          </button>
          <button type="submit" className={styles.submitButton} disabled={!title.trim()}>
            만들기
          </button>
        </div>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: 타입체크**

Run: `cd client && npx tsc -b`
Expected: 이 파일 자체는 에러 없음(호출부인 `RoomList.tsx`는 아직 시그니처가 안 맞아서
에러 — Task 11에서 해소).

- [ ] **Step 3: Commit**

```bash
git add client/src/components/CreateRoomModal.tsx
git commit -m "방 생성 모달에 게임 모드 라디오 버튼 추가"
```

---

### Task 11: `RoomList.tsx` / `App.tsx` — gameMode 프롭 배선

**Files:**
- Modify: `client/src/components/RoomList.tsx`
- Modify: `client/src/App.tsx`

**Interfaces:**
- Consumes: Task 8의 `GameMode`, Task 10의 `CreateRoomModal`의 새 `onCreate` 시그니처
- Produces: `RoomList`의 `onCreateRoom` prop 시그니처에 `gameMode: GameMode` 추가, `App.tsx`가 `JoinSpec`을 완전히 채움(Task 9의 타입 에러 해소)

- [ ] **Step 1: `RoomList.tsx` props 타입 수정**

```typescript
  onCreateRoom: (
    title: string,
    teamCount: number,
    allowSpectators: boolean,
    itemsEnabled: boolean,
    aiPracticeMode: boolean,
  ) => void;
```

을 아래로 교체:

```typescript
  onCreateRoom: (
    title: string,
    teamCount: number,
    allowSpectators: boolean,
    itemsEnabled: boolean,
    aiPracticeMode: boolean,
    gameMode: GameMode,
  ) => void;
```

파일 맨 위 import에 추가:

```typescript
import type { GameMode } from "../game/gameMode";
```

- [ ] **Step 2: `CreateRoomModal` 렌더 부분 수정**

`RoomList.tsx`에서 `<CreateRoomModal onCreate={...} />`를 렌더하는 부분(약 254번째 줄
부근, 정확한 위치는 파일에서 `CreateRoomModal` 검색):

```typescript
            onCreate={(title, teamCount, allowSpectators, itemsEnabled, aiPracticeMode) => {
              onCreateRoom(title, teamCount, allowSpectators, itemsEnabled, aiPracticeMode);
```

을 아래로 교체:

```typescript
            onCreate={(title, teamCount, allowSpectators, itemsEnabled, aiPracticeMode, gameMode) => {
              onCreateRoom(title, teamCount, allowSpectators, itemsEnabled, aiPracticeMode, gameMode);
```

(그 다음 줄들 — 예: `setShowCreateModal(false)` 등 — 은 그대로 둔다.)

- [ ] **Step 3: `App.tsx` 배선 수정**

```typescript
        onCreateRoom={(roomTitle, teamCount, allowSpectators, itemsEnabled, aiPracticeMode) =>
          setJoinSpec({ type: "create", teamCount, roomTitle, allowSpectators, itemsEnabled, aiPracticeMode })
        }
```

을 아래로 교체:

```typescript
        onCreateRoom={(roomTitle, teamCount, allowSpectators, itemsEnabled, aiPracticeMode, gameMode) =>
          setJoinSpec({
            type: "create",
            teamCount,
            roomTitle,
            allowSpectators,
            itemsEnabled,
            aiPracticeMode,
            gameMode,
          })
        }
```

- [ ] **Step 4: 타입체크**

Run: `cd client && npx tsc -b`
Expected: 에러 없음 — Task 9에서 발생했던 `JoinSpec` 관련 에러가 여기서 해소됨.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/RoomList.tsx client/src/App.tsx
git commit -m "gameMode를 CreateRoomModal에서 App.tsx의 JoinSpec까지 배선"
```

---

### Task 12: `RoleSelect.tsx` — 단일 역할 모드에서 버튼/로스터 1칸만 표시

**Files:**
- Modify: `client/src/components/RoleSelect.tsx`

**Interfaces:**
- Consumes: `room.state.gameMode`(Task 4/8에서 서버가 채우고 클라이언트가 읽을 수 있게 됨)
- Produces: 없음(UI만 변경)

- [ ] **Step 1: `gameMode` 읽기**

`const myRole = me?.role;` 바로 아래에 추가:

```typescript
  const gameMode = room.state.gameMode;
```

- [ ] **Step 2: 역할 선택 버튼 분기**

```typescript
      <div className={styles.choices}>
        <button
          className={`${styles.roleButton} ${styles.pigButton} ${myRole === "pig" ? styles.selected : ""} ${myRole && myRole !== "pig" ? styles.dimmed : ""}`}
          onClick={() => choose("pig")}
          disabled={room.state.countdownSecondsLeft > 0}
        >
          <img className={styles.roleIcon} src="/game-assets/ui/thanksgiving_room_start_player_pig.png" alt="" />
          <span>돼지</span>
        </button>
        <button
          className={`${styles.roleButton} ${styles.rabbitButton} ${myRole === "rabbit" ? styles.selected : ""} ${myRole && myRole !== "rabbit" ? styles.dimmed : ""}`}
          onClick={() => choose("rabbit")}
          disabled={room.state.countdownSecondsLeft > 0}
        >
          <img className={styles.roleIcon} src="/game-assets/ui/thanksgiving_room_start_player_rabbit.png" alt="" />
          <span>토끼</span>
        </button>
      </div>
```

을 아래로 교체:

```typescript
      <div className={styles.choices}>
        {gameMode !== "rabbitOnly" && (
          <button
            className={`${styles.roleButton} ${styles.pigButton} ${myRole === "pig" ? styles.selected : ""} ${myRole && myRole !== "pig" ? styles.dimmed : ""}`}
            onClick={() => choose("pig")}
            disabled={room.state.countdownSecondsLeft > 0}
          >
            <img className={styles.roleIcon} src="/game-assets/ui/thanksgiving_room_start_player_pig.png" alt="" />
            <span>돼지{gameMode === "pigOnly" ? "로 참가" : ""}</span>
          </button>
        )}
        {gameMode !== "pigOnly" && (
          <button
            className={`${styles.roleButton} ${styles.rabbitButton} ${myRole === "rabbit" ? styles.selected : ""} ${myRole && myRole !== "rabbit" ? styles.dimmed : ""}`}
            onClick={() => choose("rabbit")}
            disabled={room.state.countdownSecondsLeft > 0}
          >
            <img className={styles.roleIcon} src="/game-assets/ui/thanksgiving_room_start_player_rabbit.png" alt="" />
            <span>토끼{gameMode === "rabbitOnly" ? "로 참가" : ""}</span>
          </button>
        )}
      </div>
```

- [ ] **Step 3: 로스터 표시 분기**

```typescript
            <div key={team.id} className={styles.rosterTeam}>
              {team.pigSessionId ? (
```

이 시작하는 `return (...)` 블록에서, 돼지 슬롯 렌더링 전체(`{team.pigSessionId ? (...) : (...)}`)를
`{gameMode !== "rabbitOnly" && (...)}`로, 토끼 슬롯 렌더링 전체를
`{gameMode !== "pigOnly" && (...)}`로 감싼다:

```typescript
            <div key={team.id} className={styles.rosterTeam}>
              {gameMode !== "rabbitOnly" &&
                (team.pigSessionId ? (
                  <button
                    className={`${styles.rosterName} ${pigEffect.className}`}
                    style={pigEffect.style}
                    onClick={() => setProfileNickname(nicknameFor(team.pigSessionId))}
                  >
                    {nicknameFor(team.pigSessionId)}
                    {pigEffect.particles.map((d) => (
                      <span key={d.key} className={d.className} style={d.style} />
                    ))}
                  </button>
                ) : (
                  <span className={styles.rosterName}>{nicknameFor(team.pigSessionId)}</span>
                ))}
              {gameMode !== "pigOnly" &&
                (team.rabbitSessionId ? (
                  <button
                    className={`${styles.rosterName} ${rabbitEffect.className}`}
                    style={rabbitEffect.style}
                    onClick={() => setProfileNickname(nicknameFor(team.rabbitSessionId))}
                  >
                    {nicknameFor(team.rabbitSessionId)}
                    {rabbitEffect.particles.map((d) => (
                      <span key={d.key} className={d.className} style={d.style} />
                    ))}
                  </button>
                ) : (
                  <span className={styles.rosterName}>{nicknameFor(team.rabbitSessionId)}</span>
                ))}
            </div>
```

- [ ] **Step 4: 타입체크**

Run: `cd client && npx tsc -b`
Expected: 에러 없음.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/RoleSelect.tsx
git commit -m "RoleSelect: 돼지전/토끼전에서 반대 역할 버튼/로스터 슬롯 숨김"
```

---

### Task 13: 전체 검증

**Files:** 없음(검증 전용)

- [ ] **Step 1: 서버 전체 테스트**

Run: `cd server && npm test`
Expected: 전부 PASS(`dailyVisits.test.ts`의 기존 날짜 하드코딩 결함은 이번 작업과 무관하니 무시 가능 — 이미 알려진 pre-existing 이슈).

- [ ] **Step 2: 서버/클라이언트 타입체크**

Run: `cd server && npm run build` (타입체크만, `tsc --noEmit`)
Run: `cd client && npm run build`
Expected: 둘 다 에러 없음.

- [ ] **Step 3: 수동 확인 (same-origin 빌드로)**

```bash
npm run sync-public
npm run dev:server
```

`http://localhost:2567`에서:
1. "온라인" → "방 만들기" → 게임 모드 "돼지전" 선택 → 인원수 2로 방 생성.
2. 두 번째 계정으로 같은 방 입장(관리자 페이지 없이 시크릿 창 등으로 재로그인해도 되고,
   `docs/superpowers/specs/2026-08-18-beginner-single-role-modes-design.md` 작성 때 썼던
   테스트 계정 시딩 방식 참고해도 됨) — 자동으로 돼지 역할로 배정되고, 2번째 사람이 들어오는
   순간 3-2-1 카운트다운이 도는지 확인.
3. 시작된 매치의 시퀀스가 돼지 색(빨강/주황/노랑/보라)만 나오는지 화면에서 확인.
4. "초보모드", "토끼전"도 각각 방을 만들어 같은 방식으로 확인.
5. 관리자 페이지(`/admin`)에서 방금 만든 방들의 제목 앞에 "(돼지전)"/"(토끼전)"/"(초보모드)"
   접두사가 붙어 보이는지 확인.

- [ ] **Step 4: 최종 커밋(문서화 등 사소한 정리가 있었다면)**

이 태스크 자체는 코드 변경이 없으므로 커밋 불필요 — Step 1~3에서 문제가 발견되면 해당
태스크로 돌아가 고치고 그 태스크 안에서 커밋한다.
