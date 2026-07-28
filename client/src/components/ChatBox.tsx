import { memo, useEffect, useRef, useState } from "react";
import type { ChatMessage } from "../game/matchTypes";
import { nicknameStyle } from "../game/nicknameStyle";
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
  // Read once, as the useState initializer below — restores whatever the
  // player had typed but not sent the last time this component was mounted.
  // Needed because SpectatorScreen (this component's only "fill" caller)
  // unmounts every time the active turn becomes the player's own team's
  // (Game.tsx swaps it for MyTurnScreen, which has no chat at all) and
  // remounts when the turn passes again — plain useState alone would reset
  // the draft to "" on every one of those remounts. The caller is
  // responsible for actually persisting the value across that unmount (see
  // Game.tsx's chatDraftRef) — this component only reads it back in.
  initialDraft?: string;
  // Fired on every keystroke (and on send, with "") so the caller's copy
  // stays current for the next remount. NOT a controlled-input callback —
  // this component still owns `draft` as its own state; onDraftChange is a
  // side channel, not the source of truth, specifically to avoid turning
  // the input into a controlled component driven by a parent that also
  // re-renders for unrelated reasons (see chatPropsEqual's memoization
  // comment below re: Hangul IME composition, docs/TROUBLESHOOTING.md #23).
  onDraftChange?: (text: string) => void;
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
    prev.fill === next.fill &&
    prev.onDraftChange === next.onDraftChange
    // initialDraft intentionally excluded — it's only ever read once, by
    // useState's initializer on mount, so a prop change alone (without an
    // actual unmount/remount) has nothing to apply it to.
  );
}

export const ChatBox = memo(function ChatBox({
  messages,
  lastMessageAt,
  onSend,
  fill = false,
  initialDraft,
  onDraftChange,
}: ChatBoxProps) {
  const [draft, setDraft] = useState(initialDraft ?? "");
  const listRef = useRef<HTMLDivElement>(null);

  function updateDraft(text: string) {
    setDraft(text);
    onDraftChange?.(text);
  }

  // lastMessageAt, not messages.length — the same 50-message-cap staleness
  // chatPropsEqual above already accounts for applies here too: once the
  // cap is reached, .length is pinned forever, so an effect keyed on it
  // would stop re-firing (and stop auto-scrolling to new messages) even
  // though the component itself keeps re-rendering correctly via
  // lastMessageAt. See docs/TROUBLESHOOTING.md #23.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lastMessageAt]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed) return;
    onSend(trimmed);
    updateDraft("");
  }

  return (
    <div className={fill ? `${styles.wrap} ${styles.fill}` : styles.wrap}>
      <div className={styles.list} ref={listRef}>
        {messages.length === 0 && <p className={styles.empty}>아직 채팅이 없어요</p>}
        {messages.map((m, i) => {
          const effect = nicknameStyle(m.nicknameColor, m.nicknameRainbow, m.nicknameGlow);
          return m.nickname ? (
            <p key={i} className={styles.line}>
              <span className={`${styles.nickname} ${effect.className}`} style={effect.style}>
                {m.nickname}
              </span>
              <span className={styles.text}>{m.text}</span>
            </p>
          ) : (
            // Server-pushed system notices (join/leave) carry an empty
            // nickname — rendered without the bold name prefix, dimmed to
            // read as a notice rather than something a player said.
            <p key={i} className={`${styles.line} ${styles.system}`}>
              {m.text}
            </p>
          );
        })}
      </div>
      <form className={styles.inputRow} onSubmit={handleSubmit}>
        <input
          className={styles.input}
          value={draft}
          onChange={(e) => updateDraft(e.target.value)}
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
