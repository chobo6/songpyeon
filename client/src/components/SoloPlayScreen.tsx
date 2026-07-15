import type { Role } from "../game/colors";
import { useSoloMatch } from "../game/useSoloMatch";
import { SequenceBoard } from "./SequenceBoard";
import { ButtonPanel } from "./ButtonPanel";
import { TurnOutcomeBanner } from "./TurnOutcomeBanner";
import { TimerBar } from "./TimerBar";
import { BgmPlayer } from "./BgmPlayer";
import styles from "./PlayingScreen.module.css";

export function SoloPlayScreen({ role, onExit }: { role: Role; onExit: () => void }) {
  const { round, sequence, cursor, turnOutcome, turnEndsAt, press } = useSoloMatch(role);
  const disabled = turnOutcome !== "pending";

  return (
    <div className={styles.wrap}>
      <BgmPlayer />
      <p className={styles.round}>ROUND {round}</p>
      <TimerBar turnEndsAt={turnEndsAt} />
      <button className={styles.leaveButton} onClick={onExit}>
        나가기
      </button>
      <div className={styles.boardArea}>
        <SequenceBoard sequence={sequence} cursor={cursor} />
        <TurnOutcomeBanner outcome={turnOutcome} />
      </div>
      <ButtonPanel role={role} disabled={disabled} onPress={press} />
    </div>
  );
}
