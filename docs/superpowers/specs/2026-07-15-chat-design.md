# 대기실/관전 채팅 설계

## 배경 / 목적

원본 게임(참고 스크린샷)에는 대기실/관전 화면에 채팅이 있었지만, 닉네임+방 목록 기능을 만들 때는
"이번엔 닉네임만, 채팅은 나중에"로 범위를 미뤄뒀다. 이제 그 채팅을 만든다 — 방에 모인 사람들이
역할 고르기 전이나, 내 팀 차례가 아닐 때 서로 소통할 수 있게 한다.

## 스코프

- **보이는 화면**: 대기실(`RoleSelect`), 관전 화면(`SpectatorScreen`) 두 곳.
- **안 보이는 화면**: 내 차례 화면(`MyTurnScreen`) — 4초 반응속도 게임이라 화면 복잡도를 안 늘림
  (읽기 전용으로도 안 보여줌).
- **기록 범위**: 대기실 채팅과 관전 채팅은 **서로 독립**된 기록이다 (사용자 결정) — 로비에서 나눈
  대화와 경기 중 나눈 대화가 안 섞인다. 방(매치)이 살아있는 동안은 계속 유지되고, 새로 들어온
  사람도 최근 기록을 볼 수 있다. 방이 사라지면(서버 재시작 등) 같이 사라짐 — 별도 영구 저장 안 함.
- **스코프 제외** (사용자가 스크린샷 논의 때 명시): 이모지 피커, 전송 버튼 옆 "+"(첨부) 버튼, 욕설/내용
  필터링 같은 모더레이션. 순수 텍스트만.

## 서버 변경

`server/src/rooms/MatchState.ts`에 새 스키마 `ChatMessage`(닉네임, 텍스트, 보낸 시각)와, `MatchState`에
`lobbyChat`/`matchChat` 두 개의 `ArraySchema<ChatMessage>` 필드 추가. 각각 최근 50개만 유지(그 이상
쌓이면 오래된 것부터 제거) — 메모리/동기화 트래픽이 무한정 안 늘어나게.

`server/src/rooms/MatchRoom.ts`에 `sendChat` 메시지 핸들러 추가:
- 텍스트를 sanitize(trim + 최대 100자, 빈 문자열이면 무시) — 닉네임 sanitize와 같은 패턴으로
  `server/src/game/chat.ts`에 순수 함수로 분리, TDD.
- 현재 `this.state.phase`가 `"lobby"`면 `lobbyChat`에, `"playing"`이면 `matchChat`에 추가.

## 클라이언트 변경

- `client/src/components/ChatBox.tsx`(신규): 메시지 목록(스크롤 가능, 고정 높이) + 텍스트 입력 +
  전송 버튼. `RoleSelect`/`SpectatorScreen` 둘 다에서 재사용 — `messages`/`onSend` props만 받는
  화면 위치 무관 컴포넌트.
- `RoleSelect.tsx`: 역할 버튼과 팀 로스터 사이에 `<ChatBox messages={room.state.lobbyChat} .../>` 삽입.
- `SpectatorScreen.tsx`: 시퀀스보드와 (하단 고정) `TeamRosterPanel` 사이에
  `<ChatBox messages={room.state.matchChat} .../>` 삽입.
- `client/src/game/matchTypes.ts`에 서버 `MatchState`/`ChatMessage` 변경사항 수동 미러링(이 프로젝트의
  기존 관례 — shared-types 패키지 없음).

## 스코프 제외 (재확인)

- 이모지 피커, "+" 첨부 버튼 — 스크린샷 논의 때 명시적으로 제외 확정
- 욕설/신고/차단 등 모더레이션 — 소규모 친구 모임 캐주얼 게임이라 불필요
- 채팅 알림(뱃지, 소리) — 이번 스코프 아님
- 내 차례 화면에서의 채팅 노출(읽기 전용 포함) — 반응속도 게임 특성상 제외
