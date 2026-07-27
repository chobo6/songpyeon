export type DirectMessageEntry = {
  id: number;
  senderId: number;
  senderNickname: string;
  senderNicknameColor: string | null;
  text: string;
  createdAt: string;
};

async function chatFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: "same-origin", ...init });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error ?? "요청에 실패했어요.");
  return body as T;
}

export function getDirectMessages(friendUserId: number): Promise<DirectMessageEntry[]> {
  return chatFetch(`/api/chat/${friendUserId}/messages`);
}

export function sendDirectMessage(toUserId: number, text: string): Promise<{ ok: true }> {
  return chatFetch("/api/chat/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ toUserId, text }),
  });
}

export function markDirectMessagesRead(friendUserId: number): Promise<{ ok: true }> {
  return chatFetch(`/api/chat/${friendUserId}/read`, { method: "POST" });
}
