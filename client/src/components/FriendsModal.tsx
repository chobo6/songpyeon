import { useEffect, useState } from "react";
import {
  acceptFriendRequest,
  cancelFriendRequest,
  declineFriendRequest,
  getFriends,
  getReceivedRequests,
  getSentRequests,
  removeFriend,
  sendFriendRequest,
  type FriendEntry,
  type ReceivedRequestEntry,
  type SentRequestEntry,
} from "../game/friends";
import { formatLastSeen } from "../game/formatLastSeen";
import { nicknameStyle } from "../game/nicknameStyle";
import { DirectChatModal } from "./DirectChatModal";
import { ProfileModal } from "./ProfileModal";
import styles from "./FriendsModal.module.css";

export function FriendsModal({ onClose, onJoinRoom }: { onClose: () => void; onJoinRoom: (roomId: string) => void }) {
  const [friends, setFriends] = useState<FriendEntry[] | null>(null);
  const [received, setReceived] = useState<ReceivedRequestEntry[] | null>(null);
  const [sent, setSent] = useState<SentRequestEntry[] | null>(null);
  const [nickname, setNickname] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [view, setView] = useState<"friends" | "requests">("friends");
  const unreadMessageCount = friends?.reduce((sum, f) => sum + f.unreadCount, 0) ?? 0;
  const [chatWith, setChatWith] = useState<{ userId: number; nickname: string } | null>(null);
  const [profileNickname, setProfileNickname] = useState<string | null>(null);

  function refreshAll() {
    getFriends()
      .then(setFriends)
      .catch(() => setFriends([]));
    getReceivedRequests()
      .then(setReceived)
      .catch(() => setReceived([]));
    getSentRequests()
      .then(setSent)
      .catch(() => setSent([]));
  }

  useEffect(() => {
    refreshAll();
  }, []);

  async function handleSendRequest() {
    const trimmed = nickname.trim();
    if (!trimmed) return;
    setMessage(null);
    try {
      const { result } = await sendFriendRequest(trimmed);
      setMessage(result === "auto_accepted" ? "서로 요청이 있어서 바로 친구가 됐어요!" : "요청을 보냈어요.");
      setNickname("");
      refreshAll();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "요청에 실패했어요.");
    }
  }

  async function handleAccept(requestId: number) {
    try {
      await acceptFriendRequest(requestId);
      refreshAll();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "수락에 실패했어요.");
      refreshAll();
    }
  }

  async function handleDecline(requestId: number) {
    try {
      await declineFriendRequest(requestId);
      refreshAll();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "거절에 실패했어요.");
      refreshAll();
    }
  }

  async function handleCancel(requestId: number) {
    try {
      await cancelFriendRequest(requestId);
      refreshAll();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "취소에 실패했어요.");
      refreshAll();
    }
  }

  async function handleRemove(friendshipId: number) {
    try {
      await removeFriend(friendshipId);
      refreshAll();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "삭제에 실패했어요.");
      refreshAll();
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h2 className={styles.heading}>친구</h2>

        <div className={styles.requestForm}>
          <input
            className={styles.nicknameInput}
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="닉네임으로 친구 요청"
          />
          <button className={styles.sendButton} onClick={handleSendRequest} disabled={!nickname.trim()}>
            요청 보내기
          </button>
        </div>
        {message && <p className={styles.message}>{message}</p>}

        <button className={styles.viewToggle} onClick={() => setView(view === "friends" ? "requests" : "friends")}>
          {view === "friends" ? (
            <>
              요청 목록
              {received !== null && received.length > 0 && <span className={styles.toggleBadge}>{received.length}</span>}
            </>
          ) : (
            <>
              친구 목록
              {unreadMessageCount > 0 && <span className={styles.toggleBadge}>{unreadMessageCount}</span>}
            </>
          )}
        </button>

        {view === "requests" && (
          <>
            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>받은 요청</h3>
              {received === null && <p className={styles.loading}>불러오는 중...</p>}
              {received?.length === 0 && <p className={styles.empty}>받은 요청이 없어요</p>}
              {received?.map((r) => {
                const effect = nicknameStyle(r.fromNicknameColor, r.fromNicknameEffect, r.fromNicknameGlow, r.fromNicknameParticle);
                return (
                  <div key={r.requestId} className={styles.row}>
                    <button className={styles.rowNickname} onClick={() => setProfileNickname(r.fromNickname)}>
                      <span className={effect.className} style={effect.style}>
                        {r.fromNickname}
                        {effect.particles.map((p) => (
                          <span key={p.key} className={p.className} style={p.style} />
                        ))}
                      </span>
                    </button>
                    <div className={styles.rowActions}>
                      <button className={styles.acceptButton} onClick={() => handleAccept(r.requestId)}>
                        수락
                      </button>
                      <button className={styles.declineButton} onClick={() => handleDecline(r.requestId)}>
                        거절
                      </button>
                    </div>
                  </div>
                );
              })}
            </section>

            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>보낸 요청</h3>
              {sent === null && <p className={styles.loading}>불러오는 중...</p>}
              {sent?.length === 0 && <p className={styles.empty}>보낸 요청이 없어요</p>}
              {sent?.map((r) => {
                const effect = nicknameStyle(r.toNicknameColor, r.toNicknameEffect, r.toNicknameGlow, r.toNicknameParticle);
                return (
                  <div key={r.requestId} className={styles.row}>
                    <button className={styles.rowNickname} onClick={() => setProfileNickname(r.toNickname)}>
                      <span className={effect.className} style={effect.style}>
                        {r.toNickname}
                        {effect.particles.map((p) => (
                          <span key={p.key} className={p.className} style={p.style} />
                        ))}
                      </span>
                    </button>
                    <button className={styles.cancelButton} onClick={() => handleCancel(r.requestId)}>
                      취소
                    </button>
                  </div>
                );
              })}
            </section>
          </>
        )}

        {view === "friends" && (
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>친구 목록</h3>
            {friends === null && <p className={styles.loading}>불러오는 중...</p>}
            {friends?.length === 0 && <p className={styles.empty}>아직 친구가 없어요</p>}
            {friends?.map((f) => {
              const effect = nicknameStyle(f.nicknameColor, f.nicknameEffect, f.nicknameGlow, f.nicknameParticle);
              return (
                <div key={f.friendshipId} className={`${styles.row} ${styles.friendRow}`}>
                  <div className={styles.friendRowTop}>
                    <button className={styles.rowNickname} onClick={() => setProfileNickname(f.nickname)}>
                      <span className={effect.className} style={effect.style}>
                        {f.nickname}
                        {effect.particles.map((p) => (
                          <span key={p.key} className={p.className} style={p.style} />
                        ))}
                      </span>
                    </button>
                    <span className={styles.status}>{f.online ? "🟢 온라인" : formatLastSeen(f.lastLoginAt)}</span>
                  </div>
                  <div className={styles.friendRowButtons}>
                    <button
                      className={styles.chatButton}
                      onClick={() => setChatWith({ userId: f.userId, nickname: f.nickname })}
                    >
                      채팅
                      {f.unreadCount > 0 && <span className={styles.unreadBadge}>{f.unreadCount}</span>}
                    </button>
                    {f.online && f.roomId && (
                      <button className={styles.followButton} onClick={() => onJoinRoom(f.roomId!)}>
                        따라가기
                      </button>
                    )}
                    <button className={styles.removeButton} onClick={() => handleRemove(f.friendshipId)}>
                      삭제
                    </button>
                  </div>
                </div>
              );
            })}
          </section>
        )}

        {chatWith && (
          <DirectChatModal
            friendUserId={chatWith.userId}
            friendNickname={chatWith.nickname}
            onClose={() => {
              setChatWith(null);
              refreshAll();
            }}
          />
        )}
        {profileNickname && (
          <ProfileModal
            nickname={profileNickname}
            onClose={() => {
              setProfileNickname(null);
              refreshAll();
            }}
          />
        )}

        <button className={styles.closeButton} onClick={onClose}>
          닫기
        </button>
      </div>
    </div>
  );
}
