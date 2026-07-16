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
              const isDone = globalIndex < cursor;
              const isMissed = globalIndex === missedIndex;
              return (
                <div key={i} className={styles.tokenWrap}>
                  {globalIndex === cursor && !isMissed && <div className={styles.cursor} />}
                  <div
                    className={
                      isMissed
                        ? `${styles.token} ${styles.missed}`
                        : isDone
                          ? `${styles.token} ${styles.done}`
                          : styles.token
                    }
                    data-color={color}
                    style={{ backgroundImage: `url(${isDone ? COLOR_TOKEN_OFF[color] : COLOR_TOKEN[color]})` }}
                  />
                  {i < row.length - 1 && <div className={styles.link} />}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
