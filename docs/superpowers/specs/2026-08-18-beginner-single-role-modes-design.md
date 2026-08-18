# 초보모드 / 돼지전 / 토끼전 설계 문서

## 배경

기존 정상모드(돼지+토끼 팀 대결)와 AI 연습모드(팀당 1명 + 봇) 외에, 실력대별/역할별로
분리된 대결 모드 3종을 추가한다:

- **초보모드**: 팀 구조는 정상모드와 동일(팀당 돼지 1 + 토끼 1)하되 패턴이 더 쉽게
  시작한다.
- **돼지전**: 참가자 전원이 돼지 역할만 맡아 서로 대결한다.
- **토끼전**: 참가자 전원이 토끼 역할만 맡아 서로 대결한다.

세 모드 모두 랭킹(TOP10, 개인 최고라운드)에는 집계되지 않고, 게임머니 적립은 정상모드의
절반이다. 목적은 실력 격차가 큰 신규 유저나 특정 역할만 연습하고 싶은 유저에게 진입장벽을
낮춘 대결 공간을 제공하는 것 — 랭킹/게임머니를 정상모드보다 낮춰서 "진짜 실력"과는
분리해둔다.

## 게임 모드 옵션

방 생성 옵션에 새 축 `gameMode: "normal" | "beginner" | "pigOnly" | "rabbitOnly"`를
추가한다(기본값 `"normal"`, `server/src/game/gameMode.ts`에
`sanitizeGameMode(input): GameMode`를 `teamCount.ts`와 같은 패턴으로 신규 작성). 기존
`aiPracticeMode: boolean`은 그대로 두고 독립적인 축으로 유지하되, `pigOnly`/`rabbitOnly`와는
동시에 켤 수 없다(대결 상대가 전부 같은 역할이라 "봇이 반대 역할을 채운다"는 aiPracticeMode의
전제 자체가 성립하지 않음) — 서버가 `gameMode`가 `pigOnly`/`rabbitOnly`면 `aiPracticeMode`를
무조건 `false`로 무시한다. `normal`/`beginner`는 기존처럼 `aiPracticeMode`와 자유롭게 조합
가능.

`teamCount` 옵션(1~4)은 그대로 재사용한다 — `pigOnly`/`rabbitOnly`에서는 "몇 팀"이 아니라
"몇 명"이라는 의미가 되므로, 클라이언트 UI에서만 라벨을 "인원수(2~4)"로 바꿔 보여준다.
서버는 `pigOnly`/`rabbitOnly`일 때 `sanitizeTeamCount`가 돌려준 값을 `Math.max(2, ...)`로
한 번 더 클램프해서 최소 2명을 보장한다(1명은 이미 있는 혼자연습 모드와 겹치므로 배제).

`CreateRoomModal.tsx`에 라디오 버튼 4개(일반/초보/돼지전/토끼전)를 추가한다. `pigOnly`/
`rabbitOnly` 선택 시 AI연습모드 체크박스는 숨기고, 팀 수 입력 라벨만 "인원수(2~4)"로
바뀐다(입력 로직 자체는 동일, 최솟값만 1→2로 조정).

## 팀 / 역할 구조

**초보모드**: 기존 정상모드와 완전히 동일한 팀 구조(팀당 돼지 1 + 토끼 1, `RoleSelect.tsx`의
기존 역할 선택 화면 그대로). `MatchRoom.onCreate`가 만드는 `teamCount`개의 `TeamState`도
그대로.

**돼지전/토끼전**: 팀 = 참가자 1명. `onCreate`에서 만드는 각 `TeamState`는 `pigOnly`면
`pigSessionId`만 쓰고 `rabbitSessionId`는 항상 빈 문자열로 유지(반대의 경우 `rabbitOnly`).
`maybeStartGame()`의 준비 완료 판정을 모드별로 분기한다:

```ts
const ready = this.state.teams.every((t) =>
  this.gameMode === "pigOnly" ? t.pigSessionId !== "" :
  this.gameMode === "rabbitOnly" ? t.rabbitSessionId !== "" :
  t.pigSessionId !== "" && t.rabbitSessionId !== ""
);
```

**역할 선택 화면**: `RoleSelect.tsx`를 재사용하되, `pigOnly`/`rabbitOnly` 방에서는 해당
역할 버튼 1개만 렌더링한다(반대 역할 버튼 자체를 안 보여줌 — 고를 게 없으므로). 클릭하면
`chooseRole` 메시지를 그대로 보내되, **서버가 `handleChooseRole`에서 `gameMode`가
`pigOnly`/`rabbitOnly`일 때는 클라이언트가 보낸 `role` 값을 무시하고 방의 고정 역할로
강제한다**(스푸핑 방지, 기존 관례상 서버 권위 원칙 유지). 사람이 다 찰 때까지는 로비에서
자유롭게 대기하다가, 마지막 자리가 채워지는 순간 기존과 동일한 3-2-1 카운트다운
(`COUNTDOWN_START_SECONDS`)이 자동으로 시작된다 — 별도의 "시작하기" 버튼은 만들지 않는다.

턴 진행/입력 판정(`resolvePress`, `attemptPress`)은 `player.role`을 그대로 읽어 쓰므로
**변경 불필요** — 돼지전에서 플레이어의 role이 항상 "pig"로 고정되고 시퀀스도 돼지 색만
나오면, 기존 판정 로직이 그대로 올바르게 동작한다.

## 시퀀스(패턴) 생성 규칙

`sequenceLengthForRound`에 시작 줄수 파라미터를 추가한다:

```ts
// server/src/game/sequenceLength.ts
export function sequenceLengthForRound(round: number, startingRows = 3): number {
  const rows = startingRows + Math.floor((round - 1) / ROUNDS_PER_ROW_INCREASE);
  return rows * BUTTONS_PER_ROW;
}
```

모드별 시작 줄수: 정상 3(기존 기본값 유지, 호출부 변경 불필요) / 초보 2 / 돼지전 4 / 토끼전
2. `MatchRoom.startTurn()`이 `this.gameMode`에 따라 이 값을 넘겨준다.

돼지전/토끼전은 시퀀스 자체가 단일 역할 조각만으로 구성돼야 하므로, 서버에 신규 함수
`generateSingleRoleSequence(totalLength, rng, role)`를 `server/src/game/sequence.ts`에
추가한다. 클라이언트 `soloEngine.ts`가 이미 검증된 동일한 규칙(돼지: `generatePigFragment`만,
토끼: 민트런 + `generateRabbitPairFragment`)을 갖고 있지만 그건 클라이언트 전용 수동 포팅이라
서버에서 재사용할 수 없다 — 대신 서버가 이미 갖고 있는 진짜 `fragments.ts`의
`generatePigFragment`/`generateRabbitPairFragment`/`mintRun`을 그대로 호출해서 로직 중복
없이 구현한다.

`MatchRoom.startTurn()`의 분기:

```ts
const startingRows = { normal: 3, beginner: 2, pigOnly: 4, rabbitOnly: 2 }[this.gameMode];
const length = sequenceLengthForRound(this.state.round, startingRows);
const sequence =
  this.gameMode === "pigOnly" ? generateSingleRoleSequence(length, Math.random, "pig") :
  this.gameMode === "rabbitOnly" ? generateSingleRoleSequence(length, Math.random, "rabbit") :
  generateSequence(length, Math.random, this.state.round);
```

## 게임머니 / 판수 / 랭킹

**게임머니**(`creditTurnSuccess`): 현재 `20 * this.state.teams.length`인 보상 공식의 단가만
모드별로 바꾼다 — 정상 20원, 초보/돼지전/토끼전 10원. 배율(`teams.length`)은 공통으로 그대로
적용한다(돼지전/토끼전도 팀 수 자체는 2~4로 존재하므로 동일 공식이 성립 — "팀당 인원수"가
아니라 "팀 수"에 대한 배율이기 때문).

```ts
private creditTurnSuccess(team: TeamState) {
  if (this.aiPracticeMode) return;
  const rate = this.gameMode === "normal" ? 20 : 10;
  const reward = rate * this.state.teams.length;
  for (const sessionId of [team.pigSessionId, team.rabbitSessionId]) {
    const userId = this.playerUserIds.get(sessionId);
    if (userId) addGameMoney(userId, reward);
  }
}
```

(`rabbitSessionId`가 빈 문자열인 돼지전 팀은 `playerUserIds.get("")`이 `undefined`를 반환해
자연히 스킵되므로 별도 분기 불필요.)

**판수**(`pig_play_count`/`rabbit_play_count`): 세 모드 전부 **정상 집계**한다
(`recordRolePlaysStarted` 그대로 호출, 가드 추가 없음) — 랭킹과는 별개의 활동량 지표라
제외할 이유가 없다는 판단.

**랭킹**(`recordRoundAchievement` → `users.max_round`): 세 모드 전부 **미집계**한다.
`creditRound`에 `aiPracticeMode`가 이미 쓰는 것과 같은 가드 패턴을 추가:

```ts
private creditRound(team: TeamState, round: number) {
  if (this.aiPracticeMode || this.gameMode !== "normal") return;
  ...
}
```

이 모드에서 세운 라운드 기록은 프로필의 "최고 라운드" 표시에도 반영되지 않는다(랭킹용
`max_round` 필드를 그대로 재사용하는 값이라 분리 저장하지 않는 한 함께 빠짐 — 연습 성격의
기록이 "진짜 실력"에 섞이지 않게 하려는 의도이므로 의도된 동작).

## 절구 / 탈락

돼지전/토끼전은 팀 = 참가자 1명이므로, 기존 절구(`mortars`)/탈락(`eliminated`)/턴순환
(`rotation.ts`의 `nextActiveTeamIndex`) 로직이 **코드 변경 없이** 사람 단위로 그대로
적용된다 — 절구가 다 떨어진 사람만 탈락하고 나머지 인원으로 계속 진행(정상모드에서 팀이
하나둘 탈락해도 매치가 끝나지 않는 것과 동일한 방식, `docs/REQUIREMENTS.md` §1 참고).

## 방 목록 표시

기존 `aiPracticeMode`가 방 제목 앞에 `"(연습모드) "`를 붙이는 것과 같은 방식으로,
`gameMode`가 `normal`이 아니면 방 제목 앞에 구분용 접두사를 붙인다: 초보 →
`"(초보모드) "`, 돼지전 → `"(돼지전) "`, 토끼전 → `"(토끼전) "`. `aiPracticeMode`와
`beginner`가 동시에 켜진 경우 두 접두사를 순서대로 이어붙인다(`"(연습모드) (초보모드) "`).

## 서버 변경 파일

- `server/src/game/gameMode.ts` (신규) — `GameMode` 타입, `sanitizeGameMode`
- `server/src/game/sequence.ts` — `generateSingleRoleSequence` 추가
- `server/src/game/sequenceLength.ts` — `startingRows` 파라미터 추가
- `server/src/rooms/MatchRoom.ts` — `gameMode` 필드, `onCreate`(팀 생성/인원 클램프/제목
  접두사), `maybeStartGame`(준비 판정 분기), `handleChooseRole`(역할 강제), `startTurn`(시퀀스
  분기), `creditTurnSuccess`/`creditRound`(단가/가드)

## 클라이언트 변경 파일

- `client/src/components/CreateRoomModal.tsx` — 모드 라디오 버튼, 인원수 라벨 분기
- `client/src/components/RoleSelect.tsx` — `pigOnly`/`rabbitOnly`일 때 버튼 1개만 렌더링

## 테스트

- `server/src/game/gameMode.test.ts` (신규) — `sanitizeGameMode` 유효/무효 입력
- `server/src/game/sequence.test.ts` — `generateSingleRoleSequence`가 지정 역할 색만
  생성하는지, 길이가 정확한지
- `server/src/game/sequenceLength.test.ts` — `startingRows` 파라미터 반영 확인
- `server/src/rooms/MatchRoom.test.ts` — 돼지전 방에서 역할 선택 없이도 방장 강제 역할로
  배정되는지, 준비 판정이 1슬롯 기준으로 도는지, `creditTurnSuccess`/`creditRound` 단가·가드,
  `aiPracticeMode`+`pigOnly` 동시 지정 시 `aiPracticeMode`가 무시되는지

## 범위 제외

- 혼자 연습 모드(`useSoloMatch.ts`/`soloEngine.ts`)는 완전히 별개의 로컬 전용 시스템이라
  이번 작업과 무관 — 건드리지 않는다.
- `ButtonPanel.tsx`의 버튼 레이아웃(6색 고정 배치)은 그대로 둔다 — 돼지전/토끼전에서 안
  쓰이는 색 버튼도 화면에는 계속 보이되, 시퀀스에 해당 색이 아예 안 나오므로 자연히 안
  눌린다. 반대 역할 버튼을 화면에서 숨기는 UI 작업은 이번 스코프 밖.
- 아이템전(`itemsEnabled`)과의 조합 여부는 기존처럼 방 생성 시 그대로 선택 가능 — 세 모드
  다 아이템 시스템과 무관하게 독립적으로 동작하므로 별도 처리 불필요.
