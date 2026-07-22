import { colorRole, type Color } from "./colors";

// 손가락으로 화면을 눌러서는 사실상 낼 수 없는 속도로 버튼이 입력되는 걸 억제하기
// 위한 역할별 임계값 — 폰에 키보드/매크로를 연결해 버튼 위치에 키를 매핑해 연타하는
// 걸 막는 게 목적.
//
// 토끼: 민트 버튼만 대상 — 이 게임에서 같은 버튼을 반복해서 눌러야 하는 유일한
// 패턴이 민트 런(mint run, server/src/game/fragments.ts)이라, 손가락 재입력
// 속도의 한계가 가장 잘 드러나는 자리이기 때문. 다른 토끼 색(초록/파랑/분홍)은
// 항상 서로 다른 색과 섞여 나오므로 대상에서 제외.
export const MINT_SPAM_THRESHOLD_MS = 20;

// 돼지: 4색(빨강/주황/노랑/보라) 전부 대상 — 돼지 조각은 [색상, 보라] 구조라 같은
// 색이 연속으로 나오는 패턴 자체가 없다(항상 다른 색이 이어짐). 그래서 이건
// "같은 버튼 연타"가 아니라 "색이 바뀌었는데도 사람이 인식하고 반응하기엔 너무
// 빠른 입력"을 잡는 용도라, 민트보다 훨씬 타이트한 임계값을 쓴다 — 색을 인식하고
// 반응할 시간이 사실상 없는 속도라 매크로로 봐야 함.
export const PIG_SPAM_THRESHOLD_MS = 0;

// msSinceLastPress: 직전 버튼 입력(색 무관)으로부터 지난 시간(ms). null이면 이번
// 턴의 첫 입력이라는 뜻이라 비교 대상이 없으므로 항상 통과시킨다.
export function isSpammedPress(color: Color, msSinceLastPress: number | null): boolean {
  if (msSinceLastPress === null) return false;
  if (color === "mint") return msSinceLastPress < MINT_SPAM_THRESHOLD_MS;
  if (colorRole(color) === "pig") return msSinceLastPress < PIG_SPAM_THRESHOLD_MS;
  return false;
}
