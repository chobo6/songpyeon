import { useEffect, useReducer, useState } from "react";
import type { Room } from "colyseus.js";
import { joinMatch, leaveMatch } from "../colyseus";
import type { MatchState } from "./matchTypes";

export type ConnectionStatus = "connecting" | "connected" | "error";

export function useMatchRoom(nickname: string) {
  const [room, setRoom] = useState<Room<MatchState> | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [generation, setGeneration] = useState(0);
  const [, forceRender] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    let disposed = false;
    let hasReceivedState = false;

    joinMatch<MatchState>(nickname)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generation]);

  async function leaveAndRejoin() {
    setStatus("connecting");
    setRoom(null);
    try {
      await leaveMatch();
    } catch (err) {
      console.error("failed to leave match", err);
    }
    setGeneration((g) => g + 1);
  }

  // Leaves without rejoining — used by the new back/exit buttons (connecting
  // screen, lobby) to return to mode select. Unlike leaveAndRejoin, this does
  // NOT bump `generation`, so no new join is triggered; the caller unmounts
  // this hook right after by switching App's mode away from "online".
  async function cancelAndExit() {
    try {
      await leaveMatch();
    } catch (err) {
      console.error("failed to leave match", err);
    }
  }

  return { room, status, leaveAndRejoin, cancelAndExit };
}
