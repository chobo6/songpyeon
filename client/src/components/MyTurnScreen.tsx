import { useCallback } from "react";
import type { Room } from "colyseus.js";
import type { MatchState, PlayerState } from "../game/matchTypes";
import type { Color } from "../game/colors";
import { useSequencePressSound } from "../game/useSequencePressSound";
import { SequenceBoard } from "./SequenceBoard";
import { ButtonPanel } from "./ButtonPanel";
import { TurnOutcomeBanner } from "./TurnOutcomeBanner";
import { TimerBar } from "./TimerBar";
import styles from "./PlayingScreen.module.css";

// Mirrors server/src/game/mortar.ts's STARTING_MORTARS — see
// TeamRosterPanel.tsx for the same constant and reasoning.
const MAX_MORTARS = 5;

export function MyTurnScreen({
  room,
  me,
  clockOffsetMs,
}: {
  room: Room<MatchState>;
  me: PlayerState;
  clockOffsetMs: number;
}) {
  const { sequence, cursor, turnOutcome, round, turnEndsAt, teams } = room.state;
  const myTeam = teams.find((team) => team.id === me.teamId);
  const disabled = turnOutcome !== "pending";
  // My own presses already get instant local feedback (ButtonPanel plays on
  // press, before the server round-trip) — this is for hearing my
  // teammate's presses, which I'd otherwise only see, never hear.
  useSequencePressSound(sequence, cursor, me.role as "pig" | "rabbit");

  // room is a stable reference for the lifetime of the connection (set once
  // by useMatchRoom, never reassigned) — memoized so ButtonPanel's own
  // React.memo isn't defeated by a fresh onPress function every render.
  const press = useCallback(
    (color: Color) => {
      room.send("pressButton", { color });
    },
    [room],
  );

  return (
    <div className={styles.wrap}>
      <div className={styles.content}>
        <p className={styles.round}>ROUND {round}</p>
        {myTeam && (
          <div className={styles.myMortars}>
            {Array.from({ length: MAX_MORTARS }, (_, i) => (
              <img
                key={i}
                className={styles.myMortarHeart}
                alt=""
                src={
                  i < myTeam.mortars
                    ? "/game-assets/ui/thanksgiving_room_heart.png"
                    : "/game-assets/ui/thanksgiving_room_heart_off.png"
                }
              />
            ))}
          </div>
        )}
        <TimerBar turnEndsAt={turnEndsAt} clockOffsetMs={clockOffsetMs} />
        <p className={styles.myTurn}>내 차례! ({me.role === "pig" ? "돼지" : "토끼"})</p>
        <div className={styles.boardArea}>
          <SequenceBoard sequence={sequence} cursor={cursor} turnOutcome={turnOutcome} />
          <TurnOutcomeBanner outcome={turnOutcome} />
        </div>
      </div>
      <ButtonPanel role={me.role as "pig" | "rabbit"} disabled={disabled} onPress={press} />
    </div>
  );
}
