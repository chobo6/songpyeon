import { useEffect, useState } from "react";
import { getPlayCountRanking, getRanking, type PlayCountRankingEntry, type RankingEntry } from "../colyseus";
import { nicknameStyle } from "../game/nicknameStyle";
import { ProfileModal } from "./ProfileModal";
import styles from "./RankingModal.module.css";

type Tab = "round" | "playCount";

export function RankingModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("round");
  const [ranking, setRanking] = useState<RankingEntry[] | null>(null);
  const [playCountRanking, setPlayCountRanking] = useState<PlayCountRankingEntry[] | null>(null);
  const [error, setError] = useState(false);
  const [profileNickname, setProfileNickname] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getRanking(), getPlayCountRanking()])
      .then(([roundData, playCountData]) => {
        if (cancelled) return;
        setRanking(roundData);
        setPlayCountRanking(playCountData);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loading = !error && (tab === "round" ? ranking === null : playCountRanking === null);
  const empty =
    !error && !loading && (tab === "round" ? ranking?.length === 0 : playCountRanking?.length === 0);

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h2 className={styles.heading}>랭킹 TOP 10</h2>

        <div className={styles.tabs}>
          <button
            className={tab === "round" ? `${styles.tabButton} ${styles.tabButtonSelected}` : styles.tabButton}
            onClick={() => setTab("round")}
          >
            라운드 랭킹
          </button>
          <button
            className={tab === "playCount" ? `${styles.tabButton} ${styles.tabButtonSelected}` : styles.tabButton}
            onClick={() => setTab("playCount")}
          >
            판수 랭킹
          </button>
        </div>

        {error && <p className={styles.error}>랭킹을 불러오지 못했어요</p>}
        {loading && <p className={styles.loading}>불러오는 중...</p>}
        {empty && <p className={styles.empty}>아직 기록이 없어요</p>}

        {!error && !loading && tab === "round" && ranking && ranking.length > 0 && (
          <ol className={styles.list}>
            {ranking.map((entry, i) => {
              const effect = nicknameStyle(entry.nicknameColor, entry.nicknameEffect, entry.nicknameGlow, entry.nicknameParticle);
              return (
                <li key={entry.nickname} className={i === 0 ? `${styles.row} ${styles.first}` : styles.row}>
                  <span className={styles.rank}>{i + 1}</span>
                  <button className={styles.nickname} onClick={() => setProfileNickname(entry.nickname)}>
                    <span className={effect.className} style={effect.style}>
                      {entry.nickname}
                      {effect.particles.map((p) => (
                        <span key={p.key} className={p.className} style={p.style} />
                      ))}
                    </span>
                  </button>
                  <span className={styles.round}>{entry.maxRound}라운드</span>
                </li>
              );
            })}
          </ol>
        )}

        {!error && !loading && tab === "playCount" && playCountRanking && playCountRanking.length > 0 && (
          <ol className={styles.list}>
            {playCountRanking.map((entry, i) => {
              const effect = nicknameStyle(entry.nicknameColor, entry.nicknameEffect, entry.nicknameGlow, entry.nicknameParticle);
              const total = entry.pigPlayCount + entry.rabbitPlayCount;
              return (
                <li key={entry.nickname} className={i === 0 ? `${styles.row} ${styles.first}` : styles.row}>
                  <span className={styles.rank}>{i + 1}</span>
                  <button className={styles.nickname} onClick={() => setProfileNickname(entry.nickname)}>
                    <span className={effect.className} style={effect.style}>
                      {entry.nickname}
                      {effect.particles.map((p) => (
                        <span key={p.key} className={p.className} style={p.style} />
                      ))}
                    </span>
                  </button>
                  <span className={styles.round}>{total}판</span>
                </li>
              );
            })}
          </ol>
        )}

        {profileNickname && <ProfileModal nickname={profileNickname} onClose={() => setProfileNickname(null)} />}

        <button className={styles.closeButton} onClick={onClose}>
          닫기
        </button>
      </div>
    </div>
  );
}
