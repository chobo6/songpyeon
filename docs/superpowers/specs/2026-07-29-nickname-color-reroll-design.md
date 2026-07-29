# 닉네임 색 변경권 (게임머니 20,000원) 설계

## 배경

`nickname-effects` 기능(2026-07-29)으로 레인보우/글로우 효과와 `nicknameColor`(관리자만 설정 가능한 hex 색상)가 이미 존재한다. 이번 기능은 그 위에 **유저 스스로 게임머니 20,000원을 써서 자기 닉네임 색을 랜덤으로 바꾸는 상점 기능**을 추가한다. 게임머니는 지금까지 적립만 가능했고(`docs/superpowers/specs/...게임머니 설계` 참고), 이번이 첫 "소비" 동선이다.

## 범위

1. 서버: 게임머니 20,000원을 확인 후 차감하고, `#RRGGBB` 16^6가지 중 하나를 균등 랜덤으로 뽑아 `nickname_color`에 저장하는 로직 + 라우트.
2. 로그인 응답(3개 라우트)에 닉네임 색/효과 필드 추가 — 로비에서 본인 닉네임을 스타일링하려면 필요.
3. 클라이언트: 로비(`RoomList`)의 본인 닉네임에 색/효과 적용 + 클릭 시 본인 프로필 팝업(`ProfileModal`)이 뜨도록 변경.
4. `ProfileModal`에 `friendshipStatus === "self"`일 때만 보이는 "닉색 변경 (20,000원)" 버튼 추가.

## A. 데이터/로직 (서버)

`server/src/auth/googleAuth.ts`에 추가:

```ts
const NICKNAME_REROLL_COST = 20000;

export type RerollNicknameColorResult =
  | { ok: true; nicknameColor: string; gameMoney: number }
  | { ok: false; reason: "insufficient_funds" };

// 게임머니 20,000원을 차감하고 #RRGGBB(16^6가지) 중 하나를 균등 랜덤으로 뽑아
// nickname_color에 저장한다. 잔액 부족이면 아무것도 바꾸지 않고 실패를 반환한다.
// better-sqlite3는 완전히 동기적이라(이 두 문장 사이에 await 없음) 조회 후 UPDATE
// 사이에 다른 요청이 끼어들 수 없다 — getOrCreateUser의 기존 논리와 동일한 이유로
// 트랜잭션 없이도 원자적이다.
export function rerollNicknameColor(userId: number): RerollNicknameColorResult {
  const row = db.prepare(`SELECT game_money AS gameMoney FROM users WHERE id = ?`).get(userId) as
    | { gameMoney: number }
    | undefined;
  if (!row || row.gameMoney < NICKNAME_REROLL_COST) {
    return { ok: false, reason: "insufficient_funds" };
  }
  const color = randomHexColor();
  db.prepare(`UPDATE users SET game_money = game_money - ?, nickname_color = ? WHERE id = ?`).run(
    NICKNAME_REROLL_COST,
    color,
    userId,
  );
  return { ok: true, nicknameColor: color, gameMoney: row.gameMoney - NICKNAME_REROLL_COST };
}

function randomHexColor(): string {
  const n = Math.floor(Math.random() * 0x1000000);
  return `#${n.toString(16).padStart(6, "0")}`;
}
```

- 잔액이 정확히 20,000원이면 성공(차감 후 0원) — `<` 비교라 경계값 포함.
- 반복 구매 제한 없음(버튼 누를 때마다 즉시 차감 + 재추첨, "보유 티켓" 개념 없음) — 요청사항 그대로.
- `HEX_COLOR_PATTERN` 검증은 필요 없음 — `randomHexColor()`가 항상 유효한 형식만 생성.

## B. API

### B-1. 새 라우트

`server/src/createServer.ts`의 `/api/profile/:nickname` 라우트 바로 뒤에 추가:

```ts
app.post("/api/profile/reroll-color", (req, res) => {
  const cookies = (req as unknown as { cookies?: Record<string, string> }).cookies;
  const userId = verifySession(cookies?.[SESSION_COOKIE_NAME]);
  if (!userId) {
    res.status(401).json({ error: "로그인이 필요합니다." });
    return;
  }
  const result = rerollNicknameColor(userId);
  if (!result.ok) {
    res.status(400).json({ error: "게임머니가 부족해요." });
    return;
  }
  res.json({ nicknameColor: result.nicknameColor, gameMoney: result.gameMoney });
});
```

파라미터 없음(세션의 본인에게만 적용). 실패 UX는 확정된 대로 "버튼은 항상 눌러지고, 서버가 거절하면 에러 메시지만 표시" — 클라이언트가 사전에 잔액을 확인하거나 버튼을 비활성화하지 않는다.

### B-2. 기존 로그인 응답 3곳 확장

지금 `Profile`(클라이언트 타입)과 그걸 채우는 서버 응답에 닉네임 색/효과가 빠져 있다 — 로비에서 본인 닉네임을 칠하려면 필요하다. 다음 3개 라우트의 JSON 응답에 `nicknameColor`, `nicknameRainbow`, `nicknameGlow`를 추가한다(이미 `UserProfile`에 다 들어있는 필드라 서버 쪽은 스프레드만 넓히면 됨):

- `POST /api/auth/google` (createServer.ts:358-365)
- `GET /api/auth/me` (createServer.ts:383-390)
- `POST /api/auth/nickname` (createServer.ts:417- 이하)

## C. 클라이언트 배선

### C-1. `client/src/game/auth.ts`

`Profile` 타입에 3개 필드 추가:

```ts
export type Profile = {
  id: number;
  nickname: string | null;
  nicknameColor: string | null;
  nicknameRainbow: boolean;
  nicknameGlow: boolean;
  maxRound: number;
  pigPlayCount: number;
  rabbitPlayCount: number;
  gameMoney: number;
};
```

### C-2. `client/src/game/profile.ts`

새 함수 추가:

```ts
export async function rerollNicknameColor(): Promise<{ nicknameColor: string; gameMoney: number }> {
  const res = await fetch("/api/profile/reroll-color", { method: "POST", credentials: "same-origin" });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error ?? "닉색 변경에 실패했어요.");
  return body;
}
```

### C-3. `client/src/components/ProfileModal.tsx`

- import `rerollNicknameColor`.
- 새 prop `onSelfColorChanged?: () => void` — 본인 프로필일 때 재추첨이 성공하면 부모(로비)에 알려서 로비 화면의 닉네임 색도 새로고침하도록 하는 콜백. 다른 사람 프로필을 볼 때는 전달되지 않으므로 미사용.
- 새 핸들러:

```ts
async function handleReroll() {
  setBusy(true);
  setMessage(null);
  try {
    const { nicknameColor } = await rerollNicknameColor();
    setProfile((prev) => (prev ? { ...prev, nicknameColor } : prev));
    onSelfColorChanged?.();
  } catch (err) {
    setMessage(err instanceof Error ? err.message : "닉색 변경에 실패했어요.");
  } finally {
    setBusy(false);
  }
}
```

- 새 버튼 분기(다른 `friendshipStatus` 분기들과 나란히, `profile &&` 블록 안):

```tsx
{profile.friendshipStatus === "self" && (
  <button className={styles.actionButton} onClick={handleReroll} disabled={busy}>
    닉색 변경 (20,000원)
  </button>
)}
```

기존 `friendshipStatus === "none" | "friends" | "pending_*"` 분기는 그대로 둔다 — `self`는 그것들과 배타적인 새 케이스.

### C-4. `client/src/components/RoomList.tsx`

- import `nicknameStyle`, `ProfileModal`.
- 새 props: `nicknameColor: string | null`, `nicknameRainbow: boolean`, `nicknameGlow: boolean`, `onProfileChanged: () => void`.
- 새 상태: `const [showOwnProfile, setShowOwnProfile] = useState(false);`
- 163번 줄 교체 — 지금은 스타일 없는 `<span>`:

```tsx
<span className={styles.profileNickname}>{nickname}</span>
```

→ 클릭 가능한 버튼 + 효과 적용:

```tsx
const effect = nicknameStyle(nicknameColor, nicknameRainbow, nicknameGlow);
// ...
<button
  type="button"
  className={`${styles.profileNickname} ${effect.className}`}
  style={effect.style}
  onClick={() => setShowOwnProfile(true)}
>
  {nickname}
</button>
```

- `RoomList.module.css`의 `.profileNickname`(지금은 `font-weight`/`font-size`만 있음)에 버튼 리셋 추가 — 지금 보이는 모습(테두리 없는 굵은 텍스트)을 그대로 유지하기 위해:

```css
.profileNickname {
  font-weight: 800;
  font-size: 1.1rem;
  background: none;
  border: none;
  padding: 0;
  color: inherit;
  cursor: pointer;
}
```

- 모달 렌더 추가(다른 모달들 옆에):

```tsx
{showOwnProfile && (
  <ProfileModal
    nickname={nickname}
    onClose={() => setShowOwnProfile(false)}
    onSelfColorChanged={onProfileChanged}
  />
)}
```

### C-5. `client/src/App.tsx`

`OnlineFlow`의 `<RoomList>` 호출(122번 줄 부근)에 props 추가:

```tsx
<RoomList
  nickname={me.nickname}
  nicknameColor={me.nicknameColor}
  nicknameRainbow={me.nicknameRainbow}
  nicknameGlow={me.nicknameGlow}
  maxRound={me.maxRound}
  pigPlayCount={me.pigPlayCount}
  rabbitPlayCount={me.rabbitPlayCount}
  gameMoney={me.gameMoney}
  onCreateRoom={...}
  onJoinRoom={...}
  onExit={onExit}
  onProfileChanged={() => fetchMe().then(setMe).catch(() => {})}
/>
```

`onProfileChanged`는 매치 종료 후 이미 쓰이고 있는 기존 `fetchMe().then(setMe).catch(() => {})` 패턴(140-148번 줄)을 그대로 재사용 — 재추첨 성공 시 로비 전체 프로필(색 포함 게임머니도 최신화)을 서버에서 다시 받아온다. 개별 필드만 패치하는 대신 전체 재조회를 택한 이유는 기존 코드베이스 관례와 일치하고, 클릭 한 번짜리 동작이라 왕복 한 번 늘어나는 비용이 무시할 만하기 때문.

## 에러 처리 요약

| 상황 | 동작 |
|---|---|
| 게임머니 20,000원 미만 | 400 + "게임머니가 부족해요." → `ProfileModal`의 `message`에 표시, 아무것도 안 바뀜 |
| 로그인 안 됨 | 401 + "로그인이 필요합니다." (이 라우트는 로그인 상태에서만 버튼이 뜨므로 실전에서는 거의 발생 안 함) |
| 성공 | 200 + 새 색 + 새 게임머니, 팝업과 로비 양쪽에 즉시 반영 |

## 테스트

`server/src/auth/googleAuth.test.ts`에 `rerollNicknameColor` 테스트 추가:
1. 게임머니 20,000원 이상 보유 → 성공, 정확히 20,000원 차감, `nicknameColor`가 `/^#[0-9a-fA-F]{6}$/` 형식.
2. 게임머니 20,000원 미만 → `{ ok: false }`, 게임머니/색 둘 다 변경 없음.
3. 게임머니 정확히 20,000원 → 성공, 차감 후 0원(경계값).

## 셀프 리뷰

- 플레이스홀더 없음, 모든 코드 스니펫 완성된 형태.
- 기존 컨벤션과 일치: `sqliteBool` 패턴은 이 함수엔 해당 없음(boolean 필드 안 건드림), `UserProfile`/`RerollNicknameColorResult`의 반환 타입 스타일은 `SetNicknameColorResult`/`AdminSetNicknameResult`와 동일한 관례(`"ok" | "invalid"` 같은 유니온) 대신 판별 유니온을 썼는데, 이유는 성공 시 같이 반환해야 하는 값(새 색, 새 잔액)이 있어서 — 실패 케이스엔 그 값들이 없으므로 판별 유니온이 더 정확한 타입.
- 범위: 이 스펙 하나로 서버 로직 1개 + 라우트 2종(신규 1 + 기존 3 확장) + 클라이언트 파일 4개, 분해 없이 계획 하나로 충분한 크기.
