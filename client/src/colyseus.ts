import { Client, type Room } from "colyseus.js";

const endpoint =
  import.meta.env.VITE_SERVER_URL ??
  (import.meta.env.PROD
    ? `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}`
    : "ws://localhost:2567");
const RECONNECTION_TOKEN_KEY = "songpyeon:reconnectionToken";

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

export type JoinSpec =
  | { type: "create"; nickname: string }
  | { type: "joinById"; roomId: string; nickname: string }
  | { type: "resume" };

// Cached at module scope (not component/ref scope) so React StrictMode's
// dev-only double-invoke of effects (mount -> cleanup -> mount) reuses the
// same in-flight/resolved join instead of opening a second real connection
// that briefly (but really) occupies a seat server-side before it's told
// to leave.
let roomPromise: Promise<Room<unknown>> | null = null;

// sessionStorage access can throw (Safari private mode, storage disabled by
// policy) — swallow that so a storage restriction never blocks joining a
// match, it just falls back to "no saved token" behavior.
function getSavedReconnectionToken(): string | null {
  try {
    return sessionStorage.getItem(RECONNECTION_TOKEN_KEY);
  } catch {
    return null;
  }
}

function saveReconnectionToken(token: string) {
  try {
    sessionStorage.setItem(RECONNECTION_TOKEN_KEY, token);
  } catch {
    // best-effort — a refresh just won't be able to reconnect this session.
  }
}

function clearReconnectionToken() {
  try {
    sessionStorage.removeItem(RECONNECTION_TOKEN_KEY);
  } catch {
    // best-effort, see saveReconnectionToken.
  }
}

// Whether a resumable session (page refresh mid-match or mid-lobby-wait —
// see MatchRoom.ts's onLeave, which grants the same reconnection grace in
// the lobby as during play) exists. Checked once, right after nickname
// entry (see App.tsx's OnlineFlow), to offer an automatic "resume" attempt
// BEFORE the room list renders — deliberately NOT consulted inside
// connectToMatch() itself, so an explicit "새 방 만들기"/"입장" pick from the
// room list can never be silently overridden by a stale token.
export function hasSavedSession(): boolean {
  return getSavedReconnectionToken() !== null;
}

// `spec.type === "resume"` is only ever reached via the automatic
// hasSavedSession() check above — never as a fallback inside another spec —
// so a failed resume throws instead of silently falling through to
// create/joinById (there's nothing sensible to fall back to; App.tsx's
// resumeAttempted flag routes the user to the room list after a failure).
async function connectToMatch<T>(spec: JoinSpec): Promise<Room<T>> {
  if (spec.type === "resume") {
    const savedToken = getSavedReconnectionToken();
    if (!savedToken) throw new Error("no resumable session");
    try {
      const room = await client.reconnect<T>(savedToken);
      saveReconnectionToken(room.reconnectionToken);
      return room;
    } catch (err) {
      clearReconnectionToken();
      throw err;
    }
  }

  const room =
    spec.type === "create"
      ? await client.create<T>("match", { nickname: spec.nickname })
      : await client.joinById<T>(spec.roomId, { nickname: spec.nickname });
  saveReconnectionToken(room.reconnectionToken);
  return room;
}

export function joinMatch<T>(spec: JoinSpec): Promise<Room<T>> {
  if (!roomPromise) {
    roomPromise = connectToMatch<T>(spec) as Promise<Room<unknown>>;
  }
  return roomPromise as Promise<Room<T>>;
}

// Leaves the currently cached match (if any), clears the cache and the
// saved reconnection token, so the next joinMatch() call actually opens a
// fresh connection instead of returning the (now-left) stale room or
// trying to reconnect into a match we just deliberately left.
export async function leaveMatch(): Promise<void> {
  const current = roomPromise;
  roomPromise = null;
  if (!current) {
    clearReconnectionToken();
    return;
  }
  const room = await current;
  await room.leave();
  clearReconnectionToken();
}
