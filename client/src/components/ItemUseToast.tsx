import { useEffect, useState } from "react";
import type { ItemId } from "../game/matchTypes";
import { ITEM_ICON } from "../game/itemIcons";
import styles from "./ItemUseToast.module.css";

const ITEM_LABEL: Record<ItemId, string> = {
  timeAdd: "시간 추가",
  timeReduce: "시간 감소",
  doughAttack: "반죽 공격",
  superMortar: "슈퍼 절구",
  mortarRestore: "절구 회복",
};

// seq is the trigger, not itemId — the same item used twice in a row still
// needs to replay the animation, and itemId alone wouldn't change.
export function ItemUseToast({ itemId, seq }: { itemId: ItemId | ""; seq: number }) {
  const [current, setCurrent] = useState<{ itemId: ItemId; seq: number } | null>(null);

  useEffect(() => {
    if (!itemId || seq === 0) return;
    setCurrent({ itemId, seq });
  }, [itemId, seq]);

  if (!current) return null;

  return (
    <div
      key={current.seq}
      className={styles.toast}
      // The slide-in/hold/slide-out timing lives entirely in the CSS
      // animation (see .toast) — this just unmounts once it's done, so
      // there's no separate JS timeout duration to keep in sync with it.
      onAnimationEnd={() => setCurrent(null)}
    >
      <img className={styles.icon} src={ITEM_ICON[current.itemId]} alt="" />
      <span className={styles.label}>{ITEM_LABEL[current.itemId]}</span>
    </div>
  );
}
