import { useEffect, useState } from "react";
import { listRooms, type RoomListEntry } from "../colyseus";
import styles from "./RoomList.module.css";

const POLL_INTERVAL_MS = 2000;

export function RoomList({
  onCreateRoom,
  onJoinRoom,
  onExit,
}: {
  onCreateRoom: () => void;
  onJoinRoom: (roomId: string) => void;
  onExit: () => void;
}) {
  const [rooms, setRooms] = useState<RoomListEntry[]>([]);

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
      <button className={styles.createButton} onClick={onCreateRoom}>
        새 방 만들기
      </button>
      <div className={styles.list}>
        {rooms.length === 0 && <p className={styles.empty}>열려있는 방이 없어요</p>}
        {rooms.map((room) => {
          const inProgress = room.locked;
          const full = !room.locked && room.clients >= room.maxClients;
          const disabled = inProgress || full;
          return (
            <div key={room.roomId} className={styles.card}>
              <span className={styles.cardName}>
                {room.hostNickname}의 방 ({room.clients}/{room.maxClients})
              </span>
              <button
                className={styles.joinButton}
                disabled={disabled}
                onClick={() => onJoinRoom(room.roomId)}
              >
                {inProgress ? "게임 중" : full ? "가득 참" : "입장"}
              </button>
            </div>
          );
        })}
      </div>
      <button className={styles.exitButton} onClick={onExit}>
        나가기
      </button>
    </div>
  );
}
