import styles from "./WelcomeModal.module.css";

// 여기에 원하는 안내 문구를 자유롭게 작성하세요. 줄바꿈은 그대로 화면에 반영됩니다.
const WELCOME_MESSAGE = `렉걸리면 카톡에서 링크 복붙하고 실행 + 에어팟끼고 해보세요.`;

export function WelcomeModal({ onClose }: { onClose: () => void }) {
  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <p className={styles.body}>{WELCOME_MESSAGE}</p>
        <button className={styles.closeButton} onClick={onClose}>
          닫기
        </button>
      </div>
    </div>
  );
}
