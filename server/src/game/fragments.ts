import type { Color } from "./colors";
import { pick, type Rng } from "./rng";

export const MINT_RUN_LENGTHS = [2, 4, 6];

const PIG_BASE_COLORS: Color[] = ["red", "orange", "yellow"];
const RABBIT_PAIR_COLORS: Color[] = ["green", "blue", "pink"];

export function mintRun(length: number): Color[] {
  return Array.from({ length }, () => "mint");
}

export function generatePigFragment(rng: Rng): Color[] {
  return [pick(PIG_BASE_COLORS, rng), "purple"];
}

export function generateRabbitMintFragment(rng: Rng): Color[] {
  return mintRun(pick(MINT_RUN_LENGTHS, rng));
}

export function generateRabbitPairFragment(rng: Rng): Color[] {
  return [pick(RABBIT_PAIR_COLORS, rng), pick(RABBIT_PAIR_COLORS, rng)];
}

// 오른쪽버튼(초록/파랑/분홍) 하나 - 민트 2개 - 오른쪽버튼 하나(독립적으로 다시 랜덤 뽑음, 같은
// 색이 나올 수도 있음).
export function generateRabbitMintBracket4Fragment(rng: Rng): Color[] {
  return [pick(RABBIT_PAIR_COLORS, rng), "mint", "mint", pick(RABBIT_PAIR_COLORS, rng)];
}

// 오른쪽버튼 하나 - 민트 4개 - 처음과 같은 오른쪽버튼(양 끝 색이 항상 같음, 한 번만 뽑음).
export function generateRabbitMintBracket6Fragment(rng: Rng): Color[] {
  const button = pick(RABBIT_PAIR_COLORS, rng);
  return [button, "mint", "mint", "mint", "mint", button];
}
