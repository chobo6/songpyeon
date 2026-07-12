import { Room, Client } from "colyseus";
import { MatchState, PlayerState, TeamState } from "./MatchState";
import { generateSequence } from "../game/sequence";
import { sequenceLengthForRound } from "../game/sequenceLength";
import { attemptPress } from "../game/turnOrder";
import { loseMortar, isEliminated } from "../game/mortar";
import { nextActiveTeamIndex, winningTeam, type TeamStatus } from "../game/rotation";
import type { Color, Role } from "../game/colors";

const DEFAULT_TURN_DURATION_MS = 4000;
const RECONNECTION_GRACE_SECONDS = 60;
const TEAM_COUNT = 2;

interface MatchRoomOptions {
  turnDurationMs?: number;
}

export class MatchRoom extends Room<MatchState> {
  maxClients = 4;

  private turnDurationMs = DEFAULT_TURN_DURATION_MS;
  private turnToken = 0;
  private turnsThisRound = 0;
  private turnDecided = false;

  onCreate(options: MatchRoomOptions = {}) {
    if (options.turnDurationMs) this.turnDurationMs = options.turnDurationMs;

    const state = new MatchState();
    for (let i = 0; i < TEAM_COUNT; i++) {
      const team = new TeamState();
      team.id = `team-${i + 1}`;
      state.teams.push(team);
    }
    this.setState(state);

    this.onMessage("chooseRole", (client, message: { role: "pig" | "rabbit" }) => {
      this.handleChooseRole(client, message.role);
    });

    this.onMessage("pressButton", (client, message: { color: Color }) => {
      this.handlePressButton(client, message.color);
    });
  }

  onJoin(client: Client) {
    if (this.state.players.has(client.sessionId)) return;

    const player = new PlayerState();
    player.sessionId = client.sessionId;
    this.state.players.set(client.sessionId, player);
  }

  async onLeave(client: Client, consented: boolean) {
    if (consented) {
      this.state.players.delete(client.sessionId);
      return;
    }

    try {
      await this.allowReconnection(client, RECONNECTION_GRACE_SECONDS);
    } catch {
      this.state.players.delete(client.sessionId);
    }
  }

  private handleChooseRole(client: Client, role: "pig" | "rabbit") {
    if (this.state.phase !== "lobby") return;

    const player = this.state.players.get(client.sessionId);
    if (!player || player.role !== "") return;

    const team = this.state.teams.find((t) =>
      role === "pig" ? t.pigSessionId === "" : t.rabbitSessionId === "",
    );
    if (!team) return;

    player.role = role;
    player.teamId = team.id;
    if (role === "pig") {
      team.pigSessionId = client.sessionId;
    } else {
      team.rabbitSessionId = client.sessionId;
    }

    this.maybeStartGame();
  }

  private maybeStartGame() {
    const ready = this.state.teams.every((t) => t.pigSessionId !== "" && t.rabbitSessionId !== "");
    if (!ready) return;

    this.state.phase = "playing";
    this.state.round = 1;
    this.state.activeTeamIndex = 0;
    this.turnsThisRound = 0;
    this.startTurn();
  }

  private startTurn() {
    const length = sequenceLengthForRound(this.state.round);
    const sequence = generateSequence(length, Math.random);

    this.state.sequence.clear();
    sequence.forEach((color) => this.state.sequence.push(color));
    this.state.cursor = 0;
    this.state.turnOutcome = "pending";
    this.state.turnEndsAt = Date.now() + this.turnDurationMs;
    this.turnDecided = false;

    this.turnToken++;
    const token = this.turnToken;
    this.clock.setTimeout(() => {
      if (token === this.turnToken) this.onTurnTimerExpired();
    }, this.turnDurationMs);
  }

  private handlePressButton(client: Client, color: Color) {
    if (this.state.phase !== "playing") return;
    if (this.turnDecided) return;

    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const activeTeam = this.state.teams[this.state.activeTeamIndex];
    if (player.teamId !== activeTeam.id) return;

    const result = attemptPress(
      Array.from(this.state.sequence) as Color[],
      this.state.cursor,
      color,
      player.role as Role,
    );

    if (!result.correct) {
      this.turnDecided = true;
      this.applyMortarLoss(activeTeam);
      this.state.turnOutcome = "fail";
      // Turn hand-off is intentionally deferred to onTurnTimerExpired, at the
      // turn's original 4s mark, so the fail state stays on screen instead of
      // instantly cutting to the next team.
      return;
    }

    this.state.cursor = result.nextCursor;
    if (result.complete) {
      this.turnDecided = true;
      this.state.turnOutcome = "success";
      this.advanceToNextTurn();
    }
  }

  private onTurnTimerExpired() {
    if (!this.turnDecided) {
      this.turnDecided = true;
      this.applyMortarLoss(this.state.teams[this.state.activeTeamIndex]);
      this.state.turnOutcome = "fail";
    }
    this.advanceToNextTurn();
  }

  private applyMortarLoss(team: TeamState) {
    team.mortars = loseMortar(team.mortars);
    if (isEliminated(team.mortars)) team.eliminated = true;
  }

  private advanceToNextTurn() {
    const teamsSnapshot: TeamStatus[] = this.state.teams.map((t) => ({
      id: t.id,
      eliminated: t.eliminated,
    }));

    const winner = winningTeam(teamsSnapshot);
    if (winner) {
      this.state.phase = "finished";
      this.state.winnerTeamId = winner.id;
      return;
    }

    this.turnsThisRound++;
    const aliveCount = teamsSnapshot.filter((t) => !t.eliminated).length;
    if (this.turnsThisRound >= aliveCount) {
      this.state.round++;
      this.turnsThisRound = 0;
    }

    this.state.activeTeamIndex = nextActiveTeamIndex(teamsSnapshot, this.state.activeTeamIndex);
    this.startTurn();
  }
}
