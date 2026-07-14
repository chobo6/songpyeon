import type { PlayerState, TeamState } from "../game/matchTypes";
import panelBg from "./bottomPanelBackground.module.css";
import styles from "./TeamRosterPanel.module.css";

// Mirrors server/src/game/mortar.ts's STARTING_MORTARS — client and server
// are separate npm workspaces with no shared-types package, kept in sync by
// hand (see client/src/game/matchTypes.ts for the same pattern).
const MAX_MORTARS = 5;

function Seat({
  nickname,
  roleIcon,
}: {
  nickname: string | undefined;
  roleIcon: string;
}) {
  return (
    <div className={styles.seat}>
      <img className={styles.seatIcon} src={roleIcon} alt="" />
      <span className={styles.seatName}>{nickname ?? "-"}</span>
    </div>
  );
}

export function TeamRosterPanel({
  teams,
  players,
}: {
  teams: TeamState[];
  players: Map<string, PlayerState>;
}) {
  return (
    <div className={panelBg.panelBg}>
      <div className={styles.roster}>
        {teams.map((team) => (
          <div key={team.id} className={styles.column}>
            <Seat
              nickname={players.get(team.pigSessionId)?.nickname}
              roleIcon="/game-assets/ui/thanksgiving_room_start_player_pig.png"
            />
            <Seat
              nickname={players.get(team.rabbitSessionId)?.nickname}
              roleIcon="/game-assets/ui/thanksgiving_room_start_player_rabbit.png"
            />
            {team.eliminated ? (
              <span className={styles.eliminated}>탈락</span>
            ) : (
              <div className={styles.mortars}>
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
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
