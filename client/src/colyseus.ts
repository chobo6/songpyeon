import { Client, type Room } from "colyseus.js";

const endpoint = import.meta.env.VITE_SERVER_URL ?? "ws://localhost:2567";
const RECONNECTION_TOKEN_KEY = "songpyeon:reconnectionToken";

export const client = new Client(endpoint);

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

// Tries to resume the previous session (survives a page refresh mid-match)
// before falling back to normal matchmaking. A saved token can fail to
// redeem (grace period expired, room gone) — that's expected whenever the
// player was in the lobby (see server/src/rooms/MatchRoom.ts's onLeave,
// which gives no reconnection grace during "lobby"), so the fallback path
// is the common case there, not an error.
async function connectToMatch<T>(nickname: string): Promise<Room<T>> {
  const savedToken = getSavedReconnectionToken();
  if (savedToken) {
    try {
      const room = await client.reconnect<T>(savedToken);
      saveReconnectionToken(room.reconnectionToken);
      return room;
    } catch {
      clearReconnectionToken();
    }
  }

  const room = await client.joinOrCreate<T>("match", { nickname });
  saveReconnectionToken(room.reconnectionToken);
  return room;
}

export function joinMatch<T>(nickname: string): Promise<Room<T>> {
  if (!roomPromise) {
    roomPromise = connectToMatch<T>(nickname) as Promise<Room<unknown>>;
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
