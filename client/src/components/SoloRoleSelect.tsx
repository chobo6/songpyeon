import type { Role } from "../game/colors";
import styles from "./SoloRoleSelect.module.css";

export function SoloRoleSelect({
  onChoose,
  onBack,
}: {
  onChoose: (role: Role) => void;
  onBack: () => void;
}) {
  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <h1 className={styles.title}>혼자 연습</h1>
      </div>
      <div className={styles.choices}>
        <button className={`${styles.roleButton} ${styles.pigButton}`} onClick={() => onChoose("pig")}>
          <img
            className={styles.roleIcon}
            src="/game-assets/ui/thanksgiving_room_start_player_pig.png"
            alt=""
          />
          <span>돼지</span>
        </button>
        <button className={`${styles.roleButton} ${styles.rabbitButton}`} onClick={() => onChoose("rabbit")}>
          <img
            className={styles.roleIcon}
            src="/game-assets/ui/thanksgiving_room_start_player_rabbit.png"
            alt=""
          />
          <span>토끼</span>
        </button>
      </div>
      <button className={styles.backLink} onClick={onBack}>
        ← 뒤로
      </button>
    </div>
  );
}
