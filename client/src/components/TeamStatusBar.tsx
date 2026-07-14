import type { TeamState } from "../game/matchTypes";
import styles from "./TeamStatusBar.module.css";

// Mirrors server/src/game/mortar.ts's STARTING_MORTARS — client and server
// are separate npm workspaces with no shared-types package, kept in sync by
// hand (see client/src/game/matchTypes.ts for the same pattern).
const MAX_MORTARS = 5;

export function TeamStatusBar({ teams, activeTeamId }: { teams: TeamState[]; activeTeamId: string }) {
  return (
    <div className={styles.bar}>
      {teams.map((team) => (
        <div
          key={team.id}
          className={team.id === activeTeamId ? `${styles.team} ${styles.active}` : styles.team}
        >
          <span className={styles.name}>{team.id}</span>
          {team.eliminated ? (
            <span className={styles.eliminated}>탈락</span>
          ) : (
            <span className={styles.mortars}>
              {Array.from({ length: MAX_MORTARS }, (_, i) => (
                <img
                  key={i}
                  className={styles.heart}
                  alt=""
                  src={
                    i < team.mortars
                      ? "/game-assets/ui/thanksgiving_room_heart.png"
                      : "/game-assets/ui/thanksgiving_room_heart_off.png"
                  }
                />
              ))}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
