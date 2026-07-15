import { useRef, useState } from "react";
import type { Color, Role } from "../game/colors";
import { COLOR_TOKEN } from "../game/colors";
import { SLOT_ORDER, buttonPanelSlots } from "../game/buttonPanel";
import panelBg from "./bottomPanelBackground.module.css";
import styles from "./ButtonPanel.module.css";

// How long after a touch's pointerdown fires that we still trust a
// same-color click to be that touch's own (browser-synthesized,
// preventDefault()-defeated) duplicate rather than a genuinely new press.
const TOUCH_DEDUPE_WINDOW_MS = 800;

// TEMPORARY iOS touch-drop debugging (2026-07-15) — delete this whole block
// and the overlay <div> in the render below once the root cause is found.
// Shows the last events directly on screen so what actually fires (or
// doesn't) on a real iPhone can be read off the device without needing
// Safari remote debugging (Mac + cable).
const MAX_DEBUG_LOGS = 16;
function useDebugLog() {
  const [logs, setLogs] = useState<string[]>([]);
  function log(line: string) {
    const t = new Date();
    const ts = `${String(t.getMinutes()).padStart(2, "0")}:${String(t.getSeconds()).padStart(2, "0")}.${String(t.getMilliseconds()).padStart(3, "0")}`;
    setLogs((prev) => [...prev.slice(-(MAX_DEBUG_LOGS - 1)), `${ts} ${line}`]);
  }
  return { logs, log };
}

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

  const touchHandledAtRef = useRef<Map<Color, number>>(new Map());
  const { logs, log } = useDebugLog();

  function handleTouchStart(color: Color) {
    log(`touchstart ${color}`);
  }

  function handlePointerDown(e: React.PointerEvent<HTMLButtonElement>, color: Color) {
    log(`pointerdown ${color} type=${e.pointerType} disabled=${disabled}`);
    if (disabled) return;
    if (e.pointerType === "touch") {
      touchHandledAtRef.current.set(color, Date.now());
      onPress(color);
      log(`  -> onPress(${color}) [pointerdown]`);
    }
  }

  function handleClick(color: Color) {
    const touchedAt = touchHandledAtRef.current.get(color);
    if (touchedAt !== undefined && Date.now() - touchedAt < TOUCH_DEDUPE_WINDOW_MS) {
      touchHandledAtRef.current.delete(color);
      log(`click ${color} [deduped]`);
      return;
    }
    log(`click ${color} -> onPress(${color}) [click]`);
    onPress(color);
  }

  return (
    <>
      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 9999,
          background: "rgba(0,0,0,0.85)",
          color: "#4ade80",
          fontFamily: "monospace",
          fontSize: "10px",
          lineHeight: 1.3,
          padding: "4px 6px",
          maxHeight: "38vh",
          overflowY: "auto",
          pointerEvents: "none",
          whiteSpace: "pre-wrap",
        }}
      >
        {logs.length === 0 && <div>(debug log — 버튼을 눌러보세요)</div>}
        {logs.map((line, i) => (
          <div key={i}>{line}</div>
        ))}
      </div>
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
                onTouchStart={() => handleTouchStart(color)}
                onPointerDown={(e) => handlePointerDown(e, color)}
                onClick={() => handleClick(color)}
                className={`${styles.button} ${positionClass}`}
                style={{ backgroundImage: `url(${COLOR_TOKEN[color]})` }}
              />
            );
          })}
        </div>
      </div>
    </>
  );
}
