import { Schema, type, ArraySchema, MapSchema } from "@colyseus/schema";
import { STARTING_MORTARS } from "../game/mortar";

export type Phase = "lobby" | "playing";
export type RoleChoice = "pig" | "rabbit" | "";
export type TurnOutcome = "pending" | "success" | "fail";
export type NicknameEffect = "none" | "rainbow" | "shine" | "hologram" | "pulse" | "neon" | "chrome";
export type NicknameParticle = "none" | "twinkle" | "rising" | "orbit" | "snow";

export class PlayerState extends Schema {
  @type("string") sessionId: string = "";
  @type("string") nickname: string = "";
  @type("string") nicknameColor: string = "";
  @type("string") nicknameEffect: NicknameEffect = "none";
  @type("boolean") nicknameGlow: boolean = false;
  @type("string") nicknameParticle: NicknameParticle = "none";
  @type("string") role: RoleChoice = "";
  @type("string") teamId: string = "";
  @type(["string"]) inventory = new ArraySchema<string>();
}

export class TeamState extends Schema {
  @type("string") id: string = "";
  @type("string") pigSessionId: string = "";
  @type("string") rabbitSessionId: string = "";
  @type("number") mortars: number = STARTING_MORTARS;
  @type("boolean") eliminated: boolean = false;
  @type("number") combo: number = 0;
}

export class ChatMessage extends Schema {
  @type("string") nickname: string = "";
  @type("string") nicknameColor: string = "";
  @type("string") nicknameEffect: NicknameEffect = "none";
  @type("boolean") nicknameGlow: boolean = false;
  @type("string") nicknameParticle: NicknameParticle = "none";
  @type("string") text: string = "";
  @type("number") sentAt: number = 0;
}

export class SpectatorState extends Schema {
  @type("string") sessionId: string = "";
  @type("string") nickname: string = "";
  @type("string") nicknameColor: string = "";
  @type("string") nicknameEffect: NicknameEffect = "none";
  @type("boolean") nicknameGlow: boolean = false;
  @type("string") nicknameParticle: NicknameParticle = "none";
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
  // 이번 턴 보너스 토큰 위치 — 없으면 -1. startTurn()이 굴린 직후 채움.
  @type("number") bonusItemIndex: number = -1;
  // 그 위치에 어떤 아이템이 붙었는지 — 없으면 "". ItemId 값 중 하나 또는 "".
  @type("string") bonusItemId: string = "";
  // 방금 누군가 사용한 아이템 — 클라이언트가 화면 토스트 애니메이션을 트리거하는 데 씀.
  // itemId 자체는 값이 안 바뀌면(같은 아이템 연속 사용) 변화가 감지 안 되므로, 매 사용마다
  // 반드시 증가하는 lastUsedItemSeq를 트리거 신호로 함께 둔다(0 = 아직 아무도 안 씀).
  @type("string") lastUsedItemId: string = "";
  @type("number") lastUsedItemSeq: number = 0;
  // Independent histories (spec decision — lobby banter and in-match
  // commentary don't mix), each capped at MAX_CHAT_MESSAGES in MatchRoom.ts.
  @type([ChatMessage]) lobbyChat = new ArraySchema<ChatMessage>();
  @type([ChatMessage]) matchChat = new ArraySchema<ChatMessage>();
  // 실제 플레이어(players)와 완전히 분리된 맵 — 재경기 시 역할 초기화 로직이나
  // 방장 판정 등 기존 players 관련 코드를 하나도 안 건드리고 얹기 위함.
  @type({ map: SpectatorState }) spectators = new MapSchema<SpectatorState>();
}
