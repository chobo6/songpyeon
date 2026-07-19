import { useEffect, useState } from "react";
import styles from "./AnnouncementBanner.module.css";

type Announcement = { message: string; timestamp: number };

export function AnnouncementBanner() {
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const source = new EventSource("/api/announcements/stream");
    source.onmessage = (event) => {
      const data = JSON.parse(event.data) as Announcement;
      setAnnouncement(data);
      setDismissed(false);
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
