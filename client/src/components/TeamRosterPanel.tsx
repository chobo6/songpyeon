import { memo } from "react";
import type { PlayerState, TeamState } from "../game/matchTypes";
import panelBg from "./bottomPanelBackground.module.css";
import styles from "./TeamRosterPanel.module.css";

// Mirrors server/src/game/mortar.ts's STARTING_MORTARS — client and server
// are separate npm workspaces with no shared-types package, kept in sync by
// hand (see client/src/game/matchTypes.ts for the same pattern).
const MAX_MORTARS = 5;

interface TeamRosterPanelProps {
  teams: TeamState[];
  players: Map<string, PlayerState>;
  // A fresh primitive string, recomputed by the caller on every render from
  // the live team data (see SpectatorScreen.tsx). `teams` itself is a
  // colyseus ArraySchema mutated in place — comparing team.mortars directly
  // between "prev" and "next" props compares the same live object to
  // itself (both props reference the identical mutated array/team
  // instances), so that comparison is always trivially true and this panel
  // would silently freeze the instant it first skips a re-render (visible
  // as every team's mortar count sticking at whatever it was when a
  // spectator's own team was eliminated and this panel mounted). A string
  // snapshot is immutable, so comparing prev/next actually detects real
  // changes.
  signature: string;
}

// `players` isn't compared at all: this panel only renders during
// "playing" phase (its only caller, SpectatorScreen.tsx, never mounts it in
// "lobby"), when onJoin already rejects new joiners and a resolved
// nickname never changes for an existing sessionId — the only way a
// rendered seat's nickname can change mid-match is its team's
// pigSessionId/rabbitSessionId being cleared (a player leaving), which is
// already covered by `signature`.
function teamRosterPropsEqual(prev: TeamRosterPanelProps, next: TeamRosterPanelProps) {
  return prev.signature === next.signature;
}

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

export const TeamRosterPanel = memo(function TeamRosterPanel({ teams, players }: TeamRosterPanelProps) {
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
}, teamRosterPropsEqual);
