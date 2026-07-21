import { useEffect, useState } from "react";
import styles from "./AdminPressMonitor.module.css";

const MAX_LOG_ENTRIES = 200;

type PressEvent = {
  color: string;
  sinceLastPressMs: number | null;
  blocked: boolean;
  timestamp: number;
};

type LogEntry = PressEvent & { id: number };

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString("ko-KR", { hour12: false });
}

export function AdminPressMonitor({
  userId,
  nickname,
  onBack,
}: {
  userId: number;
  nickname: string;
  onBack: () => void;
}) {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let nextId = 0;
    const source = new EventSource(`/api/admin/monitor/${userId}/stream`);

    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.onmessage = (e) => {
      const event = JSON.parse(e.data) as PressEvent;
      nextId += 1;
      setEntries((prev) => [{ ...event, id: nextId }, ...prev].slice(0, MAX_LOG_ENTRIES));
    };

    return () => source.close();
  }, [userId]);

  return (
    <main className={styles.wrap}>
      <div className={styles.header}>
        <button className={styles.backButton} onClick={onBack}>
          ← 유저 목록으로
        </button>
        <h1 className={styles.heading}>{nickname}님 입력 모니터링</h1>
        <span className={connected ? styles.statusOn : styles.statusOff}>
          {connected ? "연결됨" : "연결 대기/끊김"}
        </span>
      </div>
      <p className={styles.hint}>이 유저가 온라인 매치에서 버튼을 누를 때마다 실시간으로 아래에 쌓입니다. 매치에 없으면 아무것도 안 뜹니다.</p>
      {entries.length === 0 ? (
        <p className={styles.empty}>아직 입력이 없습니다.</p>
      ) : (
        <ul className={styles.log}>
          {entries.map((entry) => (
            <li key={entry.id} className={entry.blocked ? styles.blockedRow : undefined}>
              <span className={styles.time}>{formatTime(entry.timestamp)}</span>
              <span className={styles.color} data-color={entry.color}>
                {entry.color}
              </span>
              <span className={styles.interval}>
                {entry.sinceLastPressMs === null ? "-" : `${entry.sinceLastPressMs}ms`}
              </span>
              {entry.blocked && <span className={styles.blockedTag}>⛔ 씹힘</span>}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
