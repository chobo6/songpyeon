import type { Color, Role } from "./colors";
import { mintRun, generatePigFragment } from "./fragments";

export type ItemId = "timeAdd" | "timeReduce" | "doughAttack" | "superMortar" | "mortarRestore";

const MIN_TURN_DURATION_MS = 1000;

// 같은 창(턴) 안에서 아이템별 1회 사용만 허용하는 최소 단위 — "이번 턴에 이미 쓴 아이템"과
// "다음 턴에 예약된 아이템" 두 군데 모두에서 재사용한다(둘 다 "한 번 쓰면 그걸로 끝, 또 써도
// no-op" 규칙이 동일하므로).
export class ItemUseTracker {
  private used = new Set<ItemId>();

  // 처음 쓰는 아이템이면 true(효과를 적용해야 함), 이미 쓴 아이템이면 false(무시).
  tryUse(itemId: ItemId): boolean {
    if (this.used.has(itemId)) return false;
    this.used.add(itemId);
    return true;
  }

  // 소비하지 않고 "예약/사용됐는지"만 확인 — startTurn()이 pendingItemsForNextTurn을
  // 조회할 때 씀(조회 시점에 지워버리면 doughAttack/timeReduce를 순서대로 두 번
  // 조회하는 도중 상태가 바뀌어버림).
  has(itemId: ItemId): boolean {
    return this.used.has(itemId);
  }

  reset(): void {
    this.used.clear();
  }
}

// 반죽공격: 시퀀스 맨 앞에 6버튼(1줄)을 붙인다. 원본 배열은 건드리지 않음.
// role은 이 반죽이 누구에게 떨어지는지 — 정상/초보/토끼전은 토끼(민트 6개, 기존 그대로),
// 돼지전은 방 전체가 돼지 역할이라 민트를 아무도 못 누르므로 돼지 조각 3개(색+보라 ×3
// = 6버튼)로 대신한다. 그 방의 유일한 역할이 처리 가능한 색으로 붙여야 턴이 실제로
// 풀릴 수 있다.
export function applyDoughAttack(sequence: Color[], role: Role = "rabbit"): Color[] {
  if (role === "pig") {
    const pigPrefix = [
      ...generatePigFragment(Math.random),
      ...generatePigFragment(Math.random),
      ...generatePigFragment(Math.random),
    ];
    return [...pigPrefix, ...sequence];
  }
  return [...mintRun(6), ...sequence];
}

// 시간감소: durationMs에서 1초를 빼되 MIN_TURN_DURATION_MS 밑으로는 안 내려간다.
// 바닥을 두는 이유: turnDurationMs가 테스트에서 아주 짧게(예: 500ms) 설정될 수 있어,
// 그대로 1초를 빼면 음수/0 타이머가 되어 즉시 만료되거나 setTimeout이 오작동할 수 있음.
export function applyTimeReduce(durationMs: number): number {
  return Math.max(MIN_TURN_DURATION_MS, durationMs - 1000);
}
