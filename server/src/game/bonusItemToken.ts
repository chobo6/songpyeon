import type { ItemId } from "./items";
import type { Rng } from "./rng";

export const BONUS_ITEM_CHANCE = 0.1;

const ALL_ITEM_IDS: ItemId[] = ["timeAdd", "timeReduce", "doughAttack", "superMortar", "mortarRestore", "goblinMagic"];

export interface BonusItemRoll {
  index: number;
  itemId: ItemId;
}

// 10% 확률로 시퀀스 안 랜덤 위치 하나에 아이템 중 균등 랜덤으로 하나를 붙인다.
// 당첨되지 않으면 null. rng 호출 순서: (1) 당첨 여부, (2) 위치, (3) 어떤 아이템인지 —
// 순서를 바꾸면 큐에 값을 채워 쓰는 테스트들의 기대값이 깨지므로 고정.
// excludeItemIds: 돼지전/토끼전처럼 특정 아이템이 애초에 의미가 없는 모드에서 풀에서
// 빼기 위함 — 기본은 빈 배열(6개 전부 후보).
export function rollBonusItemIndex(
  sequenceLength: number,
  rng: Rng,
  excludeItemIds: ItemId[] = [],
): BonusItemRoll | null {
  if (rng() >= BONUS_ITEM_CHANCE) return null;
  const index = Math.floor(rng() * sequenceLength);
  const pool = ALL_ITEM_IDS.filter((id) => !excludeItemIds.includes(id));
  const itemId = pool[Math.floor(rng() * pool.length)];
  return { index, itemId };
}
