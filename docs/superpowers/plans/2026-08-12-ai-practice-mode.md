# AI 연습모드 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 방 생성 시 "AI 연습모드"를 켜면, 대기실에서 역할을 고른 사람의 반대 역할 자리를 서버가 직접
조종하는 봇("돼지 봇"/"토끼 봇")이 즉시 채워서, 실제 온라인 매치와 같은 조건(양쪽 역할 색이 섞인
진짜 시퀀스, 서버 권위형 판정)으로 혼자 연습할 수 있게 한다.

**Architecture:** `MatchRoom`(Colyseus 서버 권위형 룸) 안에 봇을 실제 Colyseus 클라이언트 없이
`state.players`에 직접 끼워넣는 "가짜 플레이어"로 구현한다. 봇의 자리 채우기는 `handleChooseRole`에
훅을 걸고, 봇의 버튼 입력은 커서 이동 시점마다 "지금 색이 봇 담당이면 거의 즉시 누른다"는 이벤트
기반 로직으로 처리한다. 판수/라운드/게임머니 집계는 방 레벨 플래그로 세 지급 지점에서 막는다.

**Tech Stack:** Colyseus(서버 권위형 룸/스키마), Node/TypeScript, Vitest + `@colyseus/testing`(서버
통합 테스트), React 19 + Vite(클라이언트), 기존 프로젝트 컨벤션(itemsEnabled와 동일한 boolean 옵션
전달 패턴).

## Global Constraints

- 클라이언트/서버는 별도 npm workspace — 타입 공유 없이 손으로 동기화 (`itemsEnabled`가 이미 이
  경로를 쓰고 있음).
- 봇은 실제 Colyseus 클라이언트가 아니므로 `this.clients`/`onJoin`/`recordEvent` 어느 것도 거치지
  않는다 — IP도, 입장/퇴장 로그도 남지 않는다(설계 문서에 명시된 의도된 동작).
- 봇의 버튼 입력은 안티스팸 가드(`isSpammedPress`)와 `lastPressAt` 갱신을 절대 거치지 않는다.
- AI 연습모드 매치는 `recordRolePlayed`/`recordRoundAchievement`/`addGameMoney` 어느 것도 호출하지
  않는다.
- 서버 쪽 순수 게임 로직 변경(`handlePressButton` 리팩터)은 기존 `MatchRoom.test.ts` 전체 스위트가
  회귀 없이 통과해야 한다 — 리팩터 후 반드시 전체 스위트를 돌려서 확인한다.

---

## 파일 구조

| 파일 | 역할 |
|---|---|
| `server/src/rooms/MatchRoom.ts` | 옵션 읽기, 봇 자리 채우기/재배치, 봇 자동 입력, 통계 제외 — 이번 작업의 거의 전부가 여기 |
| `server/src/rooms/MatchRoom.test.ts` | 기존 파일에 통합 테스트 추가 (이 프로젝트는 룸별 테스트 파일을 안 나눔 — 기존 컨벤션 유지) |
| `server/src/game/colors.ts` | 이미 존재하는 `colorRole` — import만 추가, 수정 없음 |
| `client/src/components/CreateRoomModal.tsx` | 체크박스 UI + 팀 수 잠금 |
| `client/src/components/RoomList.tsx` | `onCreateRoom` 콜백 시그니처에 옵션 한 개 추가 |
| `client/src/App.tsx` | `setJoinSpec` 호출에 옵션 전달 |
| `client/src/colyseus.ts` | `JoinSpec` 타입 + `connectToMatch`의 `client.create` 옵션 전달 |

---

### Task 1: 서버 — `aiPracticeMode` 옵션, 팀 수 강제, 다른 플레이어 입장 차단

**Files:**
- Modify: `server/src/rooms/MatchRoom.ts`
- Test: `server/src/rooms/MatchRoom.test.ts`

**Interfaces:**
- Produces: `MatchRoomOptions.aiPracticeMode?: unknown`, room 필드 `private aiPracticeMode: boolean`
  (Task 2~5가 이 필드를 그대로 참조한다).

- [ ] **Step 1: 실패하는 테스트 작성**

`MatchRoom.test.ts`의 `describe("MatchRoom", ...)` 블록 안, 기존 `"the lobby still rejects a join
once every player slot is taken"` 테스트 근처에 추가:

```ts
test("aiPracticeMode forces the room to exactly 1 team regardless of the requested teamCount", async () => {
  const room = await colyseus.createRoom<MatchState>("match", {
    aiPracticeMode: true,
    teamCount: 4,
    countdownTickMs: COUNTDOWN_TICK_MS,
    bonusItemRng: NEVER_BONUS_RNG,
  });

  expect(room.state.teams).toHaveLength(1);
});

test("aiPracticeMode rejects a second player joining once the first player is in", async () => {
  const room = await colyseus.createRoom<MatchState>("match", {
    aiPracticeMode: true,
    countdownTickMs: COUNTDOWN_TICK_MS,
    bonusItemRng: NEVER_BONUS_RNG,
  });
  await connectAsUser(colyseus, room, "혼자연습유저");
  await flush();

  await expect(connectAsUser(colyseus, room, "끼어들려는유저")).rejects.toThrow();
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd server && npx vitest run src/rooms/MatchRoom.test.ts -t "aiPracticeMode"`
Expected: 두 테스트 모두 FAIL — 첫 번째는 `teams`가 4개(기본 teamCount 그대로)라서, 두 번째는
`aiPracticeMode`를 아예 안 읽으므로 두 번째 클라이언트도 그냥 관전자로 들어가거나(관전 허용
기본값이 true라 join 자체는 안 막힘) reject가 안 일어나서.

- [ ] **Step 3: 구현**

`MatchRoomOptions` 인터페이스(`bonusItemRng?: Rng;` 바로 다음 줄)에 추가:

```ts
  // 체크 시 팀 수가 항상 1로 강제되고, 대기실에서 역할을 고른 사람의 반대 역할
  // 자리를 서버가 봇으로 즉시 채운다. true여야만 켜짐(그 외는 기본 꺼짐) —
  // itemsEnabled/allowSpectators와 같은 패턴.
  aiPracticeMode?: unknown;
```

클래스 필드 선언(`private itemsEnabled = true;` 바로 다음 줄)에 추가:

```ts
  private aiPracticeMode = false;
```

`onCreate`에서 `this.itemsEnabled = options.itemsEnabled !== false;` 다음 줄에 추가:

```ts
    this.aiPracticeMode = options.aiPracticeMode === true;
```

같은 `onCreate` 안, `const teamCount = sanitizeTeamCount(options.teamCount);` 줄을 다음으로 교체:

```ts
    const teamCount = this.aiPracticeMode ? 1 : sanitizeTeamCount(options.teamCount);
```

`onJoin`의 기존 정원 체크(`if (this.state.players.size >= this.playerCapacity) { throw new
Error("방이 가득 찼습니다."); }`) 바로 앞에 추가:

```ts
    if (this.aiPracticeMode && this.state.players.size >= 1) {
      throw new Error("이 방은 AI 연습 전용 방입니다.");
    }
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd server && npx vitest run src/rooms/MatchRoom.test.ts -t "aiPracticeMode"`
Expected: PASS (2 tests)

- [ ] **Step 5: 전체 스위트 회귀 확인**

Run: `cd server && npx vitest run src/rooms/MatchRoom.test.ts`
Expected: 기존 테스트 전부 그대로 PASS (이 Task는 새 옵션을 읽기만 할 뿐 기본 동작을 안 바꿈).

- [ ] **Step 6: 커밋**

```bash
git add server/src/rooms/MatchRoom.ts server/src/rooms/MatchRoom.test.ts
git commit -m "AI 연습모드: aiPracticeMode 옵션, 팀 수 강제, 다른 플레이어 입장 차단"
```

---

### Task 2: 서버 — 봇 자리 채우기

**Files:**
- Modify: `server/src/rooms/MatchRoom.ts`
- Test: `server/src/rooms/MatchRoom.test.ts`

**Interfaces:**
- Consumes: Task 1의 `this.aiPracticeMode`.
- Produces: `private syncBotForTeam(team: TeamState): void`, `private addBot(team: TeamState, role:
  "pig" | "rabbit"): void`, 상수 `BOT_SESSION_PREFIX = "bot-"`(파일 상단, 다른 모듈 레벨 상수들
  — `MAX_CLIENTS_WITH_SPECTATORS` 등 — 옆에 추가). Task 3이 `BOT_SESSION_PREFIX`를 그대로 참조한다.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
test("aiPracticeMode fills the opposite role with a bot the instant a player picks a role", async () => {
  const room = await colyseus.createRoom<MatchState>("match", {
    aiPracticeMode: true,
    countdownTickMs: COUNTDOWN_TICK_MS,
    bonusItemRng: NEVER_BONUS_RNG,
  });
  const client = await connectAsUser(colyseus, room, "혼자연습유저");
  client.send("chooseRole", { role: "pig" });
  await flush();

  const team = room.state.teams[0];
  expect(team.pigSessionId).toBe(client.sessionId);
  expect(team.rabbitSessionId).toBe("bot-rabbit");
  const bot = room.state.players.get("bot-rabbit");
  expect(bot?.nickname).toBe("토끼 봇");
  expect(bot?.role).toBe("rabbit");
  expect(bot?.teamId).toBe(team.id);

  await waitForCountdown();
  expect(room.state.phase).toBe("playing");
});

test("switching roles mid-lobby moves the bot to the newly-empty slot", async () => {
  const room = await colyseus.createRoom<MatchState>("match", {
    aiPracticeMode: true,
    countdownTickMs: COUNTDOWN_TICK_MS,
    bonusItemRng: NEVER_BONUS_RNG,
  });
  const client = await connectAsUser(colyseus, room, "혼자연습유저");
  client.send("chooseRole", { role: "pig" });
  await flush();

  client.send("chooseRole", { role: "rabbit" });
  await flush();

  const team = room.state.teams[0];
  expect(team.rabbitSessionId).toBe(client.sessionId);
  expect(team.pigSessionId).toBe("bot-pig");
  expect(room.state.players.has("bot-rabbit")).toBe(false);
  const bot = room.state.players.get("bot-pig");
  expect(bot?.nickname).toBe("돼지 봇");
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd server && npx vitest run src/rooms/MatchRoom.test.ts -t "bot"`
Expected: FAIL — `team.rabbitSessionId`가 `""`인 채로 남아있어서 카운트다운이 시작조차 안 되고,
`room.state.players.get("bot-rabbit")`도 `undefined`.

- [ ] **Step 3: 구현**

파일 상단 모듈 레벨 상수들(`const MAX_CLIENTS_WITH_SPECTATORS = 1000;` 근처)에 추가:

```ts
// 봇의 sessionId 접두사 — 실제 Colyseus가 발급하는 sessionId와 절대 겹치지 않는다.
const BOT_SESSION_PREFIX = "bot-";
```

`handleChooseRole` 안, `this.maybeStartGame();` 호출 바로 앞줄에 추가:

```ts
    this.syncBotForTeam(team);
```

`handleChooseRole` 메서드 바로 다음에 새 메서드 두 개 추가:

```ts
  // 역할을 바꿔 탄 경우까지 한 번에 처리하기 위해, 이 팀에 남아있던 예전 봇을
  // 먼저 전부 지우고 현재 빈 자리 기준으로 다시 채운다. aiPracticeMode가 아니면 no-op.
  private syncBotForTeam(team: TeamState) {
    if (!this.aiPracticeMode) return;

    for (const [sessionId, player] of this.state.players.entries()) {
      if (sessionId.startsWith(BOT_SESSION_PREFIX) && player.teamId === team.id) {
        this.state.players.delete(sessionId);
      }
    }

    if (team.pigSessionId === "" && team.rabbitSessionId !== "") {
      this.addBot(team, "pig");
    } else if (team.rabbitSessionId === "" && team.pigSessionId !== "") {
      this.addBot(team, "rabbit");
    }
  }

  private addBot(team: TeamState, role: "pig" | "rabbit") {
    const sessionId = `${BOT_SESSION_PREFIX}${role}`;
    const bot = new PlayerState();
    bot.sessionId = sessionId;
    bot.nickname = role === "pig" ? "돼지 봇" : "토끼 봇";
    bot.role = role;
    bot.teamId = team.id;
    this.state.players.set(sessionId, bot);
    if (role === "pig") team.pigSessionId = sessionId;
    else team.rabbitSessionId = sessionId;
  }
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd server && npx vitest run src/rooms/MatchRoom.test.ts -t "bot"`
Expected: PASS (2 tests)

- [ ] **Step 5: 전체 스위트 회귀 확인**

Run: `cd server && npx vitest run src/rooms/MatchRoom.test.ts`
Expected: 전부 PASS (아이템전이 아닌 `aiPracticeMode: false`인 기존 방들은 `syncBotForTeam`이
맨 첫 줄에서 바로 return하므로 영향 없음).

- [ ] **Step 6: 커밋**

```bash
git add server/src/rooms/MatchRoom.ts server/src/rooms/MatchRoom.test.ts
git commit -m "AI 연습모드: 역할 선택 시 반대 자리에 봇 자동 배치"
```

---

### Task 3: 서버 — 봇 자동 버튼 입력

**Files:**
- Modify: `server/src/rooms/MatchRoom.ts`
- Test: `server/src/rooms/MatchRoom.test.ts`

**Interfaces:**
- Consumes: Task 1의 `this.aiPracticeMode`, Task 2의 `BOT_SESSION_PREFIX`.
- Produces: `private resolvePress(player: PlayerState, activeTeam: TeamState, color: Color): void`,
  `private handleBotPress(sessionId: string, color: Color): void`, `private maybeTriggerBotPress():
  void`. `startTurn()`이 `maybeTriggerBotPress()`를 호출하도록 바뀐다 — 이후 Task에서 이 메서드들의
  이름이 바뀌면 안 됨(테스트가 직접 참조하지는 않지만 서로를 호출함).

- [ ] **Step 1: 실패하는 테스트 작성**

파일 상단 헬퍼 함수들(`completeActiveTurn` 바로 다음) 옆에 새 헬퍼 추가 — 사람 담당 색만 직접
누르고 봇 담당 색은 서버가 알아서 처리하길 기다린다:

```ts
  async function completeActiveTurnWithBot(
    room: ServerRoom<MatchState>,
    humanClient: ClientRoom<MatchState>,
    humanRole: "pig" | "rabbit",
    turnDurationMs: number,
  ) {
    while (room.state.cursor < room.state.sequence.length && !room.state.turnDecided) {
      const dueColor = room.state.sequence[room.state.cursor] as Color;
      const dueRole = colorRole(dueColor);
      const cursorBefore = room.state.cursor;
      if (dueRole === humanRole) {
        humanClient.send("pressButton", { color: dueColor });
        await wait(70); // 안티스팸 임계값(민트 35ms/돼지 5ms)보다 넉넉히 띄움
      }
      await waitUntil(() => room.state.cursor > cursorBefore || room.state.turnDecided);
    }
    await wait(turnDurationMs + 200);
  }
```

테스트 자체:

```ts
test("the bot presses its own colors automatically and completes the turn with the human", async () => {
  const room = await colyseus.createRoom<MatchState>("match", {
    aiPracticeMode: true,
    turnDurationMs: PRESS_HEAVY_TURN_MS,
    countdownTickMs: COUNTDOWN_TICK_MS,
    bonusItemRng: NEVER_BONUS_RNG,
  });
  const client = await connectAsUser(colyseus, room, "혼자연습유저");
  client.send("chooseRole", { role: "pig" });
  await flush();
  await waitForCountdown();

  await completeActiveTurnWithBot(room, client, "pig", PRESS_HEAVY_TURN_MS);

  expect(room.state.turnOutcome).toBe("success");
});

test("the bot's presses are not subject to the anti-macro spam guard", async () => {
  // 토끼 봇이 담당하는 민트런은 같은 버튼을 연달아 눌러야 하는 유일한 패턴이라,
  // 안티스팸 가드가 봇 입력에 걸리면 이 시퀀스가 절대 안 끝난다.
  const room = await colyseus.createRoom<MatchState>("match", {
    aiPracticeMode: true,
    turnDurationMs: PRESS_HEAVY_TURN_MS,
    countdownTickMs: COUNTDOWN_TICK_MS,
    bonusItemRng: NEVER_BONUS_RNG,
  });
  const client = await connectAsUser(colyseus, room, "혼자연습유저");
  client.send("chooseRole", { role: "pig" });
  await flush();
  await waitForCountdown();

  await completeActiveTurnWithBot(room, client, "pig", PRESS_HEAVY_TURN_MS);

  expect(room.state.turnOutcome).toBe("success");
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd server && npx vitest run src/rooms/MatchRoom.test.ts -t "bot presses"`
Expected: FAIL(타임아웃 또는 `turnOutcome`이 계속 `"pending"`) — 봇 담당 색 차례에서 아무도 안
누르니 커서가 멈추고, `waitUntil`이 결국 타임아웃 에러를 던짐.

- [ ] **Step 3: 구현**

`server/src/rooms/MatchRoom.ts` 상단 import 수정:

```ts
import { colorRole, type Color, type Role } from "../game/colors";
```

(기존 `import type { Color, Role } from "../game/colors";`를 위 줄로 교체 — `colorRole`은 값
export라 `type` 전용 import로는 못 가져옴.)

기존 `handlePressButton` 전체를 아래 세 메서드로 교체:

```ts
  private handlePressButton(client: Client, color: Color) {
    if (this.state.phase !== "playing") return;
    if (this.turnDecided) return;

    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const activeTeam = this.state.teams[this.state.activeTeamIndex];
    if (player.teamId !== activeTeam.id) return;

    const now = Date.now();
    const sinceLastPress = this.lastPressAt === null ? null : now - this.lastPressAt;
    this.lastPressAt = now;
    const blocked = isSpammedPress(color, sinceLastPress);

    const monitoredUserId = this.playerUserIds.get(client.sessionId);
    if (monitoredUserId !== undefined) {
      notifyPress(monitoredUserId, { color, sinceLastPressMs: sinceLastPress, blocked, timestamp: now });
    }

    if (blocked) {
      return;
    }

    this.resolvePress(player, activeTeam, color);
  }

  // 봇 전용 진입점 — 안티스팸 체크(isSpammedPress)와 lastPressAt 갱신을 의도적으로
  // 건너뛴다. 봇은 사람 옆에서 거의 즉시 누르므로 그 체크를 태우면 봇 입력 자체가
  // 막히거나, 봇 직후의 사람 정당 입력이 오인될 수 있다(maybeTriggerBotPress 참고).
  private handleBotPress(sessionId: string, color: Color) {
    if (this.state.phase !== "playing") return;
    if (this.turnDecided) return;

    const player = this.state.players.get(sessionId);
    if (!player) return;

    const activeTeam = this.state.teams[this.state.activeTeamIndex];
    if (player.teamId !== activeTeam.id) return;

    this.resolvePress(player, activeTeam, color);
  }

  // handlePressButton/handleBotPress 공통 판정 로직 — 안티스팸 체크가 끝난 뒤부터.
  private resolvePress(player: PlayerState, activeTeam: TeamState, color: Color) {
    const result = this.superMortarActiveThisTurn
      ? {
          correct: true,
          nextCursor: this.state.cursor + 1,
          complete: this.state.cursor + 1 >= this.state.sequence.length,
        }
      : attemptPress(
          this.state.sequence as unknown as Color[],
          this.state.cursor,
          color,
          player.role as Role,
        );

    if (!result.correct) {
      this.turnDecided = true;
      this.applyMortarLoss(activeTeam);
      this.state.turnOutcome = "fail";
      this.state.missedRole = player.role;
      return;
    }

    if (this.bonusItem !== null && this.state.cursor === this.bonusItem.index) {
      if (this.bonusItem.itemId === "mortarRestore") {
        activeTeam.mortars = gainMortar(activeTeam.mortars);
      } else if (player.inventory.length < 2) {
        player.inventory.push(this.bonusItem.itemId);
      }
    }

    this.state.cursor = result.nextCursor;
    activeTeam.combo += 1;
    if (result.complete) {
      this.turnDecided = true;
      this.state.turnOutcome = "success";
      this.creditTurnSuccess(activeTeam);
    } else {
      this.maybeTriggerBotPress();
    }
  }

  // 매 턴 시작 직후(첫 색), 그리고 매 정답 처리로 커서가 이동한 직후(resolvePress
  // 끝)마다 호출된다 — 지금 커서가 가리키는 색이 봇 담당이면 거의 즉시 누른다.
  // 민트런처럼 같은 담당자가 연속으로 눌러야 하는 구간도, 매 정답 처리마다 다시
  // 호출되는 구조라 자연스럽게 이어진다.
  private maybeTriggerBotPress() {
    if (!this.aiPracticeMode) return;
    if (this.state.cursor >= this.state.sequence.length) return;

    const activeTeam = this.state.teams[this.state.activeTeamIndex];
    const dueColor = this.state.sequence[this.state.cursor] as Color;
    const dueRole = colorRole(dueColor);
    const botSessionId = dueRole === "pig" ? activeTeam.pigSessionId : activeTeam.rabbitSessionId;
    if (!botSessionId.startsWith(BOT_SESSION_PREFIX)) return;

    const token = this.turnToken;
    this.clock.setTimeout(() => {
      if (token !== this.turnToken || this.turnDecided) return;
      this.handleBotPress(botSessionId, dueColor);
    }, BOT_PRESS_DELAY_MS);
  }
```

`server/src/rooms/MatchRoom.ts` 상단, 다른 시간 상수들(`const DEFAULT_TURN_DURATION_MS = 4000;`
근처)에 추가:

```ts
// 봇이 자기 색을 "누르기"까지의 지연 — 0ms 동시성 문제(같은 틱에서 재귀적으로 여러 턴/커서가
// 갱신되는 것)를 피하기 위한 최소값이지 사람처럼 보이려는 의도된 딜레이가 아니다.
const BOT_PRESS_DELAY_MS = 30;
```

마지막으로 `startTurn()` 메서드의 맨 끝(`this.turnTimer = this.clock.setTimeout(...)` 블록
바로 다음, 메서드를 닫는 `}` 직전)에 한 줄 추가:

```ts
    this.maybeTriggerBotPress();
```

- [ ] **Step 4: 새 테스트 통과 확인**

Run: `cd server && npx vitest run src/rooms/MatchRoom.test.ts -t "bot presses"`
Expected: PASS (2 tests)

- [ ] **Step 5: 전체 스위트 회귀 확인 (중요 — 공유 판정 로직을 리팩터했음)**

Run: `cd server && npx vitest run src/rooms/MatchRoom.test.ts`
Expected: 기존 테스트 전부 그대로 PASS. 하나라도 실패하면 `resolvePress`로 옮긴 로직이 원본
`handlePressButton`과 다르게 동작하는 것 — 원본 순서(플레이어 조회 → 팀 확인 → 안티스팸 →
판정)와 정확히 비교해서 고칠 것.

- [ ] **Step 6: 커밋**

```bash
git add server/src/rooms/MatchRoom.ts server/src/rooms/MatchRoom.test.ts
git commit -m "AI 연습모드: 봇이 자기 담당 색을 자동으로 누름"
```

---

### Task 4: 서버 — 판수/라운드/게임머니 집계 제외

**Files:**
- Modify: `server/src/rooms/MatchRoom.ts`
- Test: `server/src/rooms/MatchRoom.test.ts`

**Interfaces:**
- Consumes: Task 1의 `this.aiPracticeMode`, Task 2/3의 봇 자동 플레이(테스트가 실제로 턴을
  완료시키기 위해 필요).

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
test("aiPracticeMode matches award no game money, round credit, or play count", async () => {
  const room = await colyseus.createRoom<MatchState>("match", {
    aiPracticeMode: true,
    turnDurationMs: PRESS_HEAVY_TURN_MS,
    countdownTickMs: COUNTDOWN_TICK_MS,
    bonusItemRng: NEVER_BONUS_RNG,
  });
  const client = await connectAsUser(colyseus, room, "혼자연습유저");
  client.send("chooseRole", { role: "pig" });
  await flush();
  await waitForCountdown();

  await completeActiveTurnWithBot(room, client, "pig", PRESS_HEAVY_TURN_MS);
  expect(room.state.turnOutcome).toBe("success");

  const row = db
    .prepare(`SELECT game_money, max_round, pig_play_count, rabbit_play_count FROM users WHERE nickname = ?`)
    .get("혼자연습유저") as {
    game_money: number;
    max_round: number;
    pig_play_count: number;
    rabbit_play_count: number;
  };
  expect(row.game_money).toBe(0);
  expect(row.max_round).toBe(0);
  expect(row.pig_play_count).toBe(0);
  expect(row.rabbit_play_count).toBe(0);
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd server && npx vitest run src/rooms/MatchRoom.test.ts -t "award no game money"`
Expected: FAIL — `game_money`가 40(2팀 아님, 1팀이라 20원 × 1)이고 `pig_play_count`가 1.

- [ ] **Step 3: 구현**

`creditRound`, `creditTurnSuccess`, `recordRolePlaysStarted` 세 메서드 각각의 첫 줄에 추가:

```ts
  private creditRound(team: TeamState, round: number) {
    if (this.aiPracticeMode) return;
    for (const sessionId of [team.pigSessionId, team.rabbitSessionId]) {
      const userId = this.playerUserIds.get(sessionId);
      if (userId) recordRoundAchievement(userId, round);
    }
  }
```

```ts
  private creditTurnSuccess(team: TeamState) {
    if (this.aiPracticeMode) return;
    const reward = 20 * this.state.teams.length;
    for (const sessionId of [team.pigSessionId, team.rabbitSessionId]) {
      const userId = this.playerUserIds.get(sessionId);
      if (userId) addGameMoney(userId, reward);
    }
  }
```

```ts
  private recordRolePlaysStarted() {
    if (this.aiPracticeMode) return;
    for (const team of this.state.teams) {
      const pigUserId = this.playerUserIds.get(team.pigSessionId);
      if (pigUserId) recordRolePlayed(pigUserId, "pig");
      const rabbitUserId = this.playerUserIds.get(team.rabbitSessionId);
      if (rabbitUserId) recordRolePlayed(rabbitUserId, "rabbit");
    }
  }
```

(각 메서드의 나머지 본문은 그대로 — 맨 앞에 이른 return 한 줄만 추가.)

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd server && npx vitest run src/rooms/MatchRoom.test.ts -t "award no game money"`
Expected: PASS

- [ ] **Step 5: 전체 스위트 회귀 확인**

Run: `cd server && npx vitest run src/rooms/MatchRoom.test.ts`
Expected: 전부 PASS (일반 방은 `aiPracticeMode`가 항상 `false`라 이른 return에 안 걸림).

- [ ] **Step 6: 커밋**

```bash
git add server/src/rooms/MatchRoom.ts server/src/rooms/MatchRoom.test.ts
git commit -m "AI 연습모드: 판수/라운드/게임머니 집계 제외"
```

---

### Task 5: 클라이언트 — 방 생성 UI + 옵션 전달

**Files:**
- Modify: `client/src/components/CreateRoomModal.tsx`
- Modify: `client/src/components/RoomList.tsx`
- Modify: `client/src/App.tsx`
- Modify: `client/src/colyseus.ts`

**Interfaces:**
- Consumes: Task 1의 서버 `MatchRoomOptions.aiPracticeMode`.
- Produces: 없음(이번 계획의 마지막 Task) — UI 옵션이 서버까지 끝까지 흘러가는 것으로 기능 완성.

- [ ] **Step 1: `colyseus.ts`의 `JoinSpec` 타입 확장**

`client/src/colyseus.ts`의 `JoinSpec` 타입을:

```ts
export type JoinSpec =
  | { type: "create"; teamCount: number; roomTitle: string; allowSpectators: boolean; itemsEnabled: boolean }
  | { type: "joinById"; roomId: string }
  | { type: "reconnect" };
```

다음으로 교체:

```ts
export type JoinSpec =
  | {
      type: "create";
      teamCount: number;
      roomTitle: string;
      allowSpectators: boolean;
      itemsEnabled: boolean;
      aiPracticeMode: boolean;
    }
  | { type: "joinById"; roomId: string }
  | { type: "reconnect" };
```

같은 파일 `connectToMatch`의 `client.create` 호출을:

```ts
    const room = await client.create<T>("match", {
      teamCount: spec.teamCount,
      roomTitle: spec.roomTitle,
      allowSpectators: spec.allowSpectators,
      itemsEnabled: spec.itemsEnabled,
    });
```

다음으로 교체:

```ts
    const room = await client.create<T>("match", {
      teamCount: spec.teamCount,
      roomTitle: spec.roomTitle,
      allowSpectators: spec.allowSpectators,
      itemsEnabled: spec.itemsEnabled,
      aiPracticeMode: spec.aiPracticeMode,
    });
```

- [ ] **Step 2: `App.tsx`에서 옵션 전달**

`client/src/App.tsx`의:

```tsx
        onCreateRoom={(roomTitle, teamCount, allowSpectators, itemsEnabled) =>
          setJoinSpec({ type: "create", teamCount, roomTitle, allowSpectators, itemsEnabled })
        }
```

를:

```tsx
        onCreateRoom={(roomTitle, teamCount, allowSpectators, itemsEnabled, aiPracticeMode) =>
          setJoinSpec({ type: "create", teamCount, roomTitle, allowSpectators, itemsEnabled, aiPracticeMode })
        }
```

로 교체.

- [ ] **Step 3: `RoomList.tsx`의 `onCreateRoom` prop 시그니처 확장**

`client/src/components/RoomList.tsx`의:

```ts
  onCreateRoom: (title: string, teamCount: number, allowSpectators: boolean, itemsEnabled: boolean) => void;
```

를:

```ts
  onCreateRoom: (
    title: string,
    teamCount: number,
    allowSpectators: boolean,
    itemsEnabled: boolean,
    aiPracticeMode: boolean,
  ) => void;
```

로 교체. 같은 파일의 `CreateRoomModal` 렌더 부분:

```tsx
          onCreate={(title, teamCount, allowSpectators, itemsEnabled) => {
            setShowCreateModal(false);
            onCreateRoom(title, teamCount, allowSpectators, itemsEnabled);
          }}
```

를:

```tsx
          onCreate={(title, teamCount, allowSpectators, itemsEnabled, aiPracticeMode) => {
            setShowCreateModal(false);
            onCreateRoom(title, teamCount, allowSpectators, itemsEnabled, aiPracticeMode);
          }}
```

로 교체.

- [ ] **Step 4: `CreateRoomModal.tsx`에 체크박스 + 팀 수 잠금 추가**

`client/src/components/CreateRoomModal.tsx`의 `onCreate` prop 타입:

```ts
  onCreate: (title: string, teamCount: number, allowSpectators: boolean, itemsEnabled: boolean) => void;
```

를:

```ts
  onCreate: (
    title: string,
    teamCount: number,
    allowSpectators: boolean,
    itemsEnabled: boolean,
    aiPracticeMode: boolean,
  ) => void;
```

로 교체. `const [itemsEnabled, setItemsEnabled] = useState(true);` 다음 줄에 추가:

```ts
  const [aiPracticeMode, setAiPracticeMode] = useState(false);
```

`handleSubmit`의 `onCreate(trimmed, teamCount, allowSpectators, itemsEnabled);`를:

```ts
    onCreate(trimmed, teamCount, allowSpectators, itemsEnabled, aiPracticeMode);
```

로 교체. 팀 수 `<input>`에 `disabled={aiPracticeMode}` 추가:

```tsx
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
```

"아이템전" 체크박스(`<label className={styles.checkboxField}>...아이템전...</label>`) 바로
다음에 새 체크박스 추가:

```tsx
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
```

- [ ] **Step 5: 타입체크**

Run: `cd client && npx tsc -b`
Expected: 에러 없음.

Run: `cd server && npx tsc --noEmit`
Expected: 에러 없음.

- [ ] **Step 6: 로컬에서 수동 확인**

CLAUDE.md Gotcha대로, 이 앱은 로그인/세션 기능 확인을 위해 같은 오리진이 필요하다:

```bash
npm run sync-public
npm run dev:server
```

`http://localhost:2567` 접속 후:
1. "방 만들기" → "AI 연습모드" 체크 → 팀 수 입력란이 잠기고 1로 고정되는지 확인
2. 방 생성 → 대기실에서 "돼지" 선택 → "토끼 봇"이 즉시 반대 자리에 나타나고 바로 카운트다운이
   시작되는지 확인
3. 매치 진행 중 토끼 색이 나올 때 토끼 봇이 알아서 누르는지(사람은 돼지 색만 누르면 되는지)
   확인
4. 매치 종료 후 로비로 돌아가서 게임머니/최고라운드/판수가 안 올라갔는지 확인 (로비 하단
   프로필바에서 바로 보임)
5. 관리자 페이지(`/admin`)의 "활성 방" 목록에 "토끼 봇" 닉네임이 인원 목록에 뜨는지 확인

- [ ] **Step 7: 커밋**

```bash
git add client/src/components/CreateRoomModal.tsx client/src/components/RoomList.tsx client/src/App.tsx client/src/colyseus.ts
git commit -m "AI 연습모드: 방 생성 화면 체크박스 + 옵션 전달"
```

---

## 완료 후 전체 검증

- [ ] `cd server && npx vitest run` — 서버 전체 테스트 스위트 통과 (기존 `dailyVisits.test.ts`의
  날짜 하드코딩 관련 무관한 flaky 실패 1건은 이 계획과 무관하니 무시해도 됨).
- [ ] `cd server && npx tsc --noEmit`
- [ ] `cd client && npx tsc -b`
- [ ] `cd client && npx oxlint`
