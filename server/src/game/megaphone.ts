import type { Request, Response } from "express";

const MAX_MEGAPHONE_LENGTH = 40;
const RESEND_WINDOW_MS = 5 * 60 * 1000;

export type MegaphoneMessage = { nickname: string; message: string; timestamp: number };

// 채팅(sanitizeChatText, ../game/chat.ts)과 같은 자리 — trim + 길이 제한, 빈 문자열이면
// null(닉네임과 달리 확성기 메시지엔 그럴듯한 기본값이 없으므로 호출부가 그냥 버림).
export function sanitizeMegaphoneMessage(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim().slice(0, MAX_MEGAPHONE_LENGTH);
  return trimmed || null;
}

const subscribers = new Set<Response>();
let lastMessage: MegaphoneMessage | null = null;

function shouldResend(message: MegaphoneMessage | null, now: number): message is MegaphoneMessage {
  return message !== null && now - message.timestamp <= RESEND_WINDOW_MS;
}

function formatSseMessage(message: MegaphoneMessage): string {
  return `data: ${JSON.stringify(message)}\n\n`;
}

export function subscribe(req: Request, res: Response): void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  if (shouldResend(lastMessage, Date.now())) {
    res.write(formatSseMessage(lastMessage));
  }

  subscribers.add(res);
  req.on("close", () => subscribers.delete(res));
  res.on("error", () => subscribers.delete(res));
}

export function broadcast(nickname: string, message: string): void {
  const payload: MegaphoneMessage = { nickname, message, timestamp: Date.now() };
  lastMessage = payload;
  const sse = formatSseMessage(payload);
  for (const res of subscribers) {
    try {
      res.write(sse);
    } catch {
      subscribers.delete(res);
    }
  }
}

export function _resetForTest(): void {
  subscribers.clear();
  lastMessage = null;
}

export function _subscriberCountForTest(): number {
  return subscribers.size;
}
