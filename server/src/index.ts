import express from "express";
import { createServer } from "http";
import { Server } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { MatchRoom } from "./rooms/MatchRoom";

const app = express();
const port = Number(process.env.PORT) || 2567;

const httpServer = createServer(app);
const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

gameServer.define("match", MatchRoom);

httpServer.listen(port, () => {
  console.log(`songpyeon server listening on ws://localhost:${port}`);
});
