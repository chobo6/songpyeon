import type { Room } from "colyseus.js";
import type { MatchState, PlayerState } from "../game/matchTypes";
import type { Color } from "../game/colors";
import { useSequencePressSound } from "../game/useSequencePressSound";
import { SequenceBoard } from "./SequenceBoard";
import { ButtonPanel } from "./ButtonPanel";
import { TurnOutcomeBanner } from "./TurnOutcomeBanner";
import { TimerBar } from "./TimerBar";
import styles from "./PlayingScreen.module.css";

export function MyTurnScreen({
  room,
  me,
  clockOffsetMs,
}: {
  room: Room<MatchState>;
  me: PlayerState;
  clockOffsetMs: number;
}) {
  const { sequence, cursor, turnOutcome, round, turnEndsAt } = room.state;
  const disabled = turnOutcome !== "pending";
  // My own presses already get instant local feedback (ButtonPanel plays on
  // press, before the server round-trip) — this is for hearing my
  // teammate's presses, which I'd otherwise only see, never hear.
  useSequencePressSound(sequence, cursor, me.role as "pig" | "rabbit");

  function press(color: Color) {
    room.send("pressButton", { color });
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.content}>
        <p className={styles.round}>ROUND {round}</p>
        <TimerBar turnEndsAt={turnEndsAt} clockOffsetMs={clockOffsetMs} />
        <p className={styles.myTurn}>내 차례! ({me.role === "pig" ? "돼지" : "토끼"})</p>
        <div className={styles.boardArea}>
          <SequenceBoard sequence={sequence} cursor={cursor} />
          <TurnOutcomeBanner outcome={turnOutcome} />
        </div>
      </div>
      <ButtonPanel role={me.role as "pig" | "rabbit"} disabled={disabled} onPress={press} />
    </div>
  );
}
