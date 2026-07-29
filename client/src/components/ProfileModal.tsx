import { useEffect, useState } from "react";
import { getProfile, rerollNicknameColor, type PublicProfile } from "../game/profile";
import { removeFriend, sendFriendRequest } from "../game/friends";
import { nicknameStyle } from "../game/nicknameStyle";
import styles from "./ProfileModal.module.css";

export function ProfileModal({
  nickname,
  onClose,
  onSelfColorChanged,
}: {
  nickname: string;
  onClose: () => void;
  onSelfColorChanged?: () => void;
}) {
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const effect = profile
    ? nicknameStyle(profile.nicknameColor, profile.nicknameRainbow, profile.nicknameGlow)
    : { className: "", style: {} };

  useEffect(() => {
    getProfile(nickname)
      .then(setProfile)
      .catch((err) => setError(err instanceof Error ? err.message : "프로필을 불러오지 못했어요."));
  }, [nickname]);

  async function handleSendRequest() {
    if (!profile) return;
    setBusy(true);
    setMessage(null);
    try {
      const { result } = await sendFriendRequest(profile.nickname);
      setMessage(result === "auto_accepted" ? "서로 요청이 있어서 바로 친구가 됐어요!" : "요청을 보냈어요.");
      const refreshed = await getProfile(nickname);
      setProfile(refreshed);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "요청에 실패했어요.");
      getProfile(nickname).then(setProfile).catch(() => {});
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveFriend() {
    if (!profile?.friendshipId) return;
    setBusy(true);
    setMessage(null);
    try {
      await removeFriend(profile.friendshipId);
      const refreshed = await getProfile(nickname);
      setProfile(refreshed);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "삭제에 실패했어요.");
      getProfile(nickname).then(setProfile).catch(() => {});
    } finally {
      setBusy(false);
    }
  }

  async function handleReroll() {
    setBusy(true);
    setMessage(null);
    try {
      const { nicknameColor } = await rerollNicknameColor();
      setProfile((prev) => (prev ? { ...prev, nicknameColor } : prev));
      onSelfColorChanged?.();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "닉색 변경에 실패했어요.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        {error && <p className={styles.error}>{error}</p>}
        {!error && !profile && <p className={styles.loading}>불러오는 중...</p>}
        {profile && (
          <>
            <h2 className={`${styles.heading} ${effect.className}`} style={effect.style}>
              {profile.nickname}
            </h2>
            <div className={styles.stats}>
              <span className={styles.stat}>
                🐷 {profile.pigPlayCount}판 🐰 {profile.rabbitPlayCount}판
              </span>
              <span className={styles.stat}>최고 {profile.maxRound}라운드</span>
            </div>
            {message && <p className={styles.message}>{message}</p>}
            {profile.friendshipStatus === "self" && (
              <button className={styles.actionButton} onClick={handleReroll} disabled={busy}>
                닉색 변경 (10,000원)
              </button>
            )}
            {profile.friendshipStatus === "none" && (
              <button className={styles.actionButton} onClick={handleSendRequest} disabled={busy}>
                친구 요청 보내기
              </button>
            )}
            {profile.friendshipStatus === "friends" && (
              <button className={styles.removeButton} onClick={handleRemoveFriend} disabled={busy}>
                친구 삭제
              </button>
            )}
            {(profile.friendshipStatus === "pending_sent" || profile.friendshipStatus === "pending_received") && (
              <p className={styles.pending}>요청 대기 중</p>
            )}
          </>
        )}
        <button className={styles.closeButton} onClick={onClose}>
          닫기
        </button>
      </div>
    </div>
  );
}
