import type { Room } from "colyseus.js";
import type { MatchState, TeamState } from "../game/matchTypes";
import { SequenceBoard } from "./SequenceBoard";
import { TeamStatusBar } from "./TeamStatusBar";
import styles from "./PlayingScreen.module.css";

export function SpectatorScreen({ room, activeTeam }: { room: Room<MatchState>; activeTeam: TeamState }) {
  const { sequence, cursor, round, teams } = room.state;

  return (
    <div className={styles.wrap}>
      <p className={styles.round}>ROUND {round}</p>
      <TeamStatusBar teams={teams} activeTeamId={activeTeam.id} />
      <p className={styles.spectating}>{activeTeam.id} 팀의 차례입니다</p>
      <div className={styles.boardArea}>
        <SequenceBoard sequence={sequence} cursor={cursor} />
      </div>
    </div>
  );
}
