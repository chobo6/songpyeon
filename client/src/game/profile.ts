export type FriendshipStatus = "self" | "friends" | "pending_sent" | "pending_received" | "none";

export type PublicProfile = {
  userId: number;
  nickname: string;
  nicknameColor: string | null;
  maxRound: number;
  pigPlayCount: number;
  rabbitPlayCount: number;
  friendshipStatus: FriendshipStatus;
  friendshipId: number | null;
};

export async function getProfile(nickname: string): Promise<PublicProfile> {
  const res = await fetch(`/api/profile/${encodeURIComponent(nickname)}`, { credentials: "same-origin" });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error ?? "프로필을 불러오지 못했어요.");
  return body as PublicProfile;
}
