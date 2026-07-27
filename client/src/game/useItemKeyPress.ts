import { useEffect, useRef } from "react";
import type { Role } from "./colors";
import type { ItemId } from "./matchTypes";

// Inventory slot index -> key, per role. Matches ButtonPanel.tsx's
// SLOT_ORDER traversal order for each role's 2 empty (item) slots: pig's
// are topMid then topRight ("왼쪽"/"오른쪽" as drawn), rabbit's are topLeft
// then bottomMid ("위쪽"/"아래쪽" as drawn) — see buttonPanel.ts's
// PANEL_BY_ROLE for the slot layout this mirrors.
const PIG_ITEM_KEY_MAP: Record<string, number> = { k: 0, l: 1 };
const RABBIT_ITEM_KEY_MAP: Record<string, number> = { a: 0, s: 1 };

// Same keyboard-press feature as useColorKeyPress, extended to the 2 item
// slots. Kept as its own hook (not folded into useColorKeyPress) because its
// gating differs: items stay usable through the deferred hand-off window
// after this turn's outcome is already decided (see ButtonPanel.tsx's item
// buttons, which likewise skip `disabled`), so the caller must NOT pass the
// same turnOutcome-derived `disabled` it passes for colors.
export function useItemKeyPress(role: Role, disabled: boolean, inventory: ItemId[], onUseItem: (itemId: ItemId) => void) {
  // Inventory changes far more often than this effect should re-subscribe
  // its keydown listener (every colyseus patch can produce a fresh
  // ArraySchema-derived array — see MyTurnScreen.tsx) — read it via a ref
  // updated every render instead of putting it in the effect's deps.
  const inventoryRef = useRef(inventory);
  inventoryRef.current = inventory;

  useEffect(() => {
    if (disabled) return;
    const keyMap = role === "pig" ? PIG_ITEM_KEY_MAP : RABBIT_ITEM_KEY_MAP;

    function onKeyDown(e: KeyboardEvent) {
      const active = document.activeElement;
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return;
      if (e.repeat) return;
      const slotIndex = keyMap[e.key.toLowerCase()];
      if (slotIndex === undefined) return;
      const item = inventoryRef.current[slotIndex];
      if (item) onUseItem(item);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [role, disabled, onUseItem]);
}
