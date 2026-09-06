import { useState } from "react";
import styles from "./ModeSelect.module.css";
import { isBgmEnabled, isSfxEnabled, setBgmEnabled, setSfxEnabled } from "../game/audioSettings";

export function ModeSelect({
  onSelectOnline,
  onSelectOffline,
}: {
  onSelectOnline: () => void;
  onSelectOffline: () => void;
}) {
  const [bgmEnabled, setBgmEnabledState] = useState(isBgmEnabled);
  const [sfxEnabled, setSfxEnabledState] = useState(isSfxEnabled);

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <h1 className={styles.title}>송편 만들기</h1>
      </div>
      <div className={styles.audioToggles}>
        <button
          className={styles.audioToggle}
          aria-pressed={bgmEnabled}
          onClick={() => {
            const next = !bgmEnabled;
            setBgmEnabled(next);
            setBgmEnabledState(next);
          }}
        >
          BGM {bgmEnabled ? "켜짐" : "꺼짐"}
        </button>
        <button
          className={styles.audioToggle}
          aria-pressed={sfxEnabled}
          onClick={() => {
            const next = !sfxEnabled;
            setSfxEnabled(next);
            setSfxEnabledState(next);
          }}
        >
          효과음 {sfxEnabled ? "켜짐" : "꺼짐"}
        </button>
      </div>
      <div className={styles.choices}>
        <button className={styles.modeButton} onClick={onSelectOnline}>
          온라인
        </button>
        <button className={`${styles.modeButton} ${styles.offline}`} onClick={onSelectOffline}>
          혼자 연습
        </button>
        <a
          className={`${styles.modeButton} ${styles.yutnori}`}
          href="https://43-201-71-99.nip.io/"
          target="_blank"
          rel="noopener noreferrer"
        >
          윷놀이
        </a>
      </div>
    </div>
  );
}
