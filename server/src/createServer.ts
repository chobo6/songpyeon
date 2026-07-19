import express from "express";
import { createServer as createHttpServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import cookieParser from "cookie-parser";
import { Server, matchMaker } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { MatchRoom } from "./rooms/MatchRoom";
import { checkPassword, createSession, destroySession, requireAdmin } from "./admin/auth";
import { getEvents } from "./admin/eventLog";
import { broadcast, subscribe } from "./admin/announcements";
import { getOrCreateUser, getUserById, setNickname, verifyGoogleIdToken } from "./auth/googleAuth";
import { SESSION_COOKIE_NAME, SESSION_MAX_AGE_MS, signSession, verifySession } from "./auth/session";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDistPath = path.join(__dirname, "../public");

export function createGameServer(): Server {
  const app = express();
  app.use(express.static(clientDistPath));
  app.use(express.json());
  app.use(cookieParser());

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

  app.post("/api/admin/login", (req, res) => {
    const { password } = req.body as { password?: unknown };
    if (typeof password !== "string" || !checkPassword(password)) {
      res.status(401).json({ error: "invalid password" });
      return;
    }
    const token = createSession();
    res.cookie("admin_session", token, { httpOnly: true, sameSite: "lax" });
    res.json({ ok: true });
  });

  app.post("/api/admin/logout", requireAdmin, (req, res) => {
    const cookies = (req as unknown as { cookies?: Record<string, string> }).cookies;
    destroySession(cookies?.admin_session);
    res.clearCookie("admin_session");
    res.json({ ok: true });
  });

  app.get("/api/admin/rooms", requireAdmin, async (_req, res) => {
    const rooms = await matchMaker.query({ name: "match" });
    res.json(
      rooms.map((r) => {
        const metadata = r.metadata as
          | { hostNickname?: string; players?: { sessionId: string; nickname: string }[] }
          | undefined;
        return {
          roomId: r.roomId,
          clients: r.clients,
          maxClients: r.maxClients,
          locked: r.locked,
          hostNickname: metadata?.hostNickname ?? "?",
          players: metadata?.players ?? [],
        };
      }),
    );
  });

  app.get("/api/admin/events", requireAdmin, (_req, res) => {
    res.json(getEvents().slice(-100));
  });

  app.post("/api/admin/announce", requireAdmin, (req, res) => {
    const { message } = req.body as { message?: unknown };
    if (typeof message !== "string" || message.trim().length === 0) {
      res.status(400).json({ error: "message required" });
      return;
    }
    broadcast(message.trim());
    res.json({ ok: true });
  });

  app.get("/api/announcements/stream", (req, res) => {
    subscribe(req, res);
  });

  app.post("/api/auth/google", async (req, res) => {
    try {
      const { credential } = req.body as { credential?: unknown };
      if (typeof credential !== "string") {
        res.status(400).json({ error: "credential이 필요합니다." });
        return;
      }
      const { sub, email, name } = await verifyGoogleIdToken(credential);
      const user = getOrCreateUser(sub, { email, name });
      const token = signSession(user.id);
      res.cookie(SESSION_COOKIE_NAME, token, { httpOnly: true, sameSite: "lax", maxAge: SESSION_MAX_AGE_MS });
      res.json({ id: user.id, nickname: user.nickname });
    } catch (err) {
      console.error("구글 로그인 실패:", err);
      res.status(401).json({ error: "로그인에 실패했습니다." });
    }
  });

  app.get("/api/auth/me", (req, res) => {
    const cookies = (req as unknown as { cookies?: Record<string, string> }).cookies;
    const userId = verifySession(cookies?.[SESSION_COOKIE_NAME]);
    if (!userId) {
      res.json(null);
      return;
    }
    const user = getUserById(userId);
    res.json(user ? { id: user.id, nickname: user.nickname } : null);
  });

  app.post("/api/auth/nickname", (req, res) => {
    const cookies = (req as unknown as { cookies?: Record<string, string> }).cookies;
    const userId = verifySession(cookies?.[SESSION_COOKIE_NAME]);
    if (!userId) {
      res.status(401).json({ error: "로그인이 필요합니다." });
      return;
    }
    const { nickname } = req.body as { nickname?: unknown };
    if (typeof nickname !== "string" || !nickname.trim()) {
      res.status(400).json({ error: "닉네임이 필요합니다." });
      return;
    }
    const result = setNickname(userId, nickname);
    if (result === "taken") {
      res.status(409).json({ error: "이미 사용 중인 닉네임이에요." });
      return;
    }
    if (result === "already_set") {
      res.status(409).json({ error: "이미 닉네임이 설정되어 있습니다." });
      return;
    }
    const user = getUserById(userId);
    res.json({ id: userId, nickname: user?.nickname ?? null });
  });

  app.post("/api/auth/logout", (_req, res) => {
    res.clearCookie(SESSION_COOKIE_NAME);
    res.json({ ok: true });
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
