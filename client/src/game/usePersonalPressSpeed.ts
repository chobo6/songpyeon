import { useCallback, useRef, useState } from "react";

// 본인이 직접 누른 프레스끼리의 연속 간격 누적 평균 — 동료 프레스는 집계
// 대상이 아니고(이 훅은 MyTurnScreen 쪽에서만 호출됨), 턴 사이 공백도 안
// 섞이도록 resetAnchor()로 매 턴 시작 시 기준점만 지운다(누적 합/횟수는
// 매치 "전체" 유지 — resetAll()이 호출되기 전까지만이라는 뜻. Game.tsx에서
// 호출해 MyTurnScreen이 턴마다 언마운트/리마운트돼도 누적치가 안 날아가게
// 한다 — 채팅 draft 유지와 동일한 이유.
export function usePersonalPressSpeed() {
  const lastPressAtRef = useRef<number | null>(null);
  const totalMsRef = useRef(0);
  const countRef = useRef(0);
  const [averageMs, setAverageMs] = useState<number | null>(null);

  const resetAnchor = useCallback(() => {
    lastPressAtRef.current = null;
  }, []);

  // 재대결(rematch)로 새 매치가 시작될 때 호출 — Game 컴포넌트 자체는
  // phase가 playing→lobby→playing으로 바뀌는 동안 계속 마운트된 채라
  // (재대결마다 언마운트되지 않음) resetAnchor()만으로는 누적 합/횟수가
  // 이전 매치 것과 섞여 넘어간다. 매치 경계에서 누적치까지 통째로 지운다.
  const resetAll = useCallback(() => {
    lastPressAtRef.current = null;
    totalMsRef.current = 0;
    countRef.current = 0;
    setAverageMs(null);
  }, []);

  const recordPress = useCallback(() => {
    const now = Date.now();
    if (lastPressAtRef.current !== null) {
      totalMsRef.current += now - lastPressAtRef.current;
      countRef.current += 1;
      setAverageMs(totalMsRef.current / countRef.current);
    }
    lastPressAtRef.current = now;
  }, []);

  return { averageMs, recordPress, resetAnchor, resetAll };
}
