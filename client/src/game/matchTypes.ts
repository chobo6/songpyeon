import type { Color, Role } from "./colors";
import type { NicknameEffect, NicknameParticle } from "./nicknameStyle";

// Manually mirrors server/src/rooms/MatchState.ts — client and server are
// separate npm workspaces with no shared-types package yet, so these two
// must be kept in sync by hand.
export type Phase = "lobby" | "playing";
export type RoleChoice = Role | "";
export type TurnOutcome = "pending" | "success" | "fail";
export type ItemId = "timeAdd" | "timeReduce" | "doughAttack" | "superMortar" | "mortarRestore";

export interface PlayerState {
  sessionId: string;
  nickname: string;
  nicknameColor: string;
  nicknameEffect: NicknameEffect;
  nicknameGlow: boolean;
  nicknameParticle: NicknameParticle;
  role: RoleChoice;
  teamId: string;
  inventory: ItemId[];
}

export interface TeamState {
  id: string;
  pigSessionId: string;
  rabbitSessionId: string;
  mortars: number;
  eliminated: boolean;
  combo: number;
}

export interface ChatMessage {
  nickname: string;
  nicknameColor: string;
  nicknameEffect: NicknameEffect;
  nicknameGlow: boolean;
  nicknameParticle: NicknameParticle;
  text: string;
  sentAt: number;
}

export interface SpectatorState {
  sessionId: string;
  nickname: string;
  nicknameColor: string;
  nicknameEffect: NicknameEffect;
  nicknameGlow: boolean;
  nicknameParticle: NicknameParticle;
}

export interface MatchState {
  phase: Phase;
  countdownSecondsLeft: number;
  round: number;
  players: Map<string, PlayerState>;
  teams: TeamState[];
  activeTeamIndex: number;
  sequence: Color[];
  cursor: number;
  turnEndsAt: number;
  turnOutcome: TurnOutcome;
  missedRole: RoleChoice;
  bonusItemIndex: number;
  bonusItemId: ItemId | "";
  lastUsedItemId: ItemId | "";
  lastUsedItemSeq: number;
  lobbyChat: ChatMessage[];
  matchChat: ChatMessage[];
  spectators: Map<string, SpectatorState>;
}
