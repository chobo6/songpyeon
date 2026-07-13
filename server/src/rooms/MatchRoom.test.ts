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
});
