import { useState } from "react";
import type { Room } from "colyseus.js";
import type { MatchState } from "../game/matchTypes";
import { nicknameStyle } from "../game/nicknameStyle";
import { ProfileModal } from "./ProfileModal";
import styles from "./SpectatorCountBadge.module.css";

export function SpectatorCountBadge({ room }: { room: Room<MatchState> }) {
  const [showModal, setShowModal] = useState(false);
  const [profileNickname, setProfileNickname] = useState<string | null>(null);
  const spectators = [...room.state.spectators.values()];

  return (
    <>
      <button className={styles.badge} onClick={() => setShowModal(true)}>
        👁 {spectators.length}
      </button>
      {showModal && (
        <div className={styles.overlay} onClick={() => setShowModal(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 className={styles.heading}>관전자 ({spectators.length}명)</h2>
            {spectators.length === 0 ? (
              <p className={styles.empty}>아직 관전자가 없어요</p>
            ) : (
              <ul className={styles.list}>
                {spectators.map((s) => {
                  const effect = nicknameStyle(s.nicknameColor, s.nicknameEffect, s.nicknameGlow);
                  return (
                    <li key={s.sessionId}>
                      <button className={styles.row} onClick={() => setProfileNickname(s.nickname)}>
                        <span className={effect.className} style={effect.style}>
                          {s.nickname}
                          {effect.particles.map((p) => (
                            <span key={p.key} className={p.className} style={p.style} />
                          ))}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <button className={styles.closeButton} onClick={() => setShowModal(false)}>
              닫기
            </button>
          </div>
        </div>
      )}
      {profileNickname && <ProfileModal nickname={profileNickname} onClose={() => setProfileNickname(null)} />}
    </>
  );
}
