export type Rng = () => number;

export function pick<T>(options: readonly T[], rng: Rng): T {
  return options[Math.floor(rng() * options.length)];
}
