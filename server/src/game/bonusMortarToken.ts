import type { Rng } from "./rng";

export const BONUS_MORTAR_CHANCE = 0.008;

// 0.8% 확률로 [0, sequenceLength) 범위의 균등 랜덤 인덱스 하나를 반환하고,
// 당첨되지 않으면 null. 시퀀스당 최대 1개라는 규칙은 호출부(MatchRoom.startTurn)가
// 이 함수를 턴마다 정확히 한 번만 호출하는 것으로 자연스럽게 지켜진다 — 이 함수
// 자체는 "여러 번 호출하면 여러 개 나올 수 있다"는 제약이 없는 단순 단발 룰렛이다.
export function rollBonusMortarIndex(sequenceLength: number, rng: Rng): number | null {
  if (rng() >= BONUS_MORTAR_CHANCE) return null;
  return Math.floor(rng() * sequenceLength);
}
