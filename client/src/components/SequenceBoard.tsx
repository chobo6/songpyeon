import type { Color } from "../game/colors";
import { COLOR_TOKEN, COLOR_TOKEN_OFF } from "../game/colors";
import styles from "./SequenceBoard.module.css";

const TOKENS_PER_ROW = 6;

function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    rows.push(items.slice(i, i + size));
  }
  return rows;
}

export function SequenceBoard({ sequence, cursor }: { sequence: Color[]; cursor: number }) {
  const rows = chunk(sequence, TOKENS_PER_ROW);
  const currentRow = Math.floor(cursor / TOKENS_PER_ROW);

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
              return (
                <div key={i} className={styles.tokenWrap}>
                  {globalIndex === cursor && <div className={styles.cursor} />}
                  <div
                    className={isDone ? `${styles.token} ${styles.done}` : styles.token}
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
