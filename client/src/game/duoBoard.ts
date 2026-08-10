import type { NicknameEffect, NicknameParticle } from "./nicknameStyle";

export type DuoPosition = "pig" | "rabbit" | "any";

export type DuoListingEntry = {
  userId: number;
  nickname: string;
  maxRound: number;
  position: DuoPosition;
  timeSlot: string;
  description: string;
  createdAt: string;
  nicknameColor: string | null;
  nicknameEffect: NicknameEffect;
  nicknameGlow: boolean;
  nicknameParticle: NicknameParticle;
};

async function duoFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: "same-origin", ...init });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error ?? "요청에 실패했어요.");
  return body as T;
}

export function getDuoListings(): Promise<DuoListingEntry[]> {
  return duoFetch("/api/duo");
}

export function postDuoListing(position: DuoPosition, timeSlot: string, description: string): Promise<{ ok: true }> {
  return duoFetch("/api/duo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ position, timeSlot, description }),
  });
}

export function removeDuoListing(): Promise<{ ok: true }> {
  return duoFetch("/api/duo", { method: "DELETE" });
}
