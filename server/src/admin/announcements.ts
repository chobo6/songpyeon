import type { Request, Response } from "express";

export type Announcement = { message: string; timestamp: number };

const RESEND_WINDOW_MS = 5 * 60 * 1000;
const subscribers = new Set<Response>();
let lastAnnouncement: Announcement | null = null;

export function shouldResend(
  announcement: Announcement | null,
  now: number,
): announcement is Announcement {
  return announcement !== null && now - announcement.timestamp <= RESEND_WINDOW_MS;
}

function formatSseMessage(announcement: Announcement): string {
  return `data: ${JSON.stringify(announcement)}\n\n`;
}

export function subscribe(req: Request, res: Response): void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  if (shouldResend(lastAnnouncement, Date.now())) {
    res.write(formatSseMessage(lastAnnouncement));
  }

  subscribers.add(res);

  req.on("close", () => {
    subscribers.delete(res);
  });

  res.on("error", () => {
    subscribers.delete(res);
  });
}

export function broadcast(message: string): void {
  const announcement: Announcement = { message, timestamp: Date.now() };
  lastAnnouncement = announcement;
  const payload = formatSseMessage(announcement);
  for (const res of subscribers) {
    try {
      res.write(payload);
    } catch {
      subscribers.delete(res);
    }
  }
}

export function _resetForTest(): void {
  subscribers.clear();
  lastAnnouncement = null;
}

export function _subscriberCountForTest(): number {
  return subscribers.size;
}
