import type { Color, Role } from "./colors";
import {
  generatePigFragment,
  generateRabbitMintBracket4Fragment,
  generateRabbitMintBracket6Fragment,
  generateRabbitPairFragment,
  MINT_RUN_LENGTHS,
  mintRun,
} from "./fragments";
import { pick, type Rng } from "./rng";
import { BUTTONS_PER_ROW } from "./sequenceLength";

type FragmentChoice = () => Color[];
type FragmentRole = "pig" | "rabbit";
// isBracket = 이번에 새로 추가된 두 "브라켓" 패턴(bracket4/6, 오른쪽버튼-민트런-오른쪽버튼)
// 중 하나였는지 — 바로 다음 조각을 고를 때 이 값이 true면 두 브라켓 패턴을 선택지에서 아예
// 빼서 서로 붙어 나오는 걸 막는다.
type FragmentOption = { make: FragmentChoice; isBracket: boolean };

// User-requested online-mode mix: pig-pattern fragments should come up
// roughly 7 times for every 3 rabbit-pattern fragments at round 1 — see
// stickinessForRound below for how this drifts pig-ward as rounds go on.
const PIG_FRAGMENT_WEIGHT = 0.7;

// User-requested (2026-07-24): later rounds should hand off between pig and
// rabbit less often, since switching who's pressing breaks flow more than
// continuing your own pattern. Modeled as extra probability mass toward
// repeating the PREVIOUS fragment's role — 0 at round 1 (identical to the
// old memoryless 70/30 draw), ramping linearly up to MAX_STICKINESS by
// STICKINESS_ROUNDS, then staying flat. Capped well under
// PIG_FRAGMENT_WEIGHT's distance from 0/1 (0.3) so pigProbability below
// never leaves [0, 1].
//
// This makes BOTH roles stickier as rounds progress (a pig fragment is more
// likely to be followed by another pig fragment, and likewise for rabbit),
// but since pig already starts from a higher base probability, pig streaks
// end up both more frequent and longer than rabbit streaks — the overall
// pig:rabbit mix drifts pig-ward in later rounds. Accepted trade-off, not a
// bug — see docs/superpowers/specs or the PR discussion this was decided in.
const MAX_STICKINESS = 0.05;
const STICKINESS_ROUNDS = 30;

function stickinessForRound(round: number): number {
  return Math.min(MAX_STICKINESS, (MAX_STICKINESS * (round - 1)) / (STICKINESS_ROUNDS - 1));
}

// Probability the NEXT fragment is a pig fragment, given what role the
// PREVIOUS fragment in this sequence was (undefined for the very first
// fragment, which always uses the plain base weight regardless of round).
function pigProbability(previousRole: FragmentRole | undefined, round: number): number {
  if (previousRole === undefined) return PIG_FRAGMENT_WEIGHT;
  const stickiness = stickinessForRound(round);
  return previousRole === "pig" ? PIG_FRAGMENT_WEIGHT + stickiness : PIG_FRAGMENT_WEIGHT - stickiness;
}

// 브라켓 패턴(bracket4/6)은 줄바꿈 중간에 걸쳐서 나오면 안 됨 — 시작하는 줄 안에서 끝까지
// 딱 맞아떨어져야 함. 4칸짜리는 그 줄의 1번째 칸(col0) 또는 3번째 칸(col2)에서 시작해야
// 남은 3칸(col2 기준) 안에 다 들어가고, 6칸짜리는 줄 전체를 다 쓰므로 1번째 칸(col0)에서만
// 시작 가능.
function canStartBracket4(column: number): boolean {
  return column === 0 || column === 2;
}
function canStartBracket6(column: number): boolean {
  return column === 0;
}

function rabbitFragmentChoices(remaining: number, rng: Rng, excludeBracket: boolean, column: number): FragmentOption[] {
  const choices: FragmentOption[] = [{ make: () => generateRabbitPairFragment(rng), isBracket: false }];

  const validMintLengths = MINT_RUN_LENGTHS.filter((length) => length <= remaining);
  if (validMintLengths.length > 0) {
    choices.push({ make: () => mintRun(pick(validMintLengths, rng)), isBracket: false });
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

export function generateSequence(totalLength: number, rng: Rng, round: number): Color[] {
  // Every fragment this function can produce has a minimum length of 2
  // (generatePigFragment and generateRabbitPairFragment are always exactly
  // 2; mint runs are 2/4/6 — see MINT_RUN_LENGTHS) and neither the pig nor
  // the rabbit-pair branch below checks `remaining` before picking, so an
  // odd totalLength eventually leaves remaining=1 with no fragment able to
  // fit — the loop then overshoots by pushing a 2-length fragment anyway,
  // silently returning totalLength+1 colors instead of throwing or
  // truncating. sequenceLengthForRound always returns an even multiple of
  // 6, so this never fires in production, but the contract ("returns
  // exactly totalLength colors", asserted in sequence.test.ts) should hold
  // for any caller, not just the current one.
  if (totalLength % 2 !== 0) {
    throw new Error(`generateSequence: totalLength must be even (got ${totalLength}) — every fragment is length 2+`);
  }

  const sequence: Color[] = [];
  let remaining = totalLength;
  let previousRole: FragmentRole | undefined;
  let previousWasBracket = false;

  while (remaining > 0) {
    const isPig = rng() < pigProbability(previousRole, round);
    let fragment: Color[];
    let isBracket = false;
    if (isPig) {
      fragment = generatePigFragment(rng);
    } else {
      const column = (totalLength - remaining) % BUTTONS_PER_ROW;
      const option: FragmentOption = pick(rabbitFragmentChoices(remaining, rng, previousWasBracket, column), rng);
      fragment = option.make();
      isBracket = option.isBracket;
    }
    sequence.push(...fragment);
    remaining -= fragment.length;
    previousRole = isPig ? "pig" : "rabbit";
    previousWasBracket = isBracket;
  }

  return sequence;
}

// 돼지전/토끼전 전용 — 한 역할의 조각만으로 시퀀스를 채운다. 정상모드 generateSequence와
// 달리 역할 전환/스티키니스 개념 자체가 없다(팀에 반대 역할 플레이어가 없으므로).
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
  choices.push({ make: () => generateRabbitPairFragment(rng), isBracket: false });
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

export function generateSingleRoleSequence(totalLength: number, rng: Rng, role: Role): Color[] {
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
