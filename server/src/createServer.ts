import express from "express";
import { createServer as createHttpServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import { Server, matchMaker } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { MatchRoom } from "./rooms/MatchRoom";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDistPath = path.join(__dirname, "../public");

export function createGameServer(): Server {
  const app = express();
  app.use(express.static(clientDistPath));

  // colyseus.js 0.16.x has no client.getAvailableRooms() — this app-level
  // route replaces it, backed by the server-only matchMaker.query() API.
  app.get("/api/rooms", async (_req, res) => {
    const rooms = await matchMaker.query({ name: "match" });
    res.json(
      rooms.map((r) => ({
        roomId: r.roomId,
        clients: r.clients,
        maxClients: r.maxClients,
        locked: r.locked,
        hostNickname: (r.metadata as { hostNickname?: string } | undefined)?.hostNickname ?? "?",
      })),
    );
  });

  const httpServer = createHttpServer(app);
  const gameServer = new Server({
    transport: new WebSocketTransport({ server: httpServer }),
  });
  gameServer.define("match", MatchRoom);

  app.get(/.*/, (_req, res) => {
    res.sendFile(path.join(clientDistPath, "index.html"));
  });

  return gameServer;
}
