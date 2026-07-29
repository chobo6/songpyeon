import { useEffect, useState } from "react";
import { equipEffect, getShop, purchaseEffect, type ShopState } from "../game/shop";
import { rerollNicknameColor } from "../game/profile";
import { nicknameStyle, type NicknameEffect } from "../game/nicknameStyle";
import styles from "./ShopModal.module.css";

const SHOP_EFFECTS: Exclude<NicknameEffect, "none">[] = ["rainbow", "shine", "hologram", "pulse", "neon", "chrome"];
const EFFECT_LABELS: Record<Exclude<NicknameEffect, "none">, string> = {
  rainbow: "레인보우",
  shine: "샤인",
  hologram: "홀로그램",
  pulse: "Pulse",
  neon: "네온사인",
  chrome: "크롬",
};

export function ShopModal({
  nickname,
  nicknameColor,
  nicknameGlow,
  onClose,
  onProfileChanged,
}: {
  nickname: string;
  nicknameColor: string | null;
  nicknameGlow: boolean;
  onClose: () => void;
  onProfileChanged: () => void;
}) {
  const [shop, setShop] = useState<ShopState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyEffect, setBusyEffect] = useState<string | null>(null);

  function refresh() {
    getShop()
      .then(setShop)
      .catch((err) => setError(err instanceof Error ? err.message : "상점을 불러오지 못했어요."));
  }

  useEffect(refresh, []);

  async function handlePurchase(effect: Exclude<NicknameEffect, "none">) {
    setBusyEffect(effect);
    setError(null);
    try {
      await purchaseEffect(effect);
      refresh();
      onProfileChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "구매에 실패했어요.");
    } finally {
      setBusyEffect(null);
    }
  }

  async function handleEquip(effect: NicknameEffect) {
    setBusyEffect(effect);
    setError(null);
    try {
      await equipEffect(effect);
      refresh();
      onProfileChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "장착에 실패했어요.");
    } finally {
      setBusyEffect(null);
    }
  }

  async function handleRerollColor() {
    setBusyEffect("reroll-color");
    setError(null);
    try {
      await rerollNicknameColor();
      refresh();
      onProfileChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "닉색 변경에 실패했어요.");
    } finally {
      setBusyEffect(null);
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h2 className={styles.title}>상점</h2>
        {!shop && !error && <p className={styles.loading}>불러오는 중...</p>}
        {error && <p className={styles.error}>{error}</p>}
        {shop && (
          <>
            <p className={styles.money}>🪙 {shop.gameMoney.toLocaleString("ko-KR")}원</p>
            <div className={styles.grid}>
              {[...SHOP_EFFECTS].sort((a, b) => shop.prices[a] - shop.prices[b]).map((effect) => {
                const isOwned = shop.owned.includes(effect);
                const isEquipped = shop.equipped === effect;
                const preview = nicknameStyle(nicknameColor, effect, nicknameGlow);
                return (
                  <div key={effect} className={styles.card}>
                    <span className={`${styles.preview} ${preview.className}`} style={preview.style}>
                      {nickname}
                    </span>
                    <span className={styles.effectName}>{EFFECT_LABELS[effect]}</span>
                    {isOwned ? (
                      <button
                        className={styles.actionButton}
                        disabled={isEquipped || busyEffect === effect}
                        onClick={() => handleEquip(effect)}
                      >
                        {isEquipped ? "장착됨" : "장착하기"}
                      </button>
                    ) : (
                      <button
                        className={styles.actionButton}
                        disabled={busyEffect === effect}
                        onClick={() => handlePurchase(effect)}
                      >
                        구매 ({shop.prices[effect].toLocaleString("ko-KR")}원)
                      </button>
                    )}
                  </div>
                );
              })}
              <div className={styles.card}>
                <span className={styles.preview}>{nickname}</span>
                <span className={styles.effectName}>없음</span>
                <button
                  className={styles.actionButton}
                  disabled={shop.equipped === "none" || busyEffect === "none"}
                  onClick={() => handleEquip("none")}
                >
                  {shop.equipped === "none" ? "장착됨" : "장착하기"}
                </button>
              </div>
            </div>
            <div className={styles.rerollCard}>
              <span className={styles.effectName}>닉네임 색 변경</span>
              <button
                className={styles.actionButton}
                disabled={busyEffect === "reroll-color"}
                onClick={handleRerollColor}
              >
                구매 ({shop.rerollColorPrice.toLocaleString("ko-KR")}원)
              </button>
            </div>
          </>
        )}
        <button className={styles.closeButton} onClick={onClose}>
          닫기
        </button>
      </div>
    </div>
  );
}
