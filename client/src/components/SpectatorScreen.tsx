import type { Room } from "colyseus.js";
import type { MatchState, TeamState } from "../game/matchTypes";
import { ChatBox } from "./ChatBox";
import { SequenceBoard } from "./SequenceBoard";
import { TeamRosterPanel } from "./TeamRosterPanel";
import { TimerBar } from "./TimerBar";
import styles from "./PlayingScreen.module.css";

export function SpectatorScreen({
  room,
  activeTeam,
  eliminated,
  clockOffsetMs,
  onLeave,
}: {
  room: Room<MatchState>;
  activeTeam: TeamState;
  eliminated: boolean;
  clockOffsetMs: number;
  onLeave: () => void;
}) {
  const { sequence, cursor, round, teams, turnEndsAt, players, matchChat } = room.state;

  function sendChat(text: string) {
    room.send("sendChat", { text });
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.content}>
        <p className={styles.round}>ROUND {round}</p>
        <TimerBar turnEndsAt={turnEndsAt} clockOffsetMs={clockOffsetMs} />
        {eliminated ? (
          <>
            <p className={styles.spectating}>
              {activeTeam.eliminated
                ? "모든 팀이 탈락했습니다."
                : `당신의 팀은 탈락했습니다. ${activeTeam.id} 팀이 계속 플레이 중입니다.`}
            </p>
            <button className={styles.leaveButton} onClick={onLeave}>
              나가기
            </button>
          </>
        ) : (
          <p className={styles.spectating}>{activeTeam.id} 팀의 차례입니다</p>
        )}
        <div className={styles.boardArea}>
          <SequenceBoard sequence={sequence} cursor={cursor} />
        </div>
        <ChatBox messages={matchChat} onSend={sendChat} />
      </div>
      <TeamRosterPanel teams={teams} players={players} />
    </div>
  );
}
