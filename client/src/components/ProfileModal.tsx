import { useEffect, useState } from "react";
import { getProfile, type PublicProfile } from "../game/profile";
import { removeFriend, sendFriendRequest } from "../game/friends";
import { getShop, sendMegaphone } from "../game/shop";
import { nicknameStyle } from "../game/nicknameStyle";
import styles from "./ProfileModal.module.css";

const MAX_MEGAPHONE_LENGTH = 40;

export function ProfileModal({ nickname, onClose }: { nickname: string; onClose: () => void }) {
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [megaphonePrice, setMegaphonePrice] = useState<number | null>(null);
  const [megaphoneOpen, setMegaphoneOpen] = useState(false);
  const [megaphoneValue, setMegaphoneValue] = useState("");
  const effect = profile
    ? nicknameStyle(profile.nicknameColor, profile.nicknameEffect, profile.nicknameGlow, profile.nicknameParticle)
    : { className: "", style: {}, particles: [] };

  useEffect(() => {
    getProfile(nickname)
      .then(setProfile)
      .catch((err) => setError(err instanceof Error ? err.message : "프로필을 불러오지 못했어요."));
  }, [nickname]);

  useEffect(() => {
    if (profile?.friendshipStatus === "self") {
      getShop()
        .then((shop) => setMegaphonePrice(shop.megaphonePrice))
        .catch(() => {});
    }
  }, [profile?.friendshipStatus]);

  async function handleMegaphone() {
    const trimmed = megaphoneValue.trim();
    if (!trimmed) return;
    setBusy(true);
    setMessage(null);
    try {
      await sendMegaphone(trimmed);
      setMegaphoneOpen(false);
      setMegaphoneValue("");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "확성기 전송에 실패했어요.");
    } finally {
      setBusy(false);
    }
  }

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

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        {error && <p className={styles.error}>{error}</p>}
        {!error && !profile && <p className={styles.loading}>불러오는 중...</p>}
        {profile && (
          <>
            <h2 className={`${styles.heading} ${effect.className}`} style={effect.style}>
              {profile.nickname}
              {effect.particles.map((p) => (
                <span key={p.key} className={p.className} style={p.style} />
              ))}
            </h2>
            <div className={styles.stats}>
              <span className={styles.stat}>
                🐷 {profile.pigPlayCount}판 🐰 {profile.rabbitPlayCount}판
              </span>
              <span className={styles.stat}>최고 {profile.maxRound}라운드</span>
            </div>
            {message && <p className={styles.message}>{message}</p>}
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
            {profile.friendshipStatus === "self" &&
              (megaphoneOpen ? (
                <div className={styles.inlineForm}>
                  <input
                    className={styles.inlineInput}
                    value={megaphoneValue}
                    onChange={(e) => setMegaphoneValue(e.target.value)}
                    maxLength={MAX_MEGAPHONE_LENGTH}
                    placeholder="전체에 보낼 메시지"
                    autoFocus
                  />
                  <button
                    className={styles.actionButton}
                    disabled={busy || !megaphoneValue.trim()}
                    onClick={handleMegaphone}
                  >
                    보내기
                  </button>
                </div>
              ) : (
                <button className={styles.actionButton} onClick={() => setMegaphoneOpen(true)}>
                  📢 확성기 사용{megaphonePrice !== null ? ` (${megaphonePrice.toLocaleString("ko-KR")}원)` : ""}
                </button>
              ))}
          </>
        )}
        <button className={styles.closeButton} onClick={onClose}>
          닫기
        </button>
      </div>
    </div>
  );
}
