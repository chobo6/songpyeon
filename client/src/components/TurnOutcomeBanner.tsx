import type { TurnOutcome } from "../game/matchTypes";
import styles from "./TurnOutcomeBanner.module.css";

export function TurnOutcomeBanner({ outcome }: { outcome: TurnOutcome }) {
  if (outcome === "pending") return null;
  return (
    <div className={outcome === "success" ? `${styles.banner} ${styles.success}` : `${styles.banner} ${styles.fail}`}>
      {outcome === "success" ? "성공!" : "실패"}
    </div>
  );
}
