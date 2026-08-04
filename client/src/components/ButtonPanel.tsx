import { memo, useEffect, useRef } from "react";
import type { Color, Role } from "../game/colors";
import { COLOR_TOKEN } from "../game/colors";
import { SLOT_ORDER, buttonPanelSlots } from "../game/buttonPanel";
import { playColorClickSound } from "../game/clickSound";
import type { ItemId } from "../game/matchTypes";
import { ITEM_ICON } from "../game/itemIcons";
import panelBg from "./bottomPanelBackground.module.css";
import styles from "./ButtonPanel.module.css";

// How long after a touch's touchstart fires that we still trust a
// same-color click to be that touch's own (browser-synthesized,
// preventDefault()-defeated) duplicate rather than a genuinely new press.
const TOUCH_DEDUPE_WINDOW_MS = 800;

interface ButtonPanelProps {
  role: Role;
  disabled: boolean;
  onPress: (color: Color) => void;
  // Optional: online-only, no item system in solo practice mode (see
  // SoloPlayScreen.tsx, which omits both these props entirely).
  inventory?: ItemId[];
  onUseItem?: (itemId: ItemId) => void;
}

// inventory만 값으로 비교하고 나머지는 참조/원시값으로 비교 — role/disabled는
// 원시값, onPress/onUseItem은 호출부(MyTurnScreen.tsx 등)가 이미 useCallback으로
// 안정된 참조를 넘기고 있어 참조 비교로 충분하다. inventory는 매 렌더 새
// 배열이라(MyTurnScreen.tsx의 Array.from(me.inventory) 참고, Colyseus
// ArraySchema가 in-place로 변형되는 걸 우회하기 위한 의도적인 선택) 참조
// 비교로는 항상 "다름"으로 판정되므로, 길이+원소 값으로 직접 비교한다 —
// 인벤토리는 최대 몇 개뿐이라 매번 순회해도 비용이 무시할 만하다.
function buttonPanelPropsEqual(prev: ButtonPanelProps, next: ButtonPanelProps) {
  const prevInventory = prev.inventory ?? [];
  const nextInventory = next.inventory ?? [];
  return (
    prev.role === next.role &&
    prev.disabled === next.disabled &&
    prev.onPress === next.onPress &&
    prev.onUseItem === next.onUseItem &&
    prevInventory.length === nextInventory.length &&
    prevInventory.every((id, i) => id === nextInventory[i])
  );
}

// Memoized so a re-render caused by something else entirely (any colyseus
// patch forces a full-tree re-render — see useMatchRoom.ts) doesn't also
// re-render this and re-touch all 6 button elements' props/styles. Only
// actually helps if `onPress` is a stable reference — callers must
// useCallback it (see MyTurnScreen.tsx, useSoloMatch.ts), otherwise a fresh
// function every render defeats this the same as not memoizing at all.
// `inventory`'s own reference is deliberately NOT part of that guarantee —
// see buttonPanelPropsEqual above.
export const ButtonPanel = memo(function ButtonPanel({
  role,
  disabled,
  onPress,
  inventory = [],
  onUseItem,
}: ButtonPanelProps) {
  const slots = buttonPanelSlots(role);

  // Touch input reacts on touchstart (fires the instant a finger lands,
  // independent of any other touch in flight) instead of waiting for the
  // browser's touch->click synthesis, which only reliably tracks one touch
  // at a time — a second, near-simultaneous touch on a different button
  // (this game's whole point: e.g. pig's color-then-purple, pressed as
  // fast as possible) can fail to synthesize a click at all if the browser
  // reads the motion between them as a swipe rather than two taps.
  //
  // Uses the raw TouchEvent API (onTouchStart), not Pointer Events
  // (onPointerDown) — WebKit's Pointer Events implementation is known to be
  // less reliable than TouchEvent for tracking multiple simultaneous
  // touches (each pointer gets dispatched as a separate event that can be
  // individually dropped under WebKit's internal bookkeeping, vs.
  // TouchEvent handing you the whole active-touch list atomically in one
  // event) — this is the suspected cause of reports (iOS Safari *and*
  // Chrome/Naver on iOS, which all share the same WebKit engine — Apple
  // requires it — so this isn't a Safari-specific quirk) of a second
  // simultaneous or rapid-fire touch (e.g. yellow/orange + purple, pressed
  // together) intermittently not registering at all, worse than a simple
  // wrong-press. See docs/TROUBLESHOOTING.md.
  //
  // preventDefault() on the touchstart is *supposed* to suppress the
  // browser's compatibility click for that same touch, but this isn't
  // reliable everywhere (observed: presses getting double-counted, since
  // touchstart fires onPress and the click that follows anyway fires it
  // again — the second call re-judges the NEXT cursor position against the
  // same color and almost always mismatches, reading as an instant wrong
  // press even for a single deliberate tap). So don't depend on
  // preventDefault actually working: track per-color, in a ref (not
  // state — this must never trigger a render), the touchstart timestamps
  // still waiting for their matching click, and have onClick skip firing
  // again if a click for that same color arrives within the dedupe window.
  // Real mouse/keyboard clicks never touch this map, so they're unaffected.
  //
  // Each color maps to an ARRAY of pending timestamps, not a single one —
  // rabbit's mint run means two (or more) real touchstarts on the SAME
  // button can be in flight before either one's synthetic click arrives. A
  // single-slot map lets the second touchstart overwrite the first's
  // timestamp; the first synthetic click then consumes (deletes) that sole
  // entry, leaving the second click with nothing to match — it falls
  // through the dedupe check and fires onPress again, turning 2 real
  // touches into 3 presses sent to the server. Queuing lets each touchstart
  // keep its own entry so each click can independently find and consume
  // its own match. See docs/TROUBLESHOOTING.md #24.
  const touchHandledAtRef = useRef<Map<Color, number[]>>(new Map());
  // Consecutive mint presses since the last non-mint press, used to pick
  // the next sound in playColorClickSound's mint cycle. Reset on every new
  // turn (see the disabled-transition effect below) — without that, a
  // ButtonPanel that stays mounted across turns (e.g. a team that keeps
  // getting turns back to back) can carry a nonzero streak into a new
  // turn's sequence, playing a different sound locally than what
  // useSequencePressSound recomputes fresh for everyone else from the
  // actual sequence/cursor.
  const mintStreakRef = useRef(0);

  useEffect(() => {
    if (!disabled) mintStreakRef.current = 0;
  }, [disabled]);

  // Feature-detected — iOS Safari doesn't implement the Vibration API at
  // all (silently a no-op there, not an error), so this only actually does
  // anything on Android. navigator.vibrate() itself is effectively free
  // (dispatches to the OS haptic engine, doesn't block the main thread),
  // so this doesn't add to the touch-responsiveness cost this file is
  // otherwise so careful about.
  function vibrate() {
    navigator.vibrate?.(10);
  }

  function playClickSound(color: Color) {
    if (color === "mint") {
      playColorClickSound(color, mintStreakRef.current);
      mintStreakRef.current += 1;
      return;
    }
    mintStreakRef.current = 0;
    playColorClickSound(color);
  }

  // onPress (network send) fires before playClickSound (decorative,
  // touches the Audio API) in both handlers below — not because either is
  // measurably slow on its own, but so the actual input signal is never
  // waiting behind anything else on the rare occasion audio playback does
  // hiccup, instead of the two racing in whatever order they happened to
  // be written.
  function handleTouchStart(color: Color) {
    if (disabled) return;
    const now = Date.now();
    // Drop anything already outside the dedupe window while we're here —
    // keeps the array from growing unbounded across a long session if some
    // touchstarts never get a matching synthetic click at all.
    const pending = (touchHandledAtRef.current.get(color) ?? []).filter(
      (t) => now - t < TOUCH_DEDUPE_WINDOW_MS,
    );
    pending.push(now);
    touchHandledAtRef.current.set(color, pending);
    onPress(color);
    playClickSound(color);
    vibrate();
  }

  function handleClick(color: Color) {
    const pending = touchHandledAtRef.current.get(color);
    const now = Date.now();
    const matchIndex = pending?.findIndex((t) => now - t < TOUCH_DEDUPE_WINDOW_MS) ?? -1;
    if (matchIndex !== -1) {
      // Consume only THIS click's own match, not the whole color's queue —
      // a second real touch on the same color (mint runs) still has its
      // own pending entry waiting for its own synthetic click.
      pending!.splice(matchIndex, 1);
      return;
    }
    onPress(color);
    playClickSound(color);
    vibrate();
  }

  return (
    <div className={panelBg.panelBg}>
      <div className={styles.panel}>
        {(() => {
          let emptySlotIndex = 0;
          return SLOT_ORDER.map((position) => {
            const color = slots[position];
            const positionClass = styles[position];
            if (!color) {
              const item = inventory[emptySlotIndex];
              emptySlotIndex += 1;
              if (!item) {
                return <div key={position} className={`${styles.empty} ${positionClass}`} />;
              }
              return (
                // Deliberately NOT `disabled={disabled}` — unlike color
                // buttons, items stay usable through the deferred hand-off
                // window after this turn's outcome is already decided (see
                // MatchRoom.ts's handleUseItem, which isn't gated on
                // turnDecided either).
                <button
                  key={position}
                  type="button"
                  aria-label={item}
                  onClick={() => onUseItem?.(item)}
                  className={`${styles.itemButton} ${positionClass}`}
                  style={{ backgroundImage: `url(${ITEM_ICON[item]})` }}
                />
              );
            }
            return (
              <button
                key={position}
                type="button"
                aria-label={color}
                disabled={disabled}
                onTouchStart={() => handleTouchStart(color)}
                onClick={() => handleClick(color)}
                className={`${styles.button} ${positionClass}`}
                style={{ backgroundImage: `url(${COLOR_TOKEN[color]})` }}
              />
            );
          });
        })()}
      </div>
    </div>
  );
}, buttonPanelPropsEqual);
