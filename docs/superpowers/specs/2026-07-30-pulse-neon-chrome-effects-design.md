# 닉네임 효과 확장 2차 — Pulse · 네온사인 · 크롬/메탈릭 설계

## 배경

`shine-hologram-effects`(2026-07-30)로 `nickname_effect`가 `"none"|"rainbow"|"shine"|"hologram"` enum이 됐다. 이번엔 사용자와 미리보기([샤인·홀로그램 미리보기](artifact) 다음에 만든 [2차 미리보기](artifact))로 확인한 3개(Pulse, 네온사인, 크롬/메탈릭)를 추가한다 — 롱섀도우는 이번 스코프에서 제외.

**1차 리팩터링(boolean→enum)의 이점이 이번에 그대로 실현된다**: `nickname_effect`는 이미 임의 문자열을 받는 TEXT 컬럼이고, 이 값을 쓰는 대부분의 파일(`matchTypes.ts`, `friendships.ts`, `directMessages.ts`, 각 컴포넌트)이 `NicknameEffect` 타입을 **참조만** 하고 있어서, 그 타입의 원본 선언 2곳(서버 `googleAuth.ts`, 클라이언트 `nicknameStyle.ts`)과 손으로 동기화하는 서버 쪽 로컬 사본(`MatchState.ts`) — 총 3곳에 값만 추가하면 나머지는 자동으로 넓어진다. DB 스키마 변경도, 새 마이그레이션도 없다.

## 배타성

Pulse·네온사인·크롬도 레인보우·샤인·홀로그램과 완전히 배타적이다 — `nickname_effect`가 유저당 값 하나만 가지는 enum이라 구조적으로 자동 보장된다(7개 값 중 하나만 선택 가능). 여러 효과를 동시에 겹치는 "오버레이 버전"은 샤인 때와 동일한 이유로 이번에도 범위 밖(마크업을 겹치는 구조 변경이 필요).

## A. 타입

세 곳의 `NicknameEffect` 선언에 값 3개(`"pulse" | "neon" | "chrome"`) 추가:

- `server/src/auth/googleAuth.ts`: `export type NicknameEffect = "none" | "rainbow" | "shine" | "hologram" | "pulse" | "neon" | "chrome";` 및 `NICKNAME_EFFECTS` 배열에 세 값 추가.
- `server/src/rooms/MatchState.ts`: 같은 리터럴 유니온으로 로컬 사본 갱신(기존 `Phase`/`RoleChoice`처럼 손으로 동기화하는 기존 패턴 유지).
- `client/src/game/nicknameStyle.ts`: 같은 리터럴 유니온으로 갱신 — 이 파일을 `import type`하는 나머지 전부(`matchTypes.ts`, `auth.ts`, `profile.ts`, `friends.ts`, `chat.ts`, `colyseus.ts`, 각 컴포넌트)는 코드 변경 없이 자동으로 넓어진다.

DB 컬럼(`nickname_effect TEXT`)과 라우트의 `NICKNAME_EFFECTS.includes(...)` 화이트리스트 검증은 그대로 재사용 — 검증 로직 자체는 안 건드리고 배열 값만 늘어난다.

## B. `nicknameStyle()` / CSS

`client/src/game/nicknameStyle.ts`:

```ts
export type NicknameEffect = "none" | "rainbow" | "shine" | "hologram" | "pulse" | "neon" | "chrome";

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
    const fallback =
      effect === "shine" ? DEFAULT_SHINE_BASE_COLOR : effect === "pulse" ? DEFAULT_PULSE_BASE_COLOR : DEFAULT_NEON_BASE_COLOR;
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
```

(기존 `if (effect === "shine") { ... }` 블록을 위 3-effect 조건으로 확장하는 형태 — 샤인의 기존 로직 자체는 안 바뀜, 같은 자리에 pulse/neon 케이스가 합류.)

`nicknameStyle.module.css`에 추가(미리보기 그대로):

```css
.pulse.pulse {
  color: var(--nickname-base-color, #6fb1ff);
  animation: pulse-glow 1.8s ease-in-out infinite;
}
@keyframes pulse-glow {
  0%, 100% { text-shadow: 0 0 4px var(--nickname-base-color, #6fb1ff), 0 0 8px var(--nickname-base-color, #6fb1ff); }
  50% { text-shadow: 0 0 12px var(--nickname-base-color, #6fb1ff), 0 0 28px var(--nickname-base-color, #6fb1ff); }
}

.neon.neon {
  color: var(--nickname-base-color, #ff3df0);
  text-shadow:
    0 0 2px #fff,
    0 0 6px var(--nickname-base-color, #ff3df0),
    0 0 14px var(--nickname-base-color, #ff3df0),
    0 0 28px var(--nickname-base-color, #ff3df0);
  animation: neon-flicker 3.4s linear infinite;
}
@keyframes neon-flicker {
  0%, 3%, 6%, 9%, 100% { opacity: 1; }
  4% { opacity: 0.4; }
  5% { opacity: 0.85; }
  7% { opacity: 0.5; }
  8% { opacity: 1; }
}

.chrome.chrome {
  background: linear-gradient(100deg, #7c828c 0%, #7c828c 30%, #ffffff 50%, #4a4e56 65%, #7c828c 100%);
  background-size: 240% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  -webkit-text-fill-color: transparent;
  animation: chrome-sweep 3.2s ease-in-out infinite;
}
@keyframes chrome-sweep {
  from { background-position: 140% 0; }
  to   { background-position: -140% 0; }
}
```

기존 `@media (prefers-reduced-motion: reduce)` 블록에 `.pulse.pulse, .neon.neon, .chrome.chrome`을 추가해 `animation-duration: 40s`를 같이 적용(레인보우/샤인/홀로그램과 동일한 이중 클래스 특이도 트릭 — `.pulse.pulse`처럼 새로 추가하는 3개도 처음부터 이중 클래스로 작성해 특이도 버그를 재발시키지 않는다).

**크롬은 레인보우/홀로그램처럼 `nicknameColor`를 무시**한다(고정 은색 팔레트가 정체성). **Pulse·네온사인은 샤인처럼 `nicknameColor`를 베이스로 쓰되, 색이 없으면 각각 파랑/핫핑크 기본값**을 쓴다.

## C. 관리자 UI (`AdminUsers.tsx`)

`<select>`에 옵션 3개 추가:

```tsx
<option value="pulse">Pulse</option>
<option value="neon">네온사인</option>
<option value="chrome">크롬</option>
```

글로우 체크박스는 선택된 효과가 Pulse나 네온사인이면 `disabled` 처리(체크해도 `nicknameStyle()`이 무시하므로, 관리자가 "체크했는데 왜 안 바뀌지"라고 헷갈리지 않게):

```tsx
<input
  type="checkbox"
  checked={user.nicknameGlow}
  onChange={() => toggleGlow(user)}
  disabled={user.nicknameEffect === "pulse" || user.nicknameEffect === "neon"}
/>
```

## 테스트

- `client/src/game/nicknameStyle.ts`엔 전용 테스트 파일이 없다(1차 때와 동일한 이유 — client 워크스페이스에 vitest 설정 없음). `tsc -b` + Playwright 수동 검증으로 커버.
- Playwright 검증 항목: Pulse/네온사인/크롬 각각 관리자 select로 지정 → 실제 화면에서 애니메이션/색 확인. Pulse나 네온사인 선택 시 글로우 체크박스가 `disabled`로 보이는지. 글로우를 이미 켠 상태에서 효과를 Pulse/네온사인으로 바꿨을 때 — DB엔 `nickname_glow=1`이 남아있어도 화면엔 글로우 그림자가 안 겹쳐서 애니메이션이 정상 유지되는지(핵심 회귀 확인 포인트). `prefers-reduced-motion` emulate로 셋 다 40s로 느려지는지.

## 셀프 리뷰

- **플레이스홀더**: 없음.
- **일관성**: `EFFECT_CLASSNAME` 레코드 타입(`Record<Exclude<NicknameEffect, "none">, string>`)이 이미 6개 필수 키를 요구하는 형태라, `pulse`/`neon`/`chrome` 셋 다 안 채우면 그 자체로 타입 에러가 나서 빠뜨릴 수가 없음(설계가 스스로 완전성을 강제).
- **범위**: 서버 타입 2곳 + 클라이언트 타입 1곳 + CSS + 관리자 UI, 총 5개 파일 — 1차(26개 파일)보다 훨씬 작은 스코프. 단일 태스크로도 충분할 만큼 작지만, 계획 문서 관례상 최소 하나의 태스크로는 남긴다.
