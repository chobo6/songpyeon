import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "../game/matchTypes";
import styles from "./ChatBox.module.css";

export function ChatBox({
  messages,
  onSend,
  fill = false,
}: {
  messages: ChatMessage[];
  onSend: (text: string) => void;
  fill?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setDraft("");
  }

  return (
    <div className={fill ? `${styles.wrap} ${styles.fill}` : styles.wrap}>
      <div className={styles.list} ref={listRef}>
        {messages.length === 0 && <p className={styles.empty}>아직 채팅이 없어요</p>}
        {messages.map((m, i) =>
          m.nickname ? (
            <p key={i} className={styles.line}>
              <span className={styles.nickname}>{m.nickname}</span>
              <span className={styles.text}>{m.text}</span>
            </p>
          ) : (
            // Server-pushed system notices (join/leave) carry an empty
            // nickname — rendered without the bold name prefix, dimmed to
            // read as a notice rather than something a player said.
            <p key={i} className={`${styles.line} ${styles.system}`}>
              {m.text}
            </p>
          ),
        )}
      </div>
      <form className={styles.inputRow} onSubmit={handleSubmit}>
        <input
          className={styles.input}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={100}
          placeholder="메시지 입력"
        />
        <button className={styles.sendButton} type="submit" disabled={!draft.trim()}>
          전송
        </button>
      </form>
    </div>
  );
}
