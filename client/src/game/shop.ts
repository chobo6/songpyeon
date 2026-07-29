import type { NicknameEffect } from "./nicknameStyle";

export type ShopEffect = Exclude<NicknameEffect, "none">;

export type ShopState = {
  gameMoney: number;
  prices: Record<ShopEffect, number>;
  owned: NicknameEffect[];
  equipped: NicknameEffect;
  rerollColorPrice: number;
};

async function shopFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: "same-origin", ...init });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error ?? "요청에 실패했어요.");
  return body as T;
}

export function getShop(): Promise<ShopState> {
  return shopFetch("/api/shop");
}

export function purchaseEffect(effect: ShopEffect): Promise<{ ok: true }> {
  return shopFetch("/api/shop/purchase", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ effect }),
  });
}

export function equipEffect(effect: NicknameEffect): Promise<{ ok: true }> {
  return shopFetch("/api/shop/equip", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ effect }),
  });
}
