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
