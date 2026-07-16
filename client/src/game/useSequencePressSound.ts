import { useEffect, useRef } from "react";
import type { Color, Role } from "./colors";
import { colorRole } from "./colors";
import { playColorClickSound } from "./clickSound";

// How many consecutive "mint" entries end at (and include) `index` — mint is
// the only color pressed in same-color runs, and presses always proceed
// strictly left-to-right (server-validated), so this count is exactly which
// position within its run the press at `index` is, without needing a
// stateful per-press counter.
function mintStreakEndingAt(sequence: readonly Color[], index: number): number {
  let count = 0;
  for (let i = index; i >= 0 && sequence[i] === "mint"; i--) count++;
  return count;
}

// Plays the per-color press sound for every sequence entry the cursor just
// advanced past — used to hear *other* players' presses (your own press
// already gets instant local feedback from ButtonPanel, which is why
// `excludeRole`, when given, skips that role's colors here to avoid playing
// it twice). Reacting to the synced cursor instead of a per-press message
// means this naturally covers a teammate pressing while it's your team's
// turn (MyTurnScreen, pass your own role as `excludeRole`) and, with no
// exclusion, an entire other team's presses while spectating
// (SpectatorScreen).
export function useSequencePressSound(sequence: readonly Color[], cursor: number, excludeRole?: Role) {
  const prevCursorRef = useRef(cursor);

  useEffect(() => {
    const prevCursor = prevCursorRef.current;
    prevCursorRef.current = cursor;
    if (cursor <= prevCursor) return; // new turn's reset, not forward progress

    for (let i = prevCursor; i < cursor; i++) {
      const color = sequence[i];
      if (!color || (excludeRole && colorRole(color) === excludeRole)) continue;
      const mintStreakIndex = color === "mint" ? mintStreakEndingAt(sequence, i) - 1 : 0;
      playColorClickSound(color, mintStreakIndex);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `sequence` is read, not compared; only `cursor` should retrigger this.
  }, [cursor]);
}
