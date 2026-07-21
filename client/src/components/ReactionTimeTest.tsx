import { useCallback, useEffect, useRef, useState } from "react";
import { COLOR_TOKEN } from "../game/colors";
import styles from "./ReactionTimeTest.module.css";

// 임시 테스트 도구 — 실제 반응속도 임계값 기반 부정행위 감지 기능을 설계하기 전에,
// 터치로 눌렀을 때랑 z/x 키로 눌렀을 때 반응속도가 실제로 얼마나 차이 나는지
// 직접 재보기 위한 용도. 이 화면 자체를 실제 게임에 반영할 계획은 없음 —
// SoloRoleSelect.tsx의 "반응속도 테스트(임시)" 버튼에서만 진입 가능.
const MIN_DELAY_MS = 800;
const MAX_DELAY_MS = 2500;
const RESULT_PAUSE_MS = 900;
const HISTORY_LIMIT = 10;

type Phase = "waiting" | "armed" | "result" | "falseStart";

function randomDelay(): number {
  return MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS);
}

export function ReactionTimeTest({ onBack }: { onBack: () => void }) {
  const [phase, setPhase] = useState<Phase>("waiting");
  const [lastMs, setLastMs] = useState<number | null>(null);
  const [history, setHistory] = useState<number[]>([]);

  // 렌더와 무관하게 타이머 콜백이 항상 "지금" 값을 봐야 해서 ref로 병행 추적 —
  // phase state는 화면 표시용, armedAtRef는 실제 시간 계산용.
  const phaseRef = useRef<Phase>("waiting");
  const armedAtRef = useRef<number | null>(null);
  const timeoutIdRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setPhaseBoth = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const scheduleArm = useCallback(() => {
    if (timeoutIdRef.current !== null) clearTimeout(timeoutIdRef.current);
    setPhaseBoth("waiting");
    armedAtRef.current = null;
    timeoutIdRef.current = setTimeout(() => {
      armedAtRef.current = Date.now();
      setPhaseBoth("armed");
    }, randomDelay());
  }, [setPhaseBoth]);

  useEffect(() => {
    scheduleArm();
    return () => {
      if (timeoutIdRef.current !== null) clearTimeout(timeoutIdRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePress = useCallback(() => {
    if (phaseRef.current === "waiting") {
      // 아직 민트 버튼이 뜨기 전인데 눌렀음 — 리듬을 미리 읽고 누른 부정 출발이라
      // 반응속도로 안 침. 짧게 안내하고 새 라운드로.
      if (timeoutIdRef.current !== null) clearTimeout(timeoutIdRef.current);
      setPhaseBoth("falseStart");
      setTimeout(scheduleArm, RESULT_PAUSE_MS);
      return;
    }
    if (phaseRef.current !== "armed" || armedAtRef.current === null) return;

    const ms = Date.now() - armedAtRef.current;
    setLastMs(ms);
    setHistory((prev) => [ms, ...prev].slice(0, HISTORY_LIMIT));
    setPhaseBoth("result");
    setTimeout(scheduleArm, RESULT_PAUSE_MS);
  }, [scheduleArm, setPhaseBoth]);

  // z/x 키를 실제 버튼 누름과 동일하게 취급 — 키보드/매크로로 눌렀을 때의
  // 반응속도를 손가락 터치와 비교해보기 위한 것.
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

  const armed = phase === "armed";

  return (
    <div className={styles.wrap}>
      <h1 className={styles.title}>반응속도 테스트 (임시)</h1>
      <p className={styles.hint}>화면을 터치하거나 키보드 z / x 키를 눌러보세요</p>

      <button
        type="button"
        className={`${styles.button} ${armed ? styles.armed : ""}`}
        onTouchStart={handleTouchStart}
        onClick={handlePress}
        style={{ backgroundImage: `url(${COLOR_TOKEN.mint})` }}
        aria-label="mint"
      />

      <div className={styles.status}>
        {phase === "falseStart" && <p className={styles.falseStart}>부정 출발! 신호가 뜨기 전에 눌렀어요</p>}
        {phase !== "falseStart" && lastMs !== null && <p className={styles.result}>반응속도: {lastMs}ms</p>}
        {phase !== "falseStart" && lastMs === null && <p className={styles.result}>대기 중...</p>}
      </div>

      {history.length > 0 && (
        <div className={styles.history}>
          <p className={styles.historyLabel}>최근 기록 (ms)</p>
          <div className={styles.historyList}>
            {history.map((ms, i) => (
              <span key={i} className={styles.historyItem}>
                {ms}
              </span>
            ))}
          </div>
        </div>
      )}

      <button className={styles.backLink} onClick={onBack}>
        ← 뒤로
      </button>
    </div>
  );
}
