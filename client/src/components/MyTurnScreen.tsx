import type { Room } from "colyseus.js";
import type { MatchState, PlayerState, TeamState } from "../game/matchTypes";
import type { Color } from "../game/colors";
import { SequenceBoard } from "./SequenceBoard";
import { ButtonPanel } from "./ButtonPanel";
import { TurnOutcomeBanner } from "./TurnOutcomeBanner";
import { TeamStatusBar } from "./TeamStatusBar";
import { TimerBar } from "./TimerBar";
import styles from "./PlayingScreen.module.css";

export function MyTurnScreen({
  room,
  me,
  activeTeam,
}: {
  room: Room<MatchState>;
  me: PlayerState;
  activeTeam: TeamState;
}) {
  const { sequence, cursor, turnOutcome, round, teams, turnEndsAt } = room.state;
  const dueColor = cursor < sequence.length ? (sequence[cursor] as Color) : undefined;
  const disabled = turnOutcome !== "pending";

  function press(color: Color) {
    room.send("pressButton", { color });
  }

  return (
    <div className={styles.wrap}>
      <p className={styles.round}>ROUND {round}</p>
      <TimerBar turnEndsAt={turnEndsAt} />
      <TeamStatusBar teams={teams} activeTeamId={activeTeam.id} />
      <p className={styles.myTurn}>내 차례! ({me.role === "pig" ? "돼지" : "토끼"})</p>
      <div className={styles.boardArea}>
        <SequenceBoard sequence={sequence} cursor={cursor} />
        <TurnOutcomeBanner outcome={turnOutcome} />
      </div>
      <ButtonPanel role={me.role as "pig" | "rabbit"} dueColor={dueColor} disabled={disabled} onPress={press} />
    </div>
  );
}
