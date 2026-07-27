export type FriendEntry = {
  friendshipId: number;
  userId: number;
  nickname: string;
  online: boolean;
  roomId: string | null;
  lastLoginAt: string | null;
};

export type ReceivedRequestEntry = { requestId: number; fromUserId: number; fromNickname: string; createdAt: string };

export type SentRequestEntry = { requestId: number; toUserId: number; toNickname: string; createdAt: string };

async function friendsFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: "same-origin", ...init });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error ?? "요청에 실패했어요.");
  return body as T;
}

export function getFriends(): Promise<FriendEntry[]> {
  return friendsFetch("/api/friends");
}

export function getReceivedRequests(): Promise<ReceivedRequestEntry[]> {
  return friendsFetch("/api/friends/requests");
}

export function getSentRequests(): Promise<SentRequestEntry[]> {
  return friendsFetch("/api/friends/sent");
}

export function sendFriendRequest(nickname: string): Promise<{ result: string }> {
  return friendsFetch("/api/friends/request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nickname }),
  });
}

export function acceptFriendRequest(requestId: number): Promise<{ ok: true }> {
  return friendsFetch(`/api/friends/${requestId}/accept`, { method: "POST" });
}

export function declineFriendRequest(requestId: number): Promise<{ ok: true }> {
  return friendsFetch(`/api/friends/${requestId}/decline`, { method: "POST" });
}

export function cancelFriendRequest(requestId: number): Promise<{ ok: true }> {
  return friendsFetch(`/api/friends/${requestId}/cancel`, { method: "POST" });
}

export function removeFriend(friendshipId: number): Promise<{ ok: true }> {
  return friendsFetch(`/api/friends/${friendshipId}`, { method: "DELETE" });
}
