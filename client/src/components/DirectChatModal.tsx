import { useEffect, useRef, useState } from "react";
import { ChatBox } from "./ChatBox";
import { getDirectMessages, markDirectMessagesRead, sendDirectMessage, type DirectMessageEntry } from "../game/chat";
import { directMessageToChatMessage } from "../game/directMessageToChatMessage";
import styles from "./DirectChatModal.module.css";

const POLL_INTERVAL_MS = 2000;

export function DirectChatModal({
  friendUserId,
  friendNickname,
  onClose,
}: {
  friendUserId: number;
  friendNickname: string;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<DirectMessageEntry[]>([]);
  const cancelledRef = useRef(false);

  async function refresh() {
    try {
      const list = await getDirectMessages(friendUserId);
      if (!cancelledRef.current) setMessages(list);
      await markDirectMessagesRead(friendUserId);
    } catch (err) {
      console.error("failed to load direct messages", err);
    }
  }

  useEffect(() => {
    cancelledRef.current = false;
    refresh();
    const interval = setInterval(refresh, POLL_INTERVAL_MS);
    return () => {
      cancelledRef.current = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [friendUserId]);

  async function handleSend(text: string) {
    await sendDirectMessage(friendUserId, text);
    refresh();
  }

  const chatMessages = messages.map(directMessageToChatMessage);

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h2 className={styles.heading}>{friendNickname}님과의 채팅</h2>
        <ChatBox
          messages={chatMessages}
          messageCount={chatMessages.length}
          lastMessageAt={chatMessages.length ? chatMessages[chatMessages.length - 1].sentAt : 0}
          onSend={handleSend}
          fill
        />
        <button className={styles.closeButton} onClick={onClose}>
          닫기
        </button>
      </div>
    </div>
  );
}
