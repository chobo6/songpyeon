import { useEffect, useState } from "react";
import styles from "./TimerBar.module.css";

// Mirrors server/src/rooms/MatchRoom.ts's DEFAULT_TURN_DURATION_MS — the
// client never overrides turnDurationMs (only test rooms do), so this is
// safe to hardcode for display purposes.
const TURN_DURATION_MS = 4000;

// `clockOffsetMs` corrects for this client's system clock disagreeing with
// the server's (see client/src/game/clockSync.ts) — `turnEndsAt` is an
// absolute server timestamp, so comparing it against raw client Date.now()
// makes the gauge visibly out of phase with when the server actually ends
// the turn. Solo mode has no server and no skew, so it doesn't pass this
// prop; 0 is the correct no-op default there.
export function TimerBar({ turnEndsAt, clockOffsetMs = 0 }: { turnEndsAt: number; clockOffsetMs?: number }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, []);

  const serverNow = now + clockOffsetMs;
  const remaining = Math.max(0, turnEndsAt - serverNow);
  const fraction = Math.min(1, remaining / TURN_DURATION_MS);

  return (
    <div className={styles.wrap}>
      <img className={styles.icon} src="/game-assets/ui/thanksgiving_room_time_icon.webp" alt="" />
      <div className={styles.track}>
        <div className={styles.gauge} style={{ transform: `scaleX(${fraction})` }} />
      </div>
    </div>
  );
}
