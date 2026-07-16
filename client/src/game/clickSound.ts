import type { Color } from "./colors";

// One press SFX per color, matched by ear to the original game's per-button
// sound (see client/public/game-assets/README.md) — "mint" has no static
// file here, see MINT_CLICK_SRCS below.
const COLOR_CLICK_SRC: Partial<Record<Color, string>> = {
  red: "/game-assets/audio/pig_red.mp3",
  orange: "/game-assets/audio/pig_orange.mp3",
  yellow: "/game-assets/audio/pig_yellow.mp3",
  purple: "/game-assets/audio/pig_purple.mp3",
  green: "/game-assets/audio/rabbit_green.mp3",
  blue: "/game-assets/audio/rabbit_blue.mp3",
  pink: "/game-assets/audio/rabbit_pink.mp3",
};

// Mint is the only color pressed in same-color runs (REQUIREMENTS.md's
// rabbit sub-pattern: runs of 2/4/6) — cycling click1->click4->click1...
// per consecutive mint press makes a run read as repeated strikes instead
// of the same clip looping.
const MINT_CLICK_SRCS = [
  "/game-assets/audio/click1.mp3",
  "/game-assets/audio/click2.mp3",
  "/game-assets/audio/click3.mp3",
  "/game-assets/audio/click4.mp3",
];

// `mintStreakIndex` is which consecutive mint press this is within its run
// (0 = first), so callers driven by different sources (a local press vs. a
// press observed via state sync) land on the same point in the cycle for
// the same logical press — see game/useSequencePressSound.ts.
export function playColorClickSound(color: Color, mintStreakIndex = 0) {
  if (color === "mint") {
    const src = MINT_CLICK_SRCS[mintStreakIndex % MINT_CLICK_SRCS.length];
    new Audio(src).play().catch(() => {});
    return;
  }
  const src = COLOR_CLICK_SRC[color];
  if (!src) return;
  new Audio(src).play().catch(() => {});
}
