import { useEffect, useState, type FormEvent } from "react";
import styles from "./AdminDashboard.module.css";

type RoomInfo = {
  roomId: string;
  clients: number;
  maxClients: number;
  locked: boolean;
  hostNickname: string;
  players: { sessionId: string; nickname: string }[];
};

type AdminEvent = {
  type: "join" | "leave";
  timestamp: number;
  nickname: string;
  roomId: string;
  ip: string;
  sessionId: string;
};

const POLL_INTERVAL_MS = 4000;

async function fetchAdminJson<T>(
  url: string,
): Promise<{ ok: true; data: T } | { ok: false; unauthorized: boolean }> {
  try {
    const res = await fetch(url, { credentials: "same-origin" });
    if (!res.ok) {
      return { ok: false, unauthorized: res.status === 401 };
    }
    return { ok: true, data: (await res.json()) as T };
  } catch {
    return { ok: false, unauthorized: false };
  }
}

export function AdminDashboard({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [announceError, setAnnounceError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      const [roomsResult, eventsResult] = await Promise.all([
        fetchAdminJson<RoomInfo[]>("/api/admin/rooms"),
        fetchAdminJson<AdminEvent[]>("/api/admin/events"),
      ]);
      if (cancelled) return;

      if (!roomsResult.ok || !eventsResult.ok) {
        if (!roomsResult.ok && roomsResult.unauthorized) onUnauthorized();
        if (!eventsResult.ok && eventsResult.unauthorized) onUnauthorized();
        return;
      }

      setRooms(roomsResult.data);
      setEvents(eventsResult.data);
    }

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [onUnauthorized]);

  async function handleAnnounce(e: FormEvent) {
    e.preventDefault();
    if (!message.trim()) return;
    setSending(true);
    setAnnounceError(null);
    try {
      const res = await fetch("/api/admin/announce", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ message }),
      });
      if (!res.ok) {
        if (res.status === 401) {
          onUnauthorized();
          return;
        }
        setAnnounceError("공지 전송에 실패했습니다");
        return;
      }
      setMessage("");
    } catch {
      setAnnounceError("공지 전송에 실패했습니다");
    } finally {
      setSending(false);
    }
  }

  return (
    <main className={styles.wrap}>
      <h1>관리자 대시보드</h1>

      <form onSubmit={handleAnnounce} className={styles.announceForm}>
        <input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="전체 공지 문구"
        />
        <button type="submit" disabled={sending || !message.trim()}>
          공지 보내기
        </button>
      </form>
      {announceError && <p className={styles.error}>{announceError}</p>}

      <section>
        <h2>활성 방 ({rooms.length})</h2>
        <ul className={styles.roomList}>
          {rooms.map((room) => (
            <li key={room.roomId}>
              <strong>{room.hostNickname}</strong> — {room.clients}/{room.maxClients}
              {room.locked ? " (진행 중)" : " (대기 중)"}
              <div className={styles.playerNames}>
                {room.players.map((p) => p.nickname).join(", ") || "(없음)"}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>최근 입장/퇴장</h2>
        <table className={styles.eventTable}>
          <thead>
            <tr>
              <th>시각</th>
              <th>종류</th>
              <th>닉네임</th>
              <th>방</th>
              <th>IP</th>
            </tr>
          </thead>
          <tbody>
            {[...events].reverse().map((event) => (
              <tr key={`${event.sessionId}-${event.timestamp}-${event.type}`}>
                <td>{new Date(event.timestamp).toLocaleTimeString()}</td>
                <td>{event.type === "join" ? "입장" : "퇴장"}</td>
                <td>{event.nickname}</td>
                <td>{event.roomId}</td>
                <td>{event.ip}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
