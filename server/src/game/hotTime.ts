// 핫타임: 한국시간(KST, UTC+9) 기준 토/일요일 23시~24시 사이엔 게임머니 지급이 2배.
// UTC 타임스탬프에 9시간을 더한 뒤 그 결과를 UTC로 읽으면 서버 자체 타임존 설정과
// 무관하게 KST 기준 요일/시각을 얻을 수 있다 (Intl/타임존 라이브러리 불필요).
export function isHotTime(date: Date = new Date()): boolean {
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const day = kst.getUTCDay(); // 0=일, 6=토
  const hour = kst.getUTCHours();
  return (day === 0 || day === 6) && hour === 23;
}

export const HOT_TIME_MULTIPLIER = 2;
