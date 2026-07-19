import { Schema, type, ArraySchema, MapSchema } from "@colyseus/schema";
import { STARTING_MORTARS } from "../game/mortar";

export type Phase = "lobby" | "playing";
export type RoleChoice = "pig" | "rabbit" | "";
export type TurnOutcome = "pending" | "success" | "fail";

export class PlayerState extends Schema {
  @type("string") sessionId: string = "";
  @type("string") nickname: string = "";
  @type("string") role: RoleChoice = "";
  @type("string") teamId: string = "";
}

export class TeamState extends Schema {
  @type("string") id: string = "";
  @type("string") pigSessionId: string = "";
  @type("string") rabbitSessionId: string = "";
  @type("number") mortars: number = STARTING_MORTARS;
  @type("boolean") eliminated: boolean = false;
}

export class ChatMessage extends Schema {
  @type("string") nickname: string = "";
  @type("string") text: string = "";
  @type("number") sentAt: number = 0;
}

export class MatchState extends Schema {
  @type("string") phase: Phase = "lobby";
  // 0 = no countdown running. Counts down 3→2→1 once every team has a pig
  // and a rabbit, then the room flips to "playing" (see MatchRoom.ts's
  // maybeStartGame/runCountdownTick).
  @type("number") countdownSecondsLeft: number = 0;
  @type("number") round: number = 1;
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
  @type([TeamState]) teams = new ArraySchema<TeamState>();
  @type("number") activeTeamIndex: number = 0;
  @type(["string"]) sequence = new ArraySchema<string>();
  @type("number") cursor: number = 0;
  @type("number") turnEndsAt: number = 0;
  @type("string") turnOutcome: TurnOutcome = "pending";
  // Independent histories (spec decision — lobby banter and in-match
  // commentary don't mix), each capped at MAX_CHAT_MESSAGES in MatchRoom.ts.
  @type([ChatMessage]) lobbyChat = new ArraySchema<ChatMessage>();
  @type([ChatMessage]) matchChat = new ArraySchema<ChatMessage>();
}
