import { Schema, type, ArraySchema, MapSchema } from "@colyseus/schema";
import { STARTING_MORTARS } from "../game/mortar";

export type Phase = "lobby" | "playing" | "finished";
export type RoleChoice = "pig" | "rabbit" | "";
export type TurnOutcome = "pending" | "success" | "fail";

export class PlayerState extends Schema {
  @type("string") sessionId: string = "";
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

export class MatchState extends Schema {
  @type("string") phase: Phase = "lobby";
  @type("number") round: number = 1;
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
  @type([TeamState]) teams = new ArraySchema<TeamState>();
  @type("number") activeTeamIndex: number = 0;
  @type(["string"]) sequence = new ArraySchema<string>();
  @type("number") cursor: number = 0;
  @type("number") turnEndsAt: number = 0;
  @type("string") turnOutcome: TurnOutcome = "pending";
  @type("string") winnerTeamId: string = "";
}
