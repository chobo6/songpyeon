import { memo, useEffect, useState } from "react";
import type { Color, Role } from "../game/colors";
import { COLOR_TOKEN, COLOR_TOKEN_OFF } from "../game/colors";
import type { RoleChoice, TurnOutcome } from "../game/matchTypes";
import styles from "./SequenceBoard.module.css";

const TOKENS_PER_ROW = 6;
const MISS_FRAME_COUNT = 16;
const MISS_FRAME_INTERVAL_MS = 80;

function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    rows.push(items.slice(i, i + size));
  }
  return rows;
}

// Cycles through the 16 miss-reaction frames for the role that actually
// pressed the wrong button. Kept as its own tiny component (rather than
// inline state on Token) so the 80ms re-render this causes is scoped to
// just this one instance — the missed token — not the whole board. Token
// itself stays memoized and cheap to re-render for the other ~30 tokens
// (see Token's own comment below for why that matters).
function MissFrame({ role }: { role: Role }) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    setFrame(0);
    const id = setInterval(() => setFrame((f) => (f + 1) % MISS_FRAME_COUNT), MISS_FRAME_INTERVAL_MS);
    return () => clearInterval(id);
  }, [role]);
  return (
    <div
      className={styles.missToken}
      style={{ backgroundImage: `url(/game-assets/ui/miss/thanksgiving_room_miss_${role}${frame}.webp)` }}
    />
  );
}

// Every press re-renders the whole board (colyseus mutates its schema
// state in place, so the client forces a re-render on every patch — see
// useMatchRoom.ts's forceRender — there's no way to tell React "only this
// one field changed" from the object reference alone). Without this memo,
// that meant recreating and re-diffing all 18-30 token divs (fresh style
// object + filter recalculation each) on every single press, when a press
// really only changes 1-2 tokens (the one just completed, the one the
// cursor moved to). Memoized on the plain primitives actually derived per
// token (color/isDone/isMissed/showCursor/isLastInRow) instead of on
// `sequence`/`cursor` directly, since those primitives are what actually
// stays the same for ~all of the other tokens on any given press —
// suspected contributor (alongside game/clickSound.ts's audio pooling) to
// input lag under rapid presses on iOS — see docs/TROUBLESHOOTING.md #19/#20.
const Token = memo(function Token({
  color,
  isDone,
  isMissed,
  missedRole,
  showCursor,
  isLastInRow,
}: {
  color: Color;
  isDone: boolean;
  isMissed: boolean;
  // "" for a timeout (no one to blame) or when the caller omitted the prop
  // entirely (solo practice mode — see SequenceBoard's own prop comment).
  missedRole: RoleChoice;
  showCursor: boolean;
  isLastInRow: boolean;
}) {
  return (
    <div className={styles.tokenWrap}>
      {showCursor && !isMissed && <div className={styles.cursor} />}
      {isMissed && missedRole ? (
        <MissFrame role={missedRole} />
      ) : (
        <div
          className={isDone ? `${styles.token} ${styles.done}` : styles.token}
          data-color={color}
          style={{ backgroundImage: `url(${isDone ? COLOR_TOKEN_OFF[color] : COLOR_TOKEN[color]})` }}
        />
      )}
      {!isLastInRow && <div className={styles.link} />}
    </div>
  );
});

export function SequenceBoard({
  sequence,
  cursor,
  turnOutcome,
  missedRole,
}: {
  sequence: Color[];
  cursor: number;
  // Optional: a wrong press or timeout never advances the cursor (see
  // server/src/game/turnOrder.ts), so once turnOutcome flips to "fail" the
  // cursor is still sitting exactly on the token everyone missed — no
  // separate "which token was wrong" field needed. Omit this prop (e.g. from
  // callers with no outcome concept) to just get the plain cursor marker.
  turnOutcome?: TurnOutcome;
  // Optional: online-only. Solo practice mode has no second role to blame
  // and doesn't pass this, so the missed token there just renders plainly
  // (same as a timeout) — no separate code path needed for that.
  missedRole?: RoleChoice;
}) {
  const rows = chunk(sequence, TOKENS_PER_ROW);
  const currentRow = Math.floor(cursor / TOKENS_PER_ROW);
  const missedIndex = turnOutcome === "fail" ? cursor : -1;

  return (
    <div className={styles.viewport}>
      {/* Keying by the sequence itself means a new round (new sequence) gets
          a fresh stack with no leftover scroll position/transition, while
          the same round's cursor advances animate smoothly. */}
      <div
        className={styles.stack}
        key={sequence.join(",")}
        style={{ transform: `translateY(calc(-1 * var(--row-step) * ${currentRow}))` }}
      >
        {rows.map((row, rowIndex) => (
          <div className={styles.row} key={rowIndex}>
            {row.map((color, i) => {
              const globalIndex = rowIndex * TOKENS_PER_ROW + i;
              return (
                <Token
                  key={i}
                  color={color}
                  isDone={globalIndex < cursor}
                  isMissed={globalIndex === missedIndex}
                  missedRole={missedRole ?? ""}
                  showCursor={globalIndex === cursor}
                  isLastInRow={i === row.length - 1}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
