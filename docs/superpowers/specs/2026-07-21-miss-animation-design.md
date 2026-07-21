# 오답 시 역할별 miss 애니메이션 설계

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:writing-plans to turn this spec into an implementation plan.

**Goal:** 온라인 매치에서 오답(잘못된 버튼 입력)으로 턴이 실패했을 때, 지금은 틀린 토큰에 빨간 테두리만 뜨는 걸 **실제로 잘못 누른 플레이어의 역할(돼지/토끼)에 맞는 캐릭터 miss 애니메이션**으로 완전히 대체한다. 시간초과로 실패한 경우(아무도 안 눌러서 실패)는 대상이 없으므로 이 애니메이션을 띄우지 않는다.

**Architecture:** "누가 틀렸는지"는 색상(어느 역할 담당인지)이 아니라 **실제로 잘못된 버튼을 누른 플레이어의 역할**로 판단한다 — 토끼 차례에 돼지가 (자기 색 버튼을) 눌러서 틀리는 경우도 있기 때문에, 시퀀스상 그 색이 원래 어느 역할 것인지와 실제 누른 사람의 역할이 다를 수 있다. 이 정보는 지금 서버에 없으므로 `MatchState`에 `missedRole` 필드를 새로 추가해 오답 처리 시점(`handlePressButton`)에 기록하고, 시간초과 경로(`onTurnTimerExpired`)는 건드리지 않아 자연히 빈 값으로 남긴다. 클라이언트는 이 값이 있을 때만 해당 역할의 16프레임 miss 이미지를 순환시켜 틀린 토큰 자리에 보여준다.

**Tech Stack:** 서버 `server/src/rooms/MatchState.ts`/`MatchRoom.ts`. 클라이언트 `client/src/game/matchTypes.ts`, `client/src/components/SequenceBoard.tsx`(+css). 에셋은 이미 있는 `client/public/game-assets/ui/miss/thanksgiving_room_miss_{pig,rabbit}{0-15}.webp`(역할별 16프레임, 원형 배지, README에 이미 문서화돼 있었음 — "미적용" 상태였던 걸 이번에 적용).

## Global Constraints

- **온라인 매치에만 적용** — 혼자 연습 모드(`SoloPlayScreen`/`useSoloMatch`)는 건드리지 않는다(역할 개념이 없어 "누구 실수인지" 구분이 무의미함).
- **실제 오답(누군가 잘못 누름)일 때만** 애니메이션을 띄운다. 시간초과로 실패한 경우는 지금처럼 아무 강조도 없이 넘어간다("실패" 텍스트 배너는 그대로 뜸, 그건 이 설계 범위 밖).
- 역할 판정 기준은 **그 색이 원래 누구 것인지가 아니라, 실제로 잘못된 버튼을 누른 플레이어의 역할**이다.
- 기존 빨간 테두리(`.missed` 강조)는 완전히 제거되고 이 애니메이션으로 대체된다 — 둘이 같이 뜨지 않는다.
- 애니메이션은 틀린 토큰이 있던 자리·크기에 그대로 나타난다(별도 오버레이나 팝업이 아님).
- 16프레임은 실패 표시가 떠있는 동안 계속 반복 재생한다(한 번 재생 후 멈추지 않음).

## 서버 설계

### `server/src/rooms/MatchState.ts`

`RoleChoice` 타입(이미 있음: `"pig" | "rabbit" | ""`)을 재사용해 `MatchState`에 필드 추가:

```ts
@type("string") turnOutcome: TurnOutcome = "pending";
@type("string") missedRole: RoleChoice = "";
```

(`turnOutcome` 바로 다음 줄에 추가.)

### `server/src/rooms/MatchRoom.ts`

**`startTurn()`** — 매 턴 시작 시 `turnOutcome`과 함께 초기화(기존 `this.state.turnOutcome = "pending";` 바로 다음 줄에 추가):

```ts
this.state.turnOutcome = "pending";
this.state.missedRole = "";
```

**`handlePressButton()`** — 오답 분기(`if (!result.correct) {...}`)에서 `player.role`을 기록:

```ts
if (!result.correct) {
  this.turnDecided = true;
  this.applyMortarLoss(activeTeam);
  this.state.turnOutcome = "fail";
  this.state.missedRole = player.role as RoleChoice;
  return;
}
```

**`onTurnTimerExpired()`(시간초과 경로)는 변경 없음** — `missedRole`을 건드리지 않으므로 `startTurn()`이 세팅한 `""`가 그대로 유지되고, 클라이언트는 이걸로 "시간초과라 대상이 없다"를 판단한다.

## 클라이언트 설계

### `client/src/game/matchTypes.ts`

`MatchState` 인터페이스에 필드 추가(`turnOutcome` 바로 다음 줄):

```ts
export interface MatchState {
  ...
  turnOutcome: TurnOutcome;
  missedRole: RoleChoice;
  ...
}
```

### `client/src/components/SequenceBoard.tsx`

`SequenceBoard`가 `missedRole` prop을 새로 받는다 — 기존 `turnOutcome?: TurnOutcome`과 같은 방식으로 **선택적(optional)** prop으로 추가해, 호출부인 `MyTurnScreen.tsx`/`SpectatorScreen.tsx`(온라인)는 `room.state.missedRole`을 그대로 넘겨주고, `SoloPlayScreen.tsx`(혼자 연습 모드)는 아예 안 넘긴다 — 별도 분기 없이 "prop이 없으면 애니메이션도 없음"이 자연스럽게 적용되어, 혼자 연습 모드 제외 요구사항과 시간초과 시 표시 안 함 요구사항이 같은 코드 경로(`missedRole`이 falsy)로 처리된다. 이 값을 `Token`에 전달한다.

`Token`의 렌더링 분기:
- `isMissed && missedRole` → 새 컴포넌트로 16프레임 애니메이션 표시(아래).
- `isMissed && !missedRole`(시간초과) → 지금처럼 평범한 토큰(빨간 테두리 없음, 커서 표시도 기존대로 없음).
- 그 외 → 기존 그대로(`isDone`/커서).

새 하위 컴포넌트(같은 `SequenceBoard.tsx` 파일 안에 `Token`처럼 작은 함수로 추가 — 별도 파일까지는 필요 없는 크기):

```tsx
const MISS_FRAME_COUNT = 16;
const MISS_FRAME_INTERVAL_MS = 80;

function MissFrame({ role }: { role: "pig" | "rabbit" }) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
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
```

`setInterval`을 쓰는 이 부분만 `Token`과 분리된 작은 컴포넌트로 둬서, 매 80ms 리렌더가 딱 이 하나(틀린 토큰 하나)에만 국한되고 `SequenceBoard`의 나머지 토큰들(최대 30개)에는 전혀 영향 없다 — `Token` 자체가 이미 리렌더 비용에 민감해서 메모이즈돼 있는 이유(파일 상단 주석 참고)와 같은 이유로, 새 애니메이션도 같은 원칙을 따른다.

### `client/src/components/SequenceBoard.module.css`

`.missed`(빨간 테두리 pulse) 규칙은 삭제. 새 규칙 추가 — 기존 `.token`과 같은 박스 크기(`--token-width`, `140/160` 비율)를 그대로 써서 레이아웃이 안 흔들리게 하되, 원형 배지 이미지라 `contain` + 중앙 정렬로 보여준다:

```css
.missToken {
  width: var(--token-width);
  aspect-ratio: 140 / 160;
  background-size: contain;
  background-repeat: no-repeat;
  background-position: center;
}
```

## 테스트

- 서버(`server/src/rooms/MatchRoom.test.ts`): 오답 시 `state.missedRole`이 실제로 잘못된 버튼을 보낸 플레이어의 역할과 일치하는지(`handlePressButton`은 색이 다르면 무조건 그 프레스를 보낸 사람의 역할을 기록하므로, 오답 테스트 하나로 충분 — 어느 색을 보냈는지와 무관하게 항상 같은 코드 경로), 시간초과 시엔 `missedRole`이 계속 `""`인지, 다음 턴 시작 시 `""`로 리셋되는지.
- 클라이언트는 이 프로젝트에 테스트 프레임워크가 없으므로(기존 관례) `npm run build`/`npm run lint` + 브라우저 수동 확인으로 검증.
