import { useEffect } from "react";
import type { TurnOutcome } from "../game/matchTypes";
import { playSrc } from "../game/clickSound";
import styles from "./TurnOutcomeBanner.module.css";

const SUCCESS_SOUND_SRC = "/game-assets/audio/success.mp3";
const FAIL_SOUND_SRC = "/game-assets/audio/fail.mp3";

export function TurnOutcomeBanner({ outcome }: { outcome: TurnOutcome }) {
  useEffect(() => {
    if (outcome === "pending") return;
    // Pooled (see clickSound.ts's playSrc) instead of `new Audio()` — this
    // fires exactly at a turn boundary, the same moment buttons are
    // re-enabling/disabling, so it's subject to the same iOS main-thread
    // touch-responsiveness risk documented there.
    playSrc(outcome === "success" ? SUCCESS_SOUND_SRC : FAIL_SOUND_SRC);
  }, [outcome]);

  if (outcome === "pending") return null;
  return (
    <div className={outcome === "success" ? `${styles.banner} ${styles.success}` : `${styles.banner} ${styles.fail}`}>
      {outcome === "success" ? "성공!" : "실패"}
    </div>
  );
}
