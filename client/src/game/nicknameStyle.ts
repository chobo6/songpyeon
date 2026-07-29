import type { CSSProperties } from "react";
import styles from "./nicknameStyle.module.css";

export type NicknameEffect = "none" | "rainbow" | "shine" | "hologram";

const DEFAULT_GLOW_COLOR = "#ffffff";
const DEFAULT_SHINE_BASE_COLOR = "#6fb1ff";

const EFFECT_CLASSNAME: Record<Exclude<NicknameEffect, "none">, string> = {
  rainbow: styles.rainbow,
  shine: styles.shine,
  hologram: styles.hologram,
};

// 닉네임을 렌더링하는 모든 화면이 공통으로 쓰는 스타일 계산기. 레인보우/샤인/홀로그램은
// 서로 배타적(닉네임의 "기본 색"을 정의하는 효과라 동시에 켤 수 없음 — nicknameEffect가
// 이미 하나의 값만 가지므로 구조적으로 보장됨). 글로우는 독립적으로 켤 수 있는 text-shadow.
export function nicknameStyle(
  color: string | null | undefined,
  effect: NicknameEffect | undefined,
  glow: boolean | undefined,
): { className: string; style: CSSProperties } {
  const style: CSSProperties = {};

  if (glow) {
    const glowColor = effect && effect !== "none" ? DEFAULT_GLOW_COLOR : color || DEFAULT_GLOW_COLOR;
    style.textShadow = `0 0 6px ${glowColor}, 0 0 16px ${glowColor}`;
  }

  if (effect === "shine") {
    // 샤인은 "그 사람 색 위에" 빛이 지나가는 효과라 레인보우/홀로그램과 달리 고정
    // 팔레트가 아님 — CSS 변수로 베이스 색을 주입한다(CSSProperties엔 커스텀
    // 프로퍼티 타입이 없어 캐스팅이 필요).
    (style as CSSProperties & Record<string, string>)["--nickname-base-color"] = color || DEFAULT_SHINE_BASE_COLOR;
  }

  if (effect && effect !== "none") {
    return { className: EFFECT_CLASSNAME[effect], style };
  }

  if (color) {
    style.color = color;
  }
  return { className: "", style };
}
