import type { Color } from "./colors";
import { generatePigFragment, generateRabbitPairFragment, mintRun, MINT_RUN_LENGTHS } from "./fragments";
import { pick, type Rng } from "./rng";

type FragmentChoice = () => Color[];

function fragmentChoices(remaining: number, rng: Rng): FragmentChoice[] {
  const choices: FragmentChoice[] = [];

  if (remaining >= 2) {
    choices.push(() => generatePigFragment(rng));
    choices.push(() => generateRabbitPairFragment(rng));
  }

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
    const choices = fragmentChoices(remaining, rng);
    const fragment = pick(choices, rng)();
    sequence.push(...fragment);
    remaining -= fragment.length;
  }

  return sequence;
}
