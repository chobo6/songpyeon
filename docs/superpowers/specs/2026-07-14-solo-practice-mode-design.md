# 혼자 연습 모드 설계 (2026-07-14)

## 배경

`연습.apk`(원본 게임의 솔로 연습 앱, jadx로 디컴파일해 분석함 — `docs/superpowers/specs/2026-07-14-elimination-continue-design.md` 참고)와 동일하게, 역할(돼지/토끼)을 고르고 혼자서 시퀀스 입력을 연습할 수 있는 모드를 웹 버전에도 추가한다. 원본 앱은 완전히 오프라인 싱글플레이어 도구이며 "게임 오버" 없이 라운드를 무한 반복하는 구조였다 — 이 특성을 그대로 가져온다.

## 요구사항

1. 로비 화면에 "온라인" / "혼자 연습" 두 가지 진입점을 두고, 선택에 따라 다른 흐름으로 분기한다.
2. "온라인"을 고르기 전까지는 서버에 전혀 접속하지 않는다 (지금은 앱을 열자마자 자동 접속함 — 이 동작을 바꾼다).
3. "혼자 연습"을 고르면 돼지/토끼 중 역할을 선택하고, 그 역할의 색상만으로 구성된 시퀀스를 혼자 입력하며 연습한다.
4. 절구(생명) 개념 없음 — 실패해도 게임오버 없이 다음 라운드로 계속 진행 (무한 반복).
5. 4초 타이머, 성공/실패 피드백은 온라인 모드와 동일하게 적용.
6. 언제든 "나가기"로 모드 선택 화면으로 돌아갈 수 있다.
7. 솔로 플레이 기록/통계는 저장하지 않는다 (새로고침 시 초기화).

## 아키텍처: 클라이언트 로컬 계산

솔로 모드는 경쟁 상대가 없어 공정성 문제가 없고, 버튼 타이밍 연습이 목적이라 네트워크 지연이 오히려 방해가 된다. 따라서 **서버를 전혀 거치지 않고 클라이언트에서 전부 계산**한다.

서버의 순수 함수(`server/src/game/sequence.ts`, `fragments.ts`, `turnOrder.ts`, `sequenceLength.ts`, `rng.ts`, `colors.ts`)를 클라이언트 워크스페이스로 손으로 포팅한다 (두 워크스페이스는 별개 npm 패키지라 직접 import 불가 — `client/src/game/matchTypes.ts`/`colors.ts`가 이미 서버 스키마를 손으로 미러링해온 것과 동일한 기존 패턴).

핵심 차이점 — **시퀀스가 고른 역할의 색상으로만 구성됨**: 온라인 모드의 `generateSequence`는 매 조각마다 돼지/토끼 조각 중 무작위로 골라 섞지만, 솔로 모드는 역할을 고정하고 그 역할의 조각 생성 규칙만 반복한다.
- 돼지 선택 시: `[색상,보라]` 쌍만 반복 생성 (§REQUIREMENTS.md §4.1)
- 토끼 선택 시: 민트런(2/4/6개) 또는 초록·파랑·분홍 페어만 반복 생성 (§4.2)

## 화면 흐름

```
App
 ├─ mode: "select"  → ModeSelect (온라인 / 혼자 연습)
 ├─ mode: "online"  → OnlineFlow (지금 App.tsx가 하던 일 그대로:
 │                     useMatchRoom() 연결 → RoleSelect → Game)
 └─ mode: "offline" → OfflineFlow → SoloRoleSelect(돼지/토끼) → SoloPlayScreen
```

지금은 `App` 컴포넌트가 마운트되자마자 `useMatchRoom()`을 호출해 자동으로 서버에 접속한다. 이걸 바꾸는 방법은 **`useMatchRoom()`을 호출하는 코드를 `OnlineFlow`라는 새 하위 컴포넌트로 옮기고, `mode === "online"`일 때만 그 컴포넌트를 마운트**하는 것이다. React는 마운트되지 않은 컴포넌트의 이펙트를 실행하지 않으므로, 이것만으로 "온라인을 고르기 전엔 접속 안 함" 요구사항이 충족된다. `useMatchRoom.ts`/`client/src/colyseus.ts` 자체는 수정하지 않는다.

레이블: "온라인" / "혼자 연습" (오프라인이라는 표현 대신 더 직관적인 "혼자 연습" 사용, 내부 상태값 이름은 `"offline"` 유지).

## 솔로 플레이 상태 관리 — `useSoloMatch(role)`

서버의 `MatchRoom`이 하던 턴 진행 로직(`startTurn`/`handlePressButton`/`onTurnTimerExpired`)을 React 훅으로 재현한다. 반환값: `{ round, sequence, cursor, turnOutcome, turnEndsAt, press }`.

타이밍은 온라인 모드와 동일하게 맞춘다:
- **오답을 일찍 눌렀을 때**: 그 즉시 `turnOutcome = "fail"`로 바뀌지만, 다음 라운드로의 전환은 **원래 턴의 4초 마크까지 미룬다** (실패 배너가 화면에 남아있는 시간을 보장 — `MatchRoom.handlePressButton`의 기존 동작과 동일).
- **아무 것도 안 누르고 타임아웃**: 실패 판정과 다음 라운드 시작이 같은 타이머 콜백 안에서 동시에 일어남 (온라인 모드에서 Colyseus가 같은 tick의 상태 변경을 하나의 패치로 묶어 브로드캐스트하는 것과 동일한 효과 — React도 같은 콜백 안의 `setState` 호출들을 배칭하므로 실패 배너가 깜빡였다가 사라지는 대신 바로 다음 라운드로 자연스럽게 넘어감).
- **정답을 다 맞혀서 시퀀스 완료**: 그 즉시 다음 라운드로 넘어감 (온라인 모드와 동일).

## 재사용 컴포넌트

`SequenceBoard`(시퀀스 표시), `ButtonPanel`(입력 버튼), `TurnOutcomeBanner`(성공/실패 배너), `TimerBar`(4초 게이지)는 모두 이미 역할/팀 정보만 props로 받는 순수 프레젠테이션 컴포넌트라 수정 없이 그대로 재사용한다. `TeamStatusBar`(절구 표시)는 솔로 모드엔 팀도 절구도 없으므로 사용하지 않는다.

## 새로 만들 파일

- `client/src/game/soloEngine.ts` — 역할 제한 시퀀스 생성 + 판정 로직 (서버 로직 포팅)
- `client/src/game/useSoloMatch.ts` — 솔로 게임 상태 훅
- `client/src/components/ModeSelect.tsx` — 온라인/혼자 연습 선택 화면
- `client/src/components/SoloRoleSelect.tsx` — 솔로용 돼지/토끼 선택 (기존 `RoleSelect`와 같은 비주얼 스타일, 서버 통신 없이 로컬 콜백만 호출)
- `client/src/components/SoloPlayScreen.tsx` — 솔로 플레이 화면 (ROUND + TimerBar + SequenceBoard + ButtonPanel + 나가기 버튼)

## 수정할 파일

- `client/src/App.tsx` — mode 상태 분기 추가, 기존 로직을 `OnlineFlow`로 이동

## 명시적 범위 제외

- 솔로 플레이 기록/통계 저장 (최고 라운드 등) — 새로고침하면 초기화
- 서버 쪽 변경 없음 — 매치메이킹/방 코드(todo.md 항목)와는 무관한 완전히 별개 기능
- 절구(생명), 팀, 탈락 개념 없음

## 테스트 계획

클라이언트 패키지는 자동화 테스트가 없음(기존 관례와 동일 — `tsc`/`lint`만). `soloEngine.ts`는 서버의 이미 테스트된 로직을 포팅한 것이므로 브라우저 수동 확인으로 충분: 돼지/토끼 각각 선택해 시퀀스에 상대 역할 색상이 절대 안 섞이는지, 오답/타임아웃/정답 각 케이스에서 타이밍이 온라인 모드와 동일하게 느껴지는지, 무한 라운드가 실제로 끝없이 이어지는지 확인.
