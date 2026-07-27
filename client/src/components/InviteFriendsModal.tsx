import { useEffect, useState } from "react";
import { getFriends, type FriendEntry } from "../game/friends";
import { sendInvite } from "../game/invites";
import styles from "./InviteFriendsModal.module.css";

export function InviteFriendsModal({ roomId, onClose }: { roomId: string; onClose: () => void }) {
  const [friends, setFriends] = useState<FriendEntry[] | null>(null);
  const [sentTo, setSentTo] = useState<Set<number>>(new Set());
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    getFriends()
      .then(setFriends)
      .catch(() => setFriends([]));
  }, []);

  const invitable = (friends ?? []).filter((f) => f.online && f.roomId === null);

  async function handleInvite(friend: FriendEntry) {
    setMessage(null);
    try {
      await sendInvite(friend.userId, roomId);
      setSentTo((prev) => new Set(prev).add(friend.userId));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "초대에 실패했어요.");
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h2 className={styles.heading}>친구 초대하기</h2>
        {message && <p className={styles.message}>{message}</p>}
        {friends === null && <p className={styles.loading}>불러오는 중...</p>}
        {friends !== null && invitable.length === 0 && <p className={styles.empty}>초대할 수 있는 친구가 없어요</p>}
        {invitable.map((f) => (
          <div key={f.friendshipId} className={styles.row}>
            <span className={styles.rowNickname}>{f.nickname}</span>
            <button className={styles.inviteButton} onClick={() => handleInvite(f)} disabled={sentTo.has(f.userId)}>
              {sentTo.has(f.userId) ? "보냄" : "초대"}
            </button>
          </div>
        ))}
        <button className={styles.closeButton} onClick={onClose}>
          닫기
        </button>
      </div>
    </div>
  );
}
