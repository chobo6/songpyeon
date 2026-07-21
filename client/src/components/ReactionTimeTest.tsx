import { useCallback, useEffect, useRef, useState } from "react";
import { COLOR_TOKEN } from "../game/colors";
import styles from "./ReactionTimeTest.module.css";

// 임시 테스트 도구 — "신호에 반응하는 속도"가 아니라 "버튼을 얼마나 빠르게 연타할 수
// 있는지"(누른 시점 사이의 간격, ms)를 재기 위한 용도. 터치로 연타했을 때랑 z/x 키로
// 연타했을 때 간격이 실제로 얼마나 차이 나는지 직접 비교해보기 위함. 이 화면 자체를
// 실제 게임에 반영할 계획은 없음 — SoloRoleSelect.tsx의 "반응속도 테스트(임시)" 버튼에서만
// 진입 가능.
const HISTORY_LIMIT = 20;

export function ReactionTimeTest({ onBack }: { onBack: () => void }) {
  const [lastIntervalMs, setLastIntervalMs] = useState<number | null>(null);
  const [history, setHistory] = useState<number[]>([]);
  const lastPressAtRef = useRef<number | null>(null);

  const handlePress = useCallback(() => {
    const now = Date.now();
    const previous = lastPressAtRef.current;
    lastPressAtRef.current = now;
    if (previous === null) return; // 첫 입력은 기준점만 세우고 간격은 없음(비교 대상이 없음)

    const interval = now - previous;
    setLastIntervalMs(interval);
    setHistory((prev) => [interval, ...prev].slice(0, HISTORY_LIMIT));
  }, []);

  // z/x 키를 실제 버튼 누름과 동일하게 취급 — 키보드/매크로로 연타했을 때의 입력 속도를
  // 손가락 터치 연타와 비교해보기 위한 것.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const key = e.key.toLowerCase();
      if (key === "z" || key === "x") handlePress();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handlePress]);

  function handleTouchStart(e: React.TouchEvent) {
    e.preventDefault();
    handlePress();
  }

  function handleReset() {
    lastPressAtRef.current = null;
    setLastIntervalMs(null);
    setHistory([]);
  }

  const average =
    history.length > 0 ? Math.round(history.reduce((sum, ms) => sum + ms, 0) / history.length) : null;

  return (
    <div className={styles.wrap}>
      <h1 className={styles.title}>입력 속도 테스트 (임시)</h1>
      <p className={styles.hint}>화면을 연타하거나 키보드 z / x 키를 연타해보세요 — 누른 간격(ms)을 잽니다</p>

      <button
        type="button"
        className={styles.button}
        onTouchStart={handleTouchStart}
        onClick={handlePress}
        style={{ backgroundImage: `url(${COLOR_TOKEN.mint})` }}
        aria-label="mint"
      />

      <div className={styles.status}>
        {lastIntervalMs !== null ? (
          <p className={styles.result}>간격: {lastIntervalMs}ms</p>
        ) : (
          <p className={styles.result}>버튼을 눌러 시작하세요</p>
        )}
        {average !== null && (
          <p className={styles.average}>
            평균 {average}ms ({history.length}회)
          </p>
        )}
      </div>

      {history.length > 0 && (
        <div className={styles.history}>
          <p className={styles.historyLabel}>최근 기록 (ms, 최신순)</p>
          <div className={styles.historyList}>
            {history.map((ms, i) => (
              <span key={i} className={styles.historyItem}>
                {ms}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className={styles.actions}>
        <button className={styles.backLink} onClick={handleReset}>
          기록 초기화
        </button>
        <button className={styles.backLink} onClick={onBack}>
          ← 뒤로
        </button>
      </div>
    </div>
  );
}
