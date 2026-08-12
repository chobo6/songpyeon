# AI 연습모드 — 설계 문서

## 배경

혼자 연습할 때 상대 역할(돼지/토끼)을 맡아줄 사람이 없으면 온라인 매치를 시작할 수 없다.
기존 "혼자 연습 모드"(`useSoloMatch.ts`/`soloEngine.ts`)는 완전히 클라이언트 전용 시뮬레이션이고
자기 역할의 색만 나오는 반쪽짜리 연습이라, 실제 온라인 매치와 같은 조건(두 역할 색이 섞인
진짜 시퀀스, 서버 권위형 판정)으로 혼자 연습할 방법이 없다. 방 생성 시 "AI 연습모드"를 켜면
반대 역할을 서버가 직접 조종하는 봇이 채워서, 온라인 매치 그대로의 조건으로 혼자 연습할 수
있게 한다.

## 1. 클라이언트 — 방 생성 UI

`CreateRoomModal.tsx`에 "아이템전" 체크박스 바로 아래 새 체크박스 추가, 기본 미체크:

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

체크된 동안은 팀 수 입력을 `disabled`로 잠근다(값은 이미 1로 강제됨). 체크 해제하면 다시
자유롭게 팀 수를 고를 수 있다.

`onCreate` 시그니처에 `aiPracticeMode: boolean`을 다섯 번째 인자로 추가 — 지금 `itemsEnabled`가
흘러가는 것과 완전히 같은 경로 4곳(`CreateRoomModal` → `RoomList.onCreateRoom` →
`App.tsx`의 `setJoinSpec` → `colyseus.ts`의 `JoinSpec`/`joinMatch`)을 그대로 따라간다.

## 2. 서버 — 방 옵션 + 다른 플레이어 입장 차단

`MatchRoomOptions`에 `aiPracticeMode?: unknown` 추가, `itemsEnabled`와 같은 패턴으로 읽는다:

```ts
this.aiPracticeMode = options.aiPracticeMode === true;
const teamCount = this.aiPracticeMode ? 1 : sanitizeTeamCount(options.teamCount);
```

(클라이언트가 이미 팀 수를 1로 보내지만, 서버도 방어적으로 강제한다 — 클라이언트 입력을
그대로 믿지 않는 이 프로젝트의 기존 관례를 따름.)

**다른 유저 플레이어 입장 차단**: `onJoin`의 기존 정원 체크(`state.players.size >= playerCapacity`)
만으로는, 사람이 아직 역할을 안 골라 봇이 채워지기 전의 짧은 순간에 다른 사람이 두 번째
플레이어로 들어올 수 있는 틈이 있다. AI 연습모드 방은 최초 1명이 들어온 순간부터 플레이어
정원을 사실상 1명으로 강제한다:

```ts
if (this.aiPracticeMode && this.state.players.size >= 1) {
  throw new Error("이 방은 AI 연습 전용 방입니다.");
}
```

(기존 정원 체크 바로 앞에 추가. 관전은 이 체크와 무관 — 관전 허용 여부는 기존
`allowSpectators` 옵션을 그대로 따른다.)

## 3. 서버 — 봇 자리 채우기

`handleChooseRole`이 사람의 역할을 확정한 직후(`maybeStartGame()` 호출 전), AI 연습모드
방이면 봇 동기화를 호출한다. 봇의 `sessionId`는 실제 Colyseus가 발급하는 값과 절대 겹치지
않도록 고정 접두사를 쓴다:

```ts
const BOT_SESSION_PREFIX = "bot-"; // "bot-pig" / "bot-rabbit"

private syncBotForTeam(team: TeamState) {
  if (!this.aiPracticeMode) return;

  // 역할을 바꿔 탄 경우까지 한 번에 처리하기 위해, 이 팀에 남아있던 예전 봇을
  // 먼저 전부 지우고 현재 빈 자리 기준으로 다시 채운다.
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
  const sessionId = `${BOT_SESSION_PREFIX}${role}`; // "bot-pig" / "bot-rabbit"
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

사람이 대기실에서 역할을 바꿔도(기존에 허용된 동작) `syncBotForTeam`이 다시 실행되어 자동으로
맞는 자리에 봇이 재배치된다. 봇이 채워지는 즉시 `maybeStartGame()`의 "팀이 다 찼는지" 체크가
통과해 카운트다운이 바로 시작된다 — 사람 쪽에서 추가 동작 불필요.

`rosterForMetadata()`가 `state.players` 전체를 그대로 순회하므로, 봇도 별도 처리 없이 방
메타데이터(공개 방 목록, 관리자 대시보드의 "활성 방" 인원 표시)에 자연스럽게 포함된다 — 의도된
동작으로 그대로 둔다.

## 4. 서버 — 봇 버튼 자동 입력

**공유 판정 로직 분리**: 기존 `handlePressButton(client, color)`는 안티스팸 체크
(`isSpammedPress`, `lastPressAt` 갱신)와 실제 정답 판정(`attemptPress`, 커서 이동, 성공/실패
처리)이 한 함수에 섞여 있다. 이 중 판정 부분만 `resolvePress(sessionId, color)`로 분리해서
사람 경로와 봇 경로가 공유한다:

```ts
private handlePressButton(client: Client, color: Color) {
  if (this.state.phase !== "playing") return;
  if (this.turnDecided) return;

  const now = Date.now();
  const sinceLastPress = this.lastPressAt === null ? null : now - this.lastPressAt;
  this.lastPressAt = now;
  const blocked = isSpammedPress(color, sinceLastPress);
  // ...기존 모니터링 알림...
  if (blocked) return;

  this.resolvePress(client.sessionId, color);
}

// 봇 전용 진입점 — 안티스팸 체크와 lastPressAt 갱신을 의도적으로 건너뛴다(아래 참고).
private handleBotPress(sessionId: string, color: Color) {
  if (this.state.phase !== "playing") return;
  if (this.turnDecided) return;
  this.resolvePress(sessionId, color);
}

// 기존 handlePressButton의 attemptPress 이후 로직(보너스 아이템, 커서 이동,
// 성공/실패 처리) 그대로, sessionId 기준으로 player/activeTeam을 조회하도록만 바뀜.
private resolvePress(sessionId: string, color: Color) {
  const player = this.state.players.get(sessionId);
  if (!player) return;
  const activeTeam = this.state.teams[this.state.activeTeamIndex];
  if (player.teamId !== activeTeam.id) return;
  // ...attemptPress ~ creditTurnSuccess까지 기존 로직 그대로...
  if (!this.turnDecided && !result.complete) this.maybeTriggerBotPress();
}
```

**안티스팸을 봇 경로에서 뺀 이유**: `isSpammedPress`/`lastPressAt`은 같은 버튼을 사람 손가락이
낼 수 없는 속도로 연타하는 매크로를 잡기 위한 장치다. 봇은 요구사항대로 사람 바로 옆에서
거의 즉시(0에 가깝게) 누르므로, 이 체크를 그대로 태우면 봇 입력 자체가 막히거나, 봇이 방금
누른 직후 사람이 정당하게 누른 입력이 "너무 빠르다"고 오인될 수 있다. `lastPressAt`도 봇
입력으로는 갱신하지 않는다 — 사람 쪽 안티스팸 판정 기준을 봇이 절대 흔들지 않게 하기 위함.

**언제 봇이 누르나**: 매 턴 시작(`startTurn()` 끝) 직후, 그리고 매 정답 처리로 커서가 이동한
직후(위 `resolvePress` 마지막 줄)마다 확인한다:

```ts
private maybeTriggerBotPress() {
  if (!this.aiPracticeMode) return;
  if (this.state.cursor >= this.state.sequence.length) return;

  const activeTeam = this.state.teams[this.state.activeTeamIndex];
  const dueColor = this.state.sequence[this.state.cursor] as Color;
  const dueRole = colorRole(dueColor);
  const botSessionId = dueRole === "pig" ? activeTeam.pigSessionId : activeTeam.rabbitSessionId;
  if (!botSessionId.startsWith(BOT_SESSION_PREFIX)) return; // 사람 담당 색 — 기다림

  const token = this.turnToken;
  this.clock.setTimeout(() => {
    if (token !== this.turnToken || this.turnDecided) return; // 턴이 이미 넘어감
    this.handleBotPress(botSessionId, dueColor);
  }, BOT_PRESS_DELAY_MS); // 예: 30ms — 0ms 동시성 문제 회피용 최소 지연
}
```

민트런처럼 같은 담당자가 연속으로 눌러야 하는 구간도, 매 정답 처리마다 다시 확인하는 구조라
자연스럽게 연달아 처리된다. 봇은 항상 정확한 색만 누르므로 실수는 없다.

## 5. 서버 — 판수/라운드/게임머니 집계 제외

방 레벨 플래그 하나로 세 지급 지점을 막는다:

```ts
private creditRound(team: TeamState, round: number) {
  if (this.aiPracticeMode) return;
  // ...기존 로직...
}

private creditTurnSuccess(team: TeamState) {
  if (this.aiPracticeMode) return;
  // ...기존 로직...
}

private recordRolePlaysStarted() {
  if (this.aiPracticeMode) return;
  // ...기존 로직...
}
```

콤보 배지/평균 속도 배지는 DB에 안 남고 그 판 안에서만 보여주는 라이브 상태라 영향 없음 —
AI 연습모드에서도 그대로 정상 작동(오히려 연습 중 속도 확인 용도로 유용).

## 결정 사항 정리

- **아이템전 + AI모드 동시 사용 가능**: 서로 무관하게 독립적으로 켤 수 있다. 보너스 토큰이 봇
  차례에 나오면 봇이 먹어서 인벤토리에 쌓이지만 쓰지 않는다 — 버려지는 것뿐 실제 문제는
  없어서 별도 처리 안 함.
- **사람이 방을 나가면**: 봇은 실제 Colyseus 연결이 아니므로, 사람이 나가는 순간
  `this.clients.length`가 0이 되어 Colyseus가 기존 로직대로 빈 방을 정리한다. 봇 정리용
  별도 로직 불필요.
- **재대결**: 기존 `handleRematch()`가 전원 역할을 초기화하는 구조이므로(봇의 `PlayerState`도
  같은 루프에서 role/teamId가 초기화됨), 사람이 다시 역할을 고르면 `syncBotForTeam`이 다시
  실행되어 자연스럽게 봇이 재배치된다.
- **관리자 대시보드**: "활성 방" 목록엔 봇 닉네임이 그대로 노출된다(의도적 — 실제 방 인원
  데이터를 그대로 보여주는 화면이라서). 반대로 "최근 입장/퇴장" 로그·닉네임 검색·IP 조사에는
  전혀 안 남는다 — 봇은 `onJoin`을 거치지 않아 `recordEvent`가 한 번도 호출되지 않기 때문.

## 테스트

- `MatchRoom.test.ts`에 통합 테스트 추가(기존 컨벤션대로 실제 룸 인스턴스 상태를 직접 읽는
  방식): AI 연습모드로 방 생성 → 역할 선택 시 반대 자리에 봇 자동 배치 → 역할 스위칭 시 봇
  재배치 → 두 번째 클라이언트의 플레이어 입장 거부 → 봇이 자기 색을 정확히 누르는지 →
  `creditRound`/`creditTurnSuccess`/`recordRolePlaysStarted`가 실제로 호출 안 되는지(게임머니/
  DB 값 불변 확인).
- 안티스팸 비간섭 확인: 봇이 연속으로 누르는 상황(민트런)에서 `isSpammedPress`가 안 걸리는지,
  그 직후 사람의 정당한 입력도 안 막히는지.

## 범위 제외

- 난이도 조절(봇이 일부러 느리게/실수하게) — 이번 스코프는 "완벽하게, 거의 즉시"만 지원.
  나중에 필요해지면 별도 스펙.
- 봇이 아이템을 사용하는 로직 — 받기만 하고 절대 사용 안 함(위 결정 사항 참고).
- 관전자 입장까지 막는 것 — 이번 스코프는 "플레이어로 들어오는 것"만 차단, 관전 허용 여부는
  기존 체크박스 그대로 따름.
