# 탈락/게임 지속 흐름 설계 (2026-07-14)

## 배경

지금 구현은 `TEAM_COUNT = 2`로 고정되어 있고, 한 팀이 절구 5개를 모두 잃어 탈락하면 `rotation.ts`의 `winningTeam()`이 즉시 남은 팀을 승자로 판정해 `phase`를 `"finished"`로 바꾼다. 이 시점에서 두 팀 모두 `WinnerScreen`만 보고, 로비로 돌아갈 방법이 없다 (새로고침만 가능).

참고용으로 원본 게임의 솔로 연습 앱(`연습.apk`)을 jadx로 디컴파일해 분석했으나, 이 앱은 완전히 오프라인 싱글플레이어 도구라 팀/방/로비 개념 자체가 없었다. 다만 핵심 통찰을 얻었다: **연습 앱은 "게임 오버" 없이 라운드를 무한히 반복하는 구조**이고, 이 프로젝트도 같은 방식을 멀티플레이어에 적용하기로 했다 — 팀이 탈락해도 매치를 강제 종료하지 않고, 남은 팀이 원하는 만큼 계속 라운드를 이어갈 수 있게 한다.

## 요구사항

1. 한 팀이 탈락해도 매치가 강제 종료되지 않는다. 생존 팀은 계속 라운드를 이어갈 수 있다 (연습 모드처럼).
2. 탈락한 팀의 플레이어는 관전하거나, "나가기"를 눌러 로비(역할 선택 화면)로 돌아가 새 매치 큐를 잡을 수 있다.
3. 생존 팀에게는 "나가기" 버튼을 제공하지 않는다 — 계속 남아서 플레이하는 것이 기본 흐름이다.
4. "승리 화면"이라는 개념은 없앤다. 상대 탈락은 조용히 처리되고 게임은 이어진다.

## 핵심 통찰 (구현이 작아지는 이유)

- `rotation.ts`의 `nextActiveTeamIndex()`는 이미 탈락하지 않은 팀만 순환하도록 구현되어 있다. 팀이 2개 중 1개만 살아남으면, 이 함수는 항상 그 팀의 인덱스를 반환한다 — 즉 생존 팀이 자동으로 연속 턴을 받는다. **`phase = "finished"`로 강제 전환하는 코드만 제거하면 나머지는 기존 로직이 그대로 작동한다.**
- `Game.tsx`의 화면 라우팅도 이미 "내 팀이 활성 팀이 아니면 `SpectatorScreen`"이라, 탈락한 팀은 별도 라우팅 변경 없이 자연스럽게 관전 화면으로 간다. `SpectatorScreen`에 조건부 문구/버튼만 추가하면 된다.

## 서버 변경 (`server/src/`)

1. **`rooms/MatchRoom.ts` `advanceToNextTurn()`**: `winningTeam()` 체크로 `this.state.phase = "finished"`, `this.state.winnerTeamId = winner.id`를 설정하던 블록을 삭제한다. 나머지 (라운드 순환, 라운드 카운트 증가, `startTurn()` 호출)는 변경 없이 재사용된다.
2. **`rooms/MatchRoom.ts` `onJoin()`**: `this.state.phase !== "lobby"`이면 접속을 거부한다 (예: `client.leave(4000, "Match already in progress")` 후 `return`). 탈락자가 나가서 room의 접속자 수가 `maxClients` 미만으로 떨어지면, `joinOrCreate`가 진행 중인 이 방에 관계없는 새 플레이어를 매칭시켜버릴 수 있기 때문에 반드시 필요한 안전장치다.
3. **`rooms/MatchRoom.ts` `maybeStartGame()`**: `phase`를 `"playing"`으로 바꾸는 시점에 `this.maxClients = this.clients.length`를 설정한다. Colyseus의 `joinOrCreate` 매치메이킹 단계에서 이 방을 "꽉 찬 방"으로 보이게 해 애초에 후보에서 제외시키는 1차 방어선이다 (2번은 그 방어를 우회해 `joinById` 등으로 직접 접근하는 경우에 대한 2차 방어선).
4. **`game/rotation.ts`**: 더 이상 호출되지 않는 `winningTeam()` 함수와 `rotation.test.ts`의 관련 테스트를 삭제한다.
5. **`rooms/MatchState.ts`**: `Phase` 타입에서 `"finished"`를 제거하고 (`"lobby" | "playing"`), `winnerTeamId` 필드를 제거한다.

### 새 서버 테스트 (`MatchRoom.test.ts`)

- 한 팀이 탈락해도 `phase`가 `"playing"`으로 유지되고, 생존 팀이 계속 턴을 받는다 (연속 두 번 이상 턴 완료까지 시뮬레이션).
- `phase`가 `"lobby"`가 아닐 때 새 클라이언트의 접속 시도가 거부된다.

## 클라이언트 변경 (`client/src/`)

1. **`colyseus.ts`**: `leaveMatch()`를 추가한다. 현재 캐시된 room에 대해 `room.leave()`를 호출하고, 모듈 스코프의 `roomPromise` 캐시를 `null`로 초기화한다. 이렇게 해야 이후의 `joinMatch()` 호출이 (기존처럼 죽은 캐시를 반환하지 않고) 실제로 새 매치에 참가한다.
2. **`game/useMatchRoom.ts`**: 마운트 시 1회만 join하던 구조에서, `leaveAndRejoin()` 콜백을 노출하는 구조로 리팩터한다. 이 콜백은 현재 room을 나가고(`leaveMatch()`), 훅 내부 상태(`room=null`, `status="connecting"`)를 리셋한 뒤, 새 join 시퀀스를 다시 시작한다.
3. **`components/SpectatorScreen.tsx`**: `eliminated: boolean`과 `onLeave: () => void` prop을 추가한다.
   - `eliminated`가 `true`면: "당신의 팀은 탈락했습니다. {activeTeam.id} 팀이 계속 플레이 중입니다." 문구와 "나가기" 버튼을 보여준다.
   - `eliminated`가 `false`면 (양쪽 다 생존, 그냥 내 턴이 아닌 경우): 기존 문구("{activeTeam.id} 팀의 차례입니다")만 보여주고 버튼은 없다.
4. **`components/WinnerScreen.tsx`, `WinnerScreen.module.css`**: 삭제한다. `phase: "finished"`가 더 이상 존재하지 않으므로 도달 불가능한 코드다.
5. **`components/Game.tsx`**: `phase === "finished"` 분기를 제거한다. 내 팀의 `eliminated` 여부를 계산해 `SpectatorScreen`에 전달한다.
6. **`App.tsx`**: `useMatchRoom()`이 반환하는 `leaveAndRejoin`을 `Game`까지 내려준다.
7. **`game/matchTypes.ts`**: `Phase`에서 `"finished"` 제거, `MatchState`에서 `winnerTeamId` 제거 (서버 스키마와 수기로 동기화 유지).

## 명시적 범위 제외 (Out of scope)

- 탈락한 팀이 나간 빈 슬롯에 새 플레이어가 들어와 그 방에서 이어서 도전하는 것(king-of-the-hill 방식) — `docs/todo.md`의 "매치메이킹/방 코드" 항목과 겹치는 별도 작업.
- 생존 팀을 위한 승리/격려 배너 등 시각적 피드백 — 이번 스코프에서는 조용히 이어지는 것으로 확정.
- 팀 수를 2개 이상으로 확장하는 것 — 이 설계는 `TEAM_COUNT = 2` 고정을 그대로 유지한 채로 동작한다 (탈락 시 생존 팀이 정확히 1개가 되는 현재 구조를 전제).

## 테스트 계획

- 서버: 기존 vitest 스위트에 위 "새 서버 테스트" 2건 추가. `npm test` (server/) 통과 확인.
- 클라이언트: 자동화 테스트 없음 (기존에도 client는 lint만 있고 test 스크립트 없음). `npm run dev`로 4개 탭을 열어 한 팀을 탈락시키고 (1) 생존 팀이 계속 라운드를 도는지, (2) 탈락 팀이 관전 문구 + 나가기 버튼을 보는지, (3) 나가기 클릭 후 새 로비/큐에 정상 진입하는지, (4) 게임 진행 중인 방에 새 탭이 실수로 매칭되지 않는지 수동 확인.
