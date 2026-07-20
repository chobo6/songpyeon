import { useEffect, useState } from "react";
import { listRooms, type RoomListEntry } from "../colyseus";
import { CreateRoomModal } from "./CreateRoomModal";
import { RankingModal } from "./RankingModal";
import styles from "./RoomList.module.css";

const POLL_INTERVAL_MS = 2000;

export function RoomList({
  onCreateRoom,
  onJoinRoom,
  onExit,
}: {
  onCreateRoom: (title: string, teamCount: number, allowSpectators: boolean) => void;
  onJoinRoom: (roomId: string) => void;
  onExit: () => void;
}) {
  const [rooms, setRooms] = useState<RoomListEntry[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showRankingModal, setShowRankingModal] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      try {
        const list = await listRooms();
        if (!cancelled) setRooms(list);
      } catch (err) {
        console.error("failed to list rooms", err);
      }
    }

    refresh();
    const interval = setInterval(refresh, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <div className={styles.wrap}>
      <h1 className={styles.title}>송편 만들기</h1>
      <div className={styles.topButtons}>
        <button className={styles.createButton} onClick={() => setShowCreateModal(true)}>
          방 만들기
        </button>
        <button className={styles.rankingButton} onClick={() => setShowRankingModal(true)}>
          랭킹
        </button>
      </div>
      <div className={styles.list}>
        {rooms.length === 0 && <p className={styles.empty}>열려있는 방이 없어요</p>}
        {rooms.map((room) => {
          // `locked` is the only reliable "can't join" signal here — Colyseus
          // flips it to true the same instant a room's live client count
          // reaches maxClients (see MatchRoom.ts's onLeave/lock() comments),
          // so a separate "room.clients >= room.maxClients" check can never
          // be true when `locked` isn't already true too. This listing can
          // still be stale in the other direction (a role slot held by a
          // reconnection-grace session doesn't count toward `clients`, so a
          // room can look joinable here for a couple seconds after it's
          // actually full) — that residual race is handled by
          // ConnectedOnlineFlow's error screen, not predicted here.
          return (
            <div key={room.roomId} className={styles.card}>
              <span className={styles.cardName}>
                {room.roomTitle} ({room.clients}/{room.maxClients})
              </span>
              <button
                className={styles.joinButton}
                disabled={room.locked && !room.allowSpectators}
                onClick={() => onJoinRoom(room.roomId)}
              >
                {room.locked ? (room.allowSpectators ? "관전하기" : "게임 중") : "입장"}
              </button>
            </div>
          );
        })}
      </div>
      <button className={styles.exitButton} onClick={onExit}>
        나가기
      </button>
      {showCreateModal && (
        <CreateRoomModal
          onClose={() => setShowCreateModal(false)}
          onCreate={(title, teamCount, allowSpectators) => {
            setShowCreateModal(false);
            onCreateRoom(title, teamCount, allowSpectators);
          }}
        />
      )}
      {showRankingModal && <RankingModal onClose={() => setShowRankingModal(false)} />}
    </div>
  );
}
