import type { ItemId } from "./items";
import type { Rng } from "./rng";

export const BONUS_ITEM_CHANCE = 0.1;

const ALL_ITEM_IDS: ItemId[] = ["timeAdd", "timeReduce", "doughAttack", "superMortar", "mortarRestore"];

export interface BonusItemRoll {
  index: number;
  itemId: ItemId;
}

// 10% 확률로 시퀀스 안 랜덤 위치 하나에 5개 아이템 중 균등 랜덤으로 하나를 붙인다.
// 당첨되지 않으면 null. rng 호출 순서: (1) 당첨 여부, (2) 위치, (3) 어떤 아이템인지 —
// 순서를 바꾸면 큐에 값을 채워 쓰는 테스트들의 기대값이 깨지므로 고정.
export function rollBonusItemIndex(sequenceLength: number, rng: Rng): BonusItemRoll | null {
  if (rng() >= BONUS_ITEM_CHANCE) return null;
  const index = Math.floor(rng() * sequenceLength);
  const itemId = ALL_ITEM_IDS[Math.floor(rng() * ALL_ITEM_IDS.length)];
  return { index, itemId };
}
