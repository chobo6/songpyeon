import type { Color } from "./colors";
import { generatePigFragment, generateRabbitPairFragment, mintRun, MINT_RUN_LENGTHS } from "./fragments";
import { pick, type Rng } from "./rng";

type FragmentChoice = () => Color[];

// User-requested online-mode mix: pig-pattern fragments should come up
// roughly 7 times for every 3 rabbit-pattern fragments.
const PIG_FRAGMENT_WEIGHT = 0.7;

function rabbitFragmentChoices(remaining: number, rng: Rng): FragmentChoice[] {
  const choices: FragmentChoice[] = [() => generateRabbitPairFragment(rng)];

  const validMintLengths = MINT_RUN_LENGTHS.filter((length) => length <= remaining);
  if (validMintLengths.length > 0) {
    choices.push(() => mintRun(pick(validMintLengths, rng)));
  }

  return choices;
}

export function generateSequence(totalLength: number, rng: Rng): Color[] {
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

  while (remaining > 0) {
    const fragment =
      rng() < PIG_FRAGMENT_WEIGHT
        ? generatePigFragment(rng)
        : pick(rabbitFragmentChoices(remaining, rng), rng)();
    sequence.push(...fragment);
    remaining -= fragment.length;
  }

  return sequence;
}
