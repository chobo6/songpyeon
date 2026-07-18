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

// One HTMLAudioElement per src, reused across presses instead of `new
// Audio()`-ing a fresh element every single tap. Constructing+decoding a
// fresh element on every rapid-fire press (iOS reports: a mint run of
// 2/4/6 same-button retaps starts dropping input after a couple presses,
// same as two different buttons pressed together — see
// docs/TROUBLESHOOTING.md #19/#20) is real synchronous work on the main
// thread right in the middle of the touch handler; a busy main thread is
// exactly when iOS's touch dispatch is most likely to lag or drop the next
// physical touch. Restarting a still-playing pooled element (currentTime =
// 0) just retriggers the click rather than overlapping it — fine for a
// ~1s click SFX, and is how rapid-fire UI sounds are normally done.
const audioPool = new Map<string, HTMLAudioElement>();

// Exported for reuse by anything else that needs to play a pooled one-shot
// SFX outside the color-click cycle (e.g. TurnOutcomeBanner.tsx's
// success/fail sound) — same reasoning as above applies there too: turn
// outcome lands right at the moment buttons re-enable/disable, exactly
// when a fresh `new Audio()`'s main-thread cost matters most.
export function playSrc(src: string) {
  let audio = audioPool.get(src);
  if (audio) {
    audio.currentTime = 0;
  } else {
    audio = new Audio(src);
    audioPool.set(src, audio);
  }
  audio.play().catch(() => {});
}

// `mintStreakIndex` is which consecutive mint press this is within its run
// (0 = first), so callers driven by different sources (a local press vs. a
// press observed via state sync) land on the same point in the cycle for
// the same logical press — see game/useSequencePressSound.ts.
export function playColorClickSound(color: Color, mintStreakIndex = 0) {
  if (color === "mint") {
    playSrc(MINT_CLICK_SRCS[mintStreakIndex % MINT_CLICK_SRCS.length]);
    return;
  }
  const src = COLOR_CLICK_SRC[color];
  if (!src) return;
  playSrc(src);
}
