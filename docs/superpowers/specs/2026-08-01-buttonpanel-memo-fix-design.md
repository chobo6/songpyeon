# ButtonPanel 메모이제이션 누수 수정 — 설계 문서

## 배경

`MyTurnScreen.tsx:88`은 매 렌더마다 `Array.from(me.inventory)`로 새 배열을 만들어
`ButtonPanel`에 `inventory` prop으로 넘긴다(Colyseus `ArraySchema`가 in-place로
변형되는 걸 우회하기 위한 의도적인 선택 — 그 자체는 올바름). 문제는
`ButtonPanel`이 `React.memo(Component)`로만 감싸져 있어서(커스텀 비교 함수
없음) 기본 얕은 비교를 쓰는데, `inventory`가 매번 새 배열 참조라 이 비교가
항상 "달라짐"으로 판정된다. 그 결과 `role`/`disabled`/실제 인벤토리 내용이
전혀 안 바뀌어도, 내 턴 동안 서버에서 오는 다른 상태 변화(다른 팀 채팅,
다른 팀 포탄 변화 등 — `useMatchRoom.ts`가 모든 Colyseus 패치마다
`forceRender()`로 화면 전체를 리렌더시키므로)가 있을 때마다 색깔 버튼 6개가
불필요하게 다시 그려진다. 정확히 연타 중 메인 스레드가 바빠지면 안 되는
타이밍에 낭비되는 작업이라, 버튼 인식 지연 체감의 원인 후보 중 하나다.

## 설계

`TeamRosterPanel.tsx`가 이미 쓰고 있는 패턴 — `memo(Component, customEqualFn)`
— 을 `ButtonPanel.tsx`에 그대로 적용한다. `MyTurnScreen.tsx`는 건드리지 않고
`ButtonPanel.tsx` 한 파일 안에서 해결한다.

```ts
function buttonPanelPropsEqual(prev: ButtonPanelProps, next: ButtonPanelProps) {
  const prevInventory = prev.inventory ?? [];
  const nextInventory = next.inventory ?? [];
  return (
    prev.role === next.role &&
    prev.disabled === next.disabled &&
    prev.onPress === next.onPress &&
    prev.onUseItem === next.onUseItem &&
    prevInventory.length === nextInventory.length &&
    prevInventory.every((id, i) => id === nextInventory[i])
  );
}
```

- `role`/`disabled`는 원시값이라 그대로 비교.
- `onPress`/`onUseItem`은 `MyTurnScreen.tsx`가 이미 `useCallback`으로 안정된
  참조를 넘기고 있으므로(기존 코드, 안 바뀜) 참조 비교로 충분.
- `inventory`만 참조 대신 길이+원소 값으로 비교 — 인벤토리는 아이템 몇 개
  수준이라 매번 순회해도 비용이 무시할 만하다. `?? []`로 `undefined`(솔로
  모드처럼 `inventory` prop 자체를 안 넘기는 호출부, `SoloPlayScreen.tsx`)도
  안전하게 처리한다.
- 현재 인라인으로 되어있는 prop 타입을 `interface ButtonPanelProps`로 뽑아내
  컴포넌트 함수와 비교 함수가 같은 타입을 공유하게 한다(`TeamRosterPanelProps`와
  동일한 구조).

`inventory` prop 자체의 타입/전달 방식(여전히 배열)이나 `MyTurnScreen.tsx`의
`Array.from(me.inventory)` 호출은 그대로 둔다 — 그건 렌더링에 실제로 최신
인벤토리 내용을 반영하기 위해 필요한 코드고, 문제는 오로지 memo 비교
쪽이었다.

## 테스트

이 프로젝트는 React 컴포넌트 렌더링에 대한 단위테스트 관례가 없다(타입체크
+ 수동/Playwright 확인, `nicknameStyle.ts` 등 순수 로직만 예외). 이번에도
같은 방식으로 검증한다:

1. 타입체크(`tsc -b`)로 새 타입/비교 함수가 올바른지 확인.
2. 수정 전, `ButtonPanel` 컴포넌트 본문에 임시로 렌더 횟수를 세는 계측(예:
   `console.log`)을 넣고, Playwright로 다음을 재현한다: 두 개의 연결(내 턴
   플레이어 하나 + 같은 방의 다른 탭)을 만들고, 플레이어가 자기 턴 동안
   다른 탭에서 채팅 메시지를 보낸다 — 이 채팅 자체는 `ButtonPanel`과 무관한
   상태 변화지만 `useMatchRoom`의 전체 리렌더 때문에 수정 전에는
   `ButtonPanel`도 다시 그려짐을 콘솔 로그로 확인한다.
3. 수정 후, 같은 시나리오를 반복해서 채팅 전송에도 `ButtonPanel`의 렌더
   횟수가 늘지 않는 것을 확인한다.
4. 계측 코드는 검증 후 제거한다(커밋에 남기지 않음).
5. 아이템 렌더링/클릭 로직 자체(`inventory` prop을 어떻게 그리는지,
   `onUseItem` 호출 방식)는 이번 변경에서 전혀 안 건드리므로 — 바뀌는 건
   memo 비교 방식뿐 — 실제 아이템 획득까지 재현하는 라이브 테스트는 하지
   않는다. 대신 `buttonPanelPropsEqual`이 인벤토리 원소가 하나라도 다르면
   반드시 "다름"으로 판정하는지(길이 다름 + 같은 길이인데 원소 다름 두
   경우 다) 코드 리뷰로 확인한다.

## 범위 제외

- `useMatchRoom.ts`의 patch당 전체 리렌더 구조 자체를 필드별 구독으로
  바꾸는 것 — 별도로 다룰 더 큰 아키텍처 변경.
- 그라데이션 텍스트 효과(레인보우/샤인/홀로그램/크롬)의 렌더링 비용 최적화
  — 별도 스코프.
