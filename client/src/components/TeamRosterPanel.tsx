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
}

// Memoized against the same in-place-mutation trap ChatBox's chatPropsEqual
// documents (see ChatBox.tsx) — `teams` is a colyseus ArraySchema mutated
// in place, so the default shallow/reference comparison would never detect
// a mortar loss or elimination and this panel would silently freeze after
// mount. Compares the actual per-team fields this component renders
// instead.
//
// `players` isn't compared at all: this panel only renders during
// "playing" phase (its only caller, SpectatorScreen.tsx, never mounts it in
// "lobby"), when onJoin already rejects new joiners and a resolved
// nickname never changes for an existing sessionId — the only way a
// rendered seat's nickname can change mid-match is its team's
// pigSessionId/rabbitSessionId being cleared (a player leaving), which is
// already covered below.
function teamRosterPropsEqual(prev: TeamRosterPanelProps, next: TeamRosterPanelProps) {
  if (prev.teams.length !== next.teams.length) return false;
  return prev.teams.every((team, i) => {
    const nextTeam = next.teams[i];
    return (
      team.id === nextTeam.id &&
      team.pigSessionId === nextTeam.pigSessionId &&
      team.rabbitSessionId === nextTeam.rabbitSessionId &&
      team.mortars === nextTeam.mortars &&
      team.eliminated === nextTeam.eliminated
    );
  });
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
