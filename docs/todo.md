# TODO

> 지금까지 한 작업은 git 커밋 로그와 `docs/REQUIREMENTS.md`/`docs/ARCHITECTURE.md`/`docs/TROUBLESHOOTING.md` 참고. 이 문서는 앞으로 할 일만 정리.

## 다음에 먼저 볼 것

- [ ] **iOS에서 버튼 입력이 씹히는 현상 — 시도 3(렌더링 비용 축소) 검증 대기**: 안드로이드 문제(2026-07-15 이전 세션)는 `touch-action`/pointerdown+dedupe로 해결됐지만, 아이폰에서 재발 신고. 상세 원인 분석/시도 이력은 `docs/TROUBLESHOOTING.md` #19 참고. 요약: 시도 1(Pointer→Touch Events)은 실사용자 재검증 결과 효과 없음. 시도 2(오디오 풀링 + `:active` 트랜지션 제거)는 "조금 개선됐지만 여전히 진행 어려울 정도로 씹히고 딜레이도 있음" — 방향은 맞다는 신호로 판단해 같은 방향으로 더 진행. 시도 3(2026-07-17, 배포 완료): colyseus가 state를 in-place mutate해서 매 patch마다 전체 트리를 강제 리렌더하는 구조(`useMatchRoom.ts`의 `forceRender`) 자체는 못 바꾸지만, `SequenceBoard`의 토큰들을 `React.memo`로 분리해 프레스당 실제로 안 바뀌는 토큰(보통 16~29개)의 리렌더를 건너뛰게 함, `ButtonPanel`도 `React.memo`(+ `onPress`를 `useCallback`으로 고정), `done` 토큰의 `filter: drop-shadow` 제거, 오디오 재생을 `onPress` 다음 순서로. **다음 단계**: 실기기 재검증 필요 — 이 환경엔 iOS 기기가 없어 로컬 재현 불가. 계속 효과 없으면 사용자가 "되돌려달라"고 요청 시 롤백 예정, 그다음은 추측 대신 화면에 터치 이벤트 로그 오버레이를 붙여 실제 데이터 확보하는 쪽으로 전환.
- [ ] **기기별 미디어 쿼리 적용 (부분 완료)**: `@media (max-height: 750px)`로 관전 화면의 `SequenceBoard`/`.content` 크기를 줄여 짧은 세로 뷰포트에서 채팅창이 눌리던 문제는 고침(`docs/TROUBLESHOOTING.md` #15). 다만 이건 세로 길이 기준 대응 하나뿐 — 가로 폭이 매우 좁은 기기, `TeamRosterPanel`/`ButtonPanel` 등 다른 화면 요소들의 극단적 화면비는 아직 점검 안 함.

## 확인 필요 (명세 확정 대기)

- [ ] **시퀀스 조립 시 양쪽 역할 보장 여부**: 현재 구현(`server/src/game/sequence.ts`)은 매 스텝마다 돼지/토끼 조각 중 무작위로 골라 이어붙이는 방식이라, "이번 턴엔 내 색상이 한 번도 안 나온다"가 이론상 가능함. 이대로 둘지, "양쪽 최소 1개씩 보장" 규칙을 추가할지 확인 필요.

## 후순위 (완성도)

- [ ] 상단 헤더 장식 요소 — 마스코트 아이콘, **누적 성공 횟수**(4초 타이머 progress바와는 별개, `docs/REQUIREMENTS.md` §9/§12.1 참고 — 이건 범위 제외 확정된 메타 시스템). 4초 타이머 바(`TimerBar`)는 이미 구현됨.
