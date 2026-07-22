# 닉네임 색상 기능 설계

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:writing-plans to turn this spec into an implementation plan.

**Goal:** 관리자가 특정 유저의 닉네임에 단색을 지정할 수 있게 한다(예: VIP/이벤트 당첨자 표시). 지정된 색은 팀 로스터, 역할 선택 화면, 채팅, 관전 화면, 랭킹 모달 등 게임 내에서 그 유저의 닉네임이 보이는 모든 곳에 실시간으로 반영된다. 유저 본인은 색을 바꿀 수 없다.

**Architecture:** `users` 테이블에 `nickname_color`(`#RRGGBB` 형식 hex 문자열, nullable) 컬럼을 추가한다. `MatchRoom.onAuth`가 로그인 시점에 이미 DB에서 유저를 조회해 `nickname`을 `client.auth`에 담아 룸 안 곳곳(PlayerState/SpectatorState/ChatMessage)으로 전파하는 기존 경로를 그대로 재사용해, `nicknameColor`도 같은 지점에서 같이 실어 나른다 — 별도의 조회/전파 경로를 새로 만들지 않는다. 랭킹 모달은 룸 상태와 무관한 별도 REST(`/api/ranking`)라 그쪽만 따로 챙긴다.

**Tech Stack:** 서버 `server/src/db/connection.ts`, `server/src/auth/googleAuth.ts`, `server/src/rooms/MatchState.ts`, `server/src/rooms/MatchRoom.ts`, `server/src/createServer.ts`. 클라이언트 `client/src/game/matchTypes.ts`, `client/src/colyseus.ts`, `client/src/components/{AdminUsers,TeamRosterPanel,ChatBox,RoleSelect,RankingModal}.tsx`.

## Global Constraints

- **관리자만 지정 가능** — 유저 본인이 바꿀 수 있는 UI는 없음.
- **단색만 지원** — 그라데이션 등은 범위 밖(추후 필요하면 별도 기능으로).
- **입력 형식은 `#RRGGBB` hex 문자열만** — `#`, 6자리 16진수. 그 외 형식은 거부(400).
- **적용 범위는 "게임 내 전부"** — 팀 로스터, 역할 선택 화면(대기 중 명단 포함), 채팅(로비/매치 채팅 둘 다), 관전 화면, 랭킹 모달. 로비 방 목록(`RoomList.tsx`)은 애초에 개별 플레이어 닉네임을 안 보여주는 화면이라 범위 밖.
- **색이 없으면(NULL) 그 화면의 기존 기본 텍스트 색을 그대로 사용** — 특정 색(흰색 등)으로 고정되지 않음. 렌더링 시 `style={{ color: nicknameColor || undefined }}` 형태로, 값이 없으면 아예 인라인 스타일을 안 얹는다.
- 색상 변경은 닉네임 변경과 완전히 독립된 별도 수정 흐름(관리자 페이지에서 닉네임만 고치거나 색만 고칠 수 있어야 함).

## 서버 설계

### `server/src/db/connection.ts` — 마이그레이션

기존 `max_round`/`banned_at`과 동일한 `ALTER TABLE ADD COLUMN` 가드 패턴:

```ts
if (!columns.includes("nickname_color")) {
  db.exec(`ALTER TABLE users ADD COLUMN nickname_color TEXT`);
}
```

`columns` 배열은 이미 `PRAGMA table_info(users)`로 구해져 있으므로(기존 `max_round`/`banned_at` 체크와 같은 자리) 거기에 `nickname_color` 체크만 추가하면 된다. 초기 `CREATE TABLE IF NOT EXISTS` 문에도 `nickname_color TEXT,`를 같이 넣어(신규 DB 생성 시 명확성을 위해 — `banned_at` 도입 때와 같은 관례).

### `server/src/auth/googleAuth.ts` — 타입/쿼리 확장 + 검증 함수

```ts
export type UserProfile = { id: number; nickname: string | null; bannedAt: string | null; nicknameColor: string | null };
```

`getUserById`와 `getOrCreateUser`의 SELECT에 `nickname_color AS nicknameColor` 추가.

`AdminUserRow`에도 `nicknameColor: string | null` 추가, `listUsers`의 SELECT에 동일하게 추가.

`RankingEntry`에도 `nicknameColor: string | null` 추가, `getTopRanking`의 SELECT에 `nickname_color AS nicknameColor` 추가.

신규 함수 — hex 검증 + 저장:

```ts
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

export type SetNicknameColorResult = "ok" | "invalid";

// color가 null이면 색 제거(기본 색으로 복귀). 빈 문자열도 null과 동일하게 취급.
export function setNicknameColor(userId: number, color: string | null): SetNicknameColorResult {
  const clean = color?.trim() || null;
  if (clean !== null && !HEX_COLOR_PATTERN.test(clean)) return "invalid";
  db.prepare(`UPDATE users SET nickname_color = ? WHERE id = ?`).run(clean, userId);
  return "ok";
}
```

### `server/src/rooms/MatchState.ts` — 스키마 확장

`PlayerState`, `SpectatorState`, `ChatMessage` 세 곳 모두에 필드 추가(닉네임이 보이는 세 가지 스키마 타입 전부):

```ts
export class PlayerState extends Schema {
  @type("string") sessionId: string = "";
  @type("string") nickname: string = "";
  @type("string") nicknameColor: string = ""; // 추가
  @type("string") role: RoleChoice = "";
  @type("string") teamId: string = "";
}

export class ChatMessage extends Schema {
  @type("string") nickname: string = "";
  @type("string") nicknameColor: string = ""; // 추가
  @type("string") text: string = "";
  @type("number") sentAt: number = 0;
}

export class SpectatorState extends Schema {
  @type("string") sessionId: string = "";
  @type("string") nickname: string = "";
  @type("string") nicknameColor: string = ""; // 추가
}
```

빈 문자열 `""` = 색 없음(클라이언트에서 `nicknameColor || undefined`로 처리하므로 `""`와 `undefined`가 동일하게 동작).

### `server/src/rooms/MatchRoom.ts` — 전파

**`onAuth`**: 반환 객체에 `nicknameColor` 추가.

```ts
return { ip: context.ip, userId: user.id, nickname: user.nickname, nicknameColor: user.nicknameColor ?? "" };
```

**관전자 생성** (기존 `spectator.nickname = client.auth?.nickname ?? "관전자";` 바로 다음 줄):

```ts
spectator.nicknameColor = client.auth?.nicknameColor ?? "";
```

**플레이어 생성** (기존 `player.nickname = nickname;` 다음 줄):

```ts
player.nicknameColor = client.auth?.nicknameColor ?? "";
```

**채팅** — `pushChat`이 색상 파라미터를 받도록 확장(기본값 `""` — 입장/퇴장 시스템 메시지는 계속 색 없이):

```ts
private pushChat(list: ArraySchema<ChatMessage>, nickname: string, text: string, nicknameColor: string = "") {
  const message = new ChatMessage();
  message.nickname = nickname;
  message.nicknameColor = nicknameColor;
  message.text = text;
  message.sentAt = Date.now();
  list.push(message);
  if (list.length > MAX_CHAT_MESSAGES) list.shift();
}
```

실제 대화(시스템 메시지 아님) 호출부 두 곳만 색상 인자 추가:

```ts
// handleSendChat, 플레이어 채팅
this.pushChat(list, player.nickname, text, player.nicknameColor);

// handleSendChat, 관전자 채팅
this.pushChat(this.state.matchChat, `${spectator.nickname} (관전)`, text, spectator.nicknameColor);
```

입장/퇴장 시스템 메시지 호출부 3곳(`pushChat(chatList, "", ...)` 형태)은 그대로 둔다 — 넷째 인자를 안 넘기면 기본값 `""`.

### `server/src/createServer.ts` — 라우트

기존 `/api/admin/users/:id/nickname` 라우트 바로 아래에 추가:

```ts
app.post("/api/admin/users/:id/nickname-color", requireAdmin, (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId)) {
    res.status(400).json({ error: "invalid id" });
    return;
  }
  const { color } = req.body as { color?: unknown };
  if (color !== null && typeof color !== "string") {
    res.status(400).json({ error: "color는 문자열 또는 null이어야 합니다." });
    return;
  }
  const result = setNicknameColor(userId, color);
  if (result === "invalid") {
    res.status(400).json({ error: "#RRGGBB 형식의 색상 코드를 입력해주세요." });
    return;
  }
  res.json({ ok: true });
});
```

`/api/ranking` 라우트는 이미 `getTopRanking(10)`을 그대로 JSON으로 응답하므로(`res.json(getTopRanking(10))`), `RankingEntry`에 `nicknameColor`가 추가되면 별도 수정 없이 응답에 자동 포함된다.

## 클라이언트 설계

### `client/src/game/matchTypes.ts` — 타입 미러링

```ts
export interface PlayerState {
  sessionId: string;
  nickname: string;
  nicknameColor: string; // 추가
  role: RoleChoice;
  teamId: string;
}

export interface ChatMessage {
  nickname: string;
  nicknameColor: string; // 추가
  text: string;
  sentAt: number;
}

export interface SpectatorState {
  sessionId: string;
  nickname: string;
  nicknameColor: string; // 추가
}
```

### `client/src/colyseus.ts`

```ts
export interface RankingEntry {
  nickname: string;
  nicknameColor: string | null; // 추가
  maxRound: number;
}
```

### 렌더링 반영 (4개 파일, 각각 스타일 한 줄씩)

**`TeamRosterPanel.tsx`** — `Seat` 컴포넌트에 `nicknameColor?: string` prop 추가, 두 호출부(`players.get(...)?.nicknameColor`)에서 전달:

```tsx
function Seat({ nickname, nicknameColor, roleIcon }: { nickname: string | undefined; nicknameColor: string | undefined; roleIcon: string }) {
  return (
    <div className={styles.seat}>
      <img className={styles.seatIcon} src={roleIcon} alt="" />
      <span className={styles.seatName} style={{ color: nicknameColor || undefined }}>{nickname ?? "-"}</span>
    </div>
  );
}
```

**`ChatBox.tsx`** — 닉네임 있는 메시지 분기에서:

```tsx
<span className={styles.nickname} style={{ color: m.nicknameColor || undefined }}>{m.nickname}</span>
```

**`RoleSelect.tsx`** — `nicknameFor`를 색상도 같이 돌려주도록 확장(또는 별도 `nicknameColorFor` 헬퍼 추가), 대기 중 명단과 로스터 이름 두 곳에 적용:

```tsx
function nicknameColorFor(sessionId: string): string | undefined {
  return sessionId ? room.state.players.get(sessionId)?.nicknameColor || undefined : undefined;
}
```

```tsx
<span key={p.sessionId} className={styles.pendingName} style={{ color: p.nicknameColor || undefined }}>
  {p.nickname}
</span>
...
<span className={styles.rosterName} style={{ color: nicknameColorFor(team.pigSessionId) }}>{nicknameFor(team.pigSessionId)}</span>
<span className={styles.rosterName} style={{ color: nicknameColorFor(team.rabbitSessionId) }}>{nicknameFor(team.rabbitSessionId)}</span>
```

**`RankingModal.tsx`**:

```tsx
<span className={styles.nickname} style={{ color: entry.nicknameColor || undefined }}>{entry.nickname}</span>
```

### `AdminUsers.tsx` — 관리자 편집 UI

`UserRow`에 `nicknameColor: string | null` 추가.

닉네임 편집과 완전히 독립된 별도 state 세트:

```tsx
const [colorEditingId, setColorEditingId] = useState<number | null>(null);
const [colorEditValue, setColorEditValue] = useState("");
const [colorSaving, setColorSaving] = useState(false);
```

`saveColorEdit(id)` — 기존 `saveEdit`(닉네임 저장)과 동일한 fetch/에러/401 처리 패턴으로 `POST /api/admin/users/${id}/nickname-color`에 `{ color: trimmed || null }` 전송, 성공 시 `loadUsers()`.

표에 "닉네임" 컬럼 바로 뒤에 "색상" 컬럼 추가 — 평소엔 색상 스와치(작은 원/사각형, `background: user.nicknameColor ?? "transparent"`) + hex 텍스트(없으면 "-"), 수정 모드일 땐 `<input>` (placeholder `#ff6b6b`, 비우고 저장하면 색 제거) + 저장/취소 버튼. 기존 닉네임 수정 UI와 같은 시각적 패턴(작은 인라인 폼)을 그대로 따른다.

## 테스트

- `server/src/auth/googleAuth.test.ts`:
  - `setNicknameColor`가 유효한 `#RRGGBB`를 저장하고 `getUserById`/`listUsers`/`getTopRanking`이 정확히 반영하는지.
  - 잘못된 형식(`"red"`, `"#fff"`, `"#gggggg"`, 빈 문자열 아닌 임의 문자열)에 `"invalid"`를 반환하고 DB를 안 바꾸는지.
  - `null`을 넘기면 기존 색을 지우는지(`"ok"` 반환, 컬럼이 NULL이 되는지).
- `server/src/rooms/MatchRoom.test.ts`:
  - 닉네임 색상이 지정된 계정으로 입장하면 `PlayerState.nicknameColor`가 정확히 채워지는지.
  - 색상이 없는 계정은 `nicknameColor`가 빈 문자열인지.
  - 그 유저가 채팅을 보내면 `ChatMessage.nicknameColor`에도 같은 값이 실리는지.
  - 관전자로 입장한 경우 `SpectatorState.nicknameColor`와, 관전자가 채팅했을 때 `ChatMessage.nicknameColor`도 확인.
  - 입장/퇴장 시스템 메시지는 `nicknameColor`가 항상 빈 문자열인지(색 있는 유저가 입퇴장해도 시스템 메시지 자체엔 색이 안 실림).
