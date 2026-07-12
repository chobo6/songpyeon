import styles from "./WinnerScreen.module.css";

export function WinnerScreen({ winnerTeamId }: { winnerTeamId: string }) {
  return (
    <div className={styles.wrap}>
      <p className={styles.trophy}>🏆</p>
      <h1>{winnerTeamId} 팀 승리!</h1>
    </div>
  );
}
