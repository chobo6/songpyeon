import { useEffect, useState, type FormEvent } from "react";
import styles from "./AdminDashboard.module.css";

type RoomInfo = {
  roomId: string;
  roomTitle: string;
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
  roomTitle: string;
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

export function AdminDashboard({
  onUnauthorized,
  onOpenUsers,
  onOpenKeyTest,
  onOpenInquiries,
}: {
  onUnauthorized: () => void;
  onOpenUsers: () => void;
  onOpenKeyTest: () => void;
  onOpenInquiries: () => void;
}) {
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [onlineNicknames, setOnlineNicknames] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [announceError, setAnnounceError] = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState("");
  const [searchResults, setSearchResults] = useState<AdminEvent[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      const [roomsResult, eventsResult, onlineResult] = await Promise.all([
        fetchAdminJson<RoomInfo[]>("/api/admin/rooms"),
        fetchAdminJson<AdminEvent[]>("/api/admin/events"),
        fetchAdminJson<string[]>("/api/admin/online"),
      ]);
      if (cancelled) return;

      if (!roomsResult.ok || !eventsResult.ok || !onlineResult.ok) {
        if (!roomsResult.ok && roomsResult.unauthorized) onUnauthorized();
        if (!eventsResult.ok && eventsResult.unauthorized) onUnauthorized();
        if (!onlineResult.ok && onlineResult.unauthorized) onUnauthorized();
        return;
      }

      setRooms(roomsResult.data);
      setEvents(eventsResult.data);
      setOnlineNicknames(onlineResult.data);
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

  async function handleEventSearch(e: FormEvent) {
    e.preventDefault();
    const nickname = searchInput.trim();
    if (!nickname) return;
    setSearching(true);
    setSearchError(null);
    try {
      const res = await fetch(`/api/admin/events/search?nickname=${encodeURIComponent(nickname)}`, {
        credentials: "same-origin",
      });
      if (!res.ok) {
        if (res.status === 401) {
          onUnauthorized();
          return;
        }
        setSearchError("검색에 실패했습니다");
        return;
      }
      setSearchResults((await res.json()) as AdminEvent[]);
    } catch {
      setSearchError("검색에 실패했습니다");
    } finally {
      setSearching(false);
    }
  }

  function clearEventSearch() {
    setSearchInput("");
    setSearchResults(null);
    setSearchError(null);
  }

  return (
    <main className={styles.wrap}>
      <div className={styles.topRow}>
        <h1>관리자 대시보드</h1>
        <div className={styles.topRowButtons}>
          <button className={styles.usersButton} onClick={onOpenUsers}>
            유저 정보
          </button>
          <button className={styles.usersButton} onClick={onOpenInquiries}>
            문의 내역
          </button>
          <button className={styles.usersButton} onClick={onOpenKeyTest}>
            입력속도 테스트 (임시)
          </button>
        </div>
      </div>

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
        <h2>현재 접속자 ({onlineNicknames.length})</h2>
        <div className={styles.onlineList}>
          {onlineNicknames.length > 0
            ? onlineNicknames.map((nickname) => (
                <span key={nickname} className={styles.onlineName}>
                  {nickname}
                </span>
              ))
            : "(없음)"}
        </div>
      </section>

      <section>
        <h2>활성 방 ({rooms.length})</h2>
        <ul className={styles.roomList}>
          {rooms.map((room) => (
            <li key={room.roomId}>
              <strong>{room.roomTitle}</strong> — {room.clients}/{room.maxClients}
              {room.locked ? " (진행 중)" : " (대기 중)"}
              <div className={styles.hostLine}>{room.hostNickname}님의 방</div>
              <div className={styles.playerNames}>
                {room.players.map((p) => p.nickname).join(", ") || "(없음)"}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>최근 입장/퇴장 (최대 100개)</h2>
        <div className={styles.eventTableScroll}>
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
                  <td>{event.roomTitle}</td>
                  <td>{event.ip}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2>닉네임으로 접속 기록 검색</h2>
        <p className={styles.searchHint}>위 "최근 입장/퇴장"보다 오래된 기록도 찾을 수 있어요 (최대 90일 전까지).</p>
        <form onSubmit={handleEventSearch} className={styles.announceForm}>
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="닉네임 (일부만 입력해도 검색됨)"
          />
          <button type="submit" disabled={searching || !searchInput.trim()}>
            검색
          </button>
          {searchResults !== null && (
            <button type="button" onClick={clearEventSearch}>
              지우기
            </button>
          )}
        </form>
        {searchError && <p className={styles.error}>{searchError}</p>}
        {searchResults !== null && (
          <div className={styles.eventTableScroll}>
            {searchResults.length === 0 ? (
              <p className={styles.searchHint}>일치하는 기록이 없어요.</p>
            ) : (
              <table className={styles.eventTable}>
                <thead>
                  <tr>
                    <th>일시</th>
                    <th>종류</th>
                    <th>닉네임</th>
                    <th>방</th>
                    <th>IP</th>
                  </tr>
                </thead>
                <tbody>
                  {searchResults.map((event) => (
                    <tr key={`${event.sessionId}-${event.timestamp}-${event.type}`}>
                      <td>{new Date(event.timestamp).toLocaleString()}</td>
                      <td>{event.type === "join" ? "입장" : "퇴장"}</td>
                      <td>{event.nickname}</td>
                      <td>{event.roomTitle}</td>
                      <td>{event.ip}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
