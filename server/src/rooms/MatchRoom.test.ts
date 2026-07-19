import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { boot, ColyseusTestServer } from "@colyseus/testing";
import type { Room as ClientRoom } from "colyseus.js";
import { Client as ColyseusJsClient } from "colyseus.js";
import type { Room as ServerRoom } from "colyseus";
import { createGameServer } from "../createServer";
import { PIG_COLORS, RABBIT_COLORS, colorRole, type Color } from "../game/colors";
import type { MatchState } from "./MatchState";
import { _resetForTest as resetEventLog, getEvents } from "../admin/eventLog";
import { getOrCreateUser, setNickname } from "../auth/googleAuth";
import { signSession } from "../auth/session";

const ALL_COLORS: Color[] = [...PIG_COLORS, ...RABBIT_COLORS];
const SHORT_TURN_MS = 500;
// A completed turn now waits out the full turn timer before handing off
// (see MatchRoom.ts's handlePressButton), so any test that presses through
// a full ~18-color sequence via completeActiveTurn() needs a turn long
// enough to fit that many real message round-trips before its own timer
// would fire — SHORT_TURN_MS is tuned for single-press tests and is too
// tight for that.
const PRESS_HEAVY_TURN_MS = 3000;

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

let testUserCounter = 0;

// MatchRoom.onAuth가 로그인 세션을 요구하므로, 게임 로직만 검증하려는 기존 테스트들도 이제
// "로그인된 유저로 접속"을 거쳐야 한다. 테스트용 유저를 DB에 만들고 실제 세션 쿠키를 발급받아,
// colyseus.js Client를 커스텀 Cookie 헤더로 직접 연결한다 (@colyseus/testing의 connectTo는
// 헤더를 커스터마이즈할 수 없어서 이 방식이 필요 — colyseus.js가 Node 환경에서 WebSocket
// 업그레이드 요청에 커스텀 헤더를 지원하는 것을 확인하고 쓰는 것).
async function connectAsUser(colyseus: ColyseusTestServer, room: ServerRoom<MatchState>, nickname: string) {
  testUserCounter += 1;
  const user = getOrCreateUser(`test-google-sub-${testUserCounter}`, {});
  setNickname(user.id, nickname);
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
  });

  async function fillRolesAndStart(options: Record<string, unknown> = {}) {
    const room = await colyseus.createRoom<MatchState>("match", options);
    const clients: ClientRoom<MatchState>[] = [];
    for (const role of ["pig", "rabbit", "pig", "rabbit"] as const) {
      const client = await connectAsUser(colyseus, room, "플레이어");
      client.send("chooseRole", { role });
      clients.push(client);
    }
    await flush();
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
    while (room.state.cursor < room.state.sequence.length - 1) {
      const { dueColor, actingClient } = actingClientFor(room, clients);
      actingClient.send("pressButton", { color: dueColor });
      await flush();
    }
    const { dueColor, actingClient } = actingClientFor(room, clients);
    actingClient.send("pressButton", { color: dueColor });
    await flush();
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

  test("a mid-match leave does not announce into lobbyChat (scoped to the lobby only)", async () => {
    const { room, clients } = await fillRolesAndStart();
    const lobbyChatCountBeforeLeave = room.state.lobbyChat.length;

    await clients[0].leave();
    await flush();

    expect(room.state.phase).toBe("playing");
    expect(room.state.lobbyChat).toHaveLength(lobbyChatCountBeforeLeave);
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

  test("onCreate builds the requested number of teams and sizes maxClients to match", async () => {
    const oneTeam = await colyseus.createRoom<MatchState>("match", { teamCount: 1 });
    expect(oneTeam.state.teams).toHaveLength(1);
    expect(oneTeam.maxClients).toBe(2);

    const threeTeams = await colyseus.createRoom<MatchState>("match", { teamCount: 3 });
    expect(threeTeams.state.teams.map((t) => t.id)).toEqual(["team-1", "team-2", "team-3"]);
    expect(threeTeams.maxClients).toBe(6);
  });

  test("onCreate defaults to 2 teams for a missing or out-of-range teamCount", async () => {
    const missing = await colyseus.createRoom<MatchState>("match");
    expect(missing.state.teams).toHaveLength(2);
    expect(missing.maxClients).toBe(4);

    const outOfRange = await colyseus.createRoom<MatchState>("match", { teamCount: 7 });
    expect(outOfRange.state.teams).toHaveLength(2);
    expect(outOfRange.maxClients).toBe(4);
  });

  test("a 3-team room starts once all 3 teams have a pig and a rabbit", async () => {
    const room = await colyseus.createRoom<MatchState>("match", { teamCount: 3 });
    for (const role of ["pig", "rabbit", "pig", "rabbit", "pig", "rabbit"] as const) {
      const client = await connectAsUser(colyseus, room, "플레이어");
      client.send("chooseRole", { role });
    }
    await flush();

    expect(room.state.phase).toBe("playing");
    room.state.teams.forEach((team) => {
      expect(team.pigSessionId).not.toBe("");
      expect(team.rabbitSessionId).not.toBe("");
    });
  });

  test("a 1-team room starts once its single team has a pig and a rabbit, and keeps rotating to itself", async () => {
    const room = await colyseus.createRoom<MatchState>("match", { teamCount: 1, turnDurationMs: PRESS_HEAVY_TURN_MS });
    const clients: ClientRoom<MatchState>[] = [];
    for (const role of ["pig", "rabbit"] as const) {
      const client = await connectAsUser(colyseus, room, "플레이어");
      client.send("chooseRole", { role });
      clients.push(client);
    }
    await flush();

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

  test("completing the sequence keeps the success state on screen until the original timer, then hands off", async () => {
    const { room, clients } = await fillRolesAndStart({ turnDurationMs: PRESS_HEAVY_TURN_MS });

    const activeTeamId = room.state.teams[room.state.activeTeamIndex].id;
    while (room.state.cursor < room.state.sequence.length - 1) {
      const { dueColor, actingClient } = actingClientFor(room, clients);
      actingClient.send("pressButton", { color: dueColor });
      await flush();
    }
    const { dueColor, actingClient } = actingClientFor(room, clients);
    actingClient.send("pressButton", { color: dueColor });
    await flush();

    // the completing press resolves immediately...
    expect(room.state.turnOutcome).toBe("success");
    // ...but the turn hasn't handed off yet — same team still active.
    expect(room.state.teams[room.state.activeTeamIndex].id).toBe(activeTeamId);

    await wait(PRESS_HEAVY_TURN_MS + 200);

    // only now, once the original 4s(-equivalent) timer elapses, does it move on.
    expect(room.state.turnOutcome).toBe("pending");
    expect(room.state.teams[room.state.activeTeamIndex].id).not.toBe(activeTeamId);
  });

  test("a dropped connection during a match frees the player's role/team slot immediately", async () => {
    const { room, clients } = await fillRolesAndStart();
    const { activeTeam, actingClient } = actingClientFor(room, clients);
    const droppedSessionId = actingClient.sessionId;

    await actingClient.leave(false); // simulated drop, not a deliberate leave
    await flush();

    // No reconnection grace (client never persists a token to resume with —
    // see client/src/colyseus.ts) — the match keeps going for the rest of
    // the room, but the dropped player's seat is freed right away instead of
    // lingering as a phantom occupant.
    expect(room.state.phase).toBe("playing");
    expect(room.state.players.has(droppedSessionId)).toBe(false);
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
    { timeout: 45000 },
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
      });
      const clients: ClientRoom<MatchState>[] = [];
      for (const role of ["pig", "rabbit", "pig", "rabbit", "pig", "rabbit"] as const) {
        const client = await connectAsUser(colyseus, room, "플레이어");
        client.send("chooseRole", { role });
        clients.push(client);
      }
      await flush();

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

  test("a room in progress rejects a new connection attempt", async () => {
    const { room } = await fillRolesAndStart();

    await expect(connectAsUser(colyseus, room, "플레이어")).rejects.toThrow();
  });

  test("a room still rejects new connections after a player leaves (maxClients lock can be auto-unlocked by Colyseus)", async () => {
    const { room, clients } = await fillRolesAndStart();

    await clients[0].leave();
    await flush();

    await expect(connectAsUser(colyseus, room, "플레이어")).rejects.toThrow();
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
    const room = await colyseus.createRoom<MatchState>("match", { teamCount: 1, turnDurationMs: SHORT_TURN_MS });
    const clients: ClientRoom<MatchState>[] = [];
    for (const role of ["pig", "rabbit"] as const) {
      const client = await connectAsUser(colyseus, room, "플레이어");
      client.send("chooseRole", { role });
      clients.push(client);
    }
    await flush();

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

      const metadata = room.listing.metadata as { players?: { nickname: string }[] };
      expect(metadata.players?.map((p) => p.nickname)).toEqual(["철수"]);
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

      const metadata = room.listing.metadata as { players?: { nickname: string }[] };
      expect(metadata.players ?? []).toEqual([]);
    });
  });
});
