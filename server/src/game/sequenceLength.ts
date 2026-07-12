const BUTTONS_PER_ROW = 6;
const STARTING_ROWS = 3;
const ROUNDS_PER_ROW_INCREASE = 10;

export function sequenceLengthForRound(round: number): number {
  const rows = STARTING_ROWS + Math.floor((round - 1) / ROUNDS_PER_ROW_INCREASE);
  return rows * BUTTONS_PER_ROW;
}
