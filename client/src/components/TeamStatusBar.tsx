import type { TeamState } from "../game/matchTypes";
import styles from "./TeamStatusBar.module.css";

export function TeamStatusBar({ teams, activeTeamId }: { teams: TeamState[]; activeTeamId: string }) {
  return (
    <div className={styles.bar}>
      {teams.map((team) => (
        <div
          key={team.id}
          className={team.id === activeTeamId ? `${styles.team} ${styles.active}` : styles.team}
        >
          <span className={styles.name}>{team.id}</span>
          <span className={team.eliminated ? styles.eliminated : styles.mortars}>
            {team.eliminated ? "탈락" : "절구 " + "🥣".repeat(team.mortars)}
          </span>
        </div>
      ))}
    </div>
  );
}
