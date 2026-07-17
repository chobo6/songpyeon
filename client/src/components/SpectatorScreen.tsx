import { useCallback } from "react";
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
  const { sequence, cursor, turnOutcome, round, teams, turnEndsAt, players, matchChat } = room.state;
  // No role to exclude while spectating — every press heard here belongs to
  // whichever team is actually playing, none of it is "my own" instant-fed
  // press (spectators don't have a ButtonPanel at all).
  useSequencePressSound(sequence, cursor);

  // Stable reference (room never changes for this hook's lifetime) so it
  // doesn't defeat ChatBox's memoization — see ChatBox.tsx.
  const sendChat = useCallback(
    (text: string) => {
      room.send("sendChat", { text });
    },
    [room],
  );

  // Once every team is wiped out the match itself is over (not just this
  // player's team) — "나가기" here returns everyone in the room to this same
  // room's lobby (server resets phase to "lobby") instead of leaving to the
  // room list, so the same group can play again without re-sharing a room
  // code. That's only correct once the whole match has concluded; while
  // other teams are still playing, "나가기" must still actually leave.
  //
  // NOT `activeTeam.eliminated` — a wrong press eliminates the active team
  // immediately, but the turn hand-off (and activeTeamIndex moving to the
  // next surviving team) is deliberately deferred to the original turn
  // timer (see MatchRoom.ts's handlePressButton). In a 3+ team room, that
  // leaves a window where activeTeam is your own just-eliminated team even
  // though other teams are still playing — matchOver must mirror the
  // server's real isMatchOver() (every team down), not just this one.
  const matchOver = teams.every((t) => t.eliminated);

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
        {!matchOver && (
          <div className={styles.boardArea}>
            <SequenceBoard sequence={sequence} cursor={cursor} turnOutcome={turnOutcome} />
          </div>
        )}
        <ChatBox
          messages={matchChat}
          messageCount={matchChat.length}
          lastMessageAt={matchChat.length ? matchChat[matchChat.length - 1].sentAt : 0}
          onSend={sendChat}
          fill
        />
      </div>
      <TeamRosterPanel teams={teams} players={players} />
    </div>
  );
}
