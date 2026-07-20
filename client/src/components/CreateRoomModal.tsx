import { useState, type FormEvent } from "react";
import styles from "./CreateRoomModal.module.css";

const MAX_TITLE_LENGTH = 20;
const MIN_TEAM_COUNT = 1;
const MAX_TEAM_COUNT = 4;

export function CreateRoomModal({
  onCreate,
  onClose,
}: {
  onCreate: (title: string, teamCount: number, allowSpectators: boolean) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [teamCount, setTeamCount] = useState(2);
  const [allowSpectators, setAllowSpectators] = useState(true);

  // Digits only, then clamp to the valid range — 5+ becomes 4, 0 (or an
  // emptied field) becomes 1. The field always displays an existing digit
  // (never truly empty), so without selecting it first, typing "3" appends
  // to "2" instead of replacing it (raw becomes "23", not "3") — taking
  // just the last digit typed handles that the same way a single-digit
  // field should, regardless of whether the browser happened to select the
  // old value first.
  function handleTeamCountChange(raw: string) {
    const digits = raw.replace(/\D/g, "");
    if (!digits) {
      setTeamCount(MIN_TEAM_COUNT);
      return;
    }
    const lastDigit = Number(digits[digits.length - 1]);
    setTeamCount(Math.min(MAX_TEAM_COUNT, Math.max(MIN_TEAM_COUNT, lastDigit)));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    onCreate(trimmed, teamCount, allowSpectators);
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <form className={styles.modal} onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <h2 className={styles.heading}>방 만들기</h2>
        <label className={styles.field}>
          <span>방 제목</span>
          <input
            className={styles.input}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={MAX_TITLE_LENGTH}
            placeholder="방 제목을 입력하세요"
            autoFocus
          />
        </label>
        <label className={styles.field}>
          <span>팀 수 (1~4)</span>
          <input
            className={styles.input}
            type="text"
            inputMode="numeric"
            maxLength={1}
            value={teamCount}
            onChange={(e) => handleTeamCountChange(e.target.value)}
            onFocus={(e) => e.target.select()}
          />
        </label>
        <label className={styles.checkboxField}>
          <input
            type="checkbox"
            checked={allowSpectators}
            onChange={(e) => setAllowSpectators(e.target.checked)}
          />
          <span>관전 허용</span>
        </label>
        <div className={styles.actions}>
          <button type="button" className={styles.cancelButton} onClick={onClose}>
            취소
          </button>
          <button type="submit" className={styles.submitButton} disabled={!title.trim()}>
            만들기
          </button>
        </div>
      </form>
    </div>
  );
}
