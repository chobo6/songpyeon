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

// timestamp+color+sinceLastPressMs 조합이 같으면 같은 프레스로 본다 — SSE 재연결
// 구간에서 같은 이벤트가 두 번 도착해도(네트워크 끊김/재연결 시 서버 쪽 구독자 정리가
// 살짝 늦어지는 타이밍에 발생 가능) 목록에 중복으로 안 쌓이게 하기 위함.
function fingerprint(event: PressEvent): string {
  return `${event.timestamp}:${event.color}:${event.sinceLastPressMs}`;
}

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

  // 씹힌(blocked) 입력은 가드에 막혀 온전한 반응이 아니므로 평균에서 제외 —
  // 관리자 페이지의 예전 계측 도구(AdminKeyTestTool.tsx)와 같은 기준.
  const validIntervals = entries
    .filter((e) => !e.blocked && e.sinceLastPressMs !== null)
    .map((e) => e.sinceLastPressMs as number);
  const averageMs =
    validIntervals.length > 0
      ? Math.round(validIntervals.reduce((sum, ms) => sum + ms, 0) / validIntervals.length)
      : null;

  useEffect(() => {
    let nextId = 0;
    const source = new EventSource(`/api/admin/monitor/${userId}/stream`);

    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.onmessage = (e) => {
      const event = JSON.parse(e.data) as PressEvent;
      const eventFingerprint = fingerprint(event);
      setEntries((prev) => {
        // 재연결 구간에서 같은 이벤트가 다시 도착한 경우 — 무시.
        if (prev.some((entry) => fingerprint(entry) === eventFingerprint)) return prev;
        nextId += 1;
        const next = [{ ...event, id: nextId }, ...prev];
        // 도착 순서가 아니라 이벤트 자체의 timestamp 기준으로 정렬 — 재연결 등으로
        // 이벤트가 실제 발생 순서와 다르게 도착해도 화면은 항상 시간순으로 보인다.
        // timestamp가 같으면(같은 ms) 나중에 도착한(id가 큰) 쪽을 위로.
        next.sort((a, b) => b.timestamp - a.timestamp || b.id - a.id);
        return next.slice(0, MAX_LOG_ENTRIES);
      });
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
      {averageMs !== null && (
        <p className={styles.average}>
          평균 반응 속도: {averageMs}ms (씹힘 제외 {validIntervals.length}회)
        </p>
      )}
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
