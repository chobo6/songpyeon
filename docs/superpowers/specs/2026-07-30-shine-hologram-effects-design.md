# 닉네임 효과 확장 — 샤인 · 홀로그램 설계

## 배경

`nickname-effects`(2026-07-29)로 레인보우/글로우가 이미 있다. 이번엔 샤인(빛 스캔)과 홀로그램을 추가한다. 사용자와 확인한 결과:

- 레인보우/샤인/홀로그램은 서로 **배타적**이다 — 셋 다 "닉네임 텍스트의 기본 색을 정의하는" 효과라 동시에 켜지면 그림 자체가 성립하지 않는다.
- 글로우는 지금처럼 **독립적**이다 — 셋 중 무엇과도 동시에 켤 수 있다(`text-shadow`라 배경색 정의와 무관).
- 샤인을 레인보우/홀로그램 위에 겹쳐서 지나가게 하는 "오버레이 버전"도 기술적으로는 가능하지만(`mix-blend-mode`로 텍스트를 겹치는 방식), `nicknameStyle()`이 지금처럼 `{className, style}` 한 쌍만 리턴하는 걸로는 안 되고 이걸 쓰는 12곳 넘는 컴포넌트를 전부 손봐야 해서 **이번 스코프에서는 제외** — 단순 배타적 버전으로 간다.

이 배타성 때문에, 지금 `nickname_rainbow BOOLEAN` 하나만 있던 걸 이번 기회에 `nickname_effect TEXT`(`'none'|'rainbow'|'shine'|'hologram'`) enum으로 교체한다. 셋 다 boolean 컬럼을 따로 추가하면 "동시에 여러 개 켜짐"을 코드가 우선순위로 억지로 봉합해야 하고, 효과가 늘어날수록(사용자가 이후에도 몇 가지를 더 제안함) 이 문제가 계속 커진다.

## A. 데이터 계층

### A-1. 스키마 (`server/src/db/connection.ts`)

`CREATE TABLE IF NOT EXISTS users (...)`의 `nickname_rainbow INTEGER NOT NULL DEFAULT 0,` 줄을 제거하고 대신 추가:

```sql
nickname_effect TEXT NOT NULL DEFAULT 'none',
```

기존 DB용 마이그레이션 — 지금 있는 가드 블록(`if (!columns.includes("nickname_rainbow")) { ... }` 옆)에 추가:

```ts
if (!columns.includes("nickname_effect")) {
  db.exec(`ALTER TABLE users ADD COLUMN nickname_effect TEXT NOT NULL DEFAULT 'none'`);
}
```

`nickname_rainbow` 자체는 이번에 완전히 없앤다(더 이상 이 값을 읽는 코드가 하나도 안 남으므로, 컬럼을 살려두면 나중에 "이거 왜 두 개야?" 하는 죽은 컬럼이 된다). 기존 `user_version` 게이트(현재 최종값 1, `created_at` UTC→KST 이관에 쓰임)를 재사용해 2로 올리고, 그 블록에서 백필 + 컬럼 제거를 한 번만 수행:

```ts
if (schemaVersion < 2) {
  db.exec(`UPDATE users SET nickname_effect = 'rainbow' WHERE nickname_rainbow = 1`);
  db.exec(`ALTER TABLE users DROP COLUMN nickname_rainbow`);
  db.pragma("user_version = 2");
}
```

이 블록은 위의 `ALTER TABLE ADD COLUMN nickname_effect` 가드보다 **뒤에** 와야 한다(컬럼이 먼저 존재해야 UPDATE가 성립). `DROP COLUMN`은 better-sqlite3가 번들하는 SQLite(3.35+)가 지원하므로 별도 재작성 로직 없이 그대로 쓴다.

### A-2. `sqliteBool` 관련

`nickname_effect`는 TEXT라서 `sqliteBool()` 변환이 필요 없다 — SELECT한 문자열을 그대로 `NicknameEffect`로 캐스팅해서 쓴다(형식은 DB에 쓸 때(`setNicknameEffect`)만 검증하면 되고, 읽을 때는 이미 그 값들만 들어있다고 신뢰).

### A-3. 타입 (`server/src/auth/googleAuth.ts`)

```ts
export type NicknameEffect = "none" | "rainbow" | "shine" | "hologram";
const NICKNAME_EFFECTS: readonly NicknameEffect[] = ["none", "rainbow", "shine", "hologram"];
```

`UserProfile`, `AdminUserRow`, `RankingEntry`의 `nicknameRainbow: boolean` 필드를 `nicknameEffect: NicknameEffect`로 교체. 각 SELECT의 `nickname_rainbow AS nicknameRainbow`를 `nickname_effect AS nicknameEffect`로 바꾸고, 이 값들은 이제 문자열이라 기존의 `Omit<..., "nicknameRainbow" | "nicknameGlow"> & { nicknameRainbow: number; ... }` 중간 캐스팅 패턴에서 `nicknameRainbow`/숫자 변환 부분을 걷어낸다(문자열은 캐스팅 없이 그대로 씀 — `nicknameGlow`만 여전히 0/1→boolean 변환 필요).

`setNicknameEffects`를 아래로 교체:

```ts
export function setNicknameEffect(userId: number, effect: NicknameEffect, glow: boolean): void {
  db.prepare(`UPDATE users SET nickname_effect = ?, nickname_glow = ? WHERE id = ?`).run(
    effect,
    glow ? 1 : 0,
    userId,
  );
}
```

(함수명이 복수 `setNicknameEffects` → 단수 `setNicknameEffect`로 바뀐다 — 이제 인자가 객체 하나가 아니라 명시적 `effect`/`glow` 두 개라 더 명확하다.) 유효하지 않은 문자열이 들어올 가능성은 라우트 레벨에서 `NICKNAME_EFFECTS.includes(effect)`로 막으므로 이 함수 자체는 실패 케이스가 없다(기존과 동일하게 반환 타입 없음).

## B. `nicknameStyle()` / CSS

`client/src/game/nicknameStyle.ts`의 시그니처를 교체:

```ts
import type { CSSProperties } from "react";
import styles from "./nicknameStyle.module.css";

export type NicknameEffect = "none" | "rainbow" | "shine" | "hologram";

const DEFAULT_GLOW_COLOR = "#ffffff";

const EFFECT_CLASSNAME: Record<Exclude<NicknameEffect, "none">, string> = {
  rainbow: styles.rainbow,
  shine: styles.shine,
  hologram: styles.hologram,
};

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

  if (effect && effect !== "none") {
    return { className: EFFECT_CLASSNAME[effect], style };
  }

  if (color) {
    style.color = color;
  }
  return { className: "", style };
}
```

(레인보우 때와 마찬가지로 글로우 색은 "배경이 애니메이션되는 효과가 켜져 있으면 대표색이 없으니 흰색"이라는 기존 규칙을 셋 다로 확장.)

`nicknameStyle.module.css`에 미리보기에서 검증한 CSS를 그대로 추가(레인보우 밑에):

```css
/* 샤인 — 미리보기에서 확인한 스윕 방향/타이밍 그대로.
   .shine.shine인 이유는 .rainbow.rainbow와 동일 — 이 클래스도 같은 방식으로
   pendingName/rosterName 같은 자기 background 셋을 가진 클래스와 나란히 쓰이므로
   같은 특이도 트릭이 필요하다. */
.shine.shine {
  background: linear-gradient(100deg,
    var(--nickname-base-color, #6fb1ff) 0%, var(--nickname-base-color, #6fb1ff) 42%,
    #ffffff 50%,
    var(--nickname-base-color, #6fb1ff) 58%, var(--nickname-base-color, #6fb1ff) 100%);
  background-size: 220% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  -webkit-text-fill-color: transparent;
  animation: shine-sweep 2.6s ease-in-out infinite;
}

@keyframes shine-sweep {
  from { background-position: 140% 0; }
  to   { background-position: -140% 0; }
}

/* 홀로그램 */
.hologram.hologram {
  background: linear-gradient(115deg, #ff9ecb, #ffd59e, #e6ff9e, #9effc4, #9ee7ff, #c9a4ff, #ff9ecb);
  background-size: 320% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  -webkit-text-fill-color: transparent;
  animation: holo-shift 6s linear infinite, holo-shimmer 2.2s ease-in-out infinite;
}

@keyframes holo-shift { from { background-position: 0% 0; } to { background-position: -320% 0; } }
@keyframes holo-shimmer { 0%, 100% { filter: brightness(1) saturate(1); } 50% { filter: brightness(1.3) saturate(1.35); } }

@media (prefers-reduced-motion: reduce) {
  .shine.shine, .hologram.hologram {
    animation-duration: 40s;
  }
}
```

**샤인의 베이스 색**: CSS 변수 `--nickname-base-color`로 유저의 `nicknameColor`를 주입해야 한다(레인보우/홀로그램과 달리 샤인은 "그 사람 색 위에" 빛이 지나가는 효과라 고정 팔레트가 아님). `nicknameStyle()`이 `effect === "shine"`일 때 `style["--nickname-base-color" as any] = color || "#6fb1ff"`를 같이 세팅한다:

```ts
  if (effect === "shine") {
    (style as CSSProperties & Record<string, string>)["--nickname-base-color"] = color || "#6fb1ff";
  }
  if (effect && effect !== "none") {
    return { className: EFFECT_CLASSNAME[effect], style };
  }
```

(CSS 커스텀 프로퍼티는 TS의 `CSSProperties` 타입에 없어서 캐스팅이 필요 — 기존 코드베이스에 선례 없는 첫 사례이므로 이 캐스팅 패턴을 그대로 재사용할 것.) `prefers-reduced-motion` 처리는 레인보우와 동일하게 `.shine.shine`/`.hologram.hologram`으로 이중 클래스 유지(레인보우 때 겪은 특이도 버그를 다시 만들지 않기 위해 처음부터 이중으로 씀).

**홀로그램은 `nicknameColor`를 무시**한다(레인보우와 동일한 기존 규칙 — 고정 팔레트가 정체성이라 개인 색과 무관).

## C. 관리자 UI (`AdminUsers.tsx`)

지금은 체크박스 2개(레인보우/글로우, `toggleEffect(user, "rainbow" | "glow")`)다. 배타성을 UI 레벨에서도 강제하기 위해 효과 선택을 `<select>` 4택으로 바꾸고 글로우는 체크박스로 유지:

```tsx
async function setEffect(user: UserRow, effect: NicknameEffect) {
  setError(null);
  try {
    const res = await fetch(`/api/admin/users/${user.id}/nickname-effects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ effect, glow: user.nicknameGlow }),
    });
    // ...기존 에러 처리 동일...
  } catch {
    setError("효과 변경에 실패했습니다");
  }
}

async function toggleGlow(user: UserRow) {
  setError(null);
  try {
    const res = await fetch(`/api/admin/users/${user.id}/nickname-effects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ effect: user.nicknameEffect, glow: !user.nicknameGlow }),
    });
    // ...기존 에러 처리 동일...
  } catch {
    setError("효과 변경에 실패했습니다");
  }
}
```

렌더:

```tsx
<td>
  <select value={user.nicknameEffect} onChange={(e) => setEffect(user, e.target.value as NicknameEffect)}>
    <option value="none">없음</option>
    <option value="rainbow">레인보우</option>
    <option value="shine">샤인</option>
    <option value="hologram">홀로그램</option>
  </select>
  <label className={styles.effectLabel}>
    <input type="checkbox" checked={user.nicknameGlow} onChange={() => toggleGlow(user)} />
    글로우
  </label>
</td>
```

`UserRow` 타입의 `nicknameRainbow: boolean`도 `nicknameEffect: NicknameEffect`로 교체.

## D. 서버 라우트 (`createServer.ts`)

`POST /api/admin/users/:id/nickname-effects`를 아래로 교체 — `rainbow`/`glow` 두 boolean 대신 `effect`(문자열, 화이트리스트 검증)와 `glow`를 받는다:

```ts
app.post("/api/admin/users/:id/nickname-effects", requireAdmin, (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId)) {
    res.status(400).json({ error: "invalid id" });
    return;
  }
  const { effect, glow } = req.body as { effect?: unknown; glow?: unknown };
  if (typeof effect !== "string" || !NICKNAME_EFFECTS.includes(effect as NicknameEffect)) {
    res.status(400).json({ error: "effect는 'none'|'rainbow'|'shine'|'hologram' 중 하나여야 합니다." });
    return;
  }
  if (typeof glow !== "boolean") {
    res.status(400).json({ error: "glow는 boolean이어야 합니다." });
    return;
  }
  setNicknameEffect(userId, effect as NicknameEffect, glow);
  res.json({ ok: true });
});
```

(`NICKNAME_EFFECTS`를 `googleAuth.ts`에서 export해서 여기서 import.)

나머지 3개 로그인 응답(`/api/auth/google`, `/api/auth/me`, `/api/auth/nickname`)과 `/api/profile/:nickname`은 `nicknameRainbow: user.nicknameRainbow` → `nicknameEffect: user.nicknameEffect` 한 줄씩만 바뀐다(순수 필드명 교체, 로직 변화 없음).

## E. 실시간 상태 전파 (Colyseus)

`server/src/rooms/MatchState.ts` — `PlayerState`/`ChatMessage`/`SpectatorState` 세 클래스 전부:

```ts
@type("boolean") nicknameRainbow: boolean = false;
```
→
```ts
@type("string") nicknameEffect: NicknameEffect = "none";
```

`server/src/rooms/MatchRoom.ts`의 다음 6개 지점이 전부 같은 패턴으로 바뀐다(필드명 교체 + 기본값 `false`→`"none"`):
- `onAuth` 반환 객체 (`nicknameRainbow: user.nicknameRainbow` → `nicknameEffect: user.nicknameEffect`)
- `onJoin`의 관전자 분기 (`spectator.nicknameRainbow = client.auth?.nicknameRainbow ?? false` → `spectator.nicknameEffect = client.auth?.nicknameEffect ?? "none"`)
- `onJoin`의 플레이어 분기 (동일 패턴)
- `pushChat`의 파라미터 (`nicknameRainbow: boolean = false` → `nicknameEffect: NicknameEffect = "none"`), 본문의 대입 한 줄
- `handleSendChat`의 플레이어 호출부 (`player.nicknameRainbow` → `player.nicknameEffect`)
- `handleSendChat`의 관전자 호출부 (`spectator.nicknameRainbow` → `spectator.nicknameEffect`)

`client/src/game/matchTypes.ts` — `PlayerState`/`ChatMessage`/`SpectatorState` 세 interface 전부 `nicknameRainbow: boolean` → `nicknameEffect: NicknameEffect`(파일 상단에 `import type { NicknameEffect } from "./nicknameStyle";` 추가).

## F. 나머지 클라이언트 파일 — 기계적 필드 교체

아래는 전부 "`nicknameRainbow: boolean` 필드/인자를 `nicknameEffect: NicknameEffect`로 이름과 타입만 바꾸고, `nicknameStyle(color, X.nicknameRainbow, X.nicknameGlow)` 호출을 `nicknameStyle(color, X.nicknameEffect, X.nicknameGlow)`로 바꾼다"는 동일한 규칙이 적용되는 지점이다(로직 변화 없음, 이름과 타입 교체뿐):

| 파일 | 지점 |
|---|---|
| `client/src/game/auth.ts` | `Profile` 타입 필드 |
| `client/src/game/profile.ts` | `PublicProfile` 타입 필드 |
| `client/src/game/friends.ts` | `FriendListEntry` 등 3개 타입 필드(`nicknameRainbow`/`fromNicknameRainbow`/`toNicknameRainbow` → `nicknameEffect`/`fromNicknameEffect`/`toNicknameEffect`) |
| `client/src/game/directMessageToChatMessage.ts` | `m.senderNicknameRainbow` → `m.senderNicknameEffect` (서버 `directMessages.ts`의 `senderNicknameRainbow` 컬럼 별칭도 같이 `senderNicknameEffect`로) |
| `client/src/colyseus.ts` | `RoomListEntry`류 타입 필드 |
| `client/src/App.tsx` | `<RoomList nicknameRainbow={me.nicknameRainbow} />` → `nicknameEffect={me.nicknameEffect}` |
| `client/src/components/RoomList.tsx` | prop 이름/타입, `nicknameStyle()` 호출 |
| `client/src/components/ProfileModal.tsx` | `nicknameStyle()` 호출 |
| `client/src/components/ChatBox.tsx` | `nicknameStyle()` 호출 |
| `client/src/components/FriendsModal.tsx` | `nicknameStyle()` 호출 |
| `client/src/components/RankingModal.tsx` | `nicknameStyle()` 호출 |
| `client/src/components/SpectatorCountBadge.tsx` | `nicknameStyle()` 호출 |
| `client/src/components/TeamRosterPanel.tsx` | prop 이름/타입, `nicknameStyle()` 호출 |
| `client/src/components/RoleSelect.tsx` | 헬퍼 `nicknameRainbowFor()` → `nicknameEffectFor(): NicknameEffect`(내부의 `?? false` → `?? "none"`), `nicknameStyle()` 호출, `<TeamRosterPanel nicknameRainbow={...} />` 호출부 |

서버 쪽 남은 기계적 지점(같은 규칙, 위 A/D/E에서 다루지 않은 나머지):

| 파일 | 지점 |
|---|---|
| `server/src/friends/friendships.ts` | `FriendListEntry`/`ReceivedRequestEntry`/`SentRequestEntry` 3개 타입 + SELECT 별칭 3곳(`nickname_rainbow AS nicknameRainbow` 등 → `nickname_effect AS nicknameEffect`, `sqliteBool` 변환 삭제 — 문자열은 그대로 통과) |
| `server/src/chat/directMessages.ts` | `DirectMessageEntry`의 `senderNicknameRainbow` → `senderNicknameEffect`, SELECT 별칭 |

## 테스트

- `server/src/auth/googleAuth.test.ts`: 기존 `nicknameRainbow`/`nicknameGlow` 관련 단언을 `nicknameEffect`로 갱신(`getTopRanking`, `setNicknameEffect`의 boolean 2개 → `(effect, glow)` 시그니처, 잘못된 문자열은 라우트 레벨에서만 막으므로 이 함수 자체 테스트는 정상 값만 다룸).
- `server/src/friends/friendships.test.ts`: 동일하게 필드명 갱신.
- `server/src/rooms/MatchRoom.test.ts`: `nicknameRainbow` 관련 부분을 `nicknameEffect`로 갱신.
- 신규: `nicknameStyle()`에 `effect: "shine"`/`"hologram"` 케이스 테스트(className이 맞는 값인지, `--nickname-base-color`가 shine일 때만 세팅되는지) — 이 함수엔 지금까지 전용 테스트 파일이 없었으므로 `client/src/game/nicknameStyle.test.ts`를 새로 만든다(client 워크스페이스에 vitest 설정이 있는지 확인 필요 — 없으면 이 테스트는 생략하고 `tsc -b` + Playwright 수동 검증으로 대체).
- 관리자 라우트: `effect` 화이트리스트 밖 문자열을 보내면 400이 나오는지 curl로 수동 검증(기존 컨벤션대로, 이 프로젝트엔 라우트 레벨 자동 테스트 없음).
- Playwright: 관리자 페이지에서 샤인/홀로그램을 각각 켜고 실제 화면(로스터/채팅/랭킹/프로필팝업 중 하나 이상)에서 애니메이션이 적용되는지, `prefers-reduced-motion` emulate 시 40s로 느려지는지 확인.

## 셀프 리뷰

- **플레이스홀더**: 없음.
- **일관성**: `NicknameEffect` 타입은 서버(`googleAuth.ts`)와 클라이언트(`nicknameStyle.ts`, `matchTypes.ts`가 이걸 re-export/import) 양쪽에 동일한 리터럴 유니온으로 존재 — 클라이언트/서버가 별도 워크스페이스라 손으로 동기화해야 하는 기존 제약(`matchTypes.ts` 파일 상단 주석에 이미 명시됨)과 같은 패턴.
- **범위**: 이 스펙 하나로 서버 DB/타입/라우트/Colyseus 상태 + 클라이언트 헬퍼/CSS/12개 컴포넌트가 전부 "같은 리팩터링 하나"에 속한다(레인보우 필드를 enum으로 승격 + 효과 2종 추가) — 서로 독립된 하위 시스템이 아니라 한 몸이라 분해할 필요 없음. 이전 `nickname-effects` 계획(7태스크)과 비슷한 규모가 예상됨.
- **마이그레이션 순서**: A-1의 `ADD COLUMN` 가드가 `user_version < 2` 백필 블록보다 반드시 먼저 실행돼야 한다는 제약을 본문에 명시함.
