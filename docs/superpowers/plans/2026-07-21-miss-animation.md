# 오답 시 역할별 miss 애니메이션 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 온라인 매치에서 오답으로 턴이 실패했을 때, 틀린 토큰의 빨간 테두리를 실제로 잘못 누른 플레이어의 역할(돼지/토끼)에 맞는 16프레임 miss 애니메이션으로 완전히 대체한다.

**Architecture:** 서버가 `MatchState.missedRole`에 "실제로 잘못된 버튼을 보낸 플레이어의 역할"을 기록한다(어느 색이 원래 그 역할 것인지가 아니라, 실제 프레스를 보낸 사람 기준). 시간초과 경로는 이 필드를 건드리지 않아 자동으로 빈 값으로 남는다. 클라이언트는 이 값이 있을 때만 `SequenceBoard`의 틀린 토큰 자리에 해당 역할의 miss 프레임을 순환 표시한다.

**Tech Stack:** Colyseus Schema(서버 상태), React(클라이언트). 이미 존재하는 에셋(`client/public/game-assets/ui/miss/thanksgiving_room_miss_{pig,rabbit}{0-15}.webp`)을 그대로 사용 — 새 에셋 없음.

## Global Constraints

- 온라인 매치에만 적용 — 혼자 연습 모드는 건드리지 않는다.
- 실제 오답(누군가 잘못 누름)일 때만 애니메이션을 띄운다. 시간초과 시엔 아무 강조도 없음(기존 "실패" 텍스트 배너만 뜸).
- 역할 판정 기준은 **실제로 잘못된 버튼을 누른 플레이어의 역할**이다(그 색이 원래 누구 것인지가 아님).
- 기존 빨간 테두리(`.missed`)는 완전히 제거하고 이 애니메이션으로 대체한다 — 둘이 같이 뜨지 않는다.
- 애니메이션은 틀린 토큰이 있던 자리·크기에 그대로 나타난다.
- 16프레임은 실패 표시가 떠있는 동안 계속 반복 재생한다(80ms 간격).

---

### Task 1: 서버 — `missedRole` 상태 추가

**Files:**
- Modify: `server/src/rooms/MatchState.ts`
- Modify: `server/src/rooms/MatchRoom.ts`
- Test: `server/src/rooms/MatchRoom.test.ts`

**Interfaces:**
- Consumes: 없음(이 태스크가 시작점).
- Produces: `MatchState.missedRole: RoleChoice`(`"pig" | "rabbit" | ""`) — Task 2가 클라이언트 타입(`matchTypes.ts`)과 `SequenceBoard`에서 이 필드를 읽는다.

- [ ] **Step 1: 실패하는 테스트 작성**

`server/src/rooms/MatchRoom.test.ts`의 `test("a wrong button loses a mortar immediately...")` 테스트(약 607번째 줄) 바로 뒤에 3개 테스트 추가:

```ts
  test("a wrong button records the presser's own role as missedRole", async () => {
    const { room, clients } = await fillRolesAndStart({ turnDurationMs: SHORT_TURN_MS });
    const { dueColor, actingClient } = actingClientFor(room, clients);
    const pressingRole = colorRole(dueColor);
    const wrongColor = ALL_COLORS.find((c) => c !== dueColor)!;

    actingClient.send("pressButton", { color: wrongColor });
    await flush();

    expect(room.state.missedRole).toBe(pressingRole);
  });

  test("a wrong button sent by the OTHER role (out of turn) records THEIR role, not the due color's role", async () => {
    const { room, clients } = await fillRolesAndStart({ turnDurationMs: SHORT_TURN_MS });
    const { activeTeam, dueColor } = actingClientFor(room, clients);
    const dueRole = colorRole(dueColor);
    const otherRole = dueRole === "pig" ? "rabbit" : "pig";
    const otherSessionId = otherRole === "pig" ? activeTeam.pigSessionId : activeTeam.rabbitSessionId;
    const otherClient = clients.find((c) => c.sessionId === otherSessionId)!;
    // The other role can only ever send their own colors from their own
    // button panel — sending any of those while it's not their turn (the
    // due color belongs to dueRole) can never equal dueColor, so it's
    // always a wrong press.
    const otherRoleColors = otherRole === "pig" ? PIG_COLORS : RABBIT_COLORS;

    otherClient.send("pressButton", { color: otherRoleColors[0] });
    await flush();

    expect(room.state.turnOutcome).toBe("fail");
    expect(room.state.missedRole).toBe(otherRole);
  });

  test("missedRole resets to empty once the next turn starts", async () => {
    const { room, clients } = await fillRolesAndStart({ turnDurationMs: SHORT_TURN_MS });
    const { dueColor, actingClient } = actingClientFor(room, clients);
    const wrongColor = ALL_COLORS.find((c) => c !== dueColor)!;

    actingClient.send("pressButton", { color: wrongColor });
    await flush();
    expect(room.state.missedRole).not.toBe("");

    await wait(SHORT_TURN_MS + 200);

    expect(room.state.missedRole).toBe("");
  });
```

(이 파일은 이미 `PIG_COLORS`, `RABBIT_COLORS`, `colorRole`을 `../game/colors`에서 import하고 있으므로 새 import는 필요 없다 — 파일 상단의
`import { PIG_COLORS, RABBIT_COLORS, colorRole, type Color } from "../game/colors";` 확인.)

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npm test --workspace server -- MatchRoom.test.ts`
Expected: FAIL — `room.state.missedRole` is `undefined`(스키마에 필드가 아직 없음)

- [ ] **Step 3: 구현**

`server/src/rooms/MatchState.ts`의 `MatchState` 클래스에서 `turnOutcome` 필드 바로 다음 줄에 추가:

```ts
  @type("string") turnOutcome: TurnOutcome = "pending";
  // 오답으로 턴이 실패했을 때, 그 색이 원래 누구 것인지가 아니라 실제로 잘못된
  // 버튼을 누른 플레이어의 역할을 기록한다(handlePressButton 참고) — 클라이언트가
  // 그 역할의 miss 애니메이션을 보여주는 데 씀. 시간초과로 실패한 경우는 대상이
  // 없으므로 빈 문자열로 남는다(onTurnTimerExpired는 이 필드를 건드리지 않음).
  @type("string") missedRole: RoleChoice = "";
```

`server/src/rooms/MatchRoom.ts`의 `startTurn()`에서 `this.state.turnOutcome = "pending";` 바로 다음 줄에 추가:

```ts
    this.state.turnOutcome = "pending";
    this.state.missedRole = "";
```

`server/src/rooms/MatchRoom.ts`의 `handlePressButton()`에서 오답 분기를 아래로 교체:

```ts
    if (!result.correct) {
      this.turnDecided = true;
      this.applyMortarLoss(activeTeam);
      this.state.turnOutcome = "fail";
      // player.role is already typed RoleChoice on PlayerState — no cast needed.
      this.state.missedRole = player.role;
      // Turn hand-off is intentionally deferred to onTurnTimerExpired, at the
      // turn's original 4s mark, so the fail state stays on screen instead of
      // instantly cutting to the next team.
      return;
    }
```

이 파일은 `PlayerState`를 이미 `./MatchState`에서 import하고 있고 `RoleChoice`는 별도 import 없이도 `player.role`의 타입으로 이미 쓰이고 있으므로, import 문 변경은 필요 없다.

- [ ] **Step 4: 테스트 통과 확인 + 타입체크**

Run: `npm test --workspace server -- MatchRoom.test.ts`
Expected: PASS (전체 테스트, 새로 추가한 3개 포함)

Run: `npm run build --workspace server`
Expected: 에러 없음

- [ ] **Step 5: 전체 서버 테스트 스위트 통과 확인**

Run: `npm test --workspace server`
Expected: PASS (전체 테스트 파일)

- [ ] **Step 6: 커밋**

```bash
git add server/src/rooms/MatchState.ts server/src/rooms/MatchRoom.ts server/src/rooms/MatchRoom.test.ts
git commit -m "오답 시 실제로 잘못 누른 플레이어의 역할을 MatchState.missedRole에 기록"
```

---

### Task 2: 클라이언트 — miss 애니메이션 렌더링

**Files:**
- Modify: `client/src/game/matchTypes.ts`
- Modify: `client/src/components/SequenceBoard.tsx`
- Modify: `client/src/components/SequenceBoard.module.css`
- Modify: `client/src/components/MyTurnScreen.tsx`
- Modify: `client/src/components/SpectatorScreen.tsx`

**Interfaces:**
- Consumes: Task 1의 `MatchState.missedRole: RoleChoice`(서버 스키마에 이미 존재).
- Produces: 없음 (UI 최종 단계).

이 프로젝트의 client 워크스페이스는 테스트 프레임워크가 없다(`npm run build`/`npm run lint`가 검증 수단).

- [ ] **Step 1: 클라이언트 타입에 `missedRole` 추가**

`client/src/game/matchTypes.ts`의 `MatchState` 인터페이스에서 `turnOutcome: TurnOutcome;` 바로 다음 줄에 추가:

```ts
export interface MatchState {
  phase: Phase;
  countdownSecondsLeft: number;
  round: number;
  players: Map<string, PlayerState>;
  teams: TeamState[];
  activeTeamIndex: number;
  sequence: Color[];
  cursor: number;
  turnEndsAt: number;
  turnOutcome: TurnOutcome;
  missedRole: RoleChoice;
  lobbyChat: ChatMessage[];
  matchChat: ChatMessage[];
  spectators: Map<string, SpectatorState>;
}
```

- [ ] **Step 2: `SequenceBoard.tsx`에 `missedRole` prop과 miss 애니메이션 컴포넌트 추가**

`client/src/components/SequenceBoard.tsx` 전체를 아래로 교체:

```tsx
import { memo, useEffect, useState } from "react";
import type { Color, Role } from "../game/colors";
import { COLOR_TOKEN, COLOR_TOKEN_OFF } from "../game/colors";
import type { RoleChoice, TurnOutcome } from "../game/matchTypes";
import styles from "./SequenceBoard.module.css";

const TOKENS_PER_ROW = 6;
const MISS_FRAME_COUNT = 16;
const MISS_FRAME_INTERVAL_MS = 80;

function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    rows.push(items.slice(i, i + size));
  }
  return rows;
}

// Cycles through the 16 miss-reaction frames for the role that actually
// pressed the wrong button. Kept as its own tiny component (rather than
// inline state on Token) so the 80ms re-render this causes is scoped to
// just this one instance — the missed token — not the whole board. Token
// itself stays memoized and cheap to re-render for the other ~30 tokens
// (see Token's own comment below for why that matters).
function MissFrame({ role }: { role: Role }) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    setFrame(0);
    const id = setInterval(() => setFrame((f) => (f + 1) % MISS_FRAME_COUNT), MISS_FRAME_INTERVAL_MS);
    return () => clearInterval(id);
  }, [role]);
  return (
    <div
      className={styles.missToken}
      style={{ backgroundImage: `url(/game-assets/ui/miss/thanksgiving_room_miss_${role}${frame}.webp)` }}
    />
  );
}

// Every press re-renders the whole board (colyseus mutates its schema
// state in place, so the client forces a re-render on every patch — see
// useMatchRoom.ts's forceRender — there's no way to tell React "only this
// one field changed" from the object reference alone). Without this memo,
// that meant recreating and re-diffing all 18-30 token divs (fresh style
// object + filter recalculation each) on every single press, when a press
// really only changes 1-2 tokens (the one just completed, the one the
// cursor moved to). Memoized on the plain primitives actually derived per
// token (color/isDone/isMissed/showCursor/isLastInRow) instead of on
// `sequence`/`cursor` directly, since those primitives are what actually
// stays the same for ~all of the other tokens on any given press —
// suspected contributor (alongside game/clickSound.ts's audio pooling) to
// input lag under rapid presses on iOS — see docs/TROUBLESHOOTING.md #19/#20.
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
  // "" for a timeout (no one to blame) or when the caller omitted the prop
  // entirely (solo practice mode — see SequenceBoard's own prop comment).
  missedRole: RoleChoice;
  showCursor: boolean;
  isLastInRow: boolean;
}) {
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

export function SequenceBoard({
  sequence,
  cursor,
  turnOutcome,
  missedRole,
}: {
  sequence: Color[];
  cursor: number;
  // Optional: a wrong press or timeout never advances the cursor (see
  // server/src/game/turnOrder.ts), so once turnOutcome flips to "fail" the
  // cursor is still sitting exactly on the token everyone missed — no
  // separate "which token was wrong" field needed. Omit this prop (e.g. from
  // callers with no outcome concept) to just get the plain cursor marker.
  turnOutcome?: TurnOutcome;
  // Optional: online-only. Solo practice mode has no second role to blame
  // and doesn't pass this, so the missed token there just renders plainly
  // (same as a timeout) — no separate code path needed for that.
  missedRole?: RoleChoice;
}) {
  const rows = chunk(sequence, TOKENS_PER_ROW);
  const currentRow = Math.floor(cursor / TOKENS_PER_ROW);
  const missedIndex = turnOutcome === "fail" ? cursor : -1;

  return (
    <div className={styles.viewport}>
      {/* Keying by the sequence itself means a new round (new sequence) gets
          a fresh stack with no leftover scroll position/transition, while
          the same round's cursor advances animate smoothly. */}
      <div
        className={styles.stack}
        key={sequence.join(",")}
        style={{ transform: `translateY(calc(-1 * var(--row-step) * ${currentRow}))` }}
      >
        {rows.map((row, rowIndex) => (
          <div className={styles.row} key={rowIndex}>
            {row.map((color, i) => {
              const globalIndex = rowIndex * TOKENS_PER_ROW + i;
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
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: CSS 교체 — 빨간 테두리 제거, miss 토큰 스타일 추가**

`client/src/components/SequenceBoard.module.css`에서 `.missed`와 `@keyframes missedPulse` 규칙(파일 끝 부분)을 통째로 삭제하고 그 자리에 아래로 교체:

```css
/* miss 애니메이션(MissFrame)이 그리는 이미지 박스 — 기존 .token과 같은 크기의
   박스를 그대로 써서(--token-width, 140/160 비율) 레이아웃이 안 흔들리게 하되,
   miss 프레임 자체는 정사각형에 가까운 원형 배지라 object-fit 대신
   background-size: contain으로 중앙에 그대로 담는다. */
.missToken {
  width: var(--token-width);
  aspect-ratio: 140 / 160;
  background-size: contain;
  background-repeat: no-repeat;
  background-position: center;
}
```

(`.token`/`.done`/`.link`/`.cursor`/`.tokenWrap`/`.viewport`/`.stack`/`.row` 규칙은 그대로 둔다.)

- [ ] **Step 4: 호출부에서 `missedRole` 전달**

`client/src/components/MyTurnScreen.tsx`에서:

```tsx
<SequenceBoard sequence={sequence} cursor={cursor} turnOutcome={turnOutcome} />
```

를 아래로 교체(`room.state`에서 이미 구조분해하고 있는 필드들 옆에 `missedRole`도 추가해야 함 — `const { sequence, cursor, turnOutcome, round, turnEndsAt, teams } = room.state;`를 `const { sequence, cursor, turnOutcome, missedRole, round, turnEndsAt, teams } = room.state;`로):

```tsx
<SequenceBoard sequence={sequence} cursor={cursor} turnOutcome={turnOutcome} missedRole={missedRole} />
```

`client/src/components/SpectatorScreen.tsx`에서 마찬가지로, `const { sequence, cursor, turnOutcome, round, teams, turnEndsAt, players, matchChat } = room.state;`를 `const { sequence, cursor, turnOutcome, missedRole, round, teams, turnEndsAt, players, matchChat } = room.state;`로 바꾸고:

```tsx
<SequenceBoard sequence={sequence} cursor={cursor} turnOutcome={turnOutcome} />
```

를 아래로 교체:

```tsx
<SequenceBoard sequence={sequence} cursor={cursor} turnOutcome={turnOutcome} missedRole={missedRole} />
```

`client/src/components/SoloPlayScreen.tsx`는 **건드리지 않는다** — `missedRole` prop을 안 넘기는 것 자체가 "혼자 연습 모드는 제외" 요구사항을 만족시킨다(Step 2의 `SequenceBoard`가 `missedRole ?? ""`로 기본값 처리).

- [ ] **Step 5: 타입체크 + lint**

Run: `npm run build --workspace client`
Expected: 에러 없음

Run: `npm run lint --workspace client`
Expected: 에러 없음

- [ ] **Step 6: 수동 확인 (가능하면)**

`npm run sync-public` 후 실제로 온라인 매치 두 명(돼지 1명, 토끼 1명)을 붙여서, 토끼 차례에 돼지 쪽 클라이언트가 자기 버튼을 눌러 일부러 틀려보고 돼지 miss 애니메이션이 뜨는지, 반대로 돼지 차례에 토끼가 틀려서 토끼 miss 애니메이션이 뜨는지, 시간초과로 틀렸을 땐 아무 애니메이션도 안 뜨는지 확인. 4개 브라우저 세션을 동시에 다루는 자동화가 여의치 않으면 이 단계는 생략하고 코드 리뷰로 갈음해도 된다 — Task 1의 서버 테스트가 `missedRole` 값 자체의 정확성은 이미 검증했으므로, 이 단계는 순수 시각적 확인용.

- [ ] **Step 7: 커밋**

```bash
git add client/src/game/matchTypes.ts client/src/components/SequenceBoard.tsx client/src/components/SequenceBoard.module.css client/src/components/MyTurnScreen.tsx client/src/components/SpectatorScreen.tsx
git commit -m "오답 시 틀린 토큰에 빨간테두리 대신 실제로 잘못 누른 역할의 miss 애니메이션 표시"
```
