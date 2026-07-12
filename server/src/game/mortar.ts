export const STARTING_MORTARS = 5;

export function loseMortar(mortars: number): number {
  return Math.max(0, mortars - 1);
}

export function isEliminated(mortars: number): boolean {
  return mortars <= 0;
}
