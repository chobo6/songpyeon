import styles from "./MyAverageSpeedBadge.module.css";

// averageMs가 null이면(아직 연속 프레스 간격이 한 번도 안 잡힘) 아무것도
// 안 그림 — 의미 없는 "0.00초" 플레이스홀더를 보여주지 않기 위함.
export function MyAverageSpeedBadge({ averageMs }: { averageMs: number | null }) {
  if (averageMs === null) return null;
  return <div className={styles.badge}>⚡ {(averageMs / 1000).toFixed(2)}초</div>;
}
