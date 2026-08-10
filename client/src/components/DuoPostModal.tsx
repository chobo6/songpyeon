import { useState, type FormEvent } from "react";
import { postDuoListing, removeDuoListing, type DuoListingEntry, type DuoPosition } from "../game/duoBoard";
import styles from "./DuoPostModal.module.css";

const MAX_TIME_SLOT_LENGTH = 12;
const MAX_DESCRIPTION_LENGTH = 30;

const POSITION_LABEL: Record<DuoPosition, string> = {
  pig: "🐷 돼지",
  rabbit: "🐰 토끼",
  any: "🔀 상관없음",
};

export function DuoPostModal({
  existingListing,
  onClose,
  onSaved,
}: {
  existingListing: DuoListingEntry | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [position, setPosition] = useState<DuoPosition>(existingListing?.position ?? "any");
  const [timeSlot, setTimeSlot] = useState(existingListing?.timeSlot ?? "");
  const [description, setDescription] = useState(existingListing?.description ?? "");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmedTimeSlot = timeSlot.trim();
    const trimmedDescription = description.trim();
    if (!trimmedTimeSlot || !trimmedDescription) return;
    setSending(true);
    setError(null);
    try {
      await postDuoListing(position, trimmedTimeSlot, trimmedDescription);
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "등록에 실패했어요.");
    } finally {
      setSending(false);
    }
  }

  async function handleRemove() {
    setSending(true);
    setError(null);
    try {
      await removeDuoListing();
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "삭제에 실패했어요.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h2 className={styles.heading}>{existingListing ? "구인글 수정" : "구인글 작성"}</h2>

        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.positionOptions}>
            {(Object.keys(POSITION_LABEL) as DuoPosition[]).map((p) => (
              <button
                key={p}
                type="button"
                className={p === position ? `${styles.positionOption} ${styles.positionOptionSelected}` : styles.positionOption}
                onClick={() => setPosition(p)}
              >
                {POSITION_LABEL[p]}
              </button>
            ))}
          </div>
          <input
            className={styles.textInput}
            value={timeSlot}
            onChange={(e) => setTimeSlot(e.target.value)}
            placeholder="접속 시간대 (최대 12자)"
            maxLength={MAX_TIME_SLOT_LENGTH}
            autoFocus
          />
          <input
            className={styles.textInput}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="설명 (최대 30자)"
            maxLength={MAX_DESCRIPTION_LENGTH}
          />
          {error && <p className={styles.error}>{error}</p>}
          <div className={styles.formActions}>
            <button type="button" className={styles.cancelButton} onClick={onClose} disabled={sending}>
              취소
            </button>
            {existingListing && (
              <button type="button" className={styles.removeButton} onClick={handleRemove} disabled={sending}>
                삭제
              </button>
            )}
            <button
              type="submit"
              className={styles.submitButton}
              disabled={sending || !timeSlot.trim() || !description.trim()}
            >
              {existingListing ? "수정하기" : "등록하기"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
