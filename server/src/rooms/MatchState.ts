import { Schema, type, ArraySchema, MapSchema } from "@colyseus/schema";
import { STARTING_MORTARS } from "../game/mortar";

export type Phase = "lobby" | "playing";
export type RoleChoice = "pig" | "rabbit" | "";
export type TurnOutcome = "pending" | "success" | "fail";

export class PlayerState extends Schema {
  @type("string") sessionId: string = "";
  @type("string") nickname: string = "";
  @type("string") nicknameColor: string = "";
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
  @type("string") nicknameColor: string = "";
  @type("string") text: string = "";
  @type("number") sentAt: number = 0;
}

export class SpectatorState extends Schema {
  @type("string") sessionId: string = "";
  @type("string") nickname: string = "";
  @type("string") nicknameColor: string = "";
}

export class MatchState extends Schema {
  @type("string") phase: Phase = "lobby";
  // 0 = no countdown running. Counts down 3→2→1 once every team has a pig
  // and a rabbit, then the room flips to "playing" (see MatchRoom.ts's
  // maybeStartGame/scheduleCountdownTick).
  @type("number") countdownSecondsLeft: number = 0;
  @type("number") round: number = 1;
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
  @type([TeamState]) teams = new ArraySchema<TeamState>();
  @type("number") activeTeamIndex: number = 0;
  @type(["string"]) sequence = new ArraySchema<string>();
  @type("number") cursor: number = 0;
  @type("number") turnEndsAt: number = 0;
  @type("string") turnOutcome: TurnOutcome = "pending";
  // 오답으로 턴이 실패했을 때, 그 색이 원래 누구 것인지가 아니라 실제로 잘못된
  // 버튼을 누른 플레이어의 역할을 기록한다(handlePressButton 참고) — 클라이언트가
  // 그 역할의 miss 애니메이션을 보여주는 데 씀. 시간초과로 실패한 경우는 대상이
  // 없으므로 빈 문자열로 남는다(onTurnTimerExpired는 이 필드를 건드리지 않음).
  @type("string") missedRole: RoleChoice = "";
  // Independent histories (spec decision — lobby banter and in-match
  // commentary don't mix), each capped at MAX_CHAT_MESSAGES in MatchRoom.ts.
  @type([ChatMessage]) lobbyChat = new ArraySchema<ChatMessage>();
  @type([ChatMessage]) matchChat = new ArraySchema<ChatMessage>();
  // 실제 플레이어(players)와 완전히 분리된 맵 — 재경기 시 역할 초기화 로직이나
  // 방장 판정 등 기존 players 관련 코드를 하나도 안 건드리고 얹기 위함.
  @type({ map: SpectatorState }) spectators = new MapSchema<SpectatorState>();
}
