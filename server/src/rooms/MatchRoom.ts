import { Room, Client } from "colyseus";
import type { ArraySchema } from "@colyseus/schema";
import { MatchState, PlayerState, TeamState, ChatMessage } from "./MatchState";
import { generateSequence } from "../game/sequence";
import { sequenceLengthForRound } from "../game/sequenceLength";
import { attemptPress } from "../game/turnOrder";
import { loseMortar, isEliminated, STARTING_MORTARS } from "../game/mortar";
import { nextActiveTeamIndex, type TeamStatus } from "../game/rotation";
import type { Color, Role } from "../game/colors";
import { sanitizeNickname } from "../game/nickname";
import { sanitizeTeamCount } from "../game/teamCount";
import { sanitizeChatText } from "../game/chat";

const DEFAULT_TURN_DURATION_MS = 4000;
const RECONNECTION_GRACE_SECONDS = 60;
const MAX_CHAT_MESSAGES = 50;

interface MatchRoomOptions {
  turnDurationMs?: number;
  nickname?: unknown;
  teamCount?: unknown;
}

export class MatchRoom extends Room<MatchState> {
  maxClients = 4;

  private turnDurationMs = DEFAULT_TURN_DURATION_MS;
  private turnToken = 0;
  private turnsThisRound = 0;
  private turnDecided = false;

  onCreate(options: MatchRoomOptions = {}) {
    if (options.turnDurationMs) this.turnDurationMs = options.turnDurationMs;
    this.setMetadata({ hostNickname: sanitizeNickname(options.nickname) });

    // Colyseus's default patch rate is 50ms (20/s) — state changes (cursor
    // advancing, turnOutcome, a new turn starting) only reach clients on
    // this tick, not the instant they happen server-side. This game is
    // reflex-timing-sensitive (buttons disable/enable based on turnOutcome),
    // so a slow patch rate directly costs input responsiveness: a press
    // timed right at a turn boundary can land while the client is still
    // showing the previous turn's disabled button, silently dropping the
    // click. Small state (4 players, ~24-token sequence), 4 clients per
    // room — the bandwidth/CPU cost of a much faster tick is negligible.
    this.patchRate = 16;

    const teamCount = sanitizeTeamCount(options.teamCount);
    // 2 players (pig + rabbit) per team — must stay in sync with
    // maybeStartGame()'s readiness check and handleChooseRole()'s slot
    // search, both of which assume every team has exactly one pig and one
    // rabbit slot.
    this.maxClients = teamCount * 2;

    const state = new MatchState();
    for (let i = 0; i < teamCount; i++) {
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

    this.onMessage("sendChat", (client, message: { text?: unknown }) => {
      this.handleSendChat(client, message.text);
    });

    this.onMessage("rematch", () => {
      this.handleRematch();
    });

    // Lets each client measure its clock offset from the server (see
    // client/src/game/clockSync.ts) so turnEndsAt — an absolute server
    // timestamp — can be compared against a locally-corrected "now" instead
    // of the client's raw, possibly-skewed system clock.
    this.onMessage("ping", (client, clientSentAt: unknown) => {
      if (typeof clientSentAt !== "number") return;
      client.send("pong", { clientSentAt, serverTime: Date.now() });
    });
  }

  onJoin(client: Client, options: { nickname?: unknown } = {}) {
    if (this.state.players.has(client.sessionId)) return;

    if (this.state.phase !== "lobby") {
      throw new Error("Match already in progress");
    }

    const player = new PlayerState();
    player.sessionId = client.sessionId;
    player.nickname = sanitizeNickname(options.nickname);
    this.state.players.set(client.sessionId, player);
    this.pushChat(this.state.lobbyChat, "", `${player.nickname}님이 입장했습니다`);
  }

  async onLeave(client: Client, consented: boolean) {
    if (!consented) {
      try {
        await this.allowReconnection(client, RECONNECTION_GRACE_SECONDS);
        return;
      } catch {
        // grace period expired without a reconnect — fall through to removal.
      }
    }

    this.removePlayer(client.sessionId);
  }

  private removePlayer(sessionId: string) {
    const player = this.state.players.get(sessionId);
    if (!player) return;

    if (player.role !== "") {
      const team = this.state.teams.find((t) => t.id === player.teamId);
      if (team?.pigSessionId === sessionId) team.pigSessionId = "";
      if (team?.rabbitSessionId === sessionId) team.rabbitSessionId = "";
    }

    this.state.players.delete(sessionId);

    // Scoped to the lobby specifically (the requested "대기실" behavior) — a
    // mid-match leave doesn't get a matchChat announcement, since that's a
    // separate, not-yet-requested feature.
    if (this.state.phase === "lobby") {
      this.pushChat(this.state.lobbyChat, "", `${player.nickname}님이 퇴장했습니다`);
    }
  }

  private handleSendChat(client: Client, rawText: unknown) {
    const text = sanitizeChatText(rawText);
    if (!text) return;

    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const list = this.state.phase === "lobby" ? this.state.lobbyChat : this.state.matchChat;
    this.pushChat(list, player.nickname, text);
  }

  private pushChat(list: ArraySchema<ChatMessage>, nickname: string, text: string) {
    const message = new ChatMessage();
    message.nickname = nickname;
    message.text = text;
    message.sentAt = Date.now();
    list.push(message);
    if (list.length > MAX_CHAT_MESSAGES) list.shift();
  }

  private handleChooseRole(client: Client, role: "pig" | "rabbit") {
    if (this.state.phase !== "lobby") return;

    const player = this.state.players.get(client.sessionId);
    // Re-picking the role you already have is a no-op — without this guard
    // it would fall through to the "find an open slot for this role" search
    // below, which skips your OWN (currently non-empty) slot and can hop you
    // onto a different team's matching slot instead of doing nothing.
    if (!player || player.role === role) return;

    const team = this.state.teams.find((t) =>
      role === "pig" ? t.pigSessionId === "" : t.rabbitSessionId === "",
    );
    if (!team) return;

    // Switching roles/teams mid-lobby (allowed any time before the match
    // starts) must free the slot you're leaving before claiming the new
    // one, or your old sessionId lingers in both team slots at once.
    if (player.role !== "") {
      const previousTeam = this.state.teams.find((t) => t.id === player.teamId);
      if (previousTeam?.pigSessionId === client.sessionId) previousTeam.pigSessionId = "";
      if (previousTeam?.rabbitSessionId === client.sessionId) previousTeam.rabbitSessionId = "";
    }

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
    // Colyseus auto-unlocks a maxClients-triggered lock the moment any
    // client leaves (see _decrementClientCount), which would put this room
    // back in joinOrCreate's matchmaking pool the instant an eliminated
    // player leaves — exactly when we most need it hidden. An explicit
    // lock() is not undone by that auto-unlock (it only fires when
    // !_lockedExplicitly), so it's the real defense.
    //
    // maxClients stays at its fixed default (4, the class field above) —
    // it must NOT be reassigned to room.clients.length here. Since lobby
    // reconnection grace was added, a filled role slot can be held by a
    // sessionId that's currently mid-grace (disconnected, not in
    // room.clients), so room.clients.length at this exact moment can be
    // less than 4 even though all 4 roles are genuinely taken — locking
    // maxClients to that undercount would permanently cap the match below
    // its real size.
    this.lock();
    this.state.round = 1;
    this.state.activeTeamIndex = 0;
    this.turnsThisRound = 0;
    this.startTurn();
  }

  private isMatchOver(): boolean {
    return this.state.teams.every((t) => t.eliminated);
  }

  // Resets this same room back to its lobby state (teams/roles cleared) once
  // every team has been wiped out, instead of players having to leave and
  // find/create a fresh room to play again together. Guarded to only fire
  // once the match has actually concluded — advanceToNextTurn() freezes
  // (stops scheduling turn timers) exactly when isMatchOver() becomes true,
  // so there's no in-flight timer left to invalidate here.
  private handleRematch() {
    if (this.state.phase !== "playing" || !this.isMatchOver()) return;

    this.turnDecided = false;
    this.turnsThisRound = 0;

    this.state.phase = "lobby";
    this.state.round = 1;
    this.state.activeTeamIndex = 0;
    this.state.cursor = 0;
    this.state.sequence.clear();
    this.state.turnOutcome = "pending";
    this.state.turnEndsAt = 0;

    for (const team of this.state.teams) {
      team.mortars = STARTING_MORTARS;
      team.eliminated = false;
      team.pigSessionId = "";
      team.rabbitSessionId = "";
    }
    for (const player of this.state.players.values()) {
      player.role = "";
      player.teamId = "";
    }

    // maybeStartGame()'s lock() from the match that just ended is still in
    // effect — undo it so a freed slot (e.g. someone left mid-match) can be
    // backfilled by a new joiner while the room sits in "lobby" again.
    this.unlock();
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
      // Same deferral as the fail path above: wait for the already-scheduled
      // 4s timer (onTurnTimerExpired) to advance, so the success state stays
      // on screen for the rest of the turn instead of the next turn's fresh
      // state overwriting it on the very next tick.
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

    this.turnsThisRound++;
    const aliveCount = teamsSnapshot.filter((t) => !t.eliminated).length;
    if (this.turnsThisRound >= aliveCount) {
      this.state.round++;
      this.turnsThisRound = 0;
    }

    this.state.activeTeamIndex = nextActiveTeamIndex(teamsSnapshot, this.state.activeTeamIndex);

    // nextActiveTeamIndex falls back to the current index when every team is
    // eliminated (nothing left to skip to) — freeze here instead of starting
    // a phantom turn for a team that's already out.
    if (this.state.teams[this.state.activeTeamIndex].eliminated) return;

    this.startTurn();
  }
}
