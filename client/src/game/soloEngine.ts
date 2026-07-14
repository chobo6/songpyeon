import type { Color, Role } from "./colors";

// Manually ported from server/src/game/{rng,fragments,sequence,sequenceLength,turnOrder}.ts,
// restricted to a single role — solo practice mode has no teammate to
// cover the other role's colors, so the sequence only ever contains the
// chosen role's pieces. Client and server are separate npm workspaces
// with no shared-types package, kept in sync by hand (see
// client/src/game/matchTypes.ts for the same pattern).

type Rng = () => number;

function pick<T>(options: readonly T[], rng: Rng): T {
  return options[Math.floor(rng() * options.length)];
}

const MINT_RUN_LENGTHS = [2, 4, 6];
const PIG_BASE_COLORS: Color[] = ["red", "orange", "yellow"];
const RABBIT_PAIR_COLORS: Color[] = ["green", "blue", "pink"];

function mintRun(length: number): Color[] {
  return Array.from({ length }, () => "mint");
}

function generatePigFragment(rng: Rng): Color[] {
  return [pick(PIG_BASE_COLORS, rng), "purple"];
}

function generateRabbitPairFragment(rng: Rng): Color[] {
  return [pick(RABBIT_PAIR_COLORS, rng), pick(RABBIT_PAIR_COLORS, rng)];
}

type FragmentChoice = () => Color[];

function fragmentChoicesForRole(remaining: number, rng: Rng, role: Role): FragmentChoice[] {
  if (role === "pig") {
    return [() => generatePigFragment(rng)];
  }

  const choices: FragmentChoice[] = [];
  const validMintLengths = MINT_RUN_LENGTHS.filter((length) => length <= remaining);
  if (validMintLengths.length > 0) {
    choices.push(() => mintRun(pick(validMintLengths, rng)));
  }
  if (remaining >= 2) {
    choices.push(() => generateRabbitPairFragment(rng));
  }
  return choices;
}

export function generateSoloSequence(totalLength: number, rng: Rng, role: Role): Color[] {
  const sequence: Color[] = [];
  let remaining = totalLength;

  while (remaining > 0) {
    const choices = fragmentChoicesForRole(remaining, rng, role);
    const fragment = pick(choices, rng)();
    sequence.push(...fragment);
    remaining -= fragment.length;
  }

  return sequence;
}

const BUTTONS_PER_ROW = 6;
const STARTING_ROWS = 3;
const ROUNDS_PER_ROW_INCREASE = 10;

export function sequenceLengthForRound(round: number): number {
  const rows = STARTING_ROWS + Math.floor((round - 1) / ROUNDS_PER_ROW_INCREASE);
  return rows * BUTTONS_PER_ROW;
}

export type PressResult = { correct: true; nextCursor: number; complete: boolean } | { correct: false };

export function attemptSoloPress(sequence: Color[], cursor: number, pressedColor: Color): PressResult {
  if (cursor >= sequence.length) return { correct: false };

  const dueColor = sequence[cursor];
  if (pressedColor !== dueColor) return { correct: false };

  const nextCursor = cursor + 1;
  return { correct: true, nextCursor, complete: nextCursor === sequence.length };
}
