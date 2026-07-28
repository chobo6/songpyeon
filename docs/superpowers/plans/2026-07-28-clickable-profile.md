# 닉네임 클릭 프로필 팝업 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 대기실/친구창의 모든 닉네임과, 매치 진행 중 화면에서는 관전자 목록의 닉네임만 클릭해서 그 사람의 프로필(역할별 플레이 횟수, 최고 라운드)을 보고 친구 요청/삭제를 할 수 있게 한다.

**Architecture:** 새 라우트 하나(`GET /api/profile/:nickname`)만 추가 — 통계는 이미 있는 `users` 컬럼을 그대로 쓰고, 관계 상태는 새 헬퍼 `getFriendshipStatus`로 계산한다. 친구 요청/삭제는 기존 라우트를 재사용. 클라이언트는 `ProfileModal.tsx` 하나를 만들어 세 곳에서 공용으로 쓴다.

**Tech Stack:** better-sqlite3(raw SQL), Express, React 19, vitest.

## Global Constraints

- 매치 진행 중 화면에서는 관전자 목록의 닉네임만 클릭 가능 — 플레이어 닉네임(팀 로스터 등)은 어디서도 클릭 불가.
- 대기실/친구창(친구 목록+받은 요청+보낸 요청 3개 탭 전부)에서는 보이는 닉네임 전부 클릭 가능.
- 본인 닉네임 클릭 시 프로필은 뜨되 친구 버튼 없음.
- 이미 친구 → "친구 삭제" 버튼. 친구 아님 → "친구 요청 보내기" 버튼. 요청 대기 중(보냈든 받았든) → "요청 대기 중" 텍스트만, 버튼 없음.
- 새 라우트는 `GET /api/profile/:nickname` 하나뿐 — 친구 요청/삭제는 기존 `POST /api/friends/request`, `DELETE /api/friends/:id` 재사용.
- 존재하지 않는 닉네임 → 404. 비로그인 → 401.
- 이 프로젝트는 Express 라우트에 대한 HTTP 레벨 자동 테스트 관행이 없다 — 서버 테스트는 라우트 아래 순수 함수를 직접 호출해서 검증한다. 클라이언트는 테스트 프레임워크가 전혀 없다 — 브라우저 직접 검증만 한다.

---

### Task 1: `getFriendshipStatus` (친구 관계 상태 판정)

**Files:**
- Modify: `server/src/friends/friendships.ts`
- Modify: `server/src/friends/friendships.test.ts`

**Interfaces:**
- Produces: `FriendshipStatus` 타입(`"self" | "friends" | "pending_sent" | "pending_received" | "none"`), `getFriendshipStatus(viewerId: number, targetId: number): { status: FriendshipStatus; friendshipId: number | null }` — Task 2가 그대로 소비.

- [ ] **Step 1: 실패하는 테스트 작성**

`server/src/friends/friendships.test.ts`의 기존 import 줄:

```ts
import { sendFriendRequest, respondToRequest, cancelRequest, removeFriend, listFriends, listReceivedRequests, listSentRequests, areFriends } from "./friendships";
```

변경:

```ts
import { sendFriendRequest, respondToRequest, cancelRequest, removeFriend, listFriends, listReceivedRequests, listSentRequests, areFriends, getFriendshipStatus } from "./friendships";
```

파일 끝에 추가(기존 `makeUser`/`getFriendshipId` 헬퍼를 그대로 재사용):

```ts
describe("getFriendshipStatus", () => {
  beforeEach(() => {
    db.exec("DELETE FROM friendships");
    db.exec("DELETE FROM users");
  });

  test("returns self when viewer and target are the same", () => {
    const a = makeUser("sub-status-1", "에이");
    expect(getFriendshipStatus(a, a)).toEqual({ status: "self", friendshipId: null });
  });

  test("returns none when there's no friendship row", () => {
    const a = makeUser("sub-status-2", "에이");
    const b = makeUser("sub-status-3", "비");
    expect(getFriendshipStatus(a, b)).toEqual({ status: "none", friendshipId: null });
  });

  test("returns pending_sent when the viewer sent the request", () => {
    const a = makeUser("sub-status-4", "에이");
    const b = makeUser("sub-status-5", "비");
    sendFriendRequest(a, b);
    const result = getFriendshipStatus(a, b);
    expect(result.status).toBe("pending_sent");
    expect(result.friendshipId).toEqual(expect.any(Number));
  });

  test("returns pending_received when the viewer received the request", () => {
    const a = makeUser("sub-status-6", "에이");
    const b = makeUser("sub-status-7", "비");
    sendFriendRequest(a, b);
    const result = getFriendshipStatus(b, a);
    expect(result.status).toBe("pending_received");
    expect(result.friendshipId).toEqual(expect.any(Number));
  });

  test("returns friends with the friendshipId once accepted, symmetric both directions", () => {
    const a = makeUser("sub-status-8", "에이");
    const b = makeUser("sub-status-9", "비");
    sendFriendRequest(a, b);
    const requestId = getFriendshipId(a, b);
    respondToRequest(requestId, b, true);

    expect(getFriendshipStatus(a, b)).toEqual({ status: "friends", friendshipId: requestId });
    expect(getFriendshipStatus(b, a)).toEqual({ status: "friends", friendshipId: requestId });
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run friendships.test.ts` (`server/` 디렉토리에서)
Expected: FAIL — `getFriendshipStatus is not a function` (혹은 이름을 찾을 수 없다는 취지의 에러)

- [ ] **Step 3: 구현**

`server/src/friends/friendships.ts`의 `findFriendshipRow` 함수 바로 뒤에 추가:

```ts
export type FriendshipStatus = "self" | "friends" | "pending_sent" | "pending_received" | "none";

export type FriendshipStatusResult = { status: FriendshipStatus; friendshipId: number | null };

export function getFriendshipStatus(viewerId: number, targetId: number): FriendshipStatusResult {
  if (viewerId === targetId) return { status: "self", friendshipId: null };
  const row = findFriendshipRow(viewerId, targetId);
  if (!row) return { status: "none", friendshipId: null };
  if (row.status === "accepted") return { status: "friends", friendshipId: row.id };
  return { status: row.requester_id === viewerId ? "pending_sent" : "pending_received", friendshipId: row.id };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run friendships.test.ts` (`server/` 디렉토리에서)
Expected: PASS (기존 테스트 포함 전체 통과, 새로 추가된 5개도 포함)

- [ ] **Step 5: 커밋**

```bash
git add server/src/friends/friendships.ts server/src/friends/friendships.test.ts
git commit -m "$(cat <<'EOF'
친구 관계 상태 판정 함수(getFriendshipStatus) 추가

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `GET /api/profile/:nickname` 라우트

**Files:**
- Modify: `server/src/createServer.ts`

**Interfaces:**
- Consumes: Task 1의 `getFriendshipStatus`, 기존 `findUserByNickname`/`getUserById`(이미 import돼있음).
- Produces: `GET /api/profile/:nickname` — `{userId, nickname, nicknameColor, maxRound, pigPlayCount, rabbitPlayCount, friendshipStatus, friendshipId}` — Task 3이 그대로 소비.

- [ ] **Step 1: import 추가**

기존 `from "./friends/friendships"` import 블록에 `getFriendshipStatus` 추가(그 블록에 이미 `findUserByNickname` 등이 나열돼 있는 곳).

- [ ] **Step 2: 라우트 추가**

기존 `/api/chat/:friendUserId/read` 라우트(파일 끝쪽, `const httpServer = createHttpServer(app);` 바로 앞) 뒤에 추가:

```ts
  app.get("/api/profile/:nickname", (req, res) => {
    const cookies = (req as unknown as { cookies?: Record<string, string> }).cookies;
    const userId = verifySession(cookies?.[SESSION_COOKIE_NAME]);
    if (!userId) {
      res.status(401).json({ error: "로그인이 필요합니다." });
      return;
    }
    const target = findUserByNickname(req.params.nickname);
    if (!target) {
      res.status(404).json({ error: "존재하지 않는 유저예요." });
      return;
    }
    const user = getUserById(target.id);
    if (!user) {
      res.status(404).json({ error: "존재하지 않는 유저예요." });
      return;
    }
    const { status, friendshipId } = getFriendshipStatus(userId, target.id);
    res.json({
      userId: target.id,
      nickname: user.nickname,
      nicknameColor: user.nicknameColor,
      maxRound: user.maxRound,
      pigPlayCount: user.pigPlayCount,
      rabbitPlayCount: user.rabbitPlayCount,
      friendshipStatus: status,
      friendshipId,
    });
  });
```

- [ ] **Step 3: 테스트 + 타입체크**

Run: `npm test --workspace server` (레포 루트에서)
Expected: 전체 통과(이 Task는 새 테스트 파일을 추가하지 않음 — 프로젝트 관행대로 Express 라우트 자체는 자동 테스트 없음). `MatchRoom.test.ts`의 "timeAdd extends the actual turn deadline"는 실제 wall-clock 타이밍에 의존하는 pre-existing flake — 그것만 실패하면 재실행해서 통과하는지 확인하고 무관한 것으로 취급.

Run: `npx tsc --noEmit -p tsconfig.json` (`server/` 디렉토리에서)
Expected: 에러 없음.

- [ ] **Step 4: 커밋**

```bash
git add server/src/createServer.ts
git commit -m "$(cat <<'EOF'
GET /api/profile/:nickname 라우트 추가

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: 클라이언트 API 함수 + `ProfileModal`

**Files:**
- Create: `client/src/game/profile.ts`
- Create: `client/src/components/ProfileModal.tsx`
- Create: `client/src/components/ProfileModal.module.css`

**Interfaces:**
- Consumes: Task 2의 응답 형태. 기존 `client/src/game/friends.ts`의 `sendFriendRequest(nickname): Promise<{result: string}>`, `removeFriend(friendshipId): Promise<{ok: true}>`.
- Produces: `PublicProfile` 타입, `getProfile(nickname): Promise<PublicProfile>`, `<ProfileModal nickname={string} onClose={() => void} />` — Task 4가 그대로 소비.

- [ ] **Step 1: `client/src/game/profile.ts` 작성**

```ts
export type FriendshipStatus = "self" | "friends" | "pending_sent" | "pending_received" | "none";

export type PublicProfile = {
  userId: number;
  nickname: string;
  nicknameColor: string | null;
  maxRound: number;
  pigPlayCount: number;
  rabbitPlayCount: number;
  friendshipStatus: FriendshipStatus;
  friendshipId: number | null;
};

export async function getProfile(nickname: string): Promise<PublicProfile> {
  const res = await fetch(`/api/profile/${encodeURIComponent(nickname)}`, { credentials: "same-origin" });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error ?? "프로필을 불러오지 못했어요.");
  return body as PublicProfile;
}
```

- [ ] **Step 2: `ProfileModal.tsx` 작성**

```tsx
import { useEffect, useState } from "react";
import { getProfile, type PublicProfile } from "../game/profile";
import { removeFriend, sendFriendRequest } from "../game/friends";
import styles from "./ProfileModal.module.css";

export function ProfileModal({ nickname, onClose }: { nickname: string; onClose: () => void }) {
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getProfile(nickname)
      .then(setProfile)
      .catch((err) => setError(err instanceof Error ? err.message : "프로필을 불러오지 못했어요."));
  }, [nickname]);

  async function handleSendRequest() {
    if (!profile) return;
    setBusy(true);
    setMessage(null);
    try {
      const { result } = await sendFriendRequest(profile.nickname);
      setMessage(result === "auto_accepted" ? "서로 요청이 있어서 바로 친구가 됐어요!" : "요청을 보냈어요.");
      const refreshed = await getProfile(nickname);
      setProfile(refreshed);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "요청에 실패했어요.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveFriend() {
    if (!profile?.friendshipId) return;
    setBusy(true);
    setMessage(null);
    try {
      await removeFriend(profile.friendshipId);
      const refreshed = await getProfile(nickname);
      setProfile(refreshed);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "삭제에 실패했어요.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        {error && <p className={styles.error}>{error}</p>}
        {!error && !profile && <p className={styles.loading}>불러오는 중...</p>}
        {profile && (
          <>
            <h2 className={styles.heading} style={{ color: profile.nicknameColor || undefined }}>
              {profile.nickname}
            </h2>
            <div className={styles.stats}>
              <span className={styles.stat}>
                🐷 {profile.pigPlayCount}판 🐰 {profile.rabbitPlayCount}판
              </span>
              <span className={styles.stat}>최고 {profile.maxRound}라운드</span>
            </div>
            {message && <p className={styles.message}>{message}</p>}
            {profile.friendshipStatus === "none" && (
              <button className={styles.actionButton} onClick={handleSendRequest} disabled={busy}>
                친구 요청 보내기
              </button>
            )}
            {profile.friendshipStatus === "friends" && (
              <button className={styles.removeButton} onClick={handleRemoveFriend} disabled={busy}>
                친구 삭제
              </button>
            )}
            {(profile.friendshipStatus === "pending_sent" || profile.friendshipStatus === "pending_received") && (
              <p className={styles.pending}>요청 대기 중</p>
            )}
          </>
        )}
        <button className={styles.closeButton} onClick={onClose}>
          닫기
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: `ProfileModal.module.css` 작성**

```css
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  box-sizing: border-box;
  z-index: 20;
}

.modal {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  width: 100%;
  max-width: 20rem;
  padding: 1.5rem;
  border-radius: 0.8rem;
  background: #1f2937;
  color: #fff;
  box-sizing: border-box;
  text-align: center;
}

.heading {
  margin: 0;
  font-size: 1.3rem;
  font-weight: 800;
}

.stats {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.stat {
  font-size: 0.9rem;
  opacity: 0.9;
}

.loading,
.error {
  text-align: center;
  opacity: 0.8;
  font-size: 0.9rem;
  margin: 0;
}

.message {
  margin: 0;
  font-size: 0.85rem;
  opacity: 0.9;
}

.pending {
  margin: 0;
  font-size: 0.85rem;
  opacity: 0.8;
}

.actionButton {
  padding: 0.6rem 1rem;
  font-size: 0.95rem;
  border-radius: 0.6rem;
  border: none;
  cursor: pointer;
  color: #fff;
  font-weight: 700;
  background: linear-gradient(135deg, #3b82f6, #2563eb);
}

.actionButton:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.removeButton {
  padding: 0.6rem 1rem;
  font-size: 0.95rem;
  border-radius: 0.6rem;
  border: none;
  cursor: pointer;
  color: #fff;
  font-weight: 700;
  background: #e03131;
}

.removeButton:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.closeButton {
  padding: 0.6rem 1rem;
  font-size: 0.95rem;
  border-radius: 0.6rem;
  border: none;
  cursor: pointer;
  color: #fff;
  font-weight: 700;
  background: #363861;
}
```

- [ ] **Step 4: 타입체크**

Run: `npm run build --workspace client` (레포 루트에서)
Expected: 에러 없음(이 시점엔 `ProfileModal`을 쓰는 곳이 아직 없어서 아무것도 안 깨짐).

- [ ] **Step 5: 커밋**

```bash
git add client/src/game/profile.ts client/src/components/ProfileModal.tsx client/src/components/ProfileModal.module.css
git commit -m "$(cat <<'EOF'
프로필 조회 API 함수 및 ProfileModal 컴포넌트 추가

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: 대기실/친구창/관전자 목록 배선 + 브라우저 검증

**Files:**
- Modify: `client/src/components/RoleSelect.tsx`
- Modify: `client/src/components/RoleSelect.module.css`
- Modify: `client/src/components/FriendsModal.tsx`
- Modify: `client/src/components/FriendsModal.module.css`
- Modify: `client/src/components/SpectatorCountBadge.tsx`
- Modify: `client/src/components/SpectatorCountBadge.module.css`

**Interfaces:**
- Consumes: Task 3의 `<ProfileModal nickname={string} onClose={() => void} />`.
- Produces: 없음 — 이 플랜의 마지막 Task.

- [ ] **Step 1: `RoleSelect.tsx` 배선**

기존 import 블록:

```tsx
import { useCallback, useState } from "react";
import type { Room } from "colyseus.js";
import type { MatchState } from "../game/matchTypes";
import type { Role } from "../game/colors";
import { ChatBox } from "./ChatBox";
import { InviteFriendsModal } from "./InviteFriendsModal";
import styles from "./RoleSelect.module.css";
```

변경:

```tsx
import { useCallback, useState } from "react";
import type { Room } from "colyseus.js";
import type { MatchState } from "../game/matchTypes";
import type { Role } from "../game/colors";
import { ChatBox } from "./ChatBox";
import { InviteFriendsModal } from "./InviteFriendsModal";
import { ProfileModal } from "./ProfileModal";
import styles from "./RoleSelect.module.css";
```

기존 state 선언:

```tsx
  const [showInviteModal, setShowInviteModal] = useState(false);
```

변경:

```tsx
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [profileNickname, setProfileNickname] = useState<string | null>(null);
```

"역할 선택 중" 대기 목록, 기존:

```tsx
            <div className={styles.pendingNames}>
              {unassignedPlayers.map((p) => (
                <span key={p.sessionId} className={styles.pendingName} style={{ color: p.nicknameColor || undefined }}>
                  {p.nickname}
                </span>
              ))}
            </div>
```

변경:

```tsx
            <div className={styles.pendingNames}>
              {unassignedPlayers.map((p) => (
                <button
                  key={p.sessionId}
                  className={styles.pendingName}
                  style={{ color: p.nicknameColor || undefined }}
                  onClick={() => setProfileNickname(p.nickname)}
                >
                  {p.nickname}
                </button>
              ))}
            </div>
```

팀 로스터, 기존:

```tsx
      <div className={styles.roster}>
        {teams.map((team) => (
          <div key={team.id} className={styles.rosterTeam}>
            <span className={styles.rosterName} style={{ color: nicknameColorFor(team.pigSessionId) }}>
              {nicknameFor(team.pigSessionId)}
            </span>
            <span className={styles.rosterName} style={{ color: nicknameColorFor(team.rabbitSessionId) }}>
              {nicknameFor(team.rabbitSessionId)}
            </span>
          </div>
        ))}
      </div>
```

변경:

```tsx
      <div className={styles.roster}>
        {teams.map((team) => (
          <div key={team.id} className={styles.rosterTeam}>
            {team.pigSessionId ? (
              <button
                className={styles.rosterName}
                style={{ color: nicknameColorFor(team.pigSessionId) }}
                onClick={() => setProfileNickname(nicknameFor(team.pigSessionId))}
              >
                {nicknameFor(team.pigSessionId)}
              </button>
            ) : (
              <span className={styles.rosterName}>{nicknameFor(team.pigSessionId)}</span>
            )}
            {team.rabbitSessionId ? (
              <button
                className={styles.rosterName}
                style={{ color: nicknameColorFor(team.rabbitSessionId) }}
                onClick={() => setProfileNickname(nicknameFor(team.rabbitSessionId))}
              >
                {nicknameFor(team.rabbitSessionId)}
              </button>
            ) : (
              <span className={styles.rosterName}>{nicknameFor(team.rabbitSessionId)}</span>
            )}
          </div>
        ))}
      </div>
```

파일 끝, 기존:

```tsx
      {showInviteModal && <InviteFriendsModal roomId={room.roomId} onClose={() => setShowInviteModal(false)} />}
    </div>
  );
}
```

변경:

```tsx
      {showInviteModal && <InviteFriendsModal roomId={room.roomId} onClose={() => setShowInviteModal(false)} />}
      {profileNickname && <ProfileModal nickname={profileNickname} onClose={() => setProfileNickname(null)} />}
    </div>
  );
}
```

- [ ] **Step 2: `RoleSelect.module.css`에 스타일 추가**

기존:

```css
.rosterName {
  min-width: 3.5rem;
}
```

변경:

```css
.rosterName {
  min-width: 3.5rem;
  background: none;
  border: none;
  padding: 0;
  font: inherit;
  color: inherit;
  cursor: pointer;
}

.rosterName:disabled {
  cursor: default;
}
```

기존 `.pendingName` 규칙(패딩/배경 등이 있는 알약 스타일)에 버튼 기본 스타일 초기화를 추가:

```css
.pendingName {
  border: none;
  font: inherit;
  cursor: pointer;
}
```

- [ ] **Step 3: `FriendsModal.tsx` 배선**

기존 import 블록에 추가:

```tsx
import { ProfileModal } from "./ProfileModal";
```

기존 `chatWith` state 바로 뒤에 추가:

```tsx
  const [profileNickname, setProfileNickname] = useState<string | null>(null);
```

받은 요청 행, 기존:

```tsx
              <div key={r.requestId} className={styles.row}>
                <span className={styles.rowNickname}>{r.fromNickname}</span>
                <div className={styles.rowActions}>
```

변경:

```tsx
              <div key={r.requestId} className={styles.row}>
                <button className={styles.rowNickname} onClick={() => setProfileNickname(r.fromNickname)}>
                  {r.fromNickname}
                </button>
                <div className={styles.rowActions}>
```

보낸 요청 행, 기존:

```tsx
              <div key={r.requestId} className={styles.row}>
                <span className={styles.rowNickname}>{r.toNickname}</span>
                <button className={styles.cancelButton} onClick={() => handleCancel(r.requestId)}>
```

변경:

```tsx
              <div key={r.requestId} className={styles.row}>
                <button className={styles.rowNickname} onClick={() => setProfileNickname(r.toNickname)}>
                  {r.toNickname}
                </button>
                <button className={styles.cancelButton} onClick={() => handleCancel(r.requestId)}>
```

친구 목록 행, 기존:

```tsx
              <div key={f.friendshipId} className={styles.row}>
                <span className={styles.rowNickname}>{f.nickname}</span>
                <span className={styles.status}>{f.online ? "🟢 온라인" : formatLastSeen(f.lastLoginAt)}</span>
```

변경:

```tsx
              <div key={f.friendshipId} className={styles.row}>
                <button className={styles.rowNickname} onClick={() => setProfileNickname(f.nickname)}>
                  {f.nickname}
                </button>
                <span className={styles.status}>{f.online ? "🟢 온라인" : formatLastSeen(f.lastLoginAt)}</span>
```

파일 끝, 기존:

```tsx
        {chatWith && (
          <DirectChatModal
            friendUserId={chatWith.userId}
            friendNickname={chatWith.nickname}
            onClose={() => {
              setChatWith(null);
              refreshAll();
            }}
          />
        )}
      </div>
    </div>
  );
}
```

변경:

```tsx
        {chatWith && (
          <DirectChatModal
            friendUserId={chatWith.userId}
            friendNickname={chatWith.nickname}
            onClose={() => {
              setChatWith(null);
              refreshAll();
            }}
          />
        )}
        {profileNickname && (
          <ProfileModal
            nickname={profileNickname}
            onClose={() => {
              setProfileNickname(null);
              refreshAll();
            }}
          />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: `FriendsModal.module.css`에 스타일 추가**

기존:

```css
.rowNickname {
  flex: 1;
  font-weight: 600;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

변경:

```css
.rowNickname {
  flex: 1;
  font-weight: 600;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  background: none;
  border: none;
  padding: 0;
  font-size: inherit;
  color: inherit;
  cursor: pointer;
}
```

- [ ] **Step 5: `SpectatorCountBadge.tsx` 배선**

기존 파일 전체:

```tsx
import { useState } from "react";
import type { Room } from "colyseus.js";
import type { MatchState } from "../game/matchTypes";
import styles from "./SpectatorCountBadge.module.css";

export function SpectatorCountBadge({ room }: { room: Room<MatchState> }) {
  const [showModal, setShowModal] = useState(false);
  const spectators = [...room.state.spectators.values()];

  return (
    <>
      <button className={styles.badge} onClick={() => setShowModal(true)}>
        👁 {spectators.length}
      </button>
      {showModal && (
        <div className={styles.overlay} onClick={() => setShowModal(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 className={styles.heading}>관전자 ({spectators.length}명)</h2>
            {spectators.length === 0 ? (
              <p className={styles.empty}>아직 관전자가 없어요</p>
            ) : (
              <ul className={styles.list}>
                {spectators.map((s) => (
                  <li key={s.sessionId} className={styles.row}>
                    {s.nickname}
                  </li>
                ))}
              </ul>
            )}
            <button className={styles.closeButton} onClick={() => setShowModal(false)}>
              닫기
            </button>
          </div>
        </div>
      )}
    </>
  );
}
```

변경(전체 교체):

```tsx
import { useState } from "react";
import type { Room } from "colyseus.js";
import type { MatchState } from "../game/matchTypes";
import { ProfileModal } from "./ProfileModal";
import styles from "./SpectatorCountBadge.module.css";

export function SpectatorCountBadge({ room }: { room: Room<MatchState> }) {
  const [showModal, setShowModal] = useState(false);
  const [profileNickname, setProfileNickname] = useState<string | null>(null);
  const spectators = [...room.state.spectators.values()];

  return (
    <>
      <button className={styles.badge} onClick={() => setShowModal(true)}>
        👁 {spectators.length}
      </button>
      {showModal && (
        <div className={styles.overlay} onClick={() => setShowModal(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 className={styles.heading}>관전자 ({spectators.length}명)</h2>
            {spectators.length === 0 ? (
              <p className={styles.empty}>아직 관전자가 없어요</p>
            ) : (
              <ul className={styles.list}>
                {spectators.map((s) => (
                  <li key={s.sessionId}>
                    <button className={styles.row} onClick={() => setProfileNickname(s.nickname)}>
                      {s.nickname}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button className={styles.closeButton} onClick={() => setShowModal(false)}>
              닫기
            </button>
          </div>
        </div>
      )}
      {profileNickname && <ProfileModal nickname={profileNickname} onClose={() => setProfileNickname(null)} />}
    </>
  );
}
```

- [ ] **Step 6: `SpectatorCountBadge.module.css`에 스타일 추가**

기존:

```css
.row {
  padding: 0.5rem 0.75rem;
  border-radius: 0.5rem;
  background: rgba(255, 255, 255, 0.08);
  text-align: left;
}
```

변경:

```css
.row {
  width: 100%;
  padding: 0.5rem 0.75rem;
  border-radius: 0.5rem;
  background: rgba(255, 255, 255, 0.08);
  text-align: left;
  border: none;
  font-size: inherit;
  color: inherit;
  cursor: pointer;
  box-sizing: border-box;
}
```

- [ ] **Step 7: 타입체크 + 빌드**

Run: `npm run build --workspace client`
Expected: 에러 없음.

- [ ] **Step 8: 로컬 same-origin 서버로 실행**

```bash
node sync-public.js
npm run dev:server
```

`http://localhost:2567` 접속.

- [ ] **Step 9: 브라우저로 전체 플로우 검증**

이전 기능들과 동일한 방식(`signSession`으로 세션 JWT 발급, `server/.env`의 `SESSION_JWT_SECRET`, 가짜 계정을 DB에 직접 INSERT)으로 최소 3개 계정(A/B/C)을 준비한다. A-B는 미리 accepted 친구로 만들어두고, C는 아무와도 친구 아닌 상태로 둔다. 매치 시작까지 필요하므로 최소 2개는 실제 Colyseus WS 연결이 필요 — 이전 "초대하기/따라가기" 검증 때처럼 **완전히 분리된 Playwright 브라우저 컨텍스트**를 써야 한다.

검증 순서:
1. A와 B가 대기실(RoleSelect)에 들어간 방에서, A가 B의 팀 로스터 닉네임(또는 역할 선택 중 대기 목록 닉네임)을 클릭 → 프로필 팝업에 B의 통계와 "친구 삭제" 버튼(이미 친구이므로)이 뜨는지 확인.
2. A가 본인(A) 닉네임을 클릭 → 프로필은 뜨지만 친구 버튼이 없는지 확인.
3. A가 친구창을 열어 C에게 친구 요청을 보낸 뒤, 친구창의 "보낸 요청" 탭에서 C의 닉네임을 클릭 → 프로필 팝업에 "요청 대기 중" 텍스트만 뜨고 버튼이 없는지 확인.
4. C 계정으로 로그인해 친구창의 "받은 요청" 탭에서 A의 닉네임을 클릭 → 역시 "요청 대기 중"만 뜨는지 확인(수락은 기존 받은 요청 탭의 수락 버튼으로).
5. A와 B가 매치를 시작(teamCount 1)한 뒤, 관전 허용 방이면 C가 관전자로 입장 → 관전자 목록(👁 배지 클릭)에서 C 자신 또는 다른 관전자 닉네임을 클릭하면 프로필이 뜨는지 확인.
6. 같은 매치 화면에서 팀 로스터(TeamRosterPanel, 플레이어 명단)의 닉네임은 클릭해도 아무 반응이 없는지(버튼이 아니라 일반 텍스트인지) 확인 — 관전자 화면과 플레이어 본인 화면 양쪽에서.
7. 프로필 팝업에서 "친구 삭제"를 눌러 실제로 친구 관계가 사라지는지(다시 프로필을 열면 "친구 요청 보내기"로 바뀌는지) 확인.
8. 존재하지 않는 닉네임으로 직접 `/api/profile/존재안함` 호출 시 404가 오는지 확인(정상 플로우에서는 항상 실제로 보이는 닉네임만 클릭하므로 UI로는 도달 불가 — API 직접 확인).

전부 통과하면 이 Task 완료.

- [ ] **Step 10: 테스트 아티팩트 정리**

가짜 계정들(및 관련 friendship row)을 DB에서 삭제. 개발 서버 종료.

- [ ] **Step 11: 커밋**

```bash
git add client/src/components/RoleSelect.tsx client/src/components/RoleSelect.module.css client/src/components/FriendsModal.tsx client/src/components/FriendsModal.module.css client/src/components/SpectatorCountBadge.tsx client/src/components/SpectatorCountBadge.module.css
git commit -m "$(cat <<'EOF'
대기실/친구창/관전자 목록에 닉네임 클릭 프로필 팝업 배선

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## 이 플랜에서 의도적으로 빠진 것

- 매치 중 플레이어 닉네임 클릭 — 요구사항대로 영구히 제외.
- 프로필 팝업에서 요청 수락/거절/취소 — 친구창에서만.
- 온라인 여부 표시 — 이 팝업의 목적(통계+친구 액션)과 무관, 범위 밖.
- 차단 기능.
