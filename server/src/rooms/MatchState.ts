import { Schema, type } from "@colyseus/schema";

export class MatchState extends Schema {
  @type("number") round: number = 0;
}
