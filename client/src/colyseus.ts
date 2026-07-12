import { Client, type Room } from "colyseus.js";

const endpoint = import.meta.env.VITE_SERVER_URL ?? "ws://localhost:2567";

export const client = new Client(endpoint);

// Cached at module scope (not component/ref scope) so React StrictMode's
// dev-only double-invoke of effects (mount -> cleanup -> mount) reuses the
// same in-flight/resolved join instead of opening a second real connection
// that briefly (but really) occupies a seat server-side before it's told
// to leave.
let roomPromise: Promise<Room<unknown>> | null = null;

export function joinMatch<T>(): Promise<Room<T>> {
  if (!roomPromise) {
    roomPromise = client.joinOrCreate<T>("match") as Promise<Room<unknown>>;
  }
  return roomPromise as Promise<Room<T>>;
}
