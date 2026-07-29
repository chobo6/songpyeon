# 닉네임 효과 확장 2차 — Pulse · 네온사인 · 크롬/메탈릭 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `NicknameEffect`에 `pulse`·`neon`·`chrome` 3개 값을 추가하고, 각각의 CSS 애니메이션과 관리자 UI 선택지를 구현한다.

**Architecture:** `NicknameEffect` 타입은 서버(`googleAuth.ts`)와 클라이언트(`nicknameStyle.ts`)에 원본 선언이 있고, 서버 쪽 Colyseus 상태(`MatchState.ts`)에 손으로 동기화하는 로컬 사본이 하나 더 있다 — 이 3곳에만 값을 추가하면, 나머지 모든 파일(`matchTypes.ts`, `friendships.ts`, 각 컴포넌트 등)은 이 타입을 `import type`으로 참조만 하고 있어서 코드 변경 없이 자동으로 넓어진다. DB 컬럼은 이미 TEXT라 스키마 변경도 마이그레이션도 없다.

**Tech Stack:** TypeScript, React 19, CSS Modules.

## Global Constraints

- 추가하는 3개 효과도 레인보우/샤인/홀로그램과 완전히 배타적(enum이 유저당 값 하나만 가지므로 구조적으로 보장, 별도 코드 불필요).
- **Pulse·네온사인이 켜져 있으면 독립 글로우(`nickname_glow`)를 `nicknameStyle()`이 계산에서 아예 제외**한다 — 안 그러면 인라인 `style.textShadow`가 CSS 클래스의 애니메이션 그림자를 덮어써서 깜빡임/숨쉬기 효과 자체가 사라지는 실제 버그가 생긴다(단순 미관 문제가 아님).
- 크롬은 레인보우/홀로그램처럼 `nicknameColor`를 무시하는 고정 은색 팔레트. Pulse·네온사인은 샤인처럼 `nicknameColor`를 베이스로 쓰되 값이 없으면 각각 파랑(`#6fb1ff`)/핫핑크(`#ff3df0`) 기본값.
- `prefers-reduced-motion: reduce`에서 셋 다 `animation-duration: 40s`로 느려져야 하며, 처음부터 `.pulse.pulse`/`.neon.neon`/`.chrome.chrome`(이중 클래스, 특이도 (0,2,0))로 작성해 레인보우 때 겪었던 특이도 버그를 재발시키지 않는다.
- 관리자 UI에서 Pulse·네온사인이 선택된 행은 글로우 체크박스를 `disabled` 처리(체크해도 화면에 반영 안 되는 걸 관리자가 헷갈리지 않도록).

---

### Task 1: 타입 확장 + `nicknameStyle()`/CSS 구현 + 관리자 UI

**Files:**
- Modify: `server/src/auth/googleAuth.ts:5-6`
- Modify: `server/src/rooms/MatchState.ts:7`
- Modify: `client/src/game/nicknameStyle.ts` (전체 교체)
- Modify: `client/src/game/nicknameStyle.module.css` (추가)
- Modify: `client/src/components/AdminUsers.tsx:319-330`

**Interfaces:**
- Consumes: 없음(최상위 타입 원본 선언 + 그걸 쓰는 UI 레이어).
- Produces: `NicknameEffect`가 `"pulse" | "neon" | "chrome"`를 포함하도록 넓어짐 — 이 타입을 참조하는 모든 파일(`matchTypes.ts`, `auth.ts`, `profile.ts`, `friends.ts`, `chat.ts`, `colyseus.ts`, `friendships.ts`, `directMessages.ts`, `createServer.ts`, 각 컴포넌트)은 코드 변경 없이 자동으로 세 값을 받아들인다.

- [ ] **Step 1: `server/src/auth/googleAuth.ts` 타입 확장**

기존:
```ts
export type NicknameEffect = "none" | "rainbow" | "shine" | "hologram";
export const NICKNAME_EFFECTS: readonly NicknameEffect[] = ["none", "rainbow", "shine", "hologram"];
```
교체 후:
```ts
export type NicknameEffect = "none" | "rainbow" | "shine" | "hologram" | "pulse" | "neon" | "chrome";
export const NICKNAME_EFFECTS: readonly NicknameEffect[] = [
  "none",
  "rainbow",
  "shine",
  "hologram",
  "pulse",
  "neon",
  "chrome",
];
```

- [ ] **Step 2: `server/src/rooms/MatchState.ts` 로컬 사본 확장**

기존:
```ts
export type NicknameEffect = "none" | "rainbow" | "shine" | "hologram";
```
교체 후:
```ts
export type NicknameEffect = "none" | "rainbow" | "shine" | "hologram" | "pulse" | "neon" | "chrome";
```

- [ ] **Step 3: 서버 타입체크**

Run: `cd server && npm run build`
Expected: 에러 없이 통과(이 두 파일 말고는 서버 쪽 어디도 안 건드렸으므로 곧바로 깨끗해야 함).

- [ ] **Step 4: `client/src/game/nicknameStyle.ts` 전체 교체**

```ts
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
```

- [ ] **Step 5: `nicknameStyle.module.css`에 3개 효과 추가**

기존 `.hologram.hologram`/`@keyframes holo-shimmer` 블록 다음, `@media (prefers-reduced-motion: reduce)` 블록 앞에 추가:

```css
.pulse.pulse {
  color: var(--nickname-base-color, #6fb1ff);
  animation: pulse-glow 1.8s ease-in-out infinite;
}

@keyframes pulse-glow {
  0%,
  100% {
    text-shadow:
      0 0 4px var(--nickname-base-color, #6fb1ff),
      0 0 8px var(--nickname-base-color, #6fb1ff);
  }
  50% {
    text-shadow:
      0 0 12px var(--nickname-base-color, #6fb1ff),
      0 0 28px var(--nickname-base-color, #6fb1ff);
  }
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
  0%,
  3%,
  6%,
  9%,
  100% {
    opacity: 1;
  }
  4% {
    opacity: 0.4;
  }
  5% {
    opacity: 0.85;
  }
  7% {
    opacity: 0.5;
  }
  8% {
    opacity: 1;
  }
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
  from {
    background-position: 140% 0;
  }
  to {
    background-position: -140% 0;
  }
}
```

기존 `@media (prefers-reduced-motion: reduce)` 블록, 기존:
```css
  .shine.shine,
  .hologram.hologram {
    animation-duration: 40s;
  }
}
```
교체 후:
```css
  .shine.shine,
  .hologram.hologram,
  .pulse.pulse,
  .neon.neon,
  .chrome.chrome {
    animation-duration: 40s;
  }
}
```

- [ ] **Step 6: `AdminUsers.tsx` — select 옵션 3개 + 글로우 체크박스 disabled 조건**

기존(319-330번 줄):
```tsx
                    <select
                      value={user.nicknameEffect}
                      onChange={(e) => setEffect(user, e.target.value as NicknameEffect)}
                    >
                      <option value="none">없음</option>
                      <option value="rainbow">레인보우</option>
                      <option value="shine">샤인</option>
                      <option value="hologram">홀로그램</option>
                    </select>
                    <label className={styles.effectLabel}>
                      <input type="checkbox" checked={user.nicknameGlow} onChange={() => toggleGlow(user)} />
                      글로우
                    </label>
```
교체 후:
```tsx
                    <select
                      value={user.nicknameEffect}
                      onChange={(e) => setEffect(user, e.target.value as NicknameEffect)}
                    >
                      <option value="none">없음</option>
                      <option value="rainbow">레인보우</option>
                      <option value="shine">샤인</option>
                      <option value="hologram">홀로그램</option>
                      <option value="pulse">Pulse</option>
                      <option value="neon">네온사인</option>
                      <option value="chrome">크롬</option>
                    </select>
                    <label className={styles.effectLabel}>
                      <input
                        type="checkbox"
                        checked={user.nicknameGlow}
                        onChange={() => toggleGlow(user)}
                        disabled={user.nicknameEffect === "pulse" || user.nicknameEffect === "neon"}
                      />
                      글로우
                    </label>
```

- [ ] **Step 7: 클라이언트 타입체크**

Run: `cd client && npm run build`
Expected: `tsc -b && vite build` 에러 없이 통과.

- [ ] **Step 8: 서버 전체 테스트 재실행 (회귀 확인)**

Run: `cd server && npm test`
Expected: 전부 PASS(이 태스크는 서버 로직을 안 건드렸으므로 기존 328개 그대로 통과해야 함).

- [ ] **Step 9: Commit**

```bash
git add server/src/auth/googleAuth.ts server/src/rooms/MatchState.ts client/src/game/nicknameStyle.ts client/src/game/nicknameStyle.module.css client/src/components/AdminUsers.tsx
git commit -m "닉네임 효과에 Pulse·네온사인·크롬 추가"
```

- [ ] **Step 10: Playwright로 실제 화면 검증**

`npm run sync-public` → `cd server && npm run dev`(포트 2567). DB에 테스트 유저를 만들고 세션 쿠키를 서명해 브라우저에 주입하는 기존 방식 그대로:

1. `/admin` 관리자 로그인 → 유저 정보 탭에서 테스트 유저의 select를 "Pulse"로 변경 → 로비에서 실제로 breathing 애니메이션(`animation-name: pulse-glow`)이 걸려있는지 컴퓨티드 스타일로 확인.
2. select를 "네온사인"으로 바꾸고 글로우 체크박스도 체크된 상태를 만들어본 뒤, 관리자 UI에서 그 체크박스가 실제로 `disabled` 속성을 갖는지 확인(회귀 확인 핵심 포인트: 글로우가 DB에 이미 켜져 있어도 화면에서 `neon-flicker` 애니메이션이 살아있는지 — `style.textShadow` 인라인이 안 끼어들어서 CSS 애니메이션이 안 죽는지).
3. select를 "크롬"으로 바꾸고 글로우도 켜서, 이번엔 글로우 체크박스가 `disabled`가 아니고(크롬은 예외 목록에 없음) 실제로 흰색 외곽 글로우가 크롬 그라데이션 위에 겹쳐 보이는지 확인.
4. `page.emulateMedia({ reducedMotion: "reduce" })`로 Pulse/네온사인/크롬 셋 다 `animation-duration`이 40s로 바뀌는지 확인.
5. 테스트 유저 DB에서 정리, 브라우저 탭 닫기, 개발 서버 종료 후 `netstat`으로 포트 2567이 실제로 비었는지 확인.

## Self-Review Notes

- **Spec coverage**: 스펙의 A(타입) → Step 1-3, B(nicknameStyle/CSS) → Step 4-5, C(관리자 UI) → Step 6. 스펙의 모든 섹션이 커버됨.
- **Placeholder scan**: 없음 — 모든 단계에 실제 코드/명령어.
- **Type consistency**: `EFFECT_CLASSNAME`이 `Record<Exclude<NicknameEffect, "none">, string>` 타입이라 `pulse`/`neon`/`chrome` 키를 안 채우면 그 자체로 타입 에러가 나서 빠뜨릴 수 없음 — 이 설계가 스스로 완전성을 강제. `NO_INDEPENDENT_GLOW`에 `"pulse"`/`"neon"`만 들어있고 `AdminUsers.tsx`의 `disabled` 조건도 정확히 `pulse`/`neon`만 검사 — 두 곳이 정확히 일치.
- **범위**: 스펙에서 예상한 대로 5개 파일, 태스크 1개로 충분히 작음. 별도 태스크 분해 불필요.
