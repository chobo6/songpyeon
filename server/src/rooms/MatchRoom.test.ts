import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { boot, ColyseusTestServer } from "@colyseus/testing";
import type { Room as ClientRoom } from "colyseus.js";
import { Client as ColyseusJsClient } from "colyseus.js";
import type { Room as ServerRoom } from "colyseus";
import { MatchRoom } from "./MatchRoom";
import { createGameServer } from "../createServer";
import { PIG_COLORS, RABBIT_COLORS, colorRole, type Color } from "../game/colors";
import type { MatchState } from "./MatchState";
import { _resetForTest as resetEventLog, getEvents } from "../admin/eventLog";
import { _resetForTest as resetPressMonitor, subscribe as subscribeToPressMonitor } from "../admin/pressMonitor";
import { getOrCreateUser, setNickname, setNicknameColor, setUserBanned } from "../auth/googleAuth";
import { signSession } from "../auth/session";
import { db } from "../db/connection";

const ALL_COLORS: Color[] = [...PIG_COLORS, ...RABBIT_COLORS];
const SHORT_TURN_MS = 500;
// A completed turn now waits out the full turn timer before handing off
// (see MatchRoom.ts's handlePressButton), so any test that presses through
// a full ~18-color sequence via completeActiveTurn() needs a turn long
// enough to fit that many real message round-trips before its own timer
// would fire — SHORT_TURN_MS is tuned for single-press tests and is too
// tight for that.
const PRESS_HEAVY_TURN_MS = 3000;
// Fast per-tick duration for the pre-game 3/2/1 countdown (see MatchRoom.ts's
// countdownTickMs option) — always exactly 3 ticks (COUNTDOWN_START_SECONDS,
// not exported/configurable), so waitForCountdown()'s margin only needs to
// clear 3 * COUNTDOWN_TICK_MS. Kept well above flush()'s own 10ms wait so a
// "check the count right after filling roles" assertion isn't racing the
// first tick's timer.
const COUNTDOWN_TICK_MS = 60;

// `room` in these tests is the live server-side Room instance (see
// ColyseusTestServer.createRoom), not a client-synced copy — so we only
// need to yield the event loop long enough for an onMessage handler to run,
// not wait for Colyseus's (throttled) patch-broadcast tick.
function flush() {
  return new Promise((resolve) => setTimeout(resolve, 10));
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Minimal Express Request/Response stand-in for pressMonitor.subscribe(),
// which only needs headers/flushHeaders/write plus the two "close" event
// hooks it registers — matches server/src/admin/pressMonitor.test.ts's own
// helper. Captures written SSE chunks so a test can assert on them.
function makeMockSseClient() {
  const written: string[] = [];
  const req = { on: () => {} } as unknown as Parameters<typeof subscribeToPressMonitor>[1];
  const res = {
    setHeader: () => {},
    flushHeaders: () => {},
    write: (chunk: string) => {
      written.push(chunk);
    },
    on: () => {},
  } as unknown as Parameters<typeof subscribeToPressMonitor>[2];
  return { req, res, written };
}

// Waits out the pre-game 3/2/1 countdown (always exactly 3 ticks — see
// MatchRoom.ts's COUNTDOWN_START_SECONDS), assuming the room was created
// with countdownTickMs: COUNTDOWN_TICK_MS.
function waitForCountdown() {
  return wait(3 * COUNTDOWN_TICK_MS + 100);
}

// Polls instead of sleeping a fixed duration — this test suite runs many
// rooms on real timers, so a fixed "sleep one tick then assert the exact
// intermediate value" is prone to drift (a slightly late tick, or an extra
// one slipping in before the assertion runs). Waiting for the actual
// condition is immune to that.
async function waitUntil(predicate: () => boolean, timeoutMs = 2000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitUntil: timed out");
    await wait(10);
  }
}

let testUserCounter = 0;

// MatchRoom.onAuth가 로그인 세션을 요구하므로, 게임 로직만 검증하려는 기존 테스트들도 이제
// "로그인된 유저로 접속"을 거쳐야 한다. 테스트용 유저를 DB에 만들고 실제 세션 쿠키를 발급받아,
// colyseus.js Client를 커스텀 Cookie 헤더로 직접 연결한다 (@colyseus/testing의 connectTo는
// 헤더를 커스터마이즈할 수 없어서 이 방식이 필요 — colyseus.js가 Node 환경에서 WebSocket
// 업그레이드 요청에 커스텀 헤더를 지원하는 것을 확인하고 쓰는 것).
async function connectAsUser(
  colyseus: ColyseusTestServer,
  room: ServerRoom<MatchState>,
  nickname: string,
  nicknameColor?: string,
) {
  testUserCounter += 1;
  const user = getOrCreateUser(`test-google-sub-${testUserCounter}`, {});
  setNickname(user.id, nickname);
  if (nicknameColor) setNicknameColor(user.id, nicknameColor);
  const token = signSession(user.id);
  const port = (colyseus.server as unknown as { port: number }).port;
  const client = new ColyseusJsClient(`ws://127.0.0.1:${port}`, {
    headers: { Cookie: `session=${token}` },
  });
  return client.joinById<MatchState>(room.roomId);
}

describe("MatchRoom", () => {
  let colyseus: ColyseusTestServer;

  beforeAll(async () => {
    colyseus = await boot(createGameServer());
  });

  afterAll(async () => {
    await colyseus.shutdown();
  });

  beforeEach(async () => {
    await colyseus.cleanup();
    // Nicknames are now globally unique (setNickname rejects a nickname
    // already taken by another account), and connectAsUser's test users
    // accumulate in this file's shared :memory: DB across tests — without
    // this reset, a later test reusing a literal like "채팅유저" would
    // collide with an earlier test's leftover account and silently fail to
    // get a nickname (onAuth then rejects the join entirely).
    db.exec("DELETE FROM users");
  });

  async function fillRolesAndStart(options: Record<string, unknown> = {}) {
    const room = await colyseus.createRoom<MatchState>("match", { countdownTickMs: COUNTDOWN_TICK_MS, ...options });
    const clients: ClientRoom<MatchState>[] = [];
    for (const [i, role] of (["pig", "rabbit", "pig", "rabbit"] as const).entries()) {
      // Nicknames must be unique per account now — suffix with the loop
      // index so four players filling one room don't collide with each other.
      const client = await connectAsUser(colyseus, room, `플레이어${i}`);
      client.send("chooseRole", { role });
      clients.push(client);
    }
    await flush();
    // Filling the last role slot only starts the 3/2/1 countdown, not the
    // match itself — wait it out so every existing caller's "the match has
    // already started" assumption (checking room.state.phase, sequence,
    // etc.) still holds.
    await waitForCountdown();
    return { room, clients };
  }

  function actingClientFor(room: ServerRoom<MatchState>, clients: ClientRoom<MatchState>[]) {
    const activeTeam = room.state.teams[room.state.activeTeamIndex];
    const dueColor = room.state.sequence[room.state.cursor] as Color;
    const dueRole = colorRole(dueColor);
    const actingSessionId = dueRole === "pig" ? activeTeam.pigSessionId : activeTeam.rabbitSessionId;
    return { activeTeam, dueColor, actingClient: clients.find((c) => c.sessionId === actingSessionId)! };
  }

  async function completeActiveTurn(
    room: ServerRoom<MatchState>,
    clients: ClientRoom<MatchState>[],
    turnDurationMs: number,
  ) {
    // Presses need to be spaced out past MatchRoom.ts's mint-spam-guard
    // threshold (50ms) — flush()'s 10ms gap would have every mint-run press
    // silently ignored as spam, stalling the sequence forever.
    while (room.state.cursor < room.state.sequence.length - 1) {
      const { dueColor, actingClient } = actingClientFor(room, clients);
      actingClient.send("pressButton", { color: dueColor });
      await wait(70);
    }
    const { dueColor, actingClient } = actingClientFor(room, clients);
    actingClient.send("pressButton", { color: dueColor });
    await wait(70);
    await wait(turnDurationMs + 200);
  }

  test("game starts once both teams have a pig and a rabbit", async () => {
    const { room } = await fillRolesAndStart();

    expect(room.state.phase).toBe("playing");
    expect(room.state.teams).toHaveLength(2);
    room.state.teams.forEach((team) => {
      expect(team.pigSessionId).not.toBe("");
      expect(team.rabbitSessionId).not.toBe("");
    });
    expect(room.state.sequence).toHaveLength(18);
    expect(room.state.cursor).toBe(0);
    expect(room.state.round).toBe(1);
  });

  test("filling the last role slot starts a 3-2-1 countdown before the match actually begins", async () => {
    const room = await colyseus.createRoom<MatchState>("match", { countdownTickMs: COUNTDOWN_TICK_MS });
    const clients: ClientRoom<MatchState>[] = [];
    for (const [i, role] of (["pig", "rabbit", "pig", "rabbit"] as const).entries()) {
      const client = await connectAsUser(colyseus, room, `플레이어${i}`);
      client.send("chooseRole", { role });
      clients.push(client);
    }
    await flush();

    // The last slot filling only starts the countdown — the match itself
    // (phase flip, first turn) hasn't happened yet.
    expect(room.state.phase).toBe("lobby");
    expect(room.state.countdownSecondsLeft).toBe(3);

    await waitUntil(() => room.state.countdownSecondsLeft === 2);
    expect(room.state.phase).toBe("lobby");

    await waitUntil(() => room.state.countdownSecondsLeft === 1);
    expect(room.state.phase).toBe("lobby");

    await waitUntil(() => room.state.countdownSecondsLeft === 0);
    expect(room.state.phase).toBe("playing");
  });

  test("room metadata reports phase: playing as soon as the countdown starts, not just once it finishes", async () => {
    const room = await colyseus.createRoom<MatchState>("match", { countdownTickMs: COUNTDOWN_TICK_MS });
    const clients: ClientRoom<MatchState>[] = [];
    for (const [i, role] of (["pig", "rabbit", "pig", "rabbit"] as const).entries()) {
      const client = await connectAsUser(colyseus, room, `플레이어${i}`);
      client.send("chooseRole", { role });
      clients.push(client);
    }
    await flush();

    // state.phase (game logic) is still "lobby" during the countdown, but
    // metadata.phase (room-list "is this joinable" signal) must already
    // read "playing" — otherwise the public room list would show this room
    // as still-joinable "입장" for the whole 3-2-1 countdown, even though
    // the roster is already final and a click would just bounce off
    // playerCapacity's rejection.
    expect(room.state.phase).toBe("lobby");
    expect(room.state.countdownSecondsLeft).toBeGreaterThan(0);
    expect((room.metadata as { phase?: string })?.phase).toBe("playing");
  });

  test("aborting the countdown reverts room metadata phase back to lobby", async () => {
    const room = await colyseus.createRoom<MatchState>("match", { countdownTickMs: COUNTDOWN_TICK_MS });
    const clients: ClientRoom<MatchState>[] = [];
    for (const [i, role] of (["pig", "rabbit", "pig", "rabbit"] as const).entries()) {
      const client = await connectAsUser(colyseus, room, `플레이어${i}`);
      client.send("chooseRole", { role });
      clients.push(client);
    }
    await flush();
    expect((room.metadata as { phase?: string })?.phase).toBe("playing");

    await clients[0].leave();
    await flush();

    expect(room.state.countdownSecondsLeft).toBe(0);
    expect((room.metadata as { phase?: string })?.phase).toBe("lobby");
  });

  test("a client joining while the pre-game countdown is running becomes a spectator instead of being rejected", async () => {
    const room = await colyseus.createRoom<MatchState>("match", { countdownTickMs: COUNTDOWN_TICK_MS });
    const clients: ClientRoom<MatchState>[] = [];
    for (const [i, role] of (["pig", "rabbit", "pig", "rabbit"] as const).entries()) {
      const client = await connectAsUser(colyseus, room, `플레이어${i}`);
      client.send("chooseRole", { role });
      clients.push(client);
    }
    await flush();
    expect(room.state.phase).toBe("lobby");
    expect(room.state.countdownSecondsLeft).toBeGreaterThan(0);

    // The room list already shows this room as "관전하기" during the
    // countdown (metadata.phase is "playing" — see the test above) — a join
    // attempt now must actually be seated as a spectator, not rejected with
    // "방이 가득 찼습니다" the way a genuinely-still-open lobby would reject
    // an overflow player. Before the fix, this line itself would throw.
    const spectatorClient = await connectAsUser(colyseus, room, "관전자1");
    await flush();

    expect(room.state.spectators.has(spectatorClient.sessionId)).toBe(true);
    expect(room.state.players.has(spectatorClient.sessionId)).toBe(false);
  });

  test("role picking is blocked once the pre-game countdown has started", async () => {
    const room = await colyseus.createRoom<MatchState>("match", { countdownTickMs: COUNTDOWN_TICK_MS });
    const clients: ClientRoom<MatchState>[] = [];
    for (const [i, role] of (["pig", "rabbit", "pig", "rabbit"] as const).entries()) {
      const client = await connectAsUser(colyseus, room, `플레이어${i}`);
      client.send("chooseRole", { role });
      clients.push(client);
    }
    await flush();
    expect(room.state.countdownSecondsLeft).toBe(3);

    // The first player (pig on team-1) tries to switch to rabbit mid-countdown.
    const pigTeam1 = room.state.teams[0].pigSessionId;
    clients[0].send("chooseRole", { role: "rabbit" });
    await flush();

    expect(room.state.teams[0].pigSessionId).toBe(pigTeam1);
    expect(room.state.players.get(clients[0].sessionId)?.role).toBe("pig");
  });

  test("a player leaving mid-countdown cancels it instead of starting the match one player short", async () => {
    const room = await colyseus.createRoom<MatchState>("match", { countdownTickMs: COUNTDOWN_TICK_MS });
    const clients: ClientRoom<MatchState>[] = [];
    for (const [i, role] of (["pig", "rabbit", "pig", "rabbit"] as const).entries()) {
      const client = await connectAsUser(colyseus, room, `플레이어${i}`);
      client.send("chooseRole", { role });
      clients.push(client);
    }
    await flush();
    expect(room.state.countdownSecondsLeft).toBe(3);

    await clients[0].leave();
    await flush();

    expect(room.state.countdownSecondsLeft).toBe(0);
    expect(room.state.teams[0].pigSessionId).toBe("");

    // Even after waiting out what would have been the full countdown, the
    // match must not have started — the cancelled countdown's scheduled
    // ticks must not silently keep running.
    await waitForCountdown();
    expect(room.state.phase).toBe("lobby");

    // Filling the freed slot starts a brand-new countdown from 3.
    const refill = await connectAsUser(colyseus, room, "플레이어새로");
    refill.send("chooseRole", { role: "pig" });
    await flush();
    expect(room.state.countdownSecondsLeft).toBe(3);

    await waitForCountdown();
    expect(room.state.phase).toBe("playing");
  });

  test("choosing a different role in the lobby switches you instead of being blocked", async () => {
    const room = await colyseus.createRoom<MatchState>("match");
    const client = await connectAsUser(colyseus, room, "플레이어");

    client.send("chooseRole", { role: "pig" });
    await flush();
    expect(room.state.teams[0].pigSessionId).toBe(client.sessionId);

    client.send("chooseRole", { role: "rabbit" });
    await flush();
    expect(room.state.teams[0].pigSessionId).toBe("");
    expect(room.state.teams[0].rabbitSessionId).toBe(client.sessionId);
    expect(room.state.players.get(client.sessionId)?.role).toBe("rabbit");
  });

  test("re-choosing the same role you already have is a no-op, not a hop to the other team", async () => {
    const room = await colyseus.createRoom<MatchState>("match");
    const client = await connectAsUser(colyseus, room, "플레이어");

    client.send("chooseRole", { role: "pig" });
    await flush();
    client.send("chooseRole", { role: "pig" });
    await flush();

    expect(room.state.teams[0].pigSessionId).toBe(client.sessionId);
    expect(room.state.teams[1].pigSessionId).toBe("");
  });

  test("sendChat routes to lobbyChat during the lobby and matchChat during play, independently", async () => {
    const { room, clients } = await fillRolesAndStart();
    const [firstClient] = clients;
    // fillRolesAndStart's 4 connects each announce a join into lobbyChat
    // before the match starts — capture that count instead of assuming 0.
    const lobbyChatCountBeforeMatch = room.state.lobbyChat.length;

    firstClient.send("sendChat", { text: "게임 중 메시지" });
    await flush();

    expect(room.state.matchChat).toHaveLength(1);
    expect(room.state.matchChat[0].text).toBe("게임 중 메시지");
    expect(room.state.matchChat[0].nickname).toBe(
      room.state.players.get(firstClient.sessionId)?.nickname,
    );
    expect(room.state.lobbyChat).toHaveLength(lobbyChatCountBeforeMatch);
  });

  test("sendChat in the lobby goes to lobbyChat, and ignores blank/invalid text", async () => {
    const room = await colyseus.createRoom<MatchState>("match");
    const client = await connectAsUser(colyseus, room, "채팅유저");

    client.send("sendChat", { text: "  로비 메시지  " });
    client.send("sendChat", { text: "   " });
    client.send("sendChat", {});
    await flush();

    // connecting itself already announced a join message before any of these.
    expect(room.state.lobbyChat).toHaveLength(2);
    expect(room.state.lobbyChat[0].text).toBe("채팅유저님이 입장했습니다");
    expect(room.state.lobbyChat[1].text).toBe("로비 메시지");
    expect(room.state.lobbyChat[1].nickname).toBe("채팅유저");
    expect(room.state.matchChat).toHaveLength(0);
  });

  test("a player joining the lobby gets a system message announcing it in lobbyChat", async () => {
    const room = await colyseus.createRoom<MatchState>("match");
    await connectAsUser(colyseus, room, "둘리");
    await flush();

    expect(room.state.lobbyChat).toHaveLength(1);
    expect(room.state.lobbyChat[0].nickname).toBe("");
    expect(room.state.lobbyChat[0].text).toBe("둘리님이 입장했습니다");
  });

  test("a player deliberately leaving the lobby gets a system message announcing it in lobbyChat", async () => {
    const room = await colyseus.createRoom<MatchState>("match");
    const client = await connectAsUser(colyseus, room, "또치");
    await flush();

    await client.leave(); // deliberate leave
    await flush();

    expect(room.state.lobbyChat).toHaveLength(2);
    expect(room.state.lobbyChat[1].nickname).toBe("");
    expect(room.state.lobbyChat[1].text).toBe("또치님이 퇴장했습니다");
  });

  test("a mid-match leave announces into matchChat instead of lobbyChat", async () => {
    const { room, clients } = await fillRolesAndStart();
    const lobbyChatCountBeforeLeave = room.state.lobbyChat.length;
    const leavingNickname = room.state.players.get(clients[0].sessionId)?.nickname;

    await clients[0].leave();
    await flush();

    expect(room.state.phase).toBe("playing");
    expect(room.state.lobbyChat).toHaveLength(lobbyChatCountBeforeLeave);
    expect(room.state.matchChat).toHaveLength(1);
    expect(room.state.matchChat[0].nickname).toBe("");
    expect(room.state.matchChat[0].text).toBe(`${leavingNickname}님이 퇴장했습니다`);
  });

  test(
    "a non-consented disconnect during play, reconnected within the grace period, keeps the same seat and announces it in matchChat",
    { timeout: 20000 },
    async () => {
      const { room, clients } = await fillRolesAndStart({ reconnectGraceSeconds: 2 });
      const [firstClient] = clients;
      const sessionId = firstClient.sessionId;
      const reconnectToken = firstClient.reconnectionToken;
      const nickname = room.state.players.get(sessionId)!.nickname;
      const matchChatCountBefore = room.state.matchChat.length;

      // consented=false — a raw connection close, the same thing a refresh
      // or closed tab looks like to the server (see colyseus.js's
      // Room.leave: consented sends a LEAVE_ROOM message, non-consented
      // just closes the socket).
      await firstClient.leave(false);
      await flush();

      // Still occupying its seat while the grace period is pending — no
      // removal has happened yet.
      expect(room.state.players.has(sessionId)).toBe(true);

      const port = (colyseus.server as unknown as { port: number }).port;
      const reconnected = await new ColyseusJsClient(`ws://127.0.0.1:${port}`).reconnect<MatchState>(
        reconnectToken,
      );
      await flush();

      expect(reconnected.sessionId).toBe(sessionId);
      expect(room.state.players.has(sessionId)).toBe(true);
      expect(room.state.matchChat).toHaveLength(matchChatCountBefore + 1);
      expect(room.state.matchChat[room.state.matchChat.length - 1].text).toBe(`${nickname}님이 입장했습니다`);

      await reconnected.leave();
    },
  );

  test(
    "a non-consented disconnect during play that is NOT reconnected within the grace period is removed like today",
    { timeout: 20000 },
    async () => {
      const { room, clients } = await fillRolesAndStart({ reconnectGraceSeconds: 0.05 });
      const [firstClient] = clients;
      const sessionId = firstClient.sessionId;
      const player = room.state.players.get(sessionId)!;
      const nickname = player.nickname;
      const team = room.state.teams.find((t) => t.id === player.teamId)!;

      await firstClient.leave(false);
      await waitUntil(() => !room.state.players.has(sessionId));

      expect(team.pigSessionId).not.toBe(sessionId);
      expect(team.rabbitSessionId).not.toBe(sessionId);
      expect(room.state.matchChat[room.state.matchChat.length - 1].text).toBe(`${nickname}님이 퇴장했습니다`);
    },
  );

  test("a non-consented disconnect during the lobby is removed immediately (no reconnection grace)", async () => {
    const room = await colyseus.createRoom<MatchState>("match", { reconnectGraceSeconds: 5 });
    const client = await connectAsUser(colyseus, room, "로비유저");
    await flush();
    const sessionId = client.sessionId;

    await client.leave(false);
    await flush();

    expect(room.state.players.has(sessionId)).toBe(false);
  });

  test("a deliberate (consented) leave during play is removed immediately, without reconnection grace", async () => {
    const { room, clients } = await fillRolesAndStart({ reconnectGraceSeconds: 5 });
    const [firstClient] = clients;
    const sessionId = firstClient.sessionId;

    await firstClient.leave(); // consented=true (the default)
    await flush();

    expect(room.state.players.has(sessionId)).toBe(false);
  });

  test("chat history caps at 50 messages, dropping the oldest first", async () => {
    const room = await colyseus.createRoom<MatchState>("match");
    const client = await connectAsUser(colyseus, room, "플레이어");

    for (let i = 0; i < 55; i++) {
      client.send("sendChat", { text: `msg${i}` });
    }
    await flush();

    expect(room.state.lobbyChat).toHaveLength(50);
    expect(room.state.lobbyChat[0].text).toBe("msg5");
    expect(room.state.lobbyChat[49].text).toBe("msg54");
  });

  test("ping replies with pong carrying the original timestamp and the server's current time", async () => {
    const room = await colyseus.createRoom<MatchState>("match");
    const client = await connectAsUser(colyseus, room, "플레이어");

    const pong = await new Promise<{ clientSentAt: number; serverTime: number }>((resolve) => {
      client.onMessage("pong", resolve);
      client.send("ping", 12345);
    });

    expect(pong.clientSentAt).toBe(12345);
    expect(pong.serverTime).toBeGreaterThan(0);
  });

  test("the first player to join becomes host, storing their nickname in room metadata for the room list", async () => {
    const room = await colyseus.createRoom<MatchState>("match");
    await connectAsUser(colyseus, room, "방장");
    await flush();

    expect(room.metadata?.hostNickname).toBe("방장");
  });

  test("onCreate builds the requested number of teams and sizes playerCapacity to match (maxClients is now fixed and inflated to admit spectators — see MAX_CLIENTS_WITH_SPECTATORS)", async () => {
    const oneTeam = await colyseus.createRoom<MatchState>("match", { teamCount: 1 });
    expect(oneTeam.state.teams).toHaveLength(1);
    expect((oneTeam.metadata as { playerCapacity?: number })?.playerCapacity).toBe(2);
    expect(oneTeam.maxClients).toBeGreaterThan(2);

    const threeTeams = await colyseus.createRoom<MatchState>("match", { teamCount: 3 });
    expect(threeTeams.state.teams.map((t) => t.id)).toEqual(["team-1", "team-2", "team-3"]);
    expect((threeTeams.metadata as { playerCapacity?: number })?.playerCapacity).toBe(6);

    const fourTeams = await colyseus.createRoom<MatchState>("match", { teamCount: 4 });
    expect(fourTeams.state.teams.map((t) => t.id)).toEqual(["team-1", "team-2", "team-3", "team-4"]);
    expect((fourTeams.metadata as { playerCapacity?: number })?.playerCapacity).toBe(8);
  });

  test("onCreate sets the room title in metadata immediately, before anyone joins", async () => {
    const titled = await colyseus.createRoom<MatchState>("match", { roomTitle: "  즐겜방  " });
    expect((titled.metadata as { roomTitle?: string })?.roomTitle).toBe("즐겜방");

    const untitled = await colyseus.createRoom<MatchState>("match");
    expect((untitled.metadata as { roomTitle?: string })?.roomTitle).toBe("이름 없는 방");
  });

  test("onCreate defaults to 2 teams for a missing or out-of-range teamCount", async () => {
    const missing = await colyseus.createRoom<MatchState>("match");
    expect(missing.state.teams).toHaveLength(2);
    expect((missing.metadata as { playerCapacity?: number })?.playerCapacity).toBe(4);

    const outOfRange = await colyseus.createRoom<MatchState>("match", { teamCount: 7 });
    expect(outOfRange.state.teams).toHaveLength(2);
    expect((outOfRange.metadata as { playerCapacity?: number })?.playerCapacity).toBe(4);
  });

  test("a 3-team room starts once all 3 teams have a pig and a rabbit", async () => {
    const room = await colyseus.createRoom<MatchState>("match", { teamCount: 3, countdownTickMs: COUNTDOWN_TICK_MS });
    for (const [i, role] of (["pig", "rabbit", "pig", "rabbit", "pig", "rabbit"] as const).entries()) {
      const client = await connectAsUser(colyseus, room, `플레이어${i}`);
      client.send("chooseRole", { role });
    }
    await flush();
    await waitForCountdown();

    expect(room.state.phase).toBe("playing");
    room.state.teams.forEach((team) => {
      expect(team.pigSessionId).not.toBe("");
      expect(team.rabbitSessionId).not.toBe("");
    });
  });

  test("a 1-team room starts once its single team has a pig and a rabbit, and keeps rotating to itself", async () => {
    const room = await colyseus.createRoom<MatchState>("match", {
      teamCount: 1,
      turnDurationMs: PRESS_HEAVY_TURN_MS,
      countdownTickMs: COUNTDOWN_TICK_MS,
    });
    const clients: ClientRoom<MatchState>[] = [];
    for (const [i, role] of (["pig", "rabbit"] as const).entries()) {
      const client = await connectAsUser(colyseus, room, `플레이어${i}`);
      client.send("chooseRole", { role });
      clients.push(client);
    }
    await flush();
    await waitForCountdown();

    expect(room.state.phase).toBe("playing");

    const soloTeamId = room.state.teams[0].id;
    await completeActiveTurn(room, clients, PRESS_HEAVY_TURN_MS);

    // no rival team to hand off to — the lone team just keeps getting turns.
    expect(room.state.phase).toBe("playing");
    expect(room.state.teams[room.state.activeTeamIndex].id).toBe(soloTeamId);
  });

  test("the correct button advances the cursor", async () => {
    const { room, clients } = await fillRolesAndStart();
    const { activeTeam, dueColor, actingClient } = actingClientFor(room, clients);

    actingClient.send("pressButton", { color: dueColor });
    await flush();

    expect(room.state.cursor).toBe(1);
    expect(room.state.teams[room.state.activeTeamIndex].id).toBe(activeTeam.id);
  });

  test("a wrong button loses a mortar immediately but keeps the fail state on screen until the original timer", async () => {
    const { room, clients } = await fillRolesAndStart({ turnDurationMs: SHORT_TURN_MS });
    const { activeTeam, dueColor, actingClient } = actingClientFor(room, clients);
    const startingMortars = activeTeam.mortars;
    const failedTeamId = activeTeam.id;
    const wrongColor = ALL_COLORS.find((c) => c !== dueColor)!;

    actingClient.send("pressButton", { color: wrongColor });
    await flush();

    // mortar loss and fail state are immediate...
    expect(activeTeam.mortars).toBe(startingMortars - 1);
    expect(room.state.turnOutcome).toBe("fail");
    // ...but the turn hasn't handed off yet — same team, same (unresolved) sequence.
    expect(room.state.teams[room.state.activeTeamIndex].id).toBe(failedTeamId);

    await wait(SHORT_TURN_MS + 200);

    // only now, once the original 4s(-equivalent) timer elapses, does it move on.
    expect(room.state.teams[room.state.activeTeamIndex].id).not.toBe(failedTeamId);
    expect(room.state.turnOutcome).toBe("pending");
    expect(room.state.cursor).toBe(0);
  });

  test("a wrong button records the presser's own role as missedRole", async () => {
    const { room, clients } = await fillRolesAndStart({ turnDurationMs: SHORT_TURN_MS });
    const { dueColor, actingClient } = actingClientFor(room, clients);
    const pressingRole = colorRole(dueColor);
    const wrongColor = ALL_COLORS.find((c) => c !== dueColor)!;

    actingClient.send("pressButton", { color: wrongColor });
    await flush();

    expect(room.state.missedRole).toBe(pressingRole);
  });

  test("a wrong button sent by the OTHER role (out of turn) records THEIR role, not the due color's role", async () => {
    const { room, clients } = await fillRolesAndStart({ turnDurationMs: SHORT_TURN_MS });
    const { activeTeam, dueColor } = actingClientFor(room, clients);
    const dueRole = colorRole(dueColor);
    const otherRole = dueRole === "pig" ? "rabbit" : "pig";
    const otherSessionId = otherRole === "pig" ? activeTeam.pigSessionId : activeTeam.rabbitSessionId;
    const otherClient = clients.find((c) => c.sessionId === otherSessionId)!;
    // The other role can only ever send their own colors from their own
    // button panel — sending any of those while it's not their turn (the
    // due color belongs to dueRole) can never equal dueColor, so it's
    // always a wrong press.
    const otherRoleColors = otherRole === "pig" ? PIG_COLORS : RABBIT_COLORS;

    otherClient.send("pressButton", { color: otherRoleColors[0] });
    await flush();

    expect(room.state.turnOutcome).toBe("fail");
    expect(room.state.missedRole).toBe(otherRole);
  });

  test("missedRole resets to empty once the next turn starts", async () => {
    const { room, clients } = await fillRolesAndStart({ turnDurationMs: SHORT_TURN_MS });
    const { dueColor, actingClient } = actingClientFor(room, clients);
    const wrongColor = ALL_COLORS.find((c) => c !== dueColor)!;

    actingClient.send("pressButton", { color: wrongColor });
    await flush();
    expect(room.state.missedRole).not.toBe("");

    await wait(SHORT_TURN_MS + 200);

    expect(room.state.missedRole).toBe("");
  });

  test("completing the sequence keeps the success state on screen until the original timer, then hands off", async () => {
    const { room, clients } = await fillRolesAndStart({ turnDurationMs: PRESS_HEAVY_TURN_MS });

    const activeTeamId = room.state.teams[room.state.activeTeamIndex].id;
    // 70ms spacing (not flush()'s 10ms) — stays past the mint-spam-guard's
    // 50ms threshold so mint-run presses in the sequence aren't dropped.
    while (room.state.cursor < room.state.sequence.length - 1) {
      const { dueColor, actingClient } = actingClientFor(room, clients);
      actingClient.send("pressButton", { color: dueColor });
      await wait(70);
    }
    const { dueColor, actingClient } = actingClientFor(room, clients);
    actingClient.send("pressButton", { color: dueColor });
    await wait(70);

    // the completing press resolves immediately...
    expect(room.state.turnOutcome).toBe("success");
    // ...but the turn hasn't handed off yet — same team still active.
    expect(room.state.teams[room.state.activeTeamIndex].id).toBe(activeTeamId);

    await wait(PRESS_HEAVY_TURN_MS + 200);

    // only now, once the original 4s(-equivalent) timer elapses, does it move on.
    expect(room.state.turnOutcome).toBe("pending");
    expect(room.state.teams[room.state.activeTeamIndex].id).not.toBe(activeTeamId);
  });

  test("a dropped connection during a match, unreconciled, frees the role/team slot once its grace period expires", async () => {
    const { room, clients } = await fillRolesAndStart({ reconnectGraceSeconds: 0.05 });
    const { activeTeam, actingClient } = actingClientFor(room, clients);
    const droppedSessionId = actingClient.sessionId;

    await actingClient.leave(false); // simulated drop, not a deliberate leave

    // Reconnection grace (see MatchRoom.ts's onLeave) holds the seat open for
    // a bit before freeing it — the match keeps going for the rest of the
    // room, and the dropped player's seat is freed once the grace period
    // above runs out, instead of lingering as a phantom occupant forever.
    await waitUntil(() => !room.state.players.has(droppedSessionId));

    expect(room.state.phase).toBe("playing");
    const teamAfterDrop = room.state.teams.find((t) => t.id === activeTeam.id);
    expect([teamAfterDrop?.pigSessionId, teamAfterDrop?.rabbitSessionId]).not.toContain(droppedSessionId);
  });

  test("a dropped connection during the lobby frees the role slot immediately", async () => {
    const room = await colyseus.createRoom<MatchState>("match");
    const client = await connectAsUser(colyseus, room, "플레이어");
    client.send("chooseRole", { role: "pig" });
    await flush();

    const sessionId = client.sessionId;
    expect(room.state.players.has(sessionId)).toBe(true);
    expect(room.state.teams[0].pigSessionId).toBe(sessionId);

    await client.leave(false); // simulated drop, not a deliberate leave
    await flush();

    // Same "no grace" behavior as mid-match — a dropped lobby connection
    // (refresh, closed tab, network blip) must not leave a phantom occupant
    // holding the role slot, since nothing will ever reconnect to reclaim it.
    expect(room.state.phase).toBe("lobby");
    expect(room.state.players.has(sessionId)).toBe(false);
    expect(room.state.teams[0].pigSessionId).toBe("");
  });

  test("leaving the lobby deliberately after choosing a role frees that role slot immediately", async () => {
    const room = await colyseus.createRoom<MatchState>("match");
    const client = await connectAsUser(colyseus, room, "플레이어");
    client.send("chooseRole", { role: "rabbit" });
    await flush();

    expect(room.state.teams[0].rabbitSessionId).toBe(client.sessionId);

    await client.leave(); // deliberate leave (the new back button), not a drop
    await flush();

    expect(room.state.players.has(client.sessionId)).toBe(false);
    expect(room.state.teams[0].rabbitSessionId).toBe("");
  });

  test(
    "the surviving team keeps receiving turns after the other team is eliminated",
    // completeActiveTurn's per-press spacing was widened past the
    // mint-spam-guard's 50ms threshold, which pushed this multi-round
    // elimination loop past the old 45s budget.
    { timeout: 90000 },
    async () => {
      const { room, clients } = await fillRolesAndStart({ turnDurationMs: PRESS_HEAVY_TURN_MS });
      const teamAId = room.state.teams[0].id;
      const teamBId = room.state.teams[1].id;

      // drive turns: complete team A's turns correctly, deliberately fail team
      // B's turns (wrong button) until B's 5 mortars are gone.
      while (!room.state.teams.find((t) => t.id === teamBId)!.eliminated) {
        const activeId = room.state.teams[room.state.activeTeamIndex].id;
        if (activeId === teamAId) {
          await completeActiveTurn(room, clients, PRESS_HEAVY_TURN_MS);
        } else {
          const { dueColor, actingClient } = actingClientFor(room, clients);
          const wrongColor = ALL_COLORS.find((c) => c !== dueColor)!;
          actingClient.send("pressButton", { color: wrongColor });
          await flush();
          await wait(PRESS_HEAVY_TURN_MS + 200);
        }
      }

      // team B is eliminated but the match keeps going, unlike before.
      expect(room.state.phase).toBe("playing");
      expect(room.state.teams.find((t) => t.id === teamAId)!.eliminated).toBe(false);
      expect(room.state.teams[room.state.activeTeamIndex].id).toBe(teamAId);

      // the surviving team keeps receiving turns indefinitely.
      const roundBeforeExtraTurn = room.state.round;
      await completeActiveTurn(room, clients, PRESS_HEAVY_TURN_MS);

      expect(room.state.phase).toBe("playing");
      expect(room.state.teams[room.state.activeTeamIndex].id).toBe(teamAId);
      expect(room.state.round).toBeGreaterThan(roundBeforeExtraTurn);
    }
  );

  test(
    "eliminated and surviving players each get their max_round recorded",
    // same reason as the elimination test above — wider per-press spacing
    // needs more wall-clock budget.
    { timeout: 90000 },
    async () => {
      const { room, clients } = await fillRolesAndStart({ turnDurationMs: PRESS_HEAVY_TURN_MS });
      // fillRolesAndStart assigns players in join order: 플레이어0/1 to the
      // first team (survivor here), 플레이어2/3 to the second (eliminated).
      const teamAId = room.state.teams[0].id;
      const teamBId = room.state.teams[1].id;

      while (!room.state.teams.find((t) => t.id === teamBId)!.eliminated) {
        const activeId = room.state.teams[room.state.activeTeamIndex].id;
        if (activeId === teamAId) {
          await completeActiveTurn(room, clients, PRESS_HEAVY_TURN_MS);
        } else {
          const { dueColor, actingClient } = actingClientFor(room, clients);
          const wrongColor = ALL_COLORS.find((c) => c !== dueColor)!;
          actingClient.send("pressButton", { color: wrongColor });
          await flush();
          await wait(PRESS_HEAVY_TURN_MS + 200);
        }
      }
      // In a 2-team room every round is exactly one turn per team, so team
      // B's elimination turn is always also the turn that completes the
      // round — advanceToNextTurn's round++ (and its credit to the
      // still-alive team A) fires in that same synchronous timer callback,
      // before this line runs. So room.state.round here is already one
      // ahead of the round team B was actually credited with.
      const roundRightAfterElimination = room.state.round;

      await completeActiveTurn(room, clients, PRESS_HEAVY_TURN_MS);
      const roundAfterSurvivorTurn = room.state.round;
      expect(roundAfterSurvivorTurn).toBeGreaterThan(roundRightAfterElimination);

      const maxRoundOf = (nickname: string) =>
        (db.prepare(`SELECT max_round FROM users WHERE nickname = ?`).get(nickname) as { max_round: number })
          .max_round;

      // Eliminated team: both credited the same round, and strictly less
      // than what the room had already reached for the survivor by the
      // time this test could observe it.
      expect(maxRoundOf("플레이어2")).toBe(maxRoundOf("플레이어3"));
      expect(maxRoundOf("플레이어2")).toBeGreaterThan(0);
      expect(maxRoundOf("플레이어2")).toBeLessThan(roundRightAfterElimination);

      // Surviving team: kept climbing past that, matching the room's
      // current round exactly (credited every time a round completes).
      expect(maxRoundOf("플레이어0")).toBe(roundAfterSurvivorTurn);
      expect(maxRoundOf("플레이어1")).toBe(roundAfterSurvivorTurn);
    },
  );

  test(
    "round only advances once every team that started the round alive has taken a turn, even if one gets eliminated mid-round",
    { timeout: 15000 },
    async () => {
      // PRESS_HEAVY_TURN_MS, not SHORT_TURN_MS — this test presses through
      // two full 18-color sequences via completeActiveTurn(), which needs a
      // turn long enough to fit that many real message round-trips (see
      // this file's own note on PRESS_HEAVY_TURN_MS above). Two such turns
      // plus a single-press turn comfortably exceed vitest's default 5s
      // test timeout.
      const room = await colyseus.createRoom<MatchState>("match", {
        teamCount: 3,
        turnDurationMs: PRESS_HEAVY_TURN_MS,
        countdownTickMs: COUNTDOWN_TICK_MS,
      });
      const clients: ClientRoom<MatchState>[] = [];
      for (const [i, role] of (["pig", "rabbit", "pig", "rabbit", "pig", "rabbit"] as const).entries()) {
        const client = await connectAsUser(colyseus, room, `플레이어${i}`);
        client.send("chooseRole", { role });
        clients.push(client);
      }
      await flush();
      await waitForCountdown();

      expect(room.state.phase).toBe("playing");
      const [team1Id, team2Id, team3Id] = room.state.teams.map((t) => t.id);

      // One hit from elimination — the interesting turn is team2's own turn,
      // set up directly instead of grinding through several real rounds of
      // losses first (the bug being tested is in advanceToNextTurn's round
      // math, not in how a team's mortars reach 1).
      room.state.teams[1].mortars = 1;

      // team1's turn: succeed, hands off to team2. Still round 1.
      await completeActiveTurn(room, clients, PRESS_HEAVY_TURN_MS);
      expect(room.state.teams[room.state.activeTeamIndex].id).toBe(team2Id);
      expect(room.state.round).toBe(1);

      // team2's turn: fail on purpose — its last mortar, so this turn's
      // hand-off eliminates it.
      const { dueColor, actingClient } = actingClientFor(room, clients);
      const wrongColor = ALL_COLORS.find((c) => c !== dueColor)!;
      actingClient.send("pressButton", { color: wrongColor });
      await flush();
      while (room.state.turnOutcome !== "pending") {
        await wait(20);
      }

      // team2 is eliminated, but team3 hasn't had a round-1 turn yet — the
      // round must NOT have advanced, and the next team up must be team3
      // (rotation skipping the just-eliminated team2), not wrap back to team1.
      expect(room.state.teams.find((t) => t.id === team2Id)!.eliminated).toBe(true);
      expect(room.state.round).toBe(1);
      expect(room.state.teams[room.state.activeTeamIndex].id).toBe(team3Id);

      // team3's turn: succeed — only now has every team that started round 1
      // alive (team1, team2, team3) taken its turn, so the round can advance.
      await completeActiveTurn(room, clients, PRESS_HEAVY_TURN_MS);
      expect(room.state.round).toBe(2);
      expect(room.state.teams[room.state.activeTeamIndex].id).toBe(team1Id);
    },
  );

  test("a room in progress with spectators disabled rejects a new connection attempt", async () => {
    const { room } = await fillRolesAndStart({ allowSpectators: false });

    await expect(connectAsUser(colyseus, room, "플레이어")).rejects.toThrow();
  });

  test("a room with spectators disabled still rejects new connections after a player leaves (maxClients lock can be auto-unlocked by Colyseus)", async () => {
    const { room, clients } = await fillRolesAndStart({ allowSpectators: false });

    await clients[0].leave();
    await flush();

    await expect(connectAsUser(colyseus, room, "플레이어")).rejects.toThrow();
  });

  test("a client joining an in-progress match becomes a spectator, not a player", async () => {
    const { room } = await fillRolesAndStart();
    const spectatorClient = await connectAsUser(colyseus, room, "관전자1");
    await flush();

    expect(room.state.spectators.has(spectatorClient.sessionId)).toBe(true);
    expect(room.state.spectators.get(spectatorClient.sessionId)?.nickname).toBe("관전자1");
    expect(room.state.players.has(spectatorClient.sessionId)).toBe(false);
  });

  test("a spectator joining after a player left does not backfill the vacated player slot", async () => {
    const { room, clients } = await fillRolesAndStart();
    const vacatedTeam = room.state.teams.find((t) => t.pigSessionId === clients[0].sessionId)!;

    await clients[0].leave();
    await flush();

    const spectatorClient = await connectAsUser(colyseus, room, "관전자1");
    await flush();

    expect(room.state.spectators.has(spectatorClient.sessionId)).toBe(true);
    expect(vacatedTeam.pigSessionId).toBe("");
  });

  test("a spectator leaving is removed immediately, without reconnection grace", async () => {
    const { room } = await fillRolesAndStart();
    const spectatorClient = await connectAsUser(colyseus, room, "관전자1");
    await flush();

    await spectatorClient.leave(false); // non-consented, same as a dropped connection
    await flush();

    expect(room.state.spectators.has(spectatorClient.sessionId)).toBe(false);
  });

  test("spectators are mirrored into room metadata on join and removed on leave (admin's 현재 접속자 count reads this)", async () => {
    const { room } = await fillRolesAndStart();
    const spectatorClient = await connectAsUser(colyseus, room, "관전자1");
    await flush();

    const metadataAfterJoin = room.listing.metadata as { spectators?: { nickname: string }[] };
    expect(metadataAfterJoin.spectators?.map((s) => s.nickname)).toEqual(["관전자1"]);

    await spectatorClient.leave(false);
    await flush();

    const metadataAfterLeave = room.listing.metadata as { spectators?: { nickname: string }[] };
    expect(metadataAfterLeave.spectators).toEqual([]);
  });

  test("a spectator's chat message is tagged with (관전) and only appears in matchChat", async () => {
    const { room } = await fillRolesAndStart();
    const spectatorClient = await connectAsUser(colyseus, room, "관전자1");
    await flush();
    const lobbyChatCountBefore = room.state.lobbyChat.length;

    spectatorClient.send("sendChat", { text: "안녕하세요" });
    await flush();

    expect(room.state.matchChat[room.state.matchChat.length - 1].nickname).toBe("관전자1 (관전)");
    expect(room.state.matchChat[room.state.matchChat.length - 1].text).toBe("안녕하세요");
    expect(room.state.lobbyChat).toHaveLength(lobbyChatCountBefore);
  });

  test("the lobby still rejects a join once every player slot is taken", async () => {
    const room = await colyseus.createRoom<MatchState>("match", { teamCount: 1 });
    await connectAsUser(colyseus, room, "플레이어1");
    await connectAsUser(colyseus, room, "플레이어2");
    await flush();

    await expect(connectAsUser(colyseus, room, "플레이어3")).rejects.toThrow();
  });

  test("joinOrCreate matchmaking does not route a fresh client into a room an eliminated player just left", async () => {
    const { room, clients } = await fillRolesAndStart();

    await clients[0].leave();
    await flush();

    // colyseus.sdk.joinOrCreate goes through the same onAuth as connectTo/
    // joinById did — it also needs a logged-in session now, but it's a
    // matchmaking call (not joinById into a specific room), so connectAsUser
    // (which targets a known roomId) doesn't fit here. Same underlying
    // technique as connectAsUser: a real test user + session, connected with
    // a custom Cookie header via a raw colyseus.js Client.
    testUserCounter += 1;
    const user = getOrCreateUser(`test-google-sub-${testUserCounter}`, {});
    setNickname(user.id, "플레이어");
    const token = signSession(user.id);
    const port = (colyseus.server as unknown as { port: number }).port;
    const client = new ColyseusJsClient(`ws://127.0.0.1:${port}`, {
      headers: { Cookie: `session=${token}` },
    });
    const newRoom = await client.joinOrCreate<MatchState>("match");
    expect(newRoom.roomId).not.toBe(room.roomId);
  });

  test(
    "the room freezes once every team is eliminated, instead of looping phantom turns",
    async () => {
      const { room } = await fillRolesAndStart({ turnDurationMs: SHORT_TURN_MS });

      // let every turn time out for both teams until both are eliminated.
      while (room.state.teams.some((t) => !t.eliminated)) {
        await wait(SHORT_TURN_MS + 200);
      }

      // turnEndsAt is only ever reassigned by startTurn(); if a phantom turn
      // kept starting for the wiped-out room, this timestamp would keep
      // advancing. cursor/turnOutcome are NOT used here — they reset to the
      // same "0"/"pending"-then-"fail" values every single turn regardless
      // of the bug, so they can't distinguish frozen from still-looping.
      const frozenTurnEndsAt = room.state.turnEndsAt;

      // no further turn should start — state stays frozen, not looping.
      await wait(SHORT_TURN_MS + 200);

      expect(room.state.phase).toBe("playing");
      expect(room.state.turnEndsAt).toBe(frozenTurnEndsAt);
    },
    15000,
  );

  test("a rematch sent right after the deciding press doesn't let the just-ended match's still-pending turn timer drain mortars in the new lobby", async () => {
    const room = await colyseus.createRoom<MatchState>("match", {
      teamCount: 1,
      turnDurationMs: SHORT_TURN_MS,
      countdownTickMs: COUNTDOWN_TICK_MS,
    });
    const clients: ClientRoom<MatchState>[] = [];
    for (const [i, role] of (["pig", "rabbit"] as const).entries()) {
      const client = await connectAsUser(colyseus, room, `플레이어${i}`);
      client.send("chooseRole", { role });
      clients.push(client);
    }
    await flush();
    await waitForCountdown();

    // lose 4 mortars normally, waiting for each turn's deferred hand-off to
    // actually land (turnOutcome flips back to "pending") before pressing
    // again — a fixed sleep here is flaky: if a press happens to land late
    // in its turn's life, the same sleep can also span the *next* turn's
    // own untouched natural timeout, silently costing a 2nd, legitimate
    // mortar loss and desyncing this loop from reality.
    for (let i = 0; i < 4; i++) {
      const { dueColor, actingClient } = actingClientFor(room, clients);
      const wrongColor = ALL_COLORS.find((c) => c !== dueColor)!;
      actingClient.send("pressButton", { color: wrongColor });
      await flush();
      while (room.state.turnOutcome !== "pending") {
        await wait(20);
      }
    }
    expect(room.state.teams[0].mortars).toBe(1);
    expect(room.state.teams[0].eliminated).toBe(false);

    // the deciding (5th) wrong press eliminates the team immediately, but —
    // same as every other turn — the hand-off itself is deferred to the
    // turn's already-scheduled timer (~SHORT_TURN_MS away). Send "rematch"
    // right away instead of waiting it out, simulating a player clicking
    // "나가기" the instant the match-over screen appears.
    const { dueColor, actingClient } = actingClientFor(room, clients);
    const wrongColor = ALL_COLORS.find((c) => c !== dueColor)!;
    actingClient.send("pressButton", { color: wrongColor });
    await flush();
    expect(room.state.teams[0].eliminated).toBe(true);

    actingClient.send("rematch");
    await flush();

    expect(room.state.phase).toBe("lobby");
    expect(room.state.teams[0].mortars).toBe(5);
    expect(room.state.teams[0].eliminated).toBe(false);

    // the old match's deferred timer is still out there — give it enough
    // time to fire if it wasn't properly invalidated by the rematch reset.
    await wait(SHORT_TURN_MS + 200);

    expect(room.state.teams[0].mortars).toBe(5);
    expect(room.state.phase).toBe("lobby");
  });

  test(
    "phase is mirrored into room metadata when the match starts and resets to lobby on rematch",
    async () => {
      const room = await colyseus.createRoom<MatchState>("match", {
        teamCount: 1,
        turnDurationMs: SHORT_TURN_MS,
        countdownTickMs: COUNTDOWN_TICK_MS,
      });
      const clients: ClientRoom<MatchState>[] = [];
      for (const [i, role] of (["pig", "rabbit"] as const).entries()) {
        const client = await connectAsUser(colyseus, room, `플레이어${i}`);
        client.send("chooseRole", { role });
        clients.push(client);
      }
      await flush();
      await waitForCountdown();

      expect((room.metadata as { phase?: string })?.phase).toBe("playing");

      // fail every turn until the single team is eliminated (isMatchOver).
      while (room.state.teams.some((t) => !t.eliminated)) {
        await wait(SHORT_TURN_MS + 200);
      }

      clients[0].send("rematch");
      await flush();

      expect(room.state.phase).toBe("lobby");
      expect((room.metadata as { phase?: string })?.phase).toBe("lobby");
    },
    15000,
  );

  describe("nickname color propagation", () => {
    test("a player with a nickname color has it reflected in PlayerState", async () => {
      const room = await colyseus.createRoom<MatchState>("match");
      const client = await connectAsUser(colyseus, room, "색깔돼지", "#ff6b6b");
      await flush();

      expect(room.state.players.get(client.sessionId)?.nicknameColor).toBe("#ff6b6b");
    });

    test("a player with no nickname color has an empty string, not null/undefined", async () => {
      const room = await colyseus.createRoom<MatchState>("match");
      const client = await connectAsUser(colyseus, room, "무색플레이어");
      await flush();

      expect(room.state.players.get(client.sessionId)?.nicknameColor).toBe("");
    });

    test("a chat message from a colored player carries the same color", async () => {
      const room = await colyseus.createRoom<MatchState>("match");
      const client = await connectAsUser(colyseus, room, "채팅색깔", "#00ff00");
      client.send("sendChat", { text: "안녕" });
      await flush();

      const message = room.state.lobbyChat.find((m) => m.text === "안녕");
      expect(message?.nicknameColor).toBe("#00ff00");
    });

    test("a spectator with a nickname color has it reflected in SpectatorState, and in their chat messages", async () => {
      const { room } = await fillRolesAndStart();
      const spectatorClient = await connectAsUser(colyseus, room, "관전색깔", "#0000ff");
      await flush();

      expect(room.state.spectators.get(spectatorClient.sessionId)?.nicknameColor).toBe("#0000ff");

      spectatorClient.send("sendChat", { text: "구경중" });
      await flush();

      const message = room.state.matchChat.find((m) => m.text === "구경중");
      expect(message?.nicknameColor).toBe("#0000ff");
    });

    test("join/leave system messages never carry a nickname color, even for a colored player", async () => {
      const room = await colyseus.createRoom<MatchState>("match");
      const client = await connectAsUser(colyseus, room, "시스템색깔", "#abcdef");
      await flush();

      const joinMessage = room.state.lobbyChat.find((m) => m.text === "시스템색깔님이 입장했습니다");
      expect(joinMessage?.nicknameColor).toBe("");

      await client.leave();
      await flush();

      const leaveMessage = room.state.lobbyChat.find((m) => m.text === "시스템색깔님이 퇴장했습니다");
      expect(leaveMessage?.nicknameColor).toBe("");
    });
  });

  describe("admin event log integration", () => {
    test("onJoin records a join event and updates the room's player roster metadata", async () => {
      resetEventLog();
      const room = await colyseus.createRoom<MatchState>("match", { teamCount: 1 });
      const client = await connectAsUser(colyseus, room, "철수");
      await flush();

      const events = getEvents();
      const joinEvent = events.find((e) => e.sessionId === client.sessionId && e.type === "join");
      expect(joinEvent?.nickname).toBe("철수");
      expect(joinEvent?.roomId).toBe(room.roomId);
      expect(joinEvent?.roomTitle).toBe("이름 없는 방");

      const metadata = room.listing.metadata as { players?: { nickname: string }[] };
      expect(metadata.players?.map((p) => p.nickname)).toEqual(["철수"]);
    });

    test("recorded events show the room's actual title, not just its internal room id", async () => {
      resetEventLog();
      const room = await colyseus.createRoom<MatchState>("match", { teamCount: 1, roomTitle: "우리팀 놀이방" });
      const client = await connectAsUser(colyseus, room, "철수");
      await flush();

      const joinEvent = getEvents().find((e) => e.sessionId === client.sessionId && e.type === "join");
      expect(joinEvent?.roomTitle).toBe("우리팀 놀이방");
      expect(joinEvent?.roomId).toBe(room.roomId);
    });

    test("onLeave records a leave event and removes the player from roster metadata", async () => {
      resetEventLog();
      const room = await colyseus.createRoom<MatchState>("match", { teamCount: 1 });
      const client = await connectAsUser(colyseus, room, "영희");
      await flush();

      await client.leave();
      await flush();

      const events = getEvents();
      const leaveEvent = events.find((e) => e.sessionId === client.sessionId && e.type === "leave");
      expect(leaveEvent?.nickname).toBe("영희");
      expect(leaveEvent?.roomTitle).toBe("이름 없는 방");

      const metadata = room.listing.metadata as { players?: { nickname: string }[] };
      expect(metadata.players ?? []).toEqual([]);
    });

    test("a join attempt rejected after onAuth (room full) does not record a spurious leave event", async () => {
      resetEventLog();
      const room = await colyseus.createRoom<MatchState>("match", { teamCount: 1 });
      await connectAsUser(colyseus, room, "플레이어1");
      await connectAsUser(colyseus, room, "플레이어2");
      await flush();

      // onAuth passes (real logged-in user) but onJoin itself then throws
      // "방이 가득 찼습니다" before this session is ever added to
      // state.players — Colyseus still calls onLeave as cleanup for that
      // failed join, which used to log a "leave" event with nickname "?".
      await expect(connectAsUser(colyseus, room, "플레이어3")).rejects.toThrow();
      await flush();

      expect(getEvents().filter((e) => e.type === "leave")).toHaveLength(0);
    });
  });

  describe("user ban", () => {
    test("onAuth rejects a banned user's join attempt", async () => {
      const room = await colyseus.createRoom<MatchState>("match", { teamCount: 1 });
      testUserCounter += 1;
      const user = getOrCreateUser(`test-google-sub-${testUserCounter}`, {});
      setNickname(user.id, "밴유저");
      setUserBanned(user.id, true);
      const token = signSession(user.id);
      const port = (colyseus.server as unknown as { port: number }).port;
      const client = new ColyseusJsClient(`ws://127.0.0.1:${port}`, {
        headers: { Cookie: `session=${token}` },
      });

      await expect(client.joinById<MatchState>(room.roomId)).rejects.toThrow("이용이 제한된 계정입니다");
    });

    test("kickUserId force-disconnects the given user's client from the room", async () => {
      const room = await colyseus.createRoom<MatchState>("match", { teamCount: 1 });
      testUserCounter += 1;
      const user = getOrCreateUser(`test-google-sub-${testUserCounter}`, {});
      setNickname(user.id, "강퇴대상");
      const token = signSession(user.id);
      const port = (colyseus.server as unknown as { port: number }).port;
      const client = new ColyseusJsClient(`ws://127.0.0.1:${port}`, {
        headers: { Cookie: `session=${token}` },
      });
      const joinedRoom = await client.joinById<MatchState>(room.roomId);
      await flush();
      expect(room.state.players.has(joinedRoom.sessionId)).toBe(true);

      const kicked = (room as unknown as MatchRoom).kickUserId(user.id);
      await flush();

      expect(kicked).toBe(true);
      expect(room.state.players.has(joinedRoom.sessionId)).toBe(false);
    });

    test("kickUserId returns false when the user isn't connected to this room", async () => {
      const room = await colyseus.createRoom<MatchState>("match", { teamCount: 1 });
      expect((room as unknown as MatchRoom).kickUserId(999999)).toBe(false);
    });

    test(
      "kickUserId during an active match drops the connection immediately, but roster cleanup follows the same reconnect-grace path as any other mid-match disconnect (not instant, unlike a lobby kick)",
      { timeout: 20000 },
      async () => {
        const { room, clients } = await fillRolesAndStart({ reconnectGraceSeconds: 0.05 });
        const [firstClient] = clients;
        const sessionId = firstClient.sessionId;
        const player = room.state.players.get(sessionId)!;
        const userId = (
          db.prepare(`SELECT id FROM users WHERE nickname = ?`).get(player.nickname) as { id: number }
        ).id;

        const kicked = (room as unknown as MatchRoom).kickUserId(userId);
        expect(kicked).toBe(true);

        // Unlike a lobby kick, the roster entry isn't cleared the instant
        // client.leave() is called — it routes through the same
        // phase === "playing" && !consented reconnect-grace branch as any
        // other mid-match disconnect (see kickUserId's own comment).
        await flush();
        expect(room.state.players.has(sessionId)).toBe(true);

        // Once the (shortened, for this test) grace period expires without
        // a reconnect, cleanup happens exactly like any other abandoned seat.
        await waitUntil(() => !room.state.players.has(sessionId));
      },
    );

    test(
      "a user banned during their reconnection grace window is rejected on reconnect, not let back into the seat",
      { timeout: 20000 },
      async () => {
        const { room, clients } = await fillRolesAndStart({ reconnectGraceSeconds: 5 });
        const [firstClient] = clients;
        const sessionId = firstClient.sessionId;
        const reconnectToken = firstClient.reconnectionToken;
        const player = room.state.players.get(sessionId)!;
        const team = room.state.teams.find((t) => t.id === player.teamId)!;

        // Same non-consented drop as the existing reconnection tests — the
        // grace period is open, the seat is still held.
        await firstClient.leave(false);
        await flush();
        expect(room.state.players.has(sessionId)).toBe(true);

        // Ban the account WHILE the grace period is still open — this is
        // exactly the path onAuth's ban check can't cover, since
        // allowReconnection never re-runs onAuth (see onLeave's own
        // comment).
        const bannedUserId = (
          db.prepare(`SELECT id FROM users WHERE nickname = ?`).get(player.nickname) as { id: number }
        ).id;
        setUserBanned(bannedUserId, true);

        // Whether the reconnect handshake itself resolves and is then
        // immediately kicked, or rejects outright, depends on exact
        // microtask ordering inside Colyseus's allowReconnection resolution
        // — either is an acceptable outcome here, so don't assert on it.
        // What actually matters is the room-side state afterward.
        const port = (colyseus.server as unknown as { port: number }).port;
        try {
          await new ColyseusJsClient(`ws://127.0.0.1:${port}`).reconnect<MatchState>(reconnectToken);
        } catch {
          // rejection is an acceptable way to observe the ban being enforced.
        }

        await waitUntil(() => !room.state.players.has(sessionId));

        expect(room.state.players.has(sessionId)).toBe(false);
        expect(team.pigSessionId).not.toBe(sessionId);
        expect(team.rabbitSessionId).not.toBe(sessionId);
      },
    );
  });

  describe("press monitoring", () => {
    test("a press by a monitored user is reported with its color and blocked status", async () => {
      resetPressMonitor();
      const { room, clients } = await fillRolesAndStart();
      const { dueColor, actingClient } = actingClientFor(room, clients);
      const player = room.state.players.get(actingClient.sessionId)!;
      const userId = (
        db.prepare(`SELECT id FROM users WHERE nickname = ?`).get(player.nickname) as { id: number }
      ).id;
      const monitor = makeMockSseClient();
      subscribeToPressMonitor(userId, monitor.req, monitor.res);

      actingClient.send("pressButton", { color: dueColor });
      await flush();

      expect(monitor.written).toHaveLength(1);
      const event = JSON.parse(monitor.written[0].replace(/^data: /, "").trim());
      expect(event.color).toBe(dueColor);
      expect(event.blocked).toBe(false);
      // First press of the turn has nothing to compare against.
      expect(event.sinceLastPressMs).toBeNull();
    });

    test("a press by a user nobody is monitoring is not reported to any other subscriber", async () => {
      resetPressMonitor();
      const { room, clients } = await fillRolesAndStart();
      const { dueColor, actingClient } = actingClientFor(room, clients);

      // Subscribe to some unrelated userId, not the one actually pressing.
      const monitor = makeMockSseClient();
      subscribeToPressMonitor(999999, monitor.req, monitor.res);

      actingClient.send("pressButton", { color: dueColor });
      await flush();

      expect(monitor.written).toHaveLength(0);
    });

    test("a blocked (too-fast) press is still reported to the monitor, with blocked: true", async () => {
      resetPressMonitor();
      const { room, clients } = await fillRolesAndStart();
      const { dueColor, actingClient } = actingClientFor(room, clients);
      const player = room.state.players.get(actingClient.sessionId)!;
      const userId = (
        db.prepare(`SELECT id FROM users WHERE nickname = ?`).get(player.nickname) as { id: number }
      ).id;
      const monitor = makeMockSseClient();
      subscribeToPressMonitor(userId, monitor.req, monitor.res);

      // First press: the real due color — guaranteed to pass the guard,
      // since the first press of a turn has no previous press to compare
      // against. Advances the cursor without deciding the turn.
      actingClient.send("pressButton", { color: dueColor });
      // Second press: sent immediately after, so its interval since the
      // first is well under either guard threshold (5ms pig / 35ms mint).
      // Pig colors are all guarded, so any pig color works; for rabbit only
      // mint is, so use "mint" specifically so this reliably trips the
      // guard regardless of what dueColor actually was.
      const secondColor = player.role === "pig" ? PIG_COLORS[0] : "mint";
      actingClient.send("pressButton", { color: secondColor });
      await flush();

      const events = monitor.written.map((chunk) => JSON.parse(chunk.replace(/^data: /, "").trim()));
      expect(events).toHaveLength(2);
      expect(events[0].blocked).toBe(false);
      expect(events[1].blocked).toBe(true);
      expect(events[1].color).toBe(secondColor);
    });
  });
});
