import { memo } from "react";
import type { Color } from "../game/colors";
import { COLOR_TOKEN, COLOR_TOKEN_OFF } from "../game/colors";
import type { TurnOutcome } from "../game/matchTypes";
import styles from "./SequenceBoard.module.css";

const TOKENS_PER_ROW = 6;

function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    rows.push(items.slice(i, i + size));
  }
  return rows;
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
  showCursor,
  isLastInRow,
}: {
  color: Color;
  isDone: boolean;
  isMissed: boolean;
  showCursor: boolean;
  isLastInRow: boolean;
}) {
  return (
    <div className={styles.tokenWrap}>
      {showCursor && !isMissed && <div className={styles.cursor} />}
      <div
        className={
          isMissed ? `${styles.token} ${styles.missed}` : isDone ? `${styles.token} ${styles.done}` : styles.token
        }
        data-color={color}
        style={{ backgroundImage: `url(${isDone ? COLOR_TOKEN_OFF[color] : COLOR_TOKEN[color]})` }}
      />
      {!isLastInRow && <div className={styles.link} />}
    </div>
  );
});

export function SequenceBoard({
  sequence,
  cursor,
  turnOutcome,
}: {
  sequence: Color[];
  cursor: number;
  // Optional: a wrong press or timeout never advances the cursor (see
  // server/src/game/turnOrder.ts), so once turnOutcome flips to "fail" the
  // cursor is still sitting exactly on the token everyone missed — no
  // separate "which token was wrong" field needed. Omit this prop (e.g. from
  // callers with no outcome concept) to just get the plain cursor marker.
  turnOutcome?: TurnOutcome;
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
