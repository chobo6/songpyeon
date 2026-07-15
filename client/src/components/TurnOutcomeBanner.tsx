import { useEffect } from "react";
import type { TurnOutcome } from "../game/matchTypes";
import styles from "./TurnOutcomeBanner.module.css";

const SUCCESS_SOUND_SRC = "/game-assets/audio/success.mp3";
const FAIL_SOUND_SRC = "/game-assets/audio/fail.mp3";

export function TurnOutcomeBanner({ outcome }: { outcome: TurnOutcome }) {
  useEffect(() => {
    if (outcome === "pending") return;
    const audio = new Audio(outcome === "success" ? SUCCESS_SOUND_SRC : FAIL_SOUND_SRC);
    audio.play().catch(() => {});
  }, [outcome]);

  if (outcome === "pending") return null;
  return (
    <div className={outcome === "success" ? `${styles.banner} ${styles.success}` : `${styles.banner} ${styles.fail}`}>
      {outcome === "success" ? "성공!" : "실패"}
    </div>
  );
}
