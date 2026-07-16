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
