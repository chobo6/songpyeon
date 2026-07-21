import { useCallback, useEffect, useRef, useState } from "react";
import { COLOR_TOKEN } from "../game/colors";
import styles from "./AdminKeyTestTool.module.css";

// 관리자 전용 임시 도구 — 키보드/매크로 의심 정황이 있을 때, 사람이 실제로 낼 수
// 있는 연타 속도가 어느 정도인지 관리자가 직접 재보기 위한 참고용. 예전에
// 혼자 연습 모드 진입점에 있던 반응속도 테스트 도구(docs/TROUBLESHOOTING.md #25에
// 원본 기록)를 관리자 페이지로 옮기고, z/x 두 키만 반응하던 걸 전체 키로 넓힘.
const HISTORY_LIMIT = 20;

// server/src/game/inputSpamGuard.ts의 MINT_SPAM_THRESHOLD_MS와 같은 값 — 지금
// 재는 간격이 실제 서버 가드 기준으로 씹힐 속도인지 참고용으로만 비교. 서버 값이
// 바뀌면 여기도 같이 맞출 것(별도 client 사본 모듈까지 만들 정도는 아니라 상수만
// 복사해둠 — 이 도구 자체가 임시라 재사용 부담이 낮음).
const MINT_SPAM_THRESHOLD_MS = 35;

export function AdminKeyTestTool({ onBack }: { onBack: () => void }) {
  const [lastIntervalMs, setLastIntervalMs] = useState<number | null>(null);
  const [history, setHistory] = useState<number[]>([]);
  const [blockedIntervalMs, setBlockedIntervalMs] = useState<number | null>(null);
  const lastPressAtRef = useRef<number | null>(null);

  const handlePress = useCallback(() => {
    const now = Date.now();
    const previous = lastPressAtRef.current;
    lastPressAtRef.current = now;
    if (previous === null) return; // 첫 입력은 기준점만 세우고 간격은 없음(비교 대상이 없음)

    const interval = now - previous;
    if (interval < MINT_SPAM_THRESHOLD_MS) {
      setBlockedIntervalMs(interval);
      return; // 실전 가드와 동일하게 완전히 무시 — 기록/평균에도 반영 안 함
    }

    setBlockedIntervalMs(null);
    setLastIntervalMs(interval);
    setHistory((prev) => [interval, ...prev].slice(0, HISTORY_LIMIT));
  }, []);

  // 이제 z/x 두 키만이 아니라 모든 키에 반응 — 특정 키 조합을 못 쓰는 사람도
  // 자기 손가락/키보드로 바로 테스트해볼 수 있게. e.repeat은 키를 누른 채로
  // 있을 때 OS가 자동으로 반복 발사하는 이벤트라, 사람이 실제로 연타한 게
  // 아닌데도 비정상적으로 짧은 간격이 찍히는 걸 막기 위해 무시한다.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.repeat) return;
      handlePress();
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
    setBlockedIntervalMs(null);
  }

  const average =
    history.length > 0 ? Math.round(history.reduce((sum, ms) => sum + ms, 0) / history.length) : null;

  return (
    <main className={styles.wrap}>
      <button className={styles.backButton} onClick={onBack}>
        ← 대시보드로
      </button>
      <h1 className={styles.title}>입력 속도 테스트 (임시)</h1>
      <p className={styles.hint}>화면을 연타하거나 키보드 아무 키나 연타해보세요 — 누른 간격(ms)을 잽니다</p>

      <button
        type="button"
        className={styles.button}
        onTouchStart={handleTouchStart}
        onClick={handlePress}
        style={{ backgroundImage: `url(${COLOR_TOKEN.mint})` }}
        aria-label="mint"
      />

      <div className={styles.status}>
        {blockedIntervalMs !== null ? (
          <p className={styles.result}>⛔ 씹힘 ({blockedIntervalMs}ms — {MINT_SPAM_THRESHOLD_MS}ms 미만)</p>
        ) : lastIntervalMs !== null ? (
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

      <button className={styles.resetButton} onClick={handleReset}>
        기록 초기화
      </button>
    </main>
  );
}
