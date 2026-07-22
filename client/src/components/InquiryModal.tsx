import { useState, type FormEvent } from "react";
import styles from "./InquiryModal.module.css";

const TITLE_MAX_LENGTH = 100;
const CONTENT_MAX_LENGTH = 2000;

export function InquiryModal({ onClose }: { onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || !content.trim()) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/inquiries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ title: title.trim(), content: content.trim() }),
      });
      if (!res.ok) {
        setError("문의 전송에 실패했어요");
        return;
      }
      setSent(true);
    } catch {
      setError("문의 전송에 실패했어요");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h2 className={styles.heading}>관리자에게 문의하기</h2>
        {sent ? (
          <>
            <p className={styles.sentMessage}>문의가 전달됐어요. 별도 답장은 드리지 않아요.</p>
            <button className={styles.closeButton} onClick={onClose}>
              닫기
            </button>
          </>
        ) : (
          <form onSubmit={handleSubmit} className={styles.form}>
            <input
              className={styles.titleInput}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="제목"
              maxLength={TITLE_MAX_LENGTH}
              autoFocus
            />
            <textarea
              className={styles.contentInput}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="내용"
              maxLength={CONTENT_MAX_LENGTH}
              rows={5}
            />
            {error && <p className={styles.error}>{error}</p>}
            <div className={styles.actions}>
              <button type="button" className={styles.cancelButton} onClick={onClose} disabled={sending}>
                취소
              </button>
              <button type="submit" className={styles.submitButton} disabled={sending || !title.trim() || !content.trim()}>
                보내기
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
