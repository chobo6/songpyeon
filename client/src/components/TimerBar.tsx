import { useEffect, useState } from "react";
import styles from "./TimerBar.module.css";

// Mirrors server/src/rooms/MatchRoom.ts's DEFAULT_TURN_DURATION_MS — the
// client never overrides turnDurationMs (only test rooms do), so this is
// safe to hardcode for display purposes.
const TURN_DURATION_MS = 4000;

export function TimerBar({ turnEndsAt }: { turnEndsAt: number }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, []);

  const remaining = Math.max(0, turnEndsAt - now);
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
