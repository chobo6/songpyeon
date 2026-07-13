export interface TeamStatus {
  id: string;
  eliminated: boolean;
}

export function nextActiveTeamIndex(teams: TeamStatus[], currentIndex: number): number {
  for (let step = 1; step <= teams.length; step++) {
    const index = (currentIndex + step) % teams.length;
    if (!teams[index].eliminated) return index;
  }
  return currentIndex;
}
