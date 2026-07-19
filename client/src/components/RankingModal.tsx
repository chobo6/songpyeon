import { useEffect, useState } from "react";
import { getRanking, type RankingEntry } from "../colyseus";
import styles from "./RankingModal.module.css";

export function RankingModal({ onClose }: { onClose: () => void }) {
  const [ranking, setRanking] = useState<RankingEntry[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getRanking()
      .then((data) => {
        if (!cancelled) setRanking(data);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h2 className={styles.heading}>라운드 랭킹 TOP 10</h2>
        {error && <p className={styles.error}>랭킹을 불러오지 못했어요</p>}
        {!error && ranking === null && <p className={styles.loading}>불러오는 중...</p>}
        {!error && ranking?.length === 0 && <p className={styles.empty}>아직 기록이 없어요</p>}
        {!error && ranking && ranking.length > 0 && (
          <ol className={styles.list}>
            {ranking.map((entry, i) => (
              <li key={entry.nickname} className={i === 0 ? `${styles.row} ${styles.first}` : styles.row}>
                <span className={styles.rank}>{i + 1}</span>
                <span className={styles.nickname}>{entry.nickname}</span>
                <span className={styles.round}>{entry.maxRound}라운드</span>
              </li>
            ))}
          </ol>
        )}
        <button className={styles.closeButton} onClick={onClose}>
          닫기
        </button>
      </div>
    </div>
  );
}
