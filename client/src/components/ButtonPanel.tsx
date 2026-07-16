import { useRef } from "react";
import type { Color, Role } from "../game/colors";
import { COLOR_TOKEN } from "../game/colors";
import { SLOT_ORDER, buttonPanelSlots } from "../game/buttonPanel";
import panelBg from "./bottomPanelBackground.module.css";
import styles from "./ButtonPanel.module.css";

// How long after a touch's pointerdown fires that we still trust a
// same-color click to be that touch's own (browser-synthesized,
// preventDefault()-defeated) duplicate rather than a genuinely new press.
const TOUCH_DEDUPE_WINDOW_MS = 800;

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

export function ButtonPanel({
  role,
  disabled,
  onPress,
}: {
  role: Role;
  disabled: boolean;
  onPress: (color: Color) => void;
}) {
  const slots = buttonPanelSlots(role);

  // Touch input reacts on pointerdown (fires the instant a finger lands,
  // independent of any other touch in flight) instead of waiting for the
  // browser's touch->click synthesis, which only reliably tracks one touch
  // at a time — a second, near-simultaneous touch on a different button
  // (this game's whole point: e.g. pig's color-then-purple, pressed as
  // fast as possible) can fail to synthesize a click at all if the browser
  // reads the motion between them as a swipe rather than two taps.
  //
  // preventDefault() on the touch pointerdown is *supposed* to suppress the
  // browser's compatibility click for that same touch, but this isn't
  // reliable everywhere (observed: presses getting double-counted, since
  // pointerdown fires onPress and the click that follows anyway fires it
  // again — the second call re-judges the NEXT cursor position against the
  // same color and almost always mismatches, reading as an instant wrong
  // press even for a single deliberate tap). So don't depend on
  // preventDefault actually working: track per-color, in a ref (not
  // state — this must never trigger a render) when a touch's pointerdown
  // last fired, and have onClick skip firing again if a click for that
  // same color arrives within the dedupe window. Real mouse/keyboard
  // clicks never touch this map, so they're unaffected.
  const touchHandledAtRef = useRef<Map<Color, number>>(new Map());
  // Consecutive mint presses since the last non-mint press, used to pick
  // the next sound in MINT_CLICK_SRCS's cycle.
  const mintStreakRef = useRef(0);

  function playClickSound(color: Color) {
    if (color === "mint") {
      const src = MINT_CLICK_SRCS[mintStreakRef.current % MINT_CLICK_SRCS.length];
      mintStreakRef.current += 1;
      new Audio(src).play().catch(() => {});
      return;
    }
    mintStreakRef.current = 0;
    const src = COLOR_CLICK_SRC[color];
    if (!src) return;
    new Audio(src).play().catch(() => {});
  }

  function handlePointerDown(e: React.PointerEvent<HTMLButtonElement>, color: Color) {
    if (disabled) return;
    if (e.pointerType === "touch") {
      touchHandledAtRef.current.set(color, Date.now());
      playClickSound(color);
      onPress(color);
    }
  }

  function handleClick(color: Color) {
    const touchedAt = touchHandledAtRef.current.get(color);
    if (touchedAt !== undefined && Date.now() - touchedAt < TOUCH_DEDUPE_WINDOW_MS) {
      touchHandledAtRef.current.delete(color);
      return;
    }
    playClickSound(color);
    onPress(color);
  }

  return (
    <div className={panelBg.panelBg}>
      <div className={styles.panel}>
        {SLOT_ORDER.map((position) => {
          const color = slots[position];
          const positionClass = styles[position];
          if (!color) {
            return <div key={position} className={`${styles.empty} ${positionClass}`} />;
          }
          return (
            <button
              key={position}
              type="button"
              aria-label={color}
              disabled={disabled}
              onPointerDown={(e) => handlePointerDown(e, color)}
              onClick={() => handleClick(color)}
              className={`${styles.button} ${positionClass}`}
              style={{ backgroundImage: `url(${COLOR_TOKEN[color]})` }}
            />
          );
        })}
      </div>
    </div>
  );
}
