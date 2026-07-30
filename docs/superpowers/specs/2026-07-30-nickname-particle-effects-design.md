# 닉네임 파티클 효과 — 설계 문서

> 이 스펙은 즉석 스파이크(임시 코드를 실제 게임에 바로 적용해 눈으로 반복 검증)로
> 레이아웃/랜덤성 문제를 전부 먼저 풀어낸 뒤 작성됐다. 스파이크 과정에서 확정된
> 결론을 그대로 반영한다 — 새로 논의할 것은 거의 없고, 검증된 스파이크 코드를
> 정식 기능으로 정리하는 것이 이 스펙의 목적이다.

## 배경

기존 닉네임 특수효과(레인보우/샤인/홀로그램/Pulse/네온사인/크롬)에 이어, 닉네임
주위에 작은 점(파티클)이 떠다니는 효과 4종(**반짝임/상승/궤도/눈**)을 추가한다.
관리자 전용 지급(상점 판매 없음)으로 시작한다.

## 스파이크에서 확정된 것들

- **점 하나하나는 실제 DOM 엘리먼트**여야 한다. box-shadow 하나에 여러 점을
  욱여넣는 트릭은 그 안의 점들이 전부 같은 애니메이션을 공유해서 "항상 같은
  2~3곳에서만 반복"되는 것처럼 보이는 근본적 한계가 있었다.
- 점 개수는 **6개**, 위치는 닉네임 텍스트 폭 전체(4%~96%)에서 **색상 문자열을
  시드로 한 유사난수**로 각각 독립적으로 스폰된다. `Math.random()`은 쓰지
  않는다 — 스타일 계산 함수가 리렌더마다 다시 호출되므로 진짜 랜덤을 쓰면
  리렌더마다 위치가 튀어 보인다. 시드 기반이라 같은 사람은 항상 같은 배치를
  유지하면서도, 사람마다 달라 보인다.
- **상승/눈**은 낙하·상승 중 좌우로 흔들리는 drift(바람에 날리는 느낌)가
  있어야 매 애니메이션 루프가 완전히 같은 경로를 그리는 것처럼 안 보인다.
- **효과(effect)와 파티클은 서로 독립적인 축**이다 — 글로우가 이미 효과와
  독립적으로 켜지는 것처럼, 파티클도 어떤 효과 위에든(또는 효과 없이도) 얹을
  수 있다.
- 파티클을 렌더링하는 요소가 **`flex: 1`이나 `width: 100%` 같은 확장
  레이아웃과 같은 엘리먼트에 있으면 안 된다** — 확장된 박스 기준으로 위치가
  계산돼서 실제 글자와 어긋난다(랭킹/친구창/관전자 목록에서 실제로 겪은
  버그). 레이아웃(폭 확장·말줄임)을 담당하는 바깥 엘리먼트와, 텍스트+파티클을
  담당하는 안쪽 엘리먼트를 분리해야 한다.
- **궤도(orbit)**는 반지름을 좁은 줄 높이에 맞게 압축하면 글자와 겹치는
  문제가 있음을 알고도, 4종 다 출시하기로 결정함(§출시 범위).

## 출시 범위

- **효과 4종 전부**: 반짝임(twinkle) / 상승(rising) / 궤도(orbit) / 눈(snow).
  궤도는 좁은 화면에서 글자와 겹칠 수 있음을 알고 진행 — 필요해지면 나중에
  별도로 손본다.
- **닉네임이 뜨는 9곳 전부**: 로스터(`TeamRosterPanel`), 랭킹(`RankingModal`),
  친구창(`FriendsModal`, 3곳: 받은요청/보낸요청/친구목록), 채팅(`ChatBox`),
  관전자 목록(`SpectatorCountBadge`), 프로필 팝업(`ProfileModal`), 로비
  프로필바(`RoomList`), 역할선택 대기 목록·로스터(`RoleSelect`, 2곳), 상점
  미리보기(`ShopModal`).
- **관리자 전용 지급** — 상점 판매 없음(효과처럼 나중에 상점에 올릴 수 있게
  구조는 열어두되, 이번 스코프에는 포함 안 함).

## 데이터 모델

`users` 테이블에 컬럼 추가:

```sql
ALTER TABLE users ADD COLUMN nickname_particle TEXT NOT NULL DEFAULT 'none'
```

기존 `max_round`/`nickname_glow` 등과 동일한 `ALTER TABLE ADD COLUMN` 가드
패턴(`connection.ts`)을 따른다 — 이미 배포된 DB에도 안전하게 적용됨.

```ts
export type NicknameParticle = "none" | "twinkle" | "rising" | "orbit" | "snow";
export const NICKNAME_PARTICLES: readonly NicknameParticle[] = ["none", "twinkle", "rising", "orbit", "snow"];
```

`nickname_effect`/`nickname_glow`와 완전히 독립적인 컬럼 — 서로 다른 값 조합이
전부 유효하다(예: 크롬 효과 + 눈 파티클 동시 적용).

## 서버

- `setNicknameEffect(userId, effect, glow)` → `setNicknameEffect(userId, effect, glow, particle)`로
  확장. 효과/글로우와 같은 UPDATE 문에 `nickname_particle`도 같이 갱신한다.
  파티클은 상점 소유권(`owned_nickname_effects`) 대상이 아니므로(관리자 전용,
  §출시 범위) 효과처럼 소유권 INSERT를 하지 않는다 — 단순히 컬럼 값만 갱신.
- `UserProfile`, `AdminUserRow`, 그리고 `nicknameEffect`/`nicknameGlow`를
  들고 있는 다른 모든 타입·SELECT(`friendships.ts`의 `FriendListEntry`,
  `directMessages.ts`의 발신자 필드, `MatchState.ts`의 Colyseus Schema 3곳)에
  `nicknameParticle` 필드를 같이 추가한다 — 글로우를 추가했을 때와 완전히
  같은 전파 패턴.
- `POST /api/admin/users/:id/nickname-effects` 라우트가 `particle` 필드도
  받아서 `NICKNAME_PARTICLES` 화이트리스트로 검증 후 전달.

## 클라이언트

- `nicknameStyle(color, effect, glow, particle)` — 4번째 인자 추가. 반환값에
  `particles: { key: number; className: string; style: CSSProperties }[]`
  포함(스파이크에서 검증된 시드 기반 6점 랜덤 배치 로직 그대로 이관, `color`를
  시드로 사용).
- 지금 임시로 박아둔 모듈 스코프 상수 `SPIKE_PARTICLE`은 삭제 — 대신 각
  화면이 실제 유저 데이터의 `nicknameParticle` 필드를 네 번째 인자로 넘긴다.
- CSS 클래스명에서 "spike"/"TEMP" 표시를 떼고 정식 이름으로 정리
  (`spikeWrap`→`particleWrap`, `spikeDot`→`particleDot` 등). 시각적 로직
  자체(색상 시드 기반 6점, drift, twinkle/rising/orbit/snow 각 키프레임)는
  스파이크에서 이미 검증된 그대로 유지.
- 9곳의 렌더링 위치 중, 레이아웃이 확장되는 요소(랭킹의 `.nickname`,
  친구창의 `.rowNickname`, 관전자 목록의 `.row` — 전부 `flex:1` 또는
  `width:100%`)는 이미 이번 스파이크에서 텍스트 전용 안쪽 `<span>`으로
  분리해뒀다 — 그 구조를 그대로 유지한다.

## 관리자 페이지

`AdminUsers.tsx`의 효과 `<select>` 옆에 파티클 `<select>`를 추가(없음/반짝임/
상승/궤도/눈), 같은 `POST /api/admin/users/:id/nickname-effects` 요청에
`particle` 필드를 같이 실어 보낸다. 효과/글로우와 마찬가지로 즉시 반영, 실패
케이스 없음(화이트리스트 검증은 라우트 레벨에서 끝).

## 테스트

- 서버: `googleAuth.test.ts`에 `setNicknameEffect`가 `nickname_particle`을
  올바르게 저장/조회하는지, 효과·글로우와 독립적으로 바뀌는지 테스트 추가
  (TDD, 기존 파일 컨벤션 그대로).
- 클라이언트: 이 프로젝트는 `nicknameStyle.ts`처럼 순수 UI 계산 로직에 대한
  유닛테스트 관례가 없음(타입체크 + 수동/Playwright 확인). 이번에도 동일 —
  랜덤 배치·drift·레이아웃 안 깨짐은 이미 이번 세션에서 Playwright로 실측
  검증했으므로, 정식 구현 후에도 같은 방식(스크린샷 + computed style 확인)으로
  재검증한다.

## 범위 제외

- 파티클 상점 판매(가격 책정 등) — 나중에 별도 스펙.
- 궤도(orbit)를 좁은 줄 높이에서 안 겹치게 만드는 근본 수정 — 알려진 한계로
  두고 출시.
- **로스터(`TeamRosterPanel`)의 좁은 자리에서 상승/눈/궤도가 잘리는 문제** —
  `.seatName`이 다른 8곳(랭킹/친구창 등)과 달리 여백이 전혀 없고
  `overflow: hidden`이라, 위아래로 이동하는 점(상승/눈)이나 중심 밖으로
  튀어나가는 궤도 링이 실제로 잘린다. 최종 리뷰에서 발견됨(2026-07-31) —
  올바르게 고치려면 이펙트 색상(`background-clip: text` 등)과 파티클 위치
  기준점을 서로 다른 엘리먼트로 분리해야 하는데, 그러면 레인보우 같은 효과가
  중첩된 엘리먼트에서도 그라데이션이 정확히 클리핑되는지 다시 검증해야 해서
  위험 대비 이득이 낮다고 판단, 궤도의 기존 한계와 같은 카테고리로 묶어
  알려진 한계로 남기고 출시함. 반짝임(twinkle)은 이동이 없어 이 문제가 없음.
