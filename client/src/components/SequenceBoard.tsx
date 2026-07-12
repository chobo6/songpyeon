import type { Color } from "../game/colors";
import { COLOR_HEX } from "../game/colors";
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
  const remaining = sequence.slice(cursor);
  const rows = chunk(remaining, TOKENS_PER_ROW);

  return (
    <div className={styles.board}>
      {rows.map((row, rowIndex) => (
        <div className={styles.row} key={rowIndex}>
          {row.map((color, i) => (
            <div key={i} className={styles.tokenWrap}>
              {rowIndex === 0 && i === 0 && <div className={styles.cursor} />}
              <div className={styles.token} data-color={color} style={{ background: COLOR_HEX[color] }} />
              {i < row.length - 1 && <div className={styles.link} />}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
