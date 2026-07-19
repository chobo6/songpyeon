import { useEffect, useRef, useState } from "react";
import styles from "./AnnouncementBanner.module.css";

type Announcement = { message: string; timestamp: number };

export function AnnouncementBanner() {
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const [dismissed, setDismissed] = useState(false);
  // Tracks which announcement we've already shown, so a resend of the same
  // one (SSE reconnect after a network blip, or the resend-on-subscribe
  // within the 5-minute window) doesn't un-dismiss a banner the player
  // already closed. Only a genuinely new timestamp should reopen it.
  const lastTimestampRef = useRef<number | null>(null);

  useEffect(() => {
    const source = new EventSource("/api/announcements/stream");
    source.onmessage = (event) => {
      const data = JSON.parse(event.data) as Announcement;
      setAnnouncement(data);
      if (data.timestamp !== lastTimestampRef.current) {
        setDismissed(false);
      }
      lastTimestampRef.current = data.timestamp;
    };
    return () => source.close();
  }, []);

  if (!announcement || dismissed) return null;

  return (
    <div className={styles.banner} role="status">
      <span>{announcement.message}</span>
      <button type="button" onClick={() => setDismissed(true)} aria-label="공지 닫기">
        ×
      </button>
    </div>
  );
}
