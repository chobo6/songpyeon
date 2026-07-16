# TODO

> 지금까지 한 작업은 git 커밋 로그와 `docs/REQUIREMENTS.md`/`docs/ARCHITECTURE.md`/`docs/TROUBLESHOOTING.md` 참고. 이 문서는 앞으로 할 일만 정리.

## 다음에 먼저 볼 것

- [ ] **iOS에서 버튼 입력이 씹히는 현상 — Pointer Events→Touch Events 전환 시도, 실기기 검증 대기**: 안드로이드 문제(2026-07-15 이전 세션)는 `touch-action`/pointerdown+dedupe로 해결됐지만, 아이폰에서 재발 신고. 1차 조사(시도 1: 뷰포트 핀치줌 차단, 효과 없음. 이벤트 로그 오버레이로 캡처한 사례 1건은 실제 오답이었음)에서는 "씹힘처럼 느껴지는 게 사실은 오답+4초 잠금"일 가능성으로 잠정 결론. 이후 사용자가 여러 친구를 통해 재검증한 결과 훨씬 구체적인 패턴 확인: **사파리뿐 아니라 iOS Chrome/Naver 브라우저에서도 동일 재현**(iOS는 모든 브라우저가 WebKit 공유 — Safari 고유 버그가 아니라 WebKit 공통 원인을 시사), **빨강/주황/노랑 + 보라를 동시에 누르면 몇 번은 되다가 보라만 씹히는 패턴**, **빠르게 연타("타다다닥")하면 두세 개 치고 바로 씹힘** — 이건 단순 오답 오인으로는 설명 안 되는, 진짜 멀티터치 드롭 패턴. 원인 후보 분석 후 가장 유력한 것부터 시도: `ButtonPanel.tsx`를 Pointer Events(`onPointerDown`)에서 raw Touch Events(`onTouchStart`)로 전환(2026-07-17) — WebKit의 Pointer Events가 동시 다중 터치 추적에서 TouchEvent보다 덜 신뢰할 수 있다는 게 알려진 이슈. **다음 단계**: 실제 iOS 기기(Safari/Chrome/Naver)로 재검증 필요 — 이 환경엔 iOS 기기가 없어 로컬 재현 불가, 사용자 쪽 테스트에 의존. 안 고쳐지면 다음 후보: `.panel`/`.empty` 등 버튼 사이 빈 공간까지 `touch-action: none` 확장(현재 개별 버튼에만 적용됨 — 동시 터치 중 하나가 빈 공간에 살짝 걸리면 iOS 제스처 인식기가 가로챌 여지), `:active` 스케일 트랜지션(0.93, 0.1s) 축소/제거.
- [ ] **기기별 미디어 쿼리 적용 (부분 완료)**: `@media (max-height: 750px)`로 관전 화면의 `SequenceBoard`/`.content` 크기를 줄여 짧은 세로 뷰포트에서 채팅창이 눌리던 문제는 고침(`docs/TROUBLESHOOTING.md` #15). 다만 이건 세로 길이 기준 대응 하나뿐 — 가로 폭이 매우 좁은 기기, `TeamRosterPanel`/`ButtonPanel` 등 다른 화면 요소들의 극단적 화면비는 아직 점검 안 함.

## 확인 필요 (명세 확정 대기)

- [ ] **시퀀스 조립 시 양쪽 역할 보장 여부**: 현재 구현(`server/src/game/sequence.ts`)은 매 스텝마다 돼지/토끼 조각 중 무작위로 골라 이어붙이는 방식이라, "이번 턴엔 내 색상이 한 번도 안 나온다"가 이론상 가능함. 이대로 둘지, "양쪽 최소 1개씩 보장" 규칙을 추가할지 확인 필요.

## 후순위 (완성도)

- [ ] 상단 헤더 장식 요소 — 마스코트 아이콘, **누적 성공 횟수**(4초 타이머 progress바와는 별개, `docs/REQUIREMENTS.md` §9/§12.1 참고 — 이건 범위 제외 확정된 메타 시스템). 4초 타이머 바(`TimerBar`)는 이미 구현됨.
