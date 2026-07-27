export type PendingInvite = { fromNickname: string; roomId: string; expiresAt: number } | null;

async function invitesFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: "same-origin", ...init });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error ?? "요청에 실패했어요.");
  return body as T;
}

export function sendInvite(toUserId: number, roomId: string): Promise<{ ok: true }> {
  return invitesFetch("/api/invites/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ toUserId, roomId }),
  });
}

export function getPendingInvite(): Promise<PendingInvite> {
  return invitesFetch("/api/invites/pending");
}

export function dismissInvite(): Promise<{ ok: true }> {
  return invitesFetch("/api/invites/dismiss", { method: "POST" });
}
