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
    // dev 환경에서는 client(5173)와 server(2567)가 다른 origin이라 CORS 헤더가
    // 없으면 브라우저가 응답을 읽지 못함 (client/.env.local로 LAN IP를 쓸 때도
    // 마찬가지). 프로덕션은 Caddy 뒤에서 같은 origin으로 서빙되니 영향 없음 —
    // 이 엔드포인트는 인증 없는 공개 방 목록이라 와일드카드로 열어도 안전함.
    res.header("Access-Control-Allow-Origin", "*");
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
