import { useEffect, useReducer, useState } from "react";
import type { Room } from "colyseus.js";
import { joinMatch, leaveMatch, type JoinSpec } from "../colyseus";
import type { MatchState } from "./matchTypes";

export type ConnectionStatus = "connecting" | "connected" | "error";

// `spec` is captured once at mount via closure (see the effect's deps below)
// — the caller (App.tsx) always mounts a fresh ConnectedOnlineFlow/instance
// of this hook per room (from RoomList's create/join actions), so "pick a
// different room" is a remount, not something this hook needs to handle
// internally.
export function useMatchRoom(spec: JoinSpec) {
  const [room, setRoom] = useState<Room<MatchState> | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [, forceRender] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    let disposed = false;
    // joinOrCreate() resolving only means the room handshake finished — the
    // initial full state arrives via a separate patch shortly after, so we
    // wait for the first onStateChange before trusting room.state is populated.
    let hasReceivedState = false;

    joinMatch<MatchState>(spec)
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
        if (disposed) return;
        console.error("failed to join room", err);
        setErrorMessage("입장할 수 없어요 (방이 꽉 찼거나 이미 시작됐을 수 있어요)");
        setStatus("error");
      });

    return () => {
      disposed = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Leaves the room — used by the lobby/game's exit buttons to return to the
  // room list. The caller unmounts this hook right after by switching back
  // to RoomList, so there's no "rejoin in place" concept anymore (picking
  // another room always means mounting a fresh useMatchRoom instance).
  async function cancelAndExit() {
    try {
      await leaveMatch();
    } catch (err) {
      console.error("failed to leave match", err);
    }
  }

  return { room, status, errorMessage, cancelAndExit };
}
