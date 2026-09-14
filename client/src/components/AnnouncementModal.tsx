import styles from "./AnnouncementModal.module.css";

// 관리자페이지의 "전체 공지"(admin/announcements.ts)는 그 순간 게임 중인
// 플레이어에게만 짧게 뜨는 실시간 배너 — 이 모달은 그것과 별개로, 유저가 언제든
// 우편 버튼을 눌러 확인할 수 있는 고정 공지. 내용을 바꾸려면 이 문자열만 수정.
const NOTICE_MESSAGE = "본 사이트 송편이벤트 업데이트 당일까지만 운영.\n게임 즐겨준 모든 친구들 고맙";

export function AnnouncementModal({ onClose }: { onClose: () => void }) {
  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h2 className={styles.heading}>공지</h2>
        <p className={styles.message}>{NOTICE_MESSAGE}</p>
        <button className={styles.closeButton} onClick={onClose}>
          닫기
        </button>
      </div>
    </div>
  );
}
