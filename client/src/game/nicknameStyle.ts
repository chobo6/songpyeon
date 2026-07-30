import type { CSSProperties } from "react";
import styles from "./nicknameStyle.module.css";

export type NicknameEffect = "none" | "rainbow" | "shine" | "hologram" | "pulse" | "neon" | "chrome";
export type NicknameParticle = "none" | "twinkle" | "rising" | "orbit" | "snow";

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

const PARTICLE_DOT_COUNT = 10;
const PARTICLE_SIMPLE_CLASSNAME: Record<Exclude<NicknameParticle, "none" | "orbit">, string> = {
  twinkle: styles.twinkleDot,
  rising: styles.risingDot,
  snow: styles.snowDot,
};

export type ParticleDot = { key: number; className: string; style: CSSProperties };

// 문자열 해시 → [0,1) 유사난수. Math.random()은 nicknameStyle()이 리렌더마다
// 다시 호출되는 일반 함수라 쓰면 매번 위치가 튀어 보이므로, color 문자열(유저마다
// 고유)을 시드로 써서 "그 사람은 항상 같은 위치" + "사람마다 달라 보임"을 동시에
// 만족시킨다. salt를 바꿔가며 여러 개의 서로 다른(상관없어 보이는) 값을 뽑는다.
function seededUnit(seed: number, salt: number): number {
  const x = Math.sin(seed * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}
function seededOffset(seed: number, salt: number, range: number): number {
  return (seededUnit(seed, salt) - 0.5) * 2 * range;
}
function stringSeed(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0;
  }
  return hash;
}

// 점 하나하나(PARTICLE_DOT_COUNT개)가 실제 DOM 엘리먼트라 닉네임 폭 전체
// (4%~96%)에서 각자 독립적인 위치·타이밍으로 스폰된다 — 색상 문자열 시드
// 기반이라 사실상 랜덤처럼 보이지만 같은 사람은 항상 같은 배치를 유지한다.
function particleDots(
  particle: Exclude<NicknameParticle, "none" | "orbit">,
  color: string | null | undefined,
): ParticleDot[] {
  const seed = stringSeed(color || "particle-default-seed");
  const dotClass = PARTICLE_SIMPLE_CLASSNAME[particle];
  const duration = particle === "snow" ? 2.8 : 2.6;

  const dots: ParticleDot[] = [];
  for (let i = 0; i < PARTICLE_DOT_COUNT; i++) {
    const leftPct = 4 + seededUnit(seed, 100 + i * 7) * 92;
    const delay = seededUnit(seed, 200 + i * 11) * duration;
    const style: CSSProperties & Record<string, string> = {
      left: `${leftPct.toFixed(1)}%`,
      animationDelay: `${delay.toFixed(2)}s`,
    };
    if (particle === "twinkle") {
      // 반짝임은 이동이 없으니 세로 위치도 폭 전체에 걸쳐 자유롭게 흩뿌린다.
      const topPct = 4 + seededUnit(seed, 300 + i * 13) * 92;
      style.top = `${topPct.toFixed(1)}%`;
    } else {
      // 상승/눈은 낙하·상승 중 좌우로 흔들리는 drift(바람에 날리는 느낌) —
      // translateY만 있으면 매번 완전히 같은 수직선을 그려서 반복이 티가 남.
      style["--drift-mid"] = `${seededOffset(seed, 400 + i * 17, 0.3).toFixed(2)}em`;
      style["--drift-end"] = `${seededOffset(seed, 500 + i * 19, 0.5).toFixed(2)}em`;
    }
    dots.push({ key: i, className: `${styles.particleDot} ${dotClass}`, style });
  }
  return dots;
}

// 닉네임을 렌더링하는 모든 화면이 공통으로 쓰는 스타일 계산기. 레인보우/샤인/홀로그램/
// Pulse/네온사인/크롬은 서로 배타적(닉네임의 "기본 색"을 정의하는 효과라 동시에 켤 수
// 없음 — nicknameEffect가 이미 하나의 값만 가지므로 구조적으로 보장됨). 글로우와
// 파티클은 효과와 독립적으로 켤 수 있다(파티클은 nicknameEffect/nicknameGlow와
// 완전히 다른 세 번째 축).
export function nicknameStyle(
  color: string | null | undefined,
  effect: NicknameEffect | undefined,
  glow: boolean | undefined,
  particle: NicknameParticle | undefined,
): { className: string; style: CSSProperties; particles: ParticleDot[] } {
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

  let particleClass = "";
  let particles: ParticleDot[] = [];
  if (particle === "orbit") {
    particleClass = `${styles.particleWrap} ${styles.particleOrbit}`;
  } else if (particle && particle !== "none") {
    particleClass = styles.particleWrap;
    particles = particleDots(particle, color);
  }

  if (effect && effect !== "none") {
    return { className: `${EFFECT_CLASSNAME[effect]} ${particleClass}`.trim(), style, particles };
  }

  if (color) {
    style.color = color;
  }
  return { className: particleClass, style, particles };
}
