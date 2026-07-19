import { Client, type Room } from "colyseus.js";

const endpoint =
  import.meta.env.VITE_SERVER_URL ??
  (import.meta.env.PROD
    ? `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}`
    : "ws://localhost:2567");

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
}

export async function listRooms(): Promise<RoomListEntry[]> {
  const res = await fetch(`${apiBase}/api/rooms`);
  return res.json();
}

export type JoinSpec = { type: "create"; teamCount: number } | { type: "joinById"; roomId: string };

// Cached at module scope (not component/ref scope) so React StrictMode's
// dev-only double-invoke of effects (mount -> cleanup -> mount) reuses the
// same in-flight/resolved join instead of opening a second real connection
// that briefly (but really) occupies a seat server-side before it's told
// to leave.
let roomPromise: Promise<Room<unknown>> | null = null;

// No reconnection-token persistence here on purpose — a refresh or dropped
// connection always lands back on the room list (see App.tsx's OnlineFlow),
// never a silent resume into whatever room you were last in. RoleSelect lets
// you freely change roles without leaving the room, so there's no "lost
// progress" a resume would need to protect against in the lobby; a genuine
// mid-match drop just means rejoining fresh from the room list.
// 세션 쿠키(httpOnly, 브라우저가 WebSocket 업그레이드 요청에 자동으로 실어 보냄)로 서버가
// 로그인 여부와 닉네임을 판단하므로, 더 이상 nickname을 옵션으로 넘길 필요가 없다
// (MatchRoom.onAuth/onJoin 참고).
async function connectToMatch<T>(spec: JoinSpec): Promise<Room<T>> {
  return spec.type === "create"
    ? await client.create<T>("match", { teamCount: spec.teamCount })
    : await client.joinById<T>(spec.roomId);
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
  if (!current) return;
  const room = await current;
  await room.leave();
}
