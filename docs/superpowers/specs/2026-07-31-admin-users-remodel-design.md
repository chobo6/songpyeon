# 관리자 유저 페이지 리모델링 — 설계 문서

## 배경

관리자 페이지(`/admin` → 유저 정보)가 유저 485명 전원을 한 번에 테이블로 렌더링하고,
편집 상태(`editingId`/`colorEditingId`, 편집 중인 값)가 컴포넌트 최상단에 있어서
어떤 입력창이든 한 글자 칠 때마다 485행 전체가 리렌더링됨 — 특히 닉네임 색상
편집 시 체감 버벅임이 심함(근본 원인 분석 완료, 대화 기록 참고). 이번 리모델링으로
① 페이지네이션으로 유저 수 증가에 안정적으로 대응하고 ② 편집 UI를 별도 모달로
분리해 테이블 자체는 읽기 전용으로 만들고 ③ 게임머니 지급/차감 기능을 새로 추가한다.

## 테이블

- 페이지네이션: 검색으로 필터링된 결과를 50명 단위로 클라이언트에서 자름. 서버
  라우트(`GET /api/admin/users`)는 변경 없음 — 지금처럼 전체를 한 번에 fetch하고,
  화면에는 현재 페이지분만 `.slice()`해서 렌더링. 검색어를 바꾸면 1페이지로
  리셋한다(필터링된 결과 기준으로 페이지 번호가 무의미해지는 걸 방지).
- 각 행은 읽기 전용 요약만 표시: id / 이메일 / 이름 / 닉네임 / 닉네임 색상(스와치 +
  hex 텍스트) / 효과·파티클 라벨(글로우 켜져 있으면 같이 표시) / 가입일 / 최근 로그인.
- 행의 액션 칸은 기존 밴·해제 버튼, 모니터링 버튼(그대로, 위치 변경 없음)에 새
  "수정" 버튼 하나를 추가 — 누르면 그 유저를 대상으로 `AdminEditUserModal`을 연다.
- 기존 인라인 편집(닉네임 텍스트 입력, 색상 hex 입력, 효과/파티클 드롭다운, 글로우
  체크박스)은 테이블에서 전부 제거 — 그 UI가 통째로 모달로 옮겨간다.

## `AdminEditUserModal` (신규 컴포넌트)

`client/src/components/AdminEditUserModal.tsx` — `ProfileModal`/`ShopModal`과 같은
오버레이+모달 패턴(`position:fixed; inset:0` 배경 오버레이, 클릭 시 `onClose`,
모달 박스는 `stopPropagation`). Props: `user: UserRow`, `onClose: () => void`,
`onSaved: () => void`(저장 성공 시 부모의 `loadUsers()`를 다시 부르기 위한 콜백).

4개 섹션, 각각 독립적으로 저장(항목별 개별 저장 — 하나 실패해도 나머지엔 영향 없음):

1. **닉네임 변경**: 텍스트 입력(기존 `MAX_NICKNAME_LENGTH` 유지) + 저장 버튼.
   기존 `POST /api/admin/users/:id/nickname` 그대로 재사용.
2. **닉네임 색상**: hex 입력 + 저장 버튼, 옆에 실시간 스와치 미리보기. 기존
   `POST /api/admin/users/:id/nickname-color` 그대로 재사용.
3. **효과 / 글로우 / 파티클**: 지금 테이블에 있던 드롭다운 2개 + 체크박스를 그대로
   모달로 옮김. 기존 `POST /api/admin/users/:id/nickname-effects`(effect+glow+particle
   같이 보내는 라우트) 그대로 재사용 — 로직 변경 없음, 렌더링 위치만 이동.
4. **게임머니 지급/차감** (신규): 현재 잔액 표시, 부호 있는 정수 입력(`+10000`,
   `-5000`) + "적용" 버튼. 입력값을 파싱해 델타로 서버에 보낸다 — 절대값 설정이
   아니라 증감 방식(이미 있는 `addGameMoney(userId, amount)`를 그대로 델타로 재사용).

각 섹션은 저장 성공 시 `onSaved()`를 호출해 부모 테이블 목록을 갱신하되, 모달 자체는
닫지 않는다(관리자가 한 유저의 여러 항목을 연달아 고칠 수 있어야 하므로) — 대신 모달
내부에 그 섹션 값을 최신 상태로 반영해서 보여준다.

## 서버 — 게임머니 조정 라우트 (신규)

`POST /api/admin/users/:id/game-money`, body `{ delta: number }`.

- `delta`가 정수가 아니거나 0이면 400.
- `getUserById`로 대상 유저 존재 확인, 없으면 404.
- `addGameMoney(userId, delta)` 호출 후 `{ ok: true }` 응답.

`addGameMoney`의 SQL을 다음과 같이 살짝 고친다 — 차감이 잔액을 마이너스로 만들지
않도록 클램프 추가(지금은 클램프가 없어 관리자가 실수로 잔액보다 큰 금액을 차감하면
음수가 될 수 있음):

```ts
export function addGameMoney(userId: number, amount: number): void {
  db.prepare(`UPDATE users SET game_money = MAX(0, game_money + ?) WHERE id = ?`).run(amount, userId);
}
```

이 함수는 매치 턴 성공 보상(`MatchRoom.ts`)에서도 쓰이는데, 그쪽은 항상 양수만
넘기므로 클램프가 있어도 동작 변화 없음(양수를 더해서 음수가 될 일이 없으므로
`MAX(0, ...)`이 no-op).

## 범위 제외

- 서버 사이드 페이지네이션(쿼리 파라미터로 offset/limit) — 지금 규모(수백 명)에서는
  전체를 한 번에 fetch해도 네트워크 비용이 크지 않고, 느려지는 지점은 렌더링이지
  fetch가 아니므로 클라이언트 페이지네이션으로 충분. 유저가 수만 명 단위로
  늘어나면 그때 다시 검토.
- 게임머니 조정 이력 로그(누가 언제 얼마를 줬는지 기록) — 필요해지면 별도 스펙.
