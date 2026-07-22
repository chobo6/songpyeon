import express from "express";
import { createServer as createHttpServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import cookieParser from "cookie-parser";
import { Server, matchMaker } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { MatchRoom } from "./rooms/MatchRoom";
import { checkPassword, createSession, destroySession, requireAdmin, SESSION_TTL_MS } from "./admin/auth";
import { getEvents, searchEventsByNickname } from "./admin/eventLog";
import { getInquiries, recordInquiry } from "./admin/inquiries";
import { isRateLimited, recordFailedAttempt, recordSuccessfulLogin } from "./admin/loginRateLimit";
import { broadcast, subscribe } from "./admin/announcements";
import { subscribe as subscribeToPressMonitor } from "./admin/pressMonitor";
import { getOnlineUsers, touchPresence } from "./admin/presence";
import {
  adminSetNickname,
  getOrCreateUser,
  getTopRanking,
  getUserById,
  listUsers,
  setNickname,
  setNicknameColor,
  setUserBanned,
  verifyGoogleIdToken,
} from "./auth/googleAuth";
import { SESSION_COOKIE_NAME, SESSION_MAX_AGE_MS, signSession, verifySession } from "./auth/session";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDistPath = path.join(__dirname, "../public");

export function createGameServer(): Server {
  const app = express();
  // Caddy is the only reverse proxy in front of this app (see CLAUDE.md) —
  // trusting it lets Express read the real client IP (X-Forwarded-For, used
  // by the admin login rate limiter below) and the real protocol
  // (X-Forwarded-Proto, used for req.secure so cookies can be marked
  // Secure in production without hardcoding a NODE_ENV check that could
  // drift from how the app is actually being served).
  app.set("trust proxy", true);
  app.use(express.static(clientDistPath));
  app.use(express.json());
  app.use(cookieParser());

  // colyseus.js 0.16.x has no client.getAvailableRooms() — this app-level
  // route replaces it, backed by the server-only matchMaker.query() API.
  app.get("/api/rooms", async (req, res) => {
    // dev 환경에서는 client(5173)와 server(2567)가 다른 origin이라 CORS 헤더가
    // 없으면 브라우저가 응답을 읽지 못함 (client/.env.local로 LAN IP를 쓸 때도
    // 마찬가지). 프로덕션은 Caddy 뒤에서 같은 origin으로 서빙되니 영향 없음 —
    // 이 엔드포인트는 인증 없는 공개 방 목록이라 와일드카드로 열어도 안전함.
    res.header("Access-Control-Allow-Origin", "*");

    // 로비(방 목록 화면)에 있는 동안은 아직 어느 방에도 안 들어가 있어 Colyseus
    // 룸 메타데이터로는 존재를 알 수 없다 — RoomList가 이 엔드포인트를 2초마다
    // 폴링하는 걸 관리자 "현재 접속자" 표시용 presence 신호로 재사용한다.
    const cookies = (req as unknown as { cookies?: Record<string, string> }).cookies;
    const userId = verifySession(cookies?.[SESSION_COOKIE_NAME]);
    if (userId) {
      const user = getUserById(userId);
      if (user?.nickname) touchPresence(userId, user.nickname);
    }

    const rooms = await matchMaker.query({ name: "match" });
    res.json(
      rooms.map((r) => {
        const metadata = r.metadata as
          | {
              hostNickname?: string;
              roomTitle?: string;
              players?: { sessionId: string; nickname: string }[];
              playerCapacity?: number;
              allowSpectators?: boolean;
              phase?: "lobby" | "playing";
            }
          | undefined;
        return {
          roomId: r.roomId,
          // maxClients는 관전자를 받기 위해 서버 내부적으로 크게 잡혀있다
          // (MatchRoom.ts의 MAX_CLIENTS_WITH_SPECTATORS) — 방 목록에는 그
          // 값이 아니라 실제 플레이어 수/정원만 보여야 "2/4"처럼 정확히 읽힌다.
          clients: metadata?.players?.length ?? r.clients,
          maxClients: metadata?.playerCapacity ?? r.maxClients,
          // r.locked(Colyseus 자체 잠금 플래그)는 더 이상 안 쓴다 — MatchRoom.ts가
          // lock() 대신 setPrivate()을 쓰도록 바뀌면서(관전자의 joinById가 막히지
          // 않게 하기 위해, Task 1 참고) locked는 항상 false로 고정됐다. 대신
          // 메타데이터에 직접 넣어둔 phase로 판단한다.
          locked: metadata?.phase === "playing",
          hostNickname: metadata?.hostNickname ?? "?",
          roomTitle: metadata?.roomTitle ?? "이름 없는 방",
          allowSpectators: metadata?.allowSpectators ?? true,
        };
      }),
    );
  });

  // 로그인 여부와 무관하게 누구나 볼 수 있는 공개 랭킹 — /api/rooms와 같은 이유로
  // 와일드카드 CORS를 열어둠.
  app.get("/api/ranking", (_req, res) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.json(getTopRanking(10));
  });

  app.post("/api/admin/login", (req, res) => {
    if (isRateLimited(req.ip ?? "unknown")) {
      res.status(429).json({ error: "시도 횟수를 초과했어요. 15분 후 다시 시도해주세요." });
      return;
    }

    const { password } = req.body as { password?: unknown };
    if (typeof password !== "string" || !checkPassword(password)) {
      recordFailedAttempt(req.ip ?? "unknown");
      res.status(401).json({ error: "invalid password" });
      return;
    }
    recordSuccessfulLogin(req.ip ?? "unknown");
    const token = createSession();
    res.cookie("admin_session", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: req.secure,
      maxAge: SESSION_TTL_MS,
    });
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
          | {
              hostNickname?: string;
              roomTitle?: string;
              playerCapacity?: number;
              players?: { sessionId: string; nickname: string }[];
              phase?: "lobby" | "playing";
            }
          | undefined;
        return {
          roomId: r.roomId,
          roomTitle: metadata?.roomTitle ?? "이름 없는 방",
          clients: r.clients,
          // r.maxClients는 관전자를 받기 위해 서버 내부적으로 크게 잡혀있다
          // (MatchRoom.ts의 MAX_CLIENTS_WITH_SPECTATORS) — 관리자 페이지에도
          // 실제 플레이어 정원(/api/rooms와 동일한 값)을 보여줘야 한다.
          maxClients: metadata?.playerCapacity ?? r.maxClients,
          // r.locked(Colyseus 자체 잠금 플래그)는 안 쓴다 — /api/rooms와 같은 이유
          // (MatchRoom.ts가 lock() 대신 setPrivate()을 쓰도록 바뀌면서 locked는
          // 항상 false로 고정됨). 이 라우트만 그 수정이 누락돼 있었음 — 게임이
          // 진행 중이어도 관리자 대시보드에 계속 "대기 중"으로 보이던 버그.
          locked: metadata?.phase === "playing",
          hostNickname: metadata?.hostNickname ?? "?",
          players: metadata?.players ?? [],
        };
      }),
    );
  });

  // 로그인된 상태로 온라인에 접속 중인 전체 유저 — 방에 들어가 있는지 여부와
  // 무관하게, 방 목록 화면에서 대기 중인 사람까지 포함한다 (닉네임이 이제
  // 계정당 유일하므로 닉네임으로 중복 제거). 관전자도 실제 접속자이므로 포함한다 —
  // 방 목록의 "N/M" 표시나 공개 /api/rooms의 플레이어 수와는 별개 기준.
  app.get("/api/admin/online", requireAdmin, async (_req, res) => {
    const rooms = await matchMaker.query({ name: "match" });
    const roomNicknames = rooms.flatMap((r) => {
      const metadata = r.metadata as
        | { players?: { nickname: string }[]; spectators?: { nickname: string }[] }
        | undefined;
      return [
        ...(metadata?.players?.map((p) => p.nickname) ?? []),
        ...(metadata?.spectators?.map((s) => s.nickname) ?? []),
      ];
    });
    const lobbyNicknames = getOnlineUsers().map((u) => u.nickname);
    res.json([...new Set([...roomNicknames, ...lobbyNicknames])]);
  });

  app.get("/api/admin/events", requireAdmin, (_req, res) => {
    res.json(getEvents().slice(-100));
  });

  // getEvents()는 최근 500건까지만 보므로, 그보다 오래된 특정 유저의 접속 기록(IP
  // 등)을 찾을 땐 DB를 직접(부분 일치로) 검색한다.
  app.get("/api/admin/events/search", requireAdmin, (req, res) => {
    const nickname = req.query.nickname;
    if (typeof nickname !== "string" || nickname.trim().length === 0) {
      res.status(400).json({ error: "nickname 쿼리 파라미터가 필요합니다." });
      return;
    }
    res.json(searchEventsByNickname(nickname.trim()));
  });

  app.get("/api/admin/users", requireAdmin, (_req, res) => {
    res.json(listUsers());
  });

  app.get("/api/admin/inquiries", requireAdmin, (_req, res) => {
    res.json(getInquiries());
  });

  // 자기 자신은 최초 1회만 설정 가능한 일반 /api/auth/nickname과 달리, 관리자는
  // 이미 설정된 닉네임도 덮어쓸 수 있다 (오타/부적절한 닉네임 수정용) — 다른
  // 계정과 겹치는 닉네임은 여전히 거부한다.
  app.post("/api/admin/users/:id/nickname", requireAdmin, (req, res) => {
    const userId = Number(req.params.id);
    if (!Number.isInteger(userId)) {
      res.status(400).json({ error: "invalid id" });
      return;
    }
    const { nickname } = req.body as { nickname?: unknown };
    if (typeof nickname !== "string" || !nickname.trim()) {
      res.status(400).json({ error: "닉네임이 필요합니다." });
      return;
    }
    const result = adminSetNickname(userId, nickname);
    if (result === "taken") {
      res.status(409).json({ error: "이미 사용 중인 닉네임이에요." });
      return;
    }
    res.json({ ok: true });
  });

  // 닉네임 자체와 완전히 독립된 별도 수정 — VIP/이벤트 당첨자 등 특정 유저의
  // 닉네임에 관리자가 단색을 입혀 게임 내 전체(로스터/채팅/관전/랭킹)에 보이게 함.
  app.post("/api/admin/users/:id/nickname-color", requireAdmin, (req, res) => {
    const userId = Number(req.params.id);
    if (!Number.isInteger(userId)) {
      res.status(400).json({ error: "invalid id" });
      return;
    }
    const { color } = req.body as { color?: unknown };
    if (color !== null && typeof color !== "string") {
      res.status(400).json({ error: "color는 문자열 또는 null이어야 합니다." });
      return;
    }
    const result = setNicknameColor(userId, color);
    if (result === "invalid") {
      res.status(400).json({ error: "#RRGGBB 형식의 색상 코드를 입력해주세요." });
      return;
    }
    res.json({ ok: true });
  });

  // 밴 즉시 강제 퇴장까지 처리한다 — DB만 갱신하고 끝내면 이미 접속 중인
  // 세션은 다음 방 입장 시도 전까지 계속 게임을 할 수 있어 "즉시 퇴장"
  // 요구사항을 못 지킨다. getLocalRoomById는 이 프로세스에 떠 있는 실제 룸
  // 인스턴스를 반환한다(getRoomById와 달리 — 그건 룸 목록 캐시만 반환함).
  // 이 프로젝트는 단일 프로세스 배포라 "이 프로세스에 있는 것만"이 곧 전부다.
  app.post("/api/admin/users/:id/ban", requireAdmin, async (req, res) => {
    const userId = Number(req.params.id);
    if (!Number.isInteger(userId)) {
      res.status(400).json({ error: "invalid id" });
      return;
    }
    setUserBanned(userId, true);

    const rooms = await matchMaker.query({ name: "match" });
    for (const r of rooms) {
      const room = matchMaker.getLocalRoomById(r.roomId) as MatchRoom | undefined;
      room?.kickUserId(userId);
    }

    res.json({ ok: true });
  });

  app.post("/api/admin/users/:id/unban", requireAdmin, async (req, res) => {
    const userId = Number(req.params.id);
    if (!Number.isInteger(userId)) {
      res.status(400).json({ error: "invalid id" });
      return;
    }
    setUserBanned(userId, false);
    res.json({ ok: true });
  });

  // 공지 배너 스트림(/api/announcements/stream)과 달리 전체 공개가 아니라
  // requireAdmin으로 막혀있음 — 특정 유저의 실시간 입력 패턴은 민감한 감시 데이터라
  // 관리자만 볼 수 있어야 함.
  app.get("/api/admin/monitor/:userId/stream", requireAdmin, (req, res) => {
    const userId = Number(req.params.userId);
    if (!Number.isInteger(userId)) {
      res.status(400).json({ error: "invalid id" });
      return;
    }
    subscribeToPressMonitor(userId, req, res);
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
      res.cookie(SESSION_COOKIE_NAME, token, {
        httpOnly: true,
        sameSite: "lax",
        secure: req.secure,
        maxAge: SESSION_MAX_AGE_MS,
      });
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

  // 로비(방 목록) 화면의 "문의하기" 버튼에서만 호출됨 — 온라인 입장 자체가
  // 구글 로그인을 요구하므로 여기 도달했다는 건 항상 로그인된 유저라는 뜻이고,
  // 그래서 누가 보냈는지(닉네임) 항상 같이 기록할 수 있다. 답장 기능은 없음.
  app.post("/api/inquiries", (req, res) => {
    const cookies = (req as unknown as { cookies?: Record<string, string> }).cookies;
    const userId = verifySession(cookies?.[SESSION_COOKIE_NAME]);
    const user = userId ? getUserById(userId) : null;
    if (!user?.nickname) {
      res.status(401).json({ error: "로그인이 필요합니다." });
      return;
    }
    const { title, content } = req.body as { title?: unknown; content?: unknown };
    if (typeof title !== "string" || !title.trim() || typeof content !== "string" || !content.trim()) {
      res.status(400).json({ error: "제목과 내용을 입력해주세요." });
      return;
    }
    recordInquiry(user.id, user.nickname, title.trim(), content.trim());
    res.json({ ok: true });
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
