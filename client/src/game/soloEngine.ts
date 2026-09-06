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
const BUTTONS_PER_ROW = 6;

function mintRun(length: number): Color[] {
  return Array.from({ length }, () => "mint");
}

function generatePigFragment(rng: Rng): Color[] {
  return [pick(PIG_BASE_COLORS, rng), "purple"];
}

function generateRabbitPairFragment(rng: Rng): Color[] {
  return [pick(RABBIT_PAIR_COLORS, rng), pick(RABBIT_PAIR_COLORS, rng)];
}

// 오른쪽버튼(초록/파랑/분홍) 하나 - 민트 2개 - 오른쪽버튼 하나(독립적으로 다시 랜덤 뽑음).
function generateRabbitMintBracket4Fragment(rng: Rng): Color[] {
  return [pick(RABBIT_PAIR_COLORS, rng), "mint", "mint", pick(RABBIT_PAIR_COLORS, rng)];
}

// 오른쪽버튼 하나 - 민트 4개 - 처음과 같은 오른쪽버튼(양 끝 색이 항상 같음).
function generateRabbitMintBracket6Fragment(rng: Rng): Color[] {
  const button = pick(RABBIT_PAIR_COLORS, rng);
  return [button, "mint", "mint", "mint", "mint", button];
}

type FragmentChoice = () => Color[];
// 두 브라켓 패턴(bracket4/6)이 서로 붙어 나오지 않도록, 직전 조각이 브라켓이었는지 태깅한다.
type FragmentOption = { make: FragmentChoice; isBracket: boolean };

// 브라켓 패턴(bracket4/6)은 줄바꿈 중간에 걸쳐서 나오면 안 됨 — 4칸짜리는 그 줄의 1번째
// 칸(col0) 또는 3번째 칸(col2)에서만, 6칸짜리는 줄 전체를 다 쓰므로 1번째 칸(col0)에서만
// 시작 가능.
function canStartBracket4(column: number): boolean {
  return column === 0 || column === 2;
}
function canStartBracket6(column: number): boolean {
  return column === 0;
}

function fragmentChoicesForRole(
  remaining: number,
  rng: Rng,
  role: Role,
  excludeBracket: boolean,
  column: number,
): FragmentOption[] {
  if (role === "pig") {
    return [{ make: () => generatePigFragment(rng), isBracket: false }];
  }

  const choices: FragmentOption[] = [];
  const validMintLengths = MINT_RUN_LENGTHS.filter((length) => length <= remaining);
  if (validMintLengths.length > 0) {
    choices.push({ make: () => mintRun(pick(validMintLengths, rng)), isBracket: false });
  }
  if (remaining >= 2) {
    choices.push({ make: () => generateRabbitPairFragment(rng), isBracket: false });
  }
  if (!excludeBracket) {
    if (remaining >= 4 && canStartBracket4(column)) {
      choices.push({ make: () => generateRabbitMintBracket4Fragment(rng), isBracket: true });
    }
    if (remaining >= 6 && canStartBracket6(column)) {
      choices.push({ make: () => generateRabbitMintBracket6Fragment(rng), isBracket: true });
    }
  }
  return choices;
}

export function generateSoloSequence(totalLength: number, rng: Rng, role: Role): Color[] {
  const sequence: Color[] = [];
  let remaining = totalLength;
  let previousWasBracket = false;

  while (remaining > 0) {
    const column = (totalLength - remaining) % BUTTONS_PER_ROW;
    const option: FragmentOption = pick(fragmentChoicesForRole(remaining, rng, role, previousWasBracket, column), rng);
    const fragment = option.make();
    sequence.push(...fragment);
    remaining -= fragment.length;
    previousWasBracket = option.isBracket;
  }

  return sequence;
}

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
