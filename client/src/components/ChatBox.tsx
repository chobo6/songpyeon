import { memo, useEffect, useRef, useState } from "react";
import type { ChatMessage } from "../game/matchTypes";
import styles from "./ChatBox.module.css";

interface ChatBoxProps {
  messages: ChatMessage[];
  // Frozen primitives the caller derives from `messages` at ITS OWN render
  // time (see RoleSelect.tsx/SpectatorScreen.tsx) — NOT re-derived from
  // `messages` here. Colyseus mutates lobbyChat/matchChat in place, so
  // `messages` is the exact same array object across every render; a
  // comparator that reads `.length`/`[...]` off it at comparison time would
  // always be comparing that live object against itself (both "prev" and
  // "next" alias the same, already-current array), never seeing a
  // difference — this is the same in-place-mutation trap useMatchRoom.ts's
  // forceRender() exists to work around, and reading off `messages` inside
  // chatPropsEqual below hit it directly (verified: a 2nd message sent from
  // the same tab never appeared, since the 1st message's arrival happened
  // to piggyback on an unrelated internal re-render, not a real
  // props-changed bailout). Plain numbers captured before this component
  // boundary don't have that problem — they're real point-in-time
  // snapshots, immune to later mutation of the array they were read from.
  messageCount: number;
  lastMessageAt: number;
  onSend: (text: string) => void;
  fill?: boolean;
}

// Memoized so this doesn't re-render on every unrelated colyseus patch (a
// teammate's button press, the timer, anyone else's turn hand-off — the
// parent screens re-render on literally every state change, see
// useMatchRoom.ts's forceRender()). Without this, a controlled <input>
// re-rendering mid-keystroke forces React to re-sync its DOM `.value` on
// every commit (React always does this for controlled inputs, changed or
// not) — harmless for a plain keystroke, but disruptive enough during an
// active Hangul IME composition (each syllable is itself built from several
// intermediate DOM value updates) to reorder it, which read as chat text
// coming out reversed. See docs/TROUBLESHOOTING.md #23.
//
// messageCount alone isn't a safe re-render signal once the 50-message cap
// (MAX_CHAT_MESSAGES on the server) kicks in — push+shift keeps length
// constant forever after that point, even though a genuinely new message
// arrived. lastMessageAt (the newest message's sentAt, a real timestamp)
// catches that case too: a real new message always changes what's newest.
function chatPropsEqual(prev: ChatBoxProps, next: ChatBoxProps) {
  return (
    prev.messageCount === next.messageCount &&
    prev.lastMessageAt === next.lastMessageAt &&
    prev.onSend === next.onSend &&
    prev.fill === next.fill
  );
}

export const ChatBox = memo(function ChatBox({ messages, onSend, fill = false }: ChatBoxProps) {
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
}, chatPropsEqual);
