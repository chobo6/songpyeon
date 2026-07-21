import type { Color } from "./colors";

// 손가락으로 화면을 눌러서는 사실상 낼 수 없는 속도로 같은 버튼이 반복 입력되는 걸
// 억제하기 위한 임계값 — 폰에 키보드/매크로를 연결해 버튼 위치에 키를 매핑해 연타하는
// 걸 막는 게 목적. 토끼의 민트 버튼에 한정(다른 색은 그대로 둠) — 이 게임에서 같은
// 버튼을 반복해서 눌러야 하는 유일한 패턴이 민트 런(mint run, server/src/game/fragments.ts)
// 이라, 손가락 재입력 속도의 한계가 가장 잘 드러나는 자리이기 때문.
export const MINT_SPAM_THRESHOLD_MS = 35;

// msSinceLastPress: 직전 버튼 입력(색 무관)으로부터 지난 시간(ms). null이면 이번
// 턴의 첫 입력이라는 뜻이라 비교 대상이 없으므로 항상 통과시킨다.
export function isSpammedMintPress(color: Color, msSinceLastPress: number | null): boolean {
  if (color !== "mint") return false;
  if (msSinceLastPress === null) return false;
  return msSinceLastPress < MINT_SPAM_THRESHOLD_MS;
}
