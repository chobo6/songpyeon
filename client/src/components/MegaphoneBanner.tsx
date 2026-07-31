import { useEffect, useRef, useState } from "react";
import styles from "./MegaphoneBanner.module.css";

type MegaphoneMessage = { nickname: string; message: string; timestamp: number };

const AUTO_DISMISS_MS = 20_000;

export function MegaphoneBanner() {
  const [payload, setPayload] = useState<MegaphoneMessage | null>(null);
  const [dismissed, setDismissed] = useState(false);
  // AnnouncementBanner와 같은 이유 — SSE 재연결로 같은 메시지가 다시 오더라도
  // 이미 닫은 배너가 도로 열리면 안 되고, 타임스탬프가 실제로 바뀐 새 메시지만
  // 다시 연다.
  const lastTimestampRef = useRef<number | null>(null);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const source = new EventSource("/api/megaphone/stream");
    source.onmessage = (event) => {
      const data = JSON.parse(event.data) as MegaphoneMessage;
      setPayload(data);
      if (data.timestamp !== lastTimestampRef.current) {
        setDismissed(false);
        if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
        dismissTimerRef.current = setTimeout(() => setDismissed(true), AUTO_DISMISS_MS);
      }
      lastTimestampRef.current = data.timestamp;
    };
    return () => {
      source.close();
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    };
  }, []);

  if (!payload || dismissed) return null;

  return (
    <div className={styles.banner} role="status">
      <span>
        📢 <b>{payload.nickname}</b>: {payload.message}
      </span>
      <button type="button" onClick={() => setDismissed(true)} aria-label="확성기 메시지 닫기">
        ×
      </button>
    </div>
  );
}
