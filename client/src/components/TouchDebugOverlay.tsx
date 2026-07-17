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

export function TouchDebugOverlay() {
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

    const onStart = (e: TouchEvent) => log("start", e);
    const onEnd = (e: TouchEvent) => log("end  ", e);

    // capture: true so this sees every touch regardless of where in the
    // tree it lands or whether anything else stops propagation. passive:
    // true since this never calls preventDefault — must not interfere with
    // the actual game's own touch handling in any way.
    document.addEventListener("touchstart", onStart, { capture: true, passive: true });
    document.addEventListener("touchend", onEnd, { capture: true, passive: true });
    return () => {
      document.removeEventListener("touchstart", onStart, { capture: true });
      document.removeEventListener("touchend", onEnd, { capture: true });
    };
  }, []);

  return (
    <div
      ref={logElRef}
      // pointerEvents: none is critical — this overlay sits on top of
      // everything (highest z-index) so it must never itself intercept a
      // touch meant for a button underneath it.
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 999999,
        maxHeight: "38vh",
        overflow: "hidden",
        background: "rgba(0,0,0,0.85)",
        color: "#4ade80",
        fontFamily: "ui-monospace, monospace",
        fontSize: "10px",
        lineHeight: 1.4,
        padding: "4px 6px",
        whiteSpace: "pre-wrap",
        pointerEvents: "none",
      }}
    />
  );
}
