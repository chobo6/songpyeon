import type { Role } from "../game/colors";
import styles from "./SoloRoleSelect.module.css";

export function SoloRoleSelect({
  onChoose,
  onBack,
  onOpenReactionTest,
}: {
  onChoose: (role: Role) => void;
  onBack: () => void;
  onOpenReactionTest: () => void;
}) {
  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <h1 className={styles.title}>송편 만들기</h1>
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
      {/* 임시 — 키보드/터치 반응속도 차이를 직접 재보기 위한 테스트 도구 진입점.
          부정행위 감지 기능 설계용 자료 수집이 끝나면 제거할 것. */}
      <button className={styles.backLink} onClick={onOpenReactionTest}>
        반응속도 테스트 (임시)
      </button>
      <button className={styles.backLink} onClick={onBack}>
        ← 뒤로
      </button>
    </div>
  );
}
