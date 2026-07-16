import type { Room } from "colyseus.js";
import type { MatchState, TeamState } from "../game/matchTypes";
import { useSequencePressSound } from "../game/useSequencePressSound";
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
  // No role to exclude while spectating — every press heard here belongs to
  // whichever team is actually playing, none of it is "my own" instant-fed
  // press (spectators don't have a ButtonPanel at all).
  useSequencePressSound(sequence, cursor);

  function sendChat(text: string) {
    room.send("sendChat", { text });
  }

  // Once every team is wiped out the match itself is over (not just this
  // player's team) — "나가기" here returns everyone in the room to this same
  // room's lobby (server resets phase to "lobby") instead of leaving to the
  // room list, so the same group can play again without re-sharing a room
  // code. That's only correct once the whole match has concluded; while
  // other teams are still playing, "나가기" must still actually leave.
  const matchOver = activeTeam.eliminated;

  function handleLeaveClick() {
    if (matchOver) {
      room.send("rematch");
      return;
    }
    onLeave();
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.content}>
        <p className={styles.round}>ROUND {round}</p>
        <TimerBar turnEndsAt={turnEndsAt} clockOffsetMs={clockOffsetMs} />
        {eliminated ? (
          <>
            <p className={styles.spectating}>
              {matchOver
                ? "모든 팀이 탈락했습니다."
                : `당신의 팀은 탈락했습니다. ${activeTeam.id} 팀이 계속 플레이 중입니다.`}
            </p>
            <button className={styles.leaveButton} onClick={handleLeaveClick}>
              나가기
            </button>
          </>
        ) : (
          <p className={styles.spectating}>{activeTeam.id} 팀의 차례입니다</p>
        )}
        <div className={styles.boardArea}>
          <SequenceBoard sequence={sequence} cursor={cursor} />
        </div>
        <ChatBox messages={matchChat} onSend={sendChat} fill />
      </div>
      <TeamRosterPanel teams={teams} players={players} />
    </div>
  );
}
