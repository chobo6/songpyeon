import { useState } from "react";
import type { Room } from "colyseus.js";
import type { MatchState } from "../game/matchTypes";
import styles from "./SpectatorCountBadge.module.css";

export function SpectatorCountBadge({ room }: { room: Room<MatchState> }) {
  const [showModal, setShowModal] = useState(false);
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
                {spectators.map((s) => (
                  <li key={s.sessionId} className={styles.row}>
                    {s.nickname}
                  </li>
                ))}
              </ul>
            )}
            <button className={styles.closeButton} onClick={() => setShowModal(false)}>
              닫기
            </button>
          </div>
        </div>
      )}
    </>
  );
}
