export type Color = "red" | "orange" | "yellow" | "purple" | "mint" | "green" | "blue" | "pink";
export type Role = "pig" | "rabbit";

export const COLOR_HEX: Record<Color, string> = {
  red: "#e5484d",
  orange: "#f2994a",
  yellow: "#f2c94c",
  purple: "#9b59d0",
  mint: "#2ec4b6",
  green: "#34b56f",
  blue: "#3b82f6",
  pink: "#f472b6",
};

// Illustrated per-color button tokens lifted from the original game's asset
// pack (see client/public/game-assets/README.md) — used by both ButtonPanel
// and SequenceBoard. Uses the "_unpressed" variant: the base (no-suffix)
// command1/2/3/6 art (pig colors) each have a small gray connector tab
// jutting past the circle's right edge, meant to tuck behind the next
// button in the original app's tightly packed row — our layout doesn't
// replicate that overlap so the tab shows floating loose. "_unpressed" is
// higher-contrast and doesn't have that tab, for all 8 colors.
export const COLOR_TOKEN: Record<Color, string> = {
  red: "/game-assets/tokens/thanksgiving2024_room_command1_unpressed.webp",
  orange: "/game-assets/tokens/thanksgiving2024_room_command2_unpressed.webp",
  yellow: "/game-assets/tokens/thanksgiving2024_room_command3_unpressed.webp",
  purple: "/game-assets/tokens/thanksgiving2024_room_command6_unpressed.webp",
  mint: "/game-assets/tokens/thanksgiving_room_command8_unpressed.webp",
  blue: "/game-assets/tokens/thanksgiving_room_command5_unpressed.webp",
  pink: "/game-assets/tokens/thanksgiving_room_command7_unpressed.webp",
  green: "/game-assets/tokens/thanksgiving_room_command4_unpressed.webp",
};

// "_off" variant — shown on SequenceBoard once a token has been correctly
// pressed (see client/public/game-assets/README.md).
export const COLOR_TOKEN_OFF: Record<Color, string> = {
  red: "/game-assets/tokens/thanksgiving2024_room_command1_off.webp",
  orange: "/game-assets/tokens/thanksgiving2024_room_command2_off.webp",
  yellow: "/game-assets/tokens/thanksgiving2024_room_command3_off.webp",
  purple: "/game-assets/tokens/thanksgiving2024_room_command6_off.webp",
  mint: "/game-assets/tokens/thanksgiving_room_command8_off.webp",
  blue: "/game-assets/tokens/thanksgiving_room_command5_off.webp",
  pink: "/game-assets/tokens/thanksgiving_room_command7_off.webp",
  green: "/game-assets/tokens/thanksgiving_room_command4_off.webp",
};
