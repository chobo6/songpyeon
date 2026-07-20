import { Room, Client, type AuthContext } from "colyseus";
import type { ArraySchema } from "@colyseus/schema";
import { MatchState, PlayerState, TeamState, ChatMessage } from "./MatchState";
import { generateSequence } from "../game/sequence";
import { sequenceLengthForRound } from "../game/sequenceLength";
import { attemptPress } from "../game/turnOrder";
import { loseMortar, isEliminated, STARTING_MORTARS } from "../game/mortar";
import { nextActiveTeamIndex, type TeamStatus } from "../game/rotation";
import type { Color, Role } from "../game/colors";
import { sanitizeTeamCount } from "../game/teamCount";
import { sanitizeRoomTitle } from "../game/roomTitle";
import { sanitizeChatText } from "../game/chat";
import { recordEvent } from "../admin/eventLog";
import { getUserById, recordRoundAchievement } from "../auth/googleAuth";
import { getCookieValue, SESSION_COOKIE_NAME, verifySession } from "../auth/session";

const DEFAULT_TURN_DURATION_MS = 4000;
const DEFAULT_COUNTDOWN_TICK_MS = 1000;
const COUNTDOWN_START_SECONDS = 3;
const MAX_CHAT_MESSAGES = 50;

interface MatchRoomOptions {
  turnDurationMs?: number;
  // Per-tick duration of the pre-game 3/2/1 countdown, not the countdown's
  // total length — always exactly COUNTDOWN_START_SECONDS ticks, so tests
  // can shrink this to run the countdown fast without changing what number
  // it starts at. See maybeStartGame's countdown methods.
  countdownTickMs?: number;
  teamCount?: unknown;
  roomTitle?: unknown;
}

export class MatchRoom extends Room<MatchState> {
  maxClients = 4;

  private turnDurationMs = DEFAULT_TURN_DURATION_MS;
  private countdownTickMs = DEFAULT_COUNTDOWN_TICK_MS;
  private countdownToken = 0;
  private turnToken = 0;
  private turnsThisRound = 0;
  private turnDecided = false;
  // How many teams were alive at the moment the CURRENT round started —
  // fixed for the round's duration, not recomputed per turn. advanceToNextTurn
  // used to compare turnsThisRound against a freshly-recomputed alive count,
  // which double-counts a team eliminated mid-round: the turn that eliminates
  // it also shrinks the count being compared against, so the round could
  // advance before every team that started it alive had actually gone.
  private teamsAliveAtRoundStart = 0;
  // sessionId → account id, so round-achievement credit (a DB write, not
  // part of the broadcast state) can find the right row without exposing
  // the DB id on PlayerState to every client in the room.
  private playerUserIds = new Map<string, number>();

  async onCreate(options: MatchRoomOptions = {}) {
    if (options.turnDurationMs) this.turnDurationMs = options.turnDurationMs;
    if (options.countdownTickMs) this.countdownTickMs = options.countdownTickMs;

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

    // Unlike hostNickname (which needs an authenticated joiner and so can't
    // be set until the first onJoin), the room title is a plain creation
    // option with no player identity attached — set it into metadata right
    // away so it shows in the public room list immediately, even before
    // anyone has joined. onJoin's later setMetadata calls (players,
    // hostNickname) shallow-merge on top of this, not over it.
    const roomTitle = sanitizeRoomTitle(options.roomTitle);
    await this.setMetadata({ roomTitle: roomTitle || "이름 없는 방" });

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

  // Colyseus's ws-transport already resolves the real client IP for us
  // (x-real-ip / x-forwarded-for / socket.remoteAddress, in that order).
  // Beyond IP, this room now also requires a valid login session — the
  // cookie header isn't parsed by Express's cookie-parser here (WS upgrade
  // requests never go through Express middleware), so we parse and verify
  // it ourselves, reusing the exact same session logic the HTTP auth routes
  // use. No session (or a session for an account with no nickname yet) —
  // reject the join outright; the client never even shows the room list
  // without first completing login + nickname setup, so this path only
  // fires for direct API access or a session that expired mid-lobby.
  async onAuth(_client: Client, _options: MatchRoomOptions, context: AuthContext) {
    const token = getCookieValue(context.headers?.cookie, SESSION_COOKIE_NAME);
    const userId = verifySession(token);
    const user = userId ? getUserById(userId) : undefined;
    if (!user || !user.nickname) {
      throw new Error("로그인이 필요합니다.");
    }
    return { ip: context.ip, userId: user.id, nickname: user.nickname };
  }

  async onJoin(client: Client, _options: MatchRoomOptions = {}) {
    if (this.state.players.has(client.sessionId)) return;

    if (this.state.phase !== "lobby") {
      throw new Error("Match already in progress");
    }

    // The first player to actually join (not the one who called client.create())
    // is the host, display-wise — onCreate runs before its own caller's
    // onAuth/onJoin, so hostNickname can't be set there anymore.
    const isHost = this.state.players.size === 0;
    const nickname = client.auth?.nickname ?? "플레이어";

    const player = new PlayerState();
    player.sessionId = client.sessionId;
    player.nickname = nickname;
    this.state.players.set(client.sessionId, player);
    if (client.auth?.userId) this.playerUserIds.set(client.sessionId, client.auth.userId);
    this.pushChat(this.state.lobbyChat, "", `${player.nickname}님이 입장했습니다`);
    console.log(`[join] session=${client.sessionId} ip=${client.auth?.ip} nickname=${player.nickname}`);
    recordEvent({
      type: "join",
      timestamp: Date.now(),
      nickname: player.nickname,
      roomId: this.roomId,
      ip: String(client.auth?.ip ?? "unknown"),
      sessionId: client.sessionId,
    });

    const metadataUpdate: { players: { sessionId: string; nickname: string }[]; hostNickname?: string } = {
      players: this.rosterForMetadata(),
    };
    if (isHost) metadataUpdate.hostNickname = nickname;
    await this.setMetadata(metadataUpdate);
  }

  async onLeave(client: Client) {
    // No reconnection grace: the client never persists a reconnection token
    // and never attempts to resume (see client/src/colyseus.ts) — a refresh,
    // closed tab, or dropped connection always lands back on the room list.
    // Granting a grace period here just left a phantom player occupying a
    // role/team slot (and the room looking occupied to others) for up to
    // RECONNECTION_GRACE_SECONDS with nothing that could ever reconnect
    // through it. Free the slot immediately instead.
    console.log(`[leave] session=${client.sessionId} ip=${client.auth?.ip}`);
    const leavingNickname = this.state.players.get(client.sessionId)?.nickname ?? "?";
    recordEvent({
      type: "leave",
      timestamp: Date.now(),
      nickname: leavingNickname,
      roomId: this.roomId,
      ip: String(client.auth?.ip ?? "unknown"),
      sessionId: client.sessionId,
    });
    this.removePlayer(client.sessionId);
    await this.setMetadata({ players: this.rosterForMetadata() });
  }

  private rosterForMetadata(): { sessionId: string; nickname: string }[] {
    return [...this.state.players.values()].map((p) => ({
      sessionId: p.sessionId,
      nickname: p.nickname,
    }));
  }

  private removePlayer(sessionId: string) {
    const player = this.state.players.get(sessionId);
    if (!player) return;

    if (player.role !== "") {
      const team = this.state.teams.find((t) => t.id === player.teamId);
      if (team?.pigSessionId === sessionId) team.pigSessionId = "";
      if (team?.rabbitSessionId === sessionId) team.rabbitSessionId = "";
      // A full roster is exactly what starts the countdown, so anyone
      // leaving mid-countdown necessarily had a role slot — cancel it
      // rather than let it start a match one player short.
      this.abortCountdown();
    }

    this.state.players.delete(sessionId);
    this.playerUserIds.delete(sessionId);

    // Same announcement in both phases, routed to whichever chat list is
    // currently visible — mirrors handleSendChat's phase-based list choice.
    const chatList = this.state.phase === "lobby" ? this.state.lobbyChat : this.state.matchChat;
    this.pushChat(chatList, "", `${player.nickname}님이 퇴장했습니다`);
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
    // Once the pre-game countdown starts every slot is already full (that's
    // what triggers it) — block further swaps so the roster shown for "3...
    // 2... 1..." is the one that actually plays.
    if (this.state.phase !== "lobby" || this.state.countdownSecondsLeft > 0) return;

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
    if (!ready || this.state.countdownSecondsLeft > 0) return;

    // Colyseus auto-unlocks a maxClients-triggered lock the moment any
    // client leaves (see _decrementClientCount), which would put this room
    // back in joinOrCreate's matchmaking pool the instant an eliminated
    // player leaves — exactly when we most need it hidden. An explicit
    // lock() is not undone by that auto-unlock (it only fires when
    // !_lockedExplicitly), so it's the real defense. Locked here (countdown
    // start) rather than only once play begins, since the roster is already
    // final and must not accept new joiners during the countdown either.
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
    this.startCountdown();
  }

  private startCountdown() {
    this.state.countdownSecondsLeft = COUNTDOWN_START_SECONDS;
    this.countdownToken++;
    this.scheduleCountdownTick(this.countdownToken);
  }

  // A leave during the countdown (abortCountdown, called from removePlayer)
  // bumps countdownToken, which is how an already-scheduled tick here
  // recognizes it's stale and stops instead of continuing a countdown for a
  // roster that's no longer full.
  private scheduleCountdownTick(token: number) {
    this.clock.setTimeout(() => {
      if (token !== this.countdownToken) return;
      this.state.countdownSecondsLeft--;
      if (this.state.countdownSecondsLeft > 0) {
        this.scheduleCountdownTick(token);
      } else {
        this.beginPlaying();
      }
    }, this.countdownTickMs);
  }

  // A countdown in progress gets silently cancelled (not resumed) by a
  // leave — removePlayer already frees the vacated role slot, and the next
  // player to fill it re-triggers maybeStartGame's readiness check, which
  // starts a fresh countdown from COUNTDOWN_START_SECONDS.
  private abortCountdown() {
    if (this.state.countdownSecondsLeft === 0) return;
    this.state.countdownSecondsLeft = 0;
    this.countdownToken++;
    // maybeStartGame() locked the room the instant the countdown began (to
    // stop new joins while it's running) — cancelling it must undo that, or
    // the now-short-a-player room stays locked forever and no one can fill
    // the freed slot.
    this.unlock();
  }

  private beginPlaying() {
    this.state.phase = "playing";
    this.state.round = 1;
    this.state.activeTeamIndex = 0;
    this.turnsThisRound = 0;
    this.teamsAliveAtRoundStart = this.state.teams.length;
    this.startTurn();
  }

  private isMatchOver(): boolean {
    return this.state.teams.every((t) => t.eliminated);
  }

  // Bumps turnToken so any timer scheduled by a PREVIOUS startTurn() call
  // becomes stale — its captured `token` no longer equals `this.turnToken`,
  // so its `clock.setTimeout` callback becomes a no-op instead of firing
  // onTurnTimerExpired for a turn that's no longer current. startTurn()
  // itself needs this on every ordinary hand-off, and handleRematch() needs
  // it too (see its own comment) — both call this instead of each
  // hand-rolling `this.turnToken++`, so a future transition that also needs
  // to invalidate an in-flight turn (e.g. a forced forfeit) can't forget the
  // step by copy-pasting an incomplete version of it. See
  // docs/TROUBLESHOOTING.md #21.
  private invalidateInFlightTurn() {
    this.turnToken++;
  }

  // Resets this same room back to its lobby state (teams/roles cleared) once
  // every team has been wiped out, instead of players having to leave and
  // find/create a fresh room to play again together. Guarded to only fire
  // once the match has actually concluded.
  //
  // isMatchOver() can go true from a wrong PRESS (handlePressButton sets
  // `eliminated` immediately) well before advanceToNextTurn() ever runs —
  // that hand-off is deliberately deferred to the deciding turn's original
  // startTurn()-scheduled timer, so the fail state stays on screen for the
  // rest of the turn (see handlePressButton). A client can send "rematch"
  // (e.g. the very instant the match-over screen appears) inside that
  // window, while the old timer is still armed and pointing at the team/
  // round state this function is about to reset. invalidateInFlightTurn()
  // here stops that stale timer the same way startTurn() stops the
  // PREVIOUS turn's timer on every ordinary hand-off — without this, that
  // stale timer still passes its `token === turnToken` check once it
  // fires, silently applying one more mortar loss (and possibly starting a
  // phantom turn) to the new lobby before anyone has picked a role for the
  // next match. See docs/TROUBLESHOOTING.md #21.
  private handleRematch() {
    if (this.state.phase !== "playing" || !this.isMatchOver()) return;

    this.invalidateInFlightTurn();
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

    this.invalidateInFlightTurn();
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
      // Type-only cast, not a copy — attemptPress only ever does indexed/
      // length reads, both of which ArraySchema supports natively. This
      // used to be `Array.from(...)`, copying the whole (up to ~48-token)
      // sequence into a fresh array on every single press message.
      this.state.sequence as unknown as Color[],
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
    if (isEliminated(team.mortars)) {
      team.eliminated = true;
      // Credit the round they were eliminated in — advanceToNextTurn's own
      // credit (below) only reaches teams still alive when a round
      // completes, so a team that goes out mid-round would otherwise never
      // get its final round recorded at all.
      this.creditRound(team, this.state.round);
    }
  }

  // Records "reached round N" as each of a team's two players' new personal
  // best (recordRoundAchievement itself only ever raises the stored value,
  // never lowers it — see its own comment). Missing from playerUserIds only
  // happens if the seat is currently empty (nicknameFor's "대기 중" case
  // doesn't apply mid-match, but a slot freed by a drop and not yet
  // refilled still shouldn't crash this).
  private creditRound(team: TeamState, round: number) {
    for (const sessionId of [team.pigSessionId, team.rabbitSessionId]) {
      const userId = this.playerUserIds.get(sessionId);
      if (userId) recordRoundAchievement(userId, round);
    }
  }

  private advanceToNextTurn() {
    const teamsSnapshot: TeamStatus[] = this.state.teams.map((t) => ({
      id: t.id,
      eliminated: t.eliminated,
    }));

    this.turnsThisRound++;
    // Compare against the count fixed at THIS round's start, not a fresh
    // recount — a team eliminated on its own turn this round must still
    // count toward "has this round's roster all gone", or a team later in
    // turn order (not yet up) gets skipped as if the round were already
    // over. See docs/TROUBLESHOOTING.md #24.
    if (this.turnsThisRound >= this.teamsAliveAtRoundStart) {
      this.state.round++;
      this.turnsThisRound = 0;
      this.teamsAliveAtRoundStart = teamsSnapshot.filter((t) => !t.eliminated).length;
      // Surviving teams get credited here, every time the room actually
      // reaches a new round — this is the only credit a team that's never
      // eliminated (the eventual sole survivor of a match with no formal
      // "win", see isMatchOver's own comment) ever gets, and it's what lets
      // their max_round keep climbing for as long as the match continues.
      for (const status of teamsSnapshot) {
        if (status.eliminated) continue;
        const team = this.state.teams.find((t) => t.id === status.id)!;
        this.creditRound(team, this.state.round);
      }
    }

    this.state.activeTeamIndex = nextActiveTeamIndex(teamsSnapshot, this.state.activeTeamIndex);

    // nextActiveTeamIndex falls back to the current index when every team is
    // eliminated (nothing left to skip to) — freeze here instead of starting
    // a phantom turn for a team that's already out.
    if (this.state.teams[this.state.activeTeamIndex].eliminated) return;

    this.startTurn();
  }
}
