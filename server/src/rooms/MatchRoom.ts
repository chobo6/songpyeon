import { Room, Client, type AuthContext } from "colyseus";
import type { ArraySchema } from "@colyseus/schema";
import { MatchState, PlayerState, TeamState, ChatMessage, SpectatorState } from "./MatchState";
import { generateSequence } from "../game/sequence";
import { sequenceLengthForRound } from "../game/sequenceLength";
import { attemptPress } from "../game/turnOrder";
import { loseMortar, isEliminated, STARTING_MORTARS } from "../game/mortar";
import { isSpammedMintPress } from "../game/mintSpamGuard";
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
const DEFAULT_RECONNECT_GRACE_SECONDS = 20;
// Colyseus rejects ANY join (joinOrCreate AND joinById) once
// clients.length + reservedSeats reaches maxClients — that check happens
// before onJoin ever runs, so maxClients can't be used to cap "player"
// seats only once spectators need to keep connecting past that point. Set
// generously high so a full room of players never blocks a spectator's
// joinById; the real player-seat limit is enforced by playerCapacity
// instead (see onJoin).
const MAX_CLIENTS_WITH_SPECTATORS = 1000;

interface MatchRoomOptions {
  turnDurationMs?: number;
  // Per-tick duration of the pre-game 3/2/1 countdown, not the countdown's
  // total length — always exactly COUNTDOWN_START_SECONDS ticks, so tests
  // can shrink this to run the countdown fast without changing what number
  // it starts at. See maybeStartGame's countdown methods.
  countdownTickMs?: number;
  teamCount?: unknown;
  roomTitle?: unknown;
  // Seconds to hold a disconnected player's seat open before freeing it for
  // good — only consulted for a non-consented disconnect during "playing"
  // (see onLeave). Overridable so tests can shrink it instead of waiting
  // out the real default.
  reconnectGraceSeconds?: number;
  // Whether a client joining after the match has already started (phase
  // !== "lobby") is allowed to join as a spectator instead of being
  // rejected outright. Defaults to true — only an explicit `false` opts a
  // room out (see onCreate).
  allowSpectators?: unknown;
}

export class MatchRoom extends Room<MatchState> {
  maxClients = 4;

  private turnDurationMs = DEFAULT_TURN_DURATION_MS;
  private countdownTickMs = DEFAULT_COUNTDOWN_TICK_MS;
  private reconnectGraceSeconds = DEFAULT_RECONNECT_GRACE_SECONDS;
  private allowSpectators = true;
  // Real player-seat cap (teamCount * 2) — replaces maxClients for that
  // purpose now that maxClients itself is inflated to admit spectators
  // (see MAX_CLIENTS_WITH_SPECTATORS). Set once in onCreate.
  private playerCapacity = 0;
  // 관리자 페이지의 입장/퇴장 로그가 방 번호(roomId) 대신 실제 방 제목을 보여줄 수
  // 있도록 저장해둠 — metadata는 setMetadata 호출 시점에만 갱신되고 그 자체를 다시
  // 읽어오는 API가 room 안에 따로 없어서, 값 자체를 필드로 들고 있는 게 더 간단함.
  private roomTitle = "";
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
  // 직전 버튼 입력(색 무관) 시각 — 민트 버튼 연타 속도 제한에만 씀(handlePressButton의
  // isSpammedMintPress 호출부 참고). 매 턴 시작마다 초기화.
  private lastPressAt: number | null = null;

  async onCreate(options: MatchRoomOptions = {}) {
    if (options.turnDurationMs) this.turnDurationMs = options.turnDurationMs;
    if (options.countdownTickMs) this.countdownTickMs = options.countdownTickMs;
    if (options.reconnectGraceSeconds) this.reconnectGraceSeconds = options.reconnectGraceSeconds;
    this.allowSpectators = options.allowSpectators !== false;

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
    this.playerCapacity = teamCount * 2;
    this.maxClients = MAX_CLIENTS_WITH_SPECTATORS;

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
    this.roomTitle = roomTitle || "이름 없는 방";
    await this.setMetadata({
      roomTitle: this.roomTitle,
      playerCapacity: this.playerCapacity,
      allowSpectators: this.allowSpectators,
      phase: "lobby",
    });

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
    if (this.state.players.has(client.sessionId) || this.state.spectators.has(client.sessionId)) return;

    // The roster is genuinely still open for a new PLAYER only while phase
    // is "lobby" AND no countdown is running — the countdown starting is
    // exactly what makes maybeStartGame() setPrivate(true) the room and flip
    // metadata.phase to "playing" early (see maybeStartGame's own comment),
    // so the room list already advertises this room as "관전하기", not
    // "입장", for that whole window. Routing purely on `state.phase` here
    // would miss that window (phase itself doesn't flip to "playing" until
    // beginPlaying() runs) and reject the joiner outright with "방이 가득
    // 찼습니다" instead of seating them as a spectator — a real bug reported
    // after the countdown-window room-list fix above.
    const rosterOpenForPlayers = this.state.phase === "lobby" && this.state.countdownSecondsLeft === 0;
    if (!rosterOpenForPlayers) {
      if (!this.allowSpectators) {
        throw new Error("이 방은 관전을 허용하지 않습니다.");
      }
      const spectator = new SpectatorState();
      spectator.sessionId = client.sessionId;
      spectator.nickname = client.auth?.nickname ?? "관전자";
      this.state.spectators.set(client.sessionId, spectator);
      return;
    }

    // maxClients is now inflated to admit spectators (see
    // MAX_CLIENTS_WITH_SPECTATORS), so Colyseus's own seat-reservation check
    // no longer caps how many players can join the lobby — playerCapacity
    // does that job now.
    if (this.state.players.size >= this.playerCapacity) {
      throw new Error("방이 가득 찼습니다.");
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
      roomTitle: this.roomTitle,
      ip: String(client.auth?.ip ?? "unknown"),
      sessionId: client.sessionId,
    });

    const metadataUpdate: { players: { sessionId: string; nickname: string }[]; hostNickname?: string } = {
      players: this.rosterForMetadata(),
    };
    if (isHost) metadataUpdate.hostNickname = nickname;
    await this.setMetadata(metadataUpdate);
  }

  async onLeave(client: Client, consented: boolean) {
    // 관전자는 재접속 유예도, 이벤트 로그도, 퇴장 채팅 안내도 없이 즉시 제거한다 —
    // 그냥 다시 관전 입장하면 되므로 플레이어 쪽 onLeave 로직과 완전히 분리해둔다.
    if (this.state.spectators.has(client.sessionId)) {
      this.state.spectators.delete(client.sessionId);
      return;
    }

    console.log(`[leave] session=${client.sessionId} ip=${client.auth?.ip}`);
    const leavingNickname = this.state.players.get(client.sessionId)?.nickname ?? "?";
    recordEvent({
      type: "leave",
      timestamp: Date.now(),
      nickname: leavingNickname,
      roomId: this.roomId,
      roomTitle: this.roomTitle,
      ip: String(client.auth?.ip ?? "unknown"),
      sessionId: client.sessionId,
    });

    // A non-consented drop during an active match (refresh, closed tab,
    // network blip — anything that isn't an explicit "나가기" click) gets a
    // grace period to reconnect into the exact same seat instead of losing
    // it immediately. Lobby disconnects and deliberate leaves skip this
    // entirely and fall straight through to the removal below, same as
    // before this feature existed.
    if (this.state.phase === "playing" && !consented) {
      try {
        await this.allowReconnection(client, this.reconnectGraceSeconds);
        // Reconnected in time. removePlayer was never called, so the seat,
        // team assignment, and role are exactly as they were — just
        // announce the comeback the same way a fresh join would be.
        const player = this.state.players.get(client.sessionId);
        if (player) this.pushChat(this.state.matchChat, "", `${player.nickname}님이 입장했습니다`);
        return;
      } catch {
        // Grace period expired without a reconnect — fall through to the
        // normal removal below, same as any other leave.
      }
    }

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
    if (player) {
      const list = this.state.phase === "lobby" ? this.state.lobbyChat : this.state.matchChat;
      this.pushChat(list, player.nickname, text);
      return;
    }

    const spectator = this.state.spectators.get(client.sessionId);
    if (spectator) {
      // 관전자는 진행 중인 매치(phase !== "lobby")에만 존재할 수 있으므로
      // (onJoin 참고) 항상 matchChat으로 보낸다.
      this.pushChat(this.state.matchChat, `${spectator.nickname} (관전)`, text);
    }
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

  private async maybeStartGame() {
    const ready = this.state.teams.every((t) => t.pigSessionId !== "" && t.rabbitSessionId !== "");
    if (!ready || this.state.countdownSecondsLeft > 0) return;

    // setPrivate (not lock()) to keep this room out of joinOrCreate's
    // matchmaking pool once the roster is final — lock() would also make
    // Colyseus's matchmaker reject spectators' joinById calls outright
    // (checked before onJoin ever runs, same class of problem as maxClients
    // — see MAX_CLIENTS_WITH_SPECTATORS above), which is exactly the path
    // spectators need. private has no such effect on joinById, and (unlike
    // an implicit maxClients-triggered lock) is never auto-toggled by
    // Colyseus itself — only abortCountdown/handleRematch undo it below.
    // Set here (countdown start) rather than only once play begins, since
    // the roster is already final and must not accept new joiners during
    // the countdown either.
    this.setPrivate(true);
    // Mirrored into metadata here too (not just beginPlaying), or else the
    // public room list would show this room as still-joinable "입장" for the
    // whole 3-2-1 countdown — a real player clicking it would bounce off
    // playerCapacity's rejection since the roster is already final. This
    // makes metadata.phase flip to "playing" slightly before state.phase
    // does (state.phase only flips once beginPlaying() actually runs) —
    // intentional: metadata.phase means "closed to new player joins", a
    // narrower question than the game-logic phase.
    await this.setMetadata({ phase: "playing" });
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
  private async abortCountdown() {
    if (this.state.countdownSecondsLeft === 0) return;
    this.state.countdownSecondsLeft = 0;
    this.countdownToken++;
    // maybeStartGame() made the room private the instant the countdown began
    // (to keep it out of joinOrCreate matchmaking while it's running) —
    // cancelling it must undo that, or the now-short-a-player room stays
    // hidden forever and no one can matchmake into the freed slot.
    this.setPrivate(false);
    // maybeStartGame() also flipped metadata.phase to "playing" early (see
    // its own comment) — undo that too, or the room list keeps showing
    // "게임 중" for a room that's actually back open for new players.
    await this.setMetadata({ phase: "lobby" });
  }

  private async beginPlaying() {
    this.state.phase = "playing";
    this.state.round = 1;
    this.state.activeTeamIndex = 0;
    this.turnsThisRound = 0;
    this.teamsAliveAtRoundStart = this.state.teams.length;
    // room.locked (what /api/rooms used to read) never becomes true anymore
    // now that maybeStartGame uses setPrivate instead of lock() — the public
    // room list needs some other signal for "this match is in progress," so
    // phase is mirrored into metadata here and reset to "lobby" in
    // handleRematch.
    await this.setMetadata({ phase: "playing" });
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
  private async handleRematch() {
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

    // maybeStartGame()'s setPrivate(true) from the match that just ended is
    // still in effect — undo it so a freed slot (e.g. someone left
    // mid-match) can be backfilled by a new joiner while the room sits in
    // "lobby" again.
    this.setPrivate(false);
    await this.setMetadata({ phase: "lobby" });
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
    this.lastPressAt = null;

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

    const now = Date.now();
    const sinceLastPress = this.lastPressAt === null ? null : now - this.lastPressAt;
    this.lastPressAt = now;
    if (isSpammedMintPress(color, sinceLastPress)) {
      // 너무 빠른 민트 연타는 무시 — 손가락으로는 사실상 낼 수 없는 속도라, 폰에
      // 키보드/매크로를 연결해 버튼 위치에 키를 매핑해 연타하는 걸 억제하기 위함.
      return;
    }

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
