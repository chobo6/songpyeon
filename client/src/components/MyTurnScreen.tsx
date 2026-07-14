import type { Room } from "colyseus.js";
import type { MatchState, PlayerState } from "../game/matchTypes";
import type { Color } from "../game/colors";
import { SequenceBoard } from "./SequenceBoard";
import { ButtonPanel } from "./ButtonPanel";
import { TurnOutcomeBanner } from "./TurnOutcomeBanner";
import { TimerBar } from "./TimerBar";
import styles from "./PlayingScreen.module.css";

export function MyTurnScreen({ room, me }: { room: Room<MatchState>; me: PlayerState }) {
  const { sequence, cursor, turnOutcome, round, turnEndsAt } = room.state;
  const disabled = turnOutcome !== "pending";

  function press(color: Color) {
    room.send("pressButton", { color });
  }

  return (
    <div className={styles.wrap}>
      <p className={styles.round}>ROUND {round}</p>
      <TimerBar turnEndsAt={turnEndsAt} />
      <p className={styles.myTurn}>내 차례! ({me.role === "pig" ? "돼지" : "토끼"})</p>
      <div className={styles.boardArea}>
        <SequenceBoard sequence={sequence} cursor={cursor} />
        <TurnOutcomeBanner outcome={turnOutcome} />
      </div>
      <ButtonPanel role={me.role as "pig" | "rabbit"} disabled={disabled} onPress={press} />
    </div>
  );
}
