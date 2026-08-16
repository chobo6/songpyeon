import { useEffect } from "react";

// 클릭된 요소에서 가장 가까운 버튼/링크의 라벨을 뽑는다 — 랭킹/듀오구인 목록의
// 닉네임 버튼은 그 자체로 textContent가 닉네임이라(RankingModal.tsx,
// DuoBoardModal.tsx), 이 함수 하나로 "무슨 버튼을 눌렀는지"뿐 아니라
// "어떤 닉네임의 프로필을 열어봤는지"까지 자연히 잡힌다.
function nearestButtonLabel(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  const el = target.closest("button, a, [role='button']");
  if (!el) return null;
  const label = (el.getAttribute("aria-label") ?? el.textContent ?? "").trim();
  return label || "(라벨 없음)";
}

function sendActionLog(action: string, detail: string): void {
  fetch("/api/auth/action-log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ action, detail }),
  }).catch(() => {});
}

// enabled는 /api/auth/me가 내려준 trackActions 플래그다 — 조사 대상이 아닌
// 계정에서는 enabled가 항상 false라 리스너 자체가 안 붙는다. 대상 닉네임 문자열은
// 서버(admin/actionLog.ts)에만 있고 이 클라이언트 코드 어디에도 등장하지 않는다.
export function useActionLogging(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;

    function handleClick(e: MouseEvent) {
      const label = nearestButtonLabel(e.target);
      if (label) sendActionLog("click", label);
    }

    document.addEventListener("click", handleClick, true);
    return () => document.removeEventListener("click", handleClick, true);
  }, [enabled]);
}
