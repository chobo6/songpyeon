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
// and SequenceBoard.
export const COLOR_TOKEN: Record<Color, string> = {
  red: "/game-assets/tokens/thanksgiving2024_room_command1.webp",
  orange: "/game-assets/tokens/thanksgiving2024_room_command2.webp",
  yellow: "/game-assets/tokens/thanksgiving2024_room_command3.webp",
  purple: "/game-assets/tokens/thanksgiving2024_room_command6.webp",
  mint: "/game-assets/tokens/thanksgiving_room_command8.webp",
  blue: "/game-assets/tokens/thanksgiving_room_command5.webp",
  pink: "/game-assets/tokens/thanksgiving_room_command7.webp",
  green: "/game-assets/tokens/thanksgiving_room_command4.webp",
};
