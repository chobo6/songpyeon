const BUTTONS_PER_ROW = 6;
const DEFAULT_STARTING_ROWS = 3;
const ROUNDS_PER_ROW_INCREASE = 10;

export function sequenceLengthForRound(round: number, startingRows: number = DEFAULT_STARTING_ROWS): number {
  const rows = startingRows + Math.floor((round - 1) / ROUNDS_PER_ROW_INCREASE);
  return rows * BUTTONS_PER_ROW;
}
