import { useEffect } from "react";
import type { Color, Role } from "./colors";

// 역할별 4키 매핑 — 온라인/솔로 모드 공용. 돼지와 토끼가 서로 다른 매핑을 쓰므로
// (돼지 s/a/d/m, 토끼 z/k/l/m) 'm'이 양쪽에 겹쳐 있어도 실제로는 한 플레이어가
// 자기 역할의 매핑만 쓰기 때문에 충돌하지 않는다.
const PIG_KEY_MAP: Record<string, Color> = { s: "red", a: "yellow", d: "orange", m: "purple" };
// 민트는 z/x 두 키 모두로 누를 수 있다 — 같은 버튼을 반복해서 눌러야 하는
// 유일한 패턴(민트 런)이라 한 손가락에 의존하지 않게 하기 위함.
const RABBIT_KEY_MAP: Record<string, Color> = { z: "mint", x: "mint", k: "green", l: "blue", m: "pink" };

// 버튼 클릭/터치와 동일한 press 콜백을 키보드로도 호출할 수 있게 한다 — MyTurnScreen
// (온라인)과 SoloPlayScreen(솔로) 양쪽에서 그대로 재사용.
export function useColorKeyPress(role: Role, disabled: boolean, press: (color: Color) => void) {
  useEffect(() => {
    if (disabled) return;
    const keyMap = role === "pig" ? PIG_KEY_MAP : RABBIT_KEY_MAP;

    function onKeyDown(e: KeyboardEvent) {
      // 채팅 입력 등 텍스트 필드에 타이핑 중이면 게임 입력으로 새지 않게 한다.
      const active = document.activeElement;
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return;
      // OS의 키 자동 반복(길게 누르고 있을 때) — 손가락으로 버튼을 계속 누르고
      // 있어도 한 번만 눌린 것으로 처리되는 클릭/터치와 동작을 맞추기 위해 무시.
      if (e.repeat) return;
      const color = keyMap[e.key.toLowerCase()];
      if (color) press(color);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [role, disabled, press]);
}
