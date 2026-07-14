import type { Color, Role } from "./colors";

// Manually mirrors server/src/rooms/MatchState.ts — client and server are
// separate npm workspaces with no shared-types package yet, so these two
// must be kept in sync by hand.
export type Phase = "lobby" | "playing";
export type RoleChoice = Role | "";
export type TurnOutcome = "pending" | "success" | "fail";

export interface PlayerState {
  sessionId: string;
  nickname: string;
  role: RoleChoice;
  teamId: string;
}

export interface TeamState {
  id: string;
  pigSessionId: string;
  rabbitSessionId: string;
  mortars: number;
  eliminated: boolean;
}

export interface MatchState {
  phase: Phase;
  round: number;
  players: Map<string, PlayerState>;
  teams: TeamState[];
  activeTeamIndex: number;
  sequence: Color[];
  cursor: number;
  turnEndsAt: number;
  turnOutcome: TurnOutcome;
}
