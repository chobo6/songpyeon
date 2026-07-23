import styles from "./TeamComboBadge.module.css";

// 현재 턴인 팀의 콤보만 보여줌 — 텍스트 라벨 없이 이모지 + 숫자만.
export function TeamComboBadge({ combo }: { combo: number }) {
  return <div className={styles.badge}>🔥{combo}</div>;
}
