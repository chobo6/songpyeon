import type { CSSProperties } from "react";
import styles from "./nicknameStyle.module.css";

const DEFAULT_GLOW_COLOR = "#ffffff";

// 닉네임을 렌더링하는 모든 화면(팀 로스터/채팅/랭킹/친구창/관전자 목록/
// 프로필 팝업)이 공통으로 쓰는 스타일 계산기. 레인보우는 지정된 색을
// 덮어쓰는 움직이는 그라데이션(className으로 적용 — 애니메이션은 CSS
// keyframes가 필요해 인라인 style로는 불가능). 글로우는 닉네임 자기 색
// 기준의 text-shadow이며 레인보우와 독립적으로 켤 수 있다 — 레인보우가
// 켜져 있으면 대표색이 없으므로 흰색으로 대체한다.
export function nicknameStyle(
  color: string | null | undefined,
  rainbow: boolean | undefined,
  glow: boolean | undefined,
): { className: string; style: CSSProperties } {
  const style: CSSProperties = {};

  if (glow) {
    const glowColor = rainbow ? DEFAULT_GLOW_COLOR : color || DEFAULT_GLOW_COLOR;
    style.textShadow = `0 0 6px ${glowColor}, 0 0 16px ${glowColor}`;
  }

  if (rainbow) {
    return { className: styles.rainbow, style };
  }

  if (color) {
    style.color = color;
  }
  return { className: "", style };
}
