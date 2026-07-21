import type { Request, Response } from "express";
import type { Color } from "../game/colors";

export type PressEvent = {
  color: Color;
  // 직전 입력(색 무관)으로부터 지난 시간 — 그 턴의 첫 입력이면 비교 대상이 없어 null.
  sinceLastPressMs: number | null;
  // inputSpamGuard가 이 입력을 씹었는지 여부.
  blocked: boolean;
  timestamp: number;
};

// 공지 배너(announcements.ts)와 달리 전체 구독자에게 뿌리는 게 아니라, userId별로
// 구독자를 나눠서 그 유저를 지정한 관리자한테만 보낸다 — 아무도 안 보고 있는 유저의
// 프레스는 맵 조회 한 번으로 끝나서, MatchRoom.handlePressButton이 매 프레스마다
// 호출해도 감시 대상이 아닌 한 사실상 비용이 없다.
const subscribersByUserId = new Map<number, Set<Response>>();

export function subscribe(userId: number, req: Request, res: Response): void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  let set = subscribersByUserId.get(userId);
  if (!set) {
    set = new Set();
    subscribersByUserId.set(userId, set);
  }
  set.add(res);

  const cleanup = () => {
    const current = subscribersByUserId.get(userId);
    current?.delete(res);
    if (current && current.size === 0) subscribersByUserId.delete(userId);
  };
  req.on("close", cleanup);
  res.on("error", cleanup);
}

export function notifyPress(userId: number, event: PressEvent): void {
  const set = subscribersByUserId.get(userId);
  if (!set || set.size === 0) return;
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of set) {
    try {
      res.write(payload);
    } catch {
      set.delete(res);
    }
  }
}

export function _resetForTest(): void {
  subscribersByUserId.clear();
}

export function _subscriberCountForTest(userId: number): number {
  return subscribersByUserId.get(userId)?.size ?? 0;
}
