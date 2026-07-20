import { Client, type Room } from "colyseus.js";

// PROD builds always derive the endpoint from the page's own origin — both
// the real deploy (behind Caddy) and a local `npm run sync-public` test on
// :2567 rely on the game connection landing on the same host that served
// the page, since the login session cookie is host-scoped and won't ride
// along to a different host (e.g. client/.env.local's LAN IP, meant only
// for dev-mode mobile testing — see VITE_SERVER_URL's own comment there).
const endpoint = import.meta.env.PROD
  ? `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}`
  : (import.meta.env.VITE_SERVER_URL ?? "ws://localhost:2567");

export const client = new Client(endpoint);

// /api/rooms is a plain HTTP route (see server/src/createServer.ts), not part
// of the colyseus.js Client — this Colyseus version has no
// client.getAvailableRooms(). Reuse `endpoint`'s host (it always points at
// the same server, dev or prod) and just swap the protocol.
const apiBase = endpoint.replace(/^ws/, "http");

export interface RoomListEntry {
  roomId: string;
  clients: number;
  maxClients: number;
  locked: boolean;
  hostNickname: string;
  roomTitle: string;
  allowSpectators: boolean;
}

export async function listRooms(): Promise<RoomListEntry[]> {
  const res = await fetch(`${apiBase}/api/rooms`);
  return res.json();
}

export interface RankingEntry {
  nickname: string;
  maxRound: number;
}

export async function getRanking(): Promise<RankingEntry[]> {
  const res = await fetch(`${apiBase}/api/ranking`);
  return res.json();
}

export type JoinSpec =
  | { type: "create"; teamCount: number; roomTitle: string; allowSpectators: boolean }
  | { type: "joinById"; roomId: string }
  | { type: "reconnect" };

// 게임 진행 중 새로고침/탭 닫힘에서 자동 재접속하기 위해 저장해두는 토큰 — Colyseus가 방
// 입장/재접속에 성공할 때마다 내려주는 room.reconnectionToken을 그대로 들고 있다가, 다음에
// 앱이 열릴 때 이 토큰으로 client.reconnect()를 시도한다(App.tsx 참고). localStorage를 쓰는
// 이유는 sessionStorage와 달리 탭/창을 완전히 닫았다 새로 열어도 남아있어야 하기 때문 —
// 유예 시간이 지나거나 한 번 쓰이면 서버에서 자연히 무효화되므로(MatchRoom.ts의
// reconnectGraceSeconds) 오래 남아있어도 재접속 시도가 실패할 뿐 위험하지 않다.
const RECONNECT_TOKEN_KEY = "songpyeon:reconnectToken";

function storeReconnectToken<T>(room: Room<T>) {
  if (room.reconnectionToken) localStorage.setItem(RECONNECT_TOKEN_KEY, room.reconnectionToken);
}

export function hasStoredReconnectToken(): boolean {
  return localStorage.getItem(RECONNECT_TOKEN_KEY) !== null;
}

export function clearReconnectToken(): void {
  localStorage.removeItem(RECONNECT_TOKEN_KEY);
}

// Cached at module scope (not component/ref scope) so React StrictMode's
// dev-only double-invoke of effects (mount -> cleanup -> mount) reuses the
// same in-flight/resolved join instead of opening a second real connection
// that briefly (but really) occupies a seat server-side before it's told
// to leave.
let roomPromise: Promise<Room<unknown>> | null = null;

// 세션 쿠키(httpOnly, 브라우저가 WebSocket 업그레이드 요청에 자동으로 실어 보냄)로 서버가
// 로그인 여부와 닉네임을 판단하므로, 더 이상 nickname을 옵션으로 넘길 필요가 없다
// (MatchRoom.onAuth/onJoin 참고).
async function connectToMatch<T>(spec: JoinSpec): Promise<Room<T>> {
  if (spec.type === "create") {
    const room = await client.create<T>("match", {
      teamCount: spec.teamCount,
      roomTitle: spec.roomTitle,
      allowSpectators: spec.allowSpectators,
    });
    storeReconnectToken(room);
    return room;
  }
  if (spec.type === "joinById") {
    const room = await client.joinById<T>(spec.roomId);
    storeReconnectToken(room);
    return room;
  }
  // reconnect
  const token = localStorage.getItem(RECONNECT_TOKEN_KEY);
  if (!token) throw new Error("재접속할 게임이 없어요.");
  try {
    const room = await client.reconnect<T>(token);
    storeReconnectToken(room);
    return room;
  } catch (err) {
    clearReconnectToken();
    throw err;
  }
}

export function joinMatch<T>(spec: JoinSpec): Promise<Room<T>> {
  if (!roomPromise) {
    roomPromise = connectToMatch<T>(spec) as Promise<Room<unknown>>;
  }
  return roomPromise as Promise<Room<T>>;
}

// Leaves the currently cached match (if any) and clears the cache, so the
// next joinMatch() call opens a genuinely fresh connection instead of
// returning the (now-left) stale room.
export async function leaveMatch(): Promise<void> {
  const current = roomPromise;
  roomPromise = null;
  clearReconnectToken();
  if (!current) return;
  const room = await current;
  await room.leave();
}
