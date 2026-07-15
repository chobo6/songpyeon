import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { boot, ColyseusTestServer } from "@colyseus/testing";
import type { Room as ClientRoom } from "colyseus.js";
import type { Room as ServerRoom } from "colyseus";
import { createGameServer } from "../createServer";
import { PIG_COLORS, RABBIT_COLORS, colorRole, type Color } from "../game/colors";
import type { MatchState } from "./MatchState";

const ALL_COLORS: Color[] = [...PIG_COLORS, ...RABBIT_COLORS];
const SHORT_TURN_MS = 500;

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
      const client = await colyseus.connectTo(room);
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

  async function completeActiveTurn(room: ServerRoom<MatchState>, clients: ClientRoom<MatchState>[]) {
    while (room.state.cursor < room.state.sequence.length - 1) {
      const { dueColor, actingClient } = actingClientFor(room, clients);
      actingClient.send("pressButton", { color: dueColor });
      await flush();
    }
    const { dueColor, actingClient } = actingClientFor(room, clients);
    actingClient.send("pressButton", { color: dueColor });
    await flush();
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
    const client = await colyseus.connectTo(room);

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
    const client = await colyseus.connectTo(room);

    client.send("chooseRole", { role: "pig" });
    await flush();
    client.send("chooseRole", { role: "pig" });
    await flush();

    expect(room.state.teams[0].pigSessionId).toBe(client.sessionId);
    expect(room.state.teams[1].pigSessionId).toBe("");
  });

  test("onJoin stores a sanitized nickname from join options", async () => {
    const room = await colyseus.createRoom<MatchState>("match");
    const clean = await colyseus.connectTo(room, { nickname: "  둘리  " });
    const dirty = await colyseus.connectTo(room, { nickname: 12345 });

    expect(room.state.players.get(clean.sessionId)?.nickname).toBe("둘리");
    expect(room.state.players.get(dirty.sessionId)?.nickname).toBe("플레이어");
  });

  test("onCreate stores a sanitized host nickname in room metadata, for the room list", async () => {
    const room = await colyseus.createRoom<MatchState>("match", { nickname: "  방장  " });

    expect(room.metadata?.hostNickname).toBe("방장");
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

  test("a correct-completing button hands off to the next team right away", async () => {
    const { room, clients } = await fillRolesAndStart({ turnDurationMs: SHORT_TURN_MS });

    const activeTeamId = room.state.teams[room.state.activeTeamIndex].id;
    while (room.state.cursor < room.state.sequence.length - 1) {
      const { dueColor, actingClient } = actingClientFor(room, clients);
      actingClient.send("pressButton", { color: dueColor });
      await flush();
    }
    const { dueColor, actingClient } = actingClientFor(room, clients);
    actingClient.send("pressButton", { color: dueColor });
    await flush();

    expect(room.state.turnOutcome).toBe("pending");
    expect(room.state.teams[room.state.activeTeamIndex].id).not.toBe(activeTeamId);
  });

  test("a dropped connection keeps the match running, and reconnecting restores the player's seat", async () => {
    const { room, clients } = await fillRolesAndStart();
    const { activeTeam, dueColor, actingClient } = actingClientFor(room, clients);
    const droppedSessionId = actingClient.sessionId;
    const reconnectionToken = actingClient.reconnectionToken;

    await actingClient.leave(false); // simulated drop, not a deliberate leave
    await flush();

    // the match keeps going — the player's seat/role/team survive the drop.
    expect(room.state.phase).toBe("playing");
    const survivingPlayer = room.state.players.get(droppedSessionId);
    expect(survivingPlayer?.role).not.toBe("");
    expect(survivingPlayer?.teamId).toBe(activeTeam.id);

    const reconnectedClient = await colyseus.sdk.reconnect<MatchState>(reconnectionToken);
    expect(reconnectedClient.sessionId).toBe(droppedSessionId);

    reconnectedClient.send("pressButton", { color: dueColor });
    await flush();

    expect(room.state.cursor).toBe(1);
  });

  test("a dropped connection during the lobby keeps the role slot, and reconnecting restores it", async () => {
    const room = await colyseus.createRoom<MatchState>("match");
    const client = await colyseus.connectTo(room);
    const reconnectionToken = client.reconnectionToken;
    client.send("chooseRole", { role: "pig" });
    await flush();

    const sessionId = client.sessionId;
    expect(room.state.players.has(sessionId)).toBe(true);
    expect(room.state.teams[0].pigSessionId).toBe(sessionId);

    await client.leave(false); // simulated drop, not a deliberate leave
    await flush();

    // mobile networks drop briefly (wifi/LTE handoff, screen off) — the lobby
    // now grants the same reconnection grace as mid-match, so the role slot
    // must survive the drop instead of vanishing from other players' rosters.
    expect(room.state.phase).toBe("lobby");
    expect(room.state.players.has(sessionId)).toBe(true);
    expect(room.state.teams[0].pigSessionId).toBe(sessionId);

    const reconnectedClient = await colyseus.sdk.reconnect<MatchState>(reconnectionToken);
    expect(reconnectedClient.sessionId).toBe(sessionId);
    expect(room.state.teams[0].pigSessionId).toBe(sessionId);
  });

  test("starting the game locks maxClients at 4 even if a role-holder is mid-grace (not actually connected) at that moment", async () => {
    const room = await colyseus.createRoom<MatchState>("match");
    const pig1 = await colyseus.connectTo(room);
    pig1.send("chooseRole", { role: "pig" });
    await flush();
    const rabbit1 = await colyseus.connectTo(room);
    rabbit1.send("chooseRole", { role: "rabbit" });
    await flush();
    const pig2 = await colyseus.connectTo(room);
    pig2.send("chooseRole", { role: "pig" });
    await flush();

    // pig1's role slot survives the drop (lobby reconnection grace), but
    // pig1 is no longer in room.clients — only 3 real connections remain
    // when the 4th role gets filled below.
    await pig1.leave(false);
    await flush();

    const rabbit2 = await colyseus.connectTo(room);
    rabbit2.send("chooseRole", { role: "rabbit" });
    await flush();

    expect(room.state.phase).toBe("playing");
    // Bug regression: maxClients must stay the fixed team size (4), not
    // whatever room.clients.length happened to be at start time — that
    // count is now unreliable once lobby grace can leave a filled role slot
    // held by a currently-disconnected sessionId.
    expect(room.maxClients).toBe(4);
  });

  test("leaving the lobby deliberately after choosing a role frees that role slot immediately", async () => {
    const room = await colyseus.createRoom<MatchState>("match");
    const client = await colyseus.connectTo(room);
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
    { timeout: 20000 },
    async () => {
      const { room, clients } = await fillRolesAndStart({ turnDurationMs: SHORT_TURN_MS });
      const teamAId = room.state.teams[0].id;
      const teamBId = room.state.teams[1].id;

      // drive turns: complete team A's turns correctly, deliberately fail team
      // B's turns (wrong button) until B's 5 mortars are gone.
      while (!room.state.teams.find((t) => t.id === teamBId)!.eliminated) {
        const activeId = room.state.teams[room.state.activeTeamIndex].id;
        if (activeId === teamAId) {
          await completeActiveTurn(room, clients);
        } else {
          const { dueColor, actingClient } = actingClientFor(room, clients);
          const wrongColor = ALL_COLORS.find((c) => c !== dueColor)!;
          actingClient.send("pressButton", { color: wrongColor });
          await flush();
          await wait(SHORT_TURN_MS + 200);
        }
      }

      // team B is eliminated but the match keeps going, unlike before.
      expect(room.state.phase).toBe("playing");
      expect(room.state.teams.find((t) => t.id === teamAId)!.eliminated).toBe(false);
      expect(room.state.teams[room.state.activeTeamIndex].id).toBe(teamAId);

      // the surviving team keeps receiving turns indefinitely.
      const roundBeforeExtraTurn = room.state.round;
      await completeActiveTurn(room, clients);

      expect(room.state.phase).toBe("playing");
      expect(room.state.teams[room.state.activeTeamIndex].id).toBe(teamAId);
      expect(room.state.round).toBeGreaterThan(roundBeforeExtraTurn);
    }
  );

  test("a room in progress rejects a new connection attempt", async () => {
    const { room } = await fillRolesAndStart();

    await expect(colyseus.connectTo(room)).rejects.toThrow();
  });

  test("a room still rejects new connections after a player leaves (maxClients lock can be auto-unlocked by Colyseus)", async () => {
    const { room, clients } = await fillRolesAndStart();

    await clients[0].leave();
    await flush();

    await expect(colyseus.connectTo(room)).rejects.toThrow();
  });

  test("joinOrCreate matchmaking does not route a fresh client into a room an eliminated player just left", async () => {
    const { room, clients } = await fillRolesAndStart();

    await clients[0].leave();
    await flush();

    const newRoom = await colyseus.sdk.joinOrCreate("match");
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
});
