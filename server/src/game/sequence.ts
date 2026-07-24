import type { Color } from "./colors";
import { generatePigFragment, generateRabbitPairFragment, mintRun, MINT_RUN_LENGTHS } from "./fragments";
import { pick, type Rng } from "./rng";

type FragmentChoice = () => Color[];
type FragmentRole = "pig" | "rabbit";

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
const MAX_STICKINESS = 0.1;
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

function rabbitFragmentChoices(remaining: number, rng: Rng): FragmentChoice[] {
  const choices: FragmentChoice[] = [() => generateRabbitPairFragment(rng)];

  const validMintLengths = MINT_RUN_LENGTHS.filter((length) => length <= remaining);
  if (validMintLengths.length > 0) {
    choices.push(() => mintRun(pick(validMintLengths, rng)));
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

  while (remaining > 0) {
    const isPig = rng() < pigProbability(previousRole, round);
    const fragment = isPig ? generatePigFragment(rng) : pick(rabbitFragmentChoices(remaining, rng), rng)();
    sequence.push(...fragment);
    remaining -= fragment.length;
    previousRole = isPig ? "pig" : "rabbit";
  }

  return sequence;
}
