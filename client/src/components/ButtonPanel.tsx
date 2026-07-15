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

  function handlePointerDown(e: React.PointerEvent<HTMLButtonElement>, color: Color) {
    if (disabled) return;
    if (e.pointerType === "touch") {
      touchHandledAtRef.current.set(color, Date.now());
      onPress(color);
    }
  }

  function handleClick(color: Color) {
    const touchedAt = touchHandledAtRef.current.get(color);
    if (touchedAt !== undefined && Date.now() - touchedAt < TOUCH_DEDUPE_WINDOW_MS) {
      touchHandledAtRef.current.delete(color);
      return;
    }
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
