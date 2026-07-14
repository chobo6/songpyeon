import styles from "./ModeSelect.module.css";

export function ModeSelect({
  onSelectOnline,
  onSelectOffline,
}: {
  onSelectOnline: () => void;
  onSelectOffline: () => void;
}) {
  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <h1 className={styles.title}>송편 만들기</h1>
      </div>
      <div className={styles.choices}>
        <button className={styles.modeButton} onClick={onSelectOnline}>
          온라인
        </button>
        <button className={`${styles.modeButton} ${styles.offline}`} onClick={onSelectOffline}>
          혼자 연습
        </button>
      </div>
    </div>
  );
}
