import type { CSSProperties } from "react";
import styles from "./nicknameStyle.module.css";

export type NicknameEffect = "none" | "rainbow" | "shine" | "hologram" | "pulse" | "neon" | "chrome";

const DEFAULT_GLOW_COLOR = "#ffffff";
const DEFAULT_SHINE_BASE_COLOR = "#6fb1ff";
const DEFAULT_PULSE_BASE_COLOR = "#6fb1ff";
const DEFAULT_NEON_BASE_COLOR = "#ff3df0";

const EFFECT_CLASSNAME: Record<Exclude<NicknameEffect, "none">, string> = {
  rainbow: styles.rainbow,
  shine: styles.shine,
  hologram: styles.hologram,
  pulse: styles.pulse,
  neon: styles.neon,
  chrome: styles.chrome,
};

// Pulse·네온사인은 그 자체가 이미 애니메이션되는 text-shadow라, 독립 글로우의 인라인
// style.textShadow를 얹으면 인라인 스타일이 CSS 클래스의 애니메이션 그림자를 덮어써서
// 깜빡임/숨쉬기 자체가 죽는다(단순히 안 예쁜 수준이 아니라 실제로 효과가 사라지는 버그) —
// 그래서 이 둘일 땐 글로우를 아예 계산하지 않는다.
const NO_INDEPENDENT_GLOW = new Set<NicknameEffect>(["pulse", "neon"]);

// 닉네임을 렌더링하는 모든 화면이 공통으로 쓰는 스타일 계산기. 레인보우/샤인/홀로그램/
// Pulse/네온사인/크롬은 서로 배타적(닉네임의 "기본 색"을 정의하는 효과라 동시에 켤 수
// 없음 — nicknameEffect가 이미 하나의 값만 가지므로 구조적으로 보장됨). 글로우는
// 독립적으로 켤 수 있는 text-shadow이지만 Pulse/네온사인일 땐 예외(위 주석 참고).
export function nicknameStyle(
  color: string | null | undefined,
  effect: NicknameEffect | undefined,
  glow: boolean | undefined,
): { className: string; style: CSSProperties } {
  const style: CSSProperties = {};

  if (glow && !(effect && NO_INDEPENDENT_GLOW.has(effect))) {
    const glowColor = effect && effect !== "none" ? DEFAULT_GLOW_COLOR : color || DEFAULT_GLOW_COLOR;
    style.textShadow = `0 0 6px ${glowColor}, 0 0 16px ${glowColor}`;
  }

  if (effect === "shine" || effect === "pulse" || effect === "neon") {
    // 이 셋은 "그 사람 색 위에" 얹히는 효과라 레인보우/홀로그램/크롬과 달리 고정
    // 팔레트가 아님 — CSS 변수로 베이스 색을 주입한다(CSSProperties엔 커스텀
    // 프로퍼티 타입이 없어 캐스팅이 필요).
    const fallback =
      effect === "shine"
        ? DEFAULT_SHINE_BASE_COLOR
        : effect === "pulse"
          ? DEFAULT_PULSE_BASE_COLOR
          : DEFAULT_NEON_BASE_COLOR;
    (style as CSSProperties & Record<string, string>)["--nickname-base-color"] = color || fallback;
  }

  if (effect && effect !== "none") {
    return { className: EFFECT_CLASSNAME[effect], style };
  }

  if (color) {
    style.color = color;
  }
  return { className: "", style };
}
