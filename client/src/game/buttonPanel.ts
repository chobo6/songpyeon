import type { Color, Role } from "./colors";

export type SlotPosition = "topLeft" | "topMid" | "topRight" | "bottomLeft" | "bottomMid" | "bottomRight";

export const SLOT_ORDER: SlotPosition[] = ["topLeft", "topMid", "topRight", "bottomLeft", "bottomMid", "bottomRight"];

// Mirrors docs/REQUIREMENTS.md §12.2's slot↔color table exactly — verify
// against that table, not by eye, before changing this.
const PANEL_BY_ROLE: Record<Role, Record<SlotPosition, Color | null>> = {
  pig: {
    topLeft: "red",
    topMid: null,
    topRight: null,
    bottomLeft: "yellow",
    bottomMid: "orange",
    bottomRight: "purple",
  },
  rabbit: {
    topLeft: null,
    topMid: "green",
    topRight: "blue",
    bottomLeft: "mint",
    bottomMid: null,
    bottomRight: "pink",
  },
};

export function buttonPanelSlots(role: Role): Record<SlotPosition, Color | null> {
  return PANEL_BY_ROLE[role];
}
