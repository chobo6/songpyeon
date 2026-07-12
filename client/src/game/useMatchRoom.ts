import { useEffect, useReducer, useState } from "react";
import type { Room } from "colyseus.js";
import { joinMatch } from "../colyseus";
import type { MatchState } from "./matchTypes";

export type ConnectionStatus = "connecting" | "connected" | "error";

export function useMatchRoom() {
  const [room, setRoom] = useState<Room<MatchState> | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [, forceRender] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    let disposed = false;
    // joinOrCreate() resolving only means the room handshake finished — the
    // initial full state arrives via a separate patch shortly after, so we
    // wait for the first onStateChange before trusting room.state is populated.
    let hasReceivedState = false;

    joinMatch<MatchState>()
      .then((joined) => {
        if (disposed) return;
        joined.onStateChange(() => {
          if (!hasReceivedState) {
            hasReceivedState = true;
            setRoom(joined);
            setStatus("connected");
          } else {
            forceRender();
          }
        });
      })
      .catch((err) => {
        console.error("failed to join room", err);
        setStatus("error");
      });

    return () => {
      disposed = true;
    };
  }, []);

  return { room, status };
}
