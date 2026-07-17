import { useEffect, useRef } from "react";

// TEMP diagnostic — remove after collecting real touch data from a friend's
// iPhone (docs/TROUBLESHOOTING.md #19/#20 — several fixes tried, unclear
// which if any actually helped, need real data instead of more guessing).
//
// Logs every touchstart/touchend anywhere on the page: sequence number, time
// since the previous logged touch, raw coordinates, and — critically —
// document.elementFromPoint() at those coordinates, so we can tell apart
// "the tap landed on the wrong element" (a targeting/hit-box problem) from
// "the tap landed on the right button but the app didn't react" (a bug in
// our handlers) from "no log line appears at all for a tap the user swears
// they made" (the browser/OS never delivered the touch event to the page).
//
// Written to update the DOM directly via a ref (not React state) so the
// logger itself never triggers a re-render — logging touch activity should
// not be able to skew the exact responsiveness problem it's measuring.
const MAX_LINES = 14;

function describeTarget(x: number, y: number): string {
  const el = document.elementFromPoint(x, y);
  if (!el) return "(없음)";
  const button = el.closest("button");
  if (button) {
    const label = button.getAttribute("aria-label") ?? button.textContent ?? "?";
    return `button[${label}]${button.disabled ? " disabled" : ""}`;
  }
  const withClass = el as HTMLElement;
  const firstClass = typeof withClass.className === "string" ? withClass.className.split(" ")[0] : "";
  return `${el.tagName.toLowerCase()}${firstClass ? "." + firstClass : ""}`;
}

// The bottom button/roster panel (ButtonPanel.tsx and TeamRosterPanel.tsx
// both wrap in the same bottomPanelBackground.module.css) is the one piece
// of chrome present on every gameplay screen — anchoring the log just above
// it (roughly where the online spectator screen's chat sits, between the
// board and the panel) keeps it off the SequenceBoard regardless of which
// screen/role is showing. CSS module classnames in this project's build
// keep the original name as a prefix (confirmed empirically: e.g.
// `_panelBg_1ug12_9`), so a substring match is reliable here without
// needing to plumb a ref/data-attribute through for a temp diagnostic.
function findPanelTop(): number | null {
  const el = document.querySelector('[class*="panelBg"]');
  if (!el) return null;
  return el.getBoundingClientRect().top;
}

export function TouchDebugOverlay() {
  const containerElRef = useRef<HTMLDivElement>(null);
  const logElRef = useRef<HTMLDivElement>(null);
  const linesRef = useRef<string[]>([]);
  const lastTimeRef = useRef<number | null>(null);
  const countRef = useRef(0);

  useEffect(() => {
    function log(type: string, e: TouchEvent) {
      const touch = e.changedTouches[0];
      if (!touch) return;
      const now = performance.now();
      const delta = lastTimeRef.current === null ? 0 : Math.round(now - lastTimeRef.current);
      lastTimeRef.current = now;
      countRef.current += 1;
      const x = Math.round(touch.clientX);
      const y = Math.round(touch.clientY);
      const line = `#${countRef.current} ${type} +${delta}ms (${x},${y}) ${describeTarget(x, y)}`;
      linesRef.current.push(line);
      if (linesRef.current.length > MAX_LINES) linesRef.current.shift();
      if (logElRef.current) logElRef.current.textContent = linesRef.current.join("\n");
    }

    const onStart = (e: TouchEvent) => log("start ", e);
    const onEnd = (e: TouchEvent) => log("end   ", e);
    // Distinct from end — fires when iOS itself decides to abort an
    // in-progress touch (handing it to a system gesture, or the touch
    // controller losing/reacquiring contact) rather than the finger being
    // deliberately lifted. If a "purple pressed twice" case turns out to be
    // start->cancel->start->end instead of two clean start->end pairs, that
    // confirms the touch controller — not the user — split one continuous
    // contact into two, since a genuine lift+retouch would show end, not
    // cancel. Not listened for before this — see docs/TROUBLESHOOTING.md #19/#20.
    const onCancel = (e: TouchEvent) => log("CANCEL", e);

    // capture: true so this sees every touch regardless of where in the
    // tree it lands or whether anything else stops propagation. passive:
    // true since this never calls preventDefault — must not interfere with
    // the actual game's own touch handling in any way.
    document.addEventListener("touchstart", onStart, { capture: true, passive: true });
    document.addEventListener("touchend", onEnd, { capture: true, passive: true });
    document.addEventListener("touchcancel", onCancel, { capture: true, passive: true });
    return () => {
      document.removeEventListener("touchstart", onStart, { capture: true });
      document.removeEventListener("touchend", onEnd, { capture: true });
      document.removeEventListener("touchcancel", onCancel, { capture: true });
    };
  }, []);

  useEffect(() => {
    // Re-measured on a plain interval rather than a one-shot layout effect —
    // the panel mounts/unmounts and moves as the app navigates between
    // screens (nickname entry has no panel at all; the board grows a row
    // every 10 rounds, shifting the panel down), and this is throwaway
    // diagnostic code where a cheap poll is simpler than wiring a
    // MutationObserver/ResizeObserver correctly for every screen transition.
    function reposition() {
      const el = containerElRef.current;
      if (!el) return;
      const top = findPanelTop();
      if (top === null) {
        // No panel on screen (e.g. nickname/room-list) — pin to the bottom
        // instead of leaving it stuck wherever it last was measured.
        el.style.bottom = "0px";
      } else {
        el.style.bottom = `${Math.max(0, window.innerHeight - top)}px`;
      }
    }
    reposition();
    const id = window.setInterval(reposition, 300);
    window.addEventListener("resize", reposition);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("resize", reposition);
    };
  }, []);

  return (
    <div
      ref={containerElRef}
      // pointerEvents: none is critical — this overlay sits on top of
      // everything (highest z-index) so it must never itself intercept a
      // touch meant for a button underneath it.
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        zIndex: 999999,
        pointerEvents: "none",
      }}
    >
      <div
        ref={logElRef}
        style={{
          maxHeight: "22vh",
          overflow: "hidden",
          background: "rgba(0,0,0,0.85)",
          color: "#4ade80",
          fontFamily: "ui-monospace, monospace",
          fontSize: "10px",
          lineHeight: 1.4,
          padding: "4px 6px",
          whiteSpace: "pre-wrap",
        }}
      />
    </div>
  );
}
