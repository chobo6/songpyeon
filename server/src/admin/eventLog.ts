export type AdminEvent = {
  type: "join" | "leave";
  timestamp: number;
  nickname: string;
  roomId: string;
  ip: string;
  sessionId: string;
};

const MAX_EVENTS = 500;
const events: AdminEvent[] = [];

export function recordEvent(event: AdminEvent): void {
  events.push(event);
  if (events.length > MAX_EVENTS) {
    events.shift();
  }
}

export function getEvents(): AdminEvent[] {
  return events;
}

export function _resetForTest(): void {
  events.length = 0;
}
