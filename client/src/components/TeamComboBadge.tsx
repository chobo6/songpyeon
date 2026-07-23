import type { TeamState } from "../game/matchTypes";
import styles from "./TeamComboBadge.module.css";

export function TeamComboBadge({ teams }: { teams: TeamState[] }) {
  return (
    <div className={styles.wrap}>
      {teams.map((t) => (
        <div key={t.id} className={t.eliminated ? `${styles.row} ${styles.eliminated}` : styles.row}>
          {t.id}팀 🔥{t.combo}
        </div>
      ))}
    </div>
  );
}
