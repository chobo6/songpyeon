# 닉네임 클릭 → 프로필 팝업 (친구요청/삭제) 설계

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:writing-plans to turn this spec into an implementation plan.

**Goal:** 대기실(`RoleSelect.tsx`)과 친구창(`FriendsModal.tsx`)에서는 보이는 모든 닉네임을, 매치 진행 중 화면에서는 관전자 목록(`SpectatorCountBadge.tsx`)의 닉네임만 클릭해서 그 사람의 프로필(역할별 플레이 횟수, 최고 라운드)을 보고, 친구 요청을 보내거나(아직 친구 아님) 친구를 삭제할 수 있게(이미 친구) 한다. 매치 진행 중인 화면의 **플레이어 닉네임은 어디서도 클릭 불가**(`TeamRosterPanel` 등은 손대지 않음).

**Architecture:** 새 GET 라우트 하나(`/api/profile/:nickname`)만 추가 — 대상의 통계(이미 있는 `max_round`/`pig_play_count`/`rabbit_play_count`)와 조회자 기준 친구 관계 상태를 합쳐서 반환한다. 친구 요청 보내기/삭제는 새 라우트를 만들지 않고 **기존 `POST /api/friends/request`, `DELETE /api/friends/:id`를 그대로 재사용**한다. 클라이언트는 `ProfileModal.tsx` 하나만 새로 만들어 세 곳(대기실/친구창/관전자 목록)에서 공용으로 쓴다 — 모달 위에 겹쳐 뜨는 형태(기존에도 모달 위에 모달이 뜨는 패턴이 이미 있음).

## Global Constraints

- 매치 진행 중 화면에서는 **관전자 목록의 닉네임만** 클릭 가능 — 플레이어 닉네임(팀 로스터 등)은 관전자가 보는 화면이든 본인 화면이든 어디서도 클릭 불가.
- 대기실/친구창에서는 보이는 닉네임 전부 클릭 가능(친구창은 친구 목록 + 받은 요청 + 보낸 요청 3개 탭 전부).
- 자기 자신의 닉네임을 클릭하면 프로필은 뜨되 친구 버튼은 없음.
- 이미 친구인 경우: "친구 삭제" 버튼.
- 친구 아닌 경우: "친구 요청 보내기" 버튼.
- 요청이 대기 중(보냈든 받았든)인 경우: "요청 대기 중" 텍스트만, 액션 버튼 없음(수락/거절/취소는 기존대로 친구창에서만).
- 새로 만드는 라우트는 `GET /api/profile/:nickname` 하나뿐 — 친구 요청/삭제는 기존 라우트 재사용.
- 대상을 못 찾으면(존재하지 않는 닉네임) 404.
- 로그인 필요(401) — 기존 라우트들과 같은 세션 인증 패턴.

## `server/src/friends/friendships.ts` 변경 — `getFriendshipStatus` 추가

기존 `findFriendshipRow`(비공개 함수, 이미 있음 — 방향 무관 pending/accepted row 조회)를 재사용해서, 그 바로 뒤에 추가:

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

## `server/src/createServer.ts` — `GET /api/profile/:nickname`

새 import(기존 `from "./friends/friendships"` 블록에 `getFriendshipStatus` 추가), 새 라우트(기존 `/api/chat/*` 라우트들 뒤, `const httpServer = createHttpServer(app);` 앞):

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

`findUserByNickname`은 이미 `./friends/friendships`에서 import돼있음(친구 요청 라우트가 이미 씀). `getUserById`도 이미 import돼있음.

## 클라이언트

### `client/src/game/profile.ts` (신규)

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

### `client/src/components/ProfileModal.tsx` (신규)

`FriendsModal.tsx`와 같은 오버레이+모달 구조. 친구 요청/삭제는 기존 `client/src/game/friends.ts`의 `sendFriendRequest`/`removeFriend`를 그대로 가져다 쓴다:

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

### `client/src/components/ProfileModal.module.css` (신규)

`FriendsModal.module.css`의 `.overlay`/`.modal`/`.heading`/`.closeButton`을 그대로 가져오되, 이 모달 전용 요소 추가:

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

(`z-index: 20` — 친구창/관전자 목록 모달(`z-index: 10`) 위에 겹쳐 뜰 수 있어야 하므로 더 높게.)

### `client/src/components/RoleSelect.tsx` 배선

새 state + import, 팀 로스터와 "역할 선택 중" 대기 목록의 닉네임을 클릭 가능한 버튼으로 변경. 로스터 쪽은 빈 슬롯("대기 중"/"?")은 클릭 불가로 남겨둔다.

기존 import:

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

기존 state 선언 바로 뒤에 추가:

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

변경(빈 슬롯인 sessionId는 그냥 `<span>`, 실제 플레이어가 있는 슬롯만 `<button>`):

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

### `client/src/components/RoleSelect.module.css` 변경

기존 `.rosterName`(지금은 `<span>`용)에 버튼 리셋 스타일을 더해 `<button>`으로도 자연스럽게 쓰이게 한다. 기존:

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

(`<span>`은 `cursor: pointer`가 적용돼도 클릭 핸들러가 없어 실질적 영향 없음 — 굳이 `<span>`/`<button>` 두 버전의 스타일을 분리하지 않고 하나로 재사용.) `.pendingName`도 원래 `<span>`용 padding/border-radius/background가 있는 "알약" 스타일이라 버튼 기본 스타일(테두리 등)을 초기화해줘야 함 — 기존 규칙에 다음을 추가:

```css
.pendingName {
  border: none;
  font: inherit;
  cursor: pointer;
}
```

### `client/src/components/FriendsModal.tsx` 배선

새 state + import, 친구 목록/받은 요청/보낸 요청 3개 탭의 닉네임을 전부 클릭 가능한 버튼으로 변경.

새 import 추가:

```tsx
import { ProfileModal } from "./ProfileModal";
```

새 state(기존 `chatWith` state 바로 뒤에 추가):

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

(닫을 때 `refreshAll()` — 프로필 팝업에서 친구 삭제/요청을 했으면 친구창 목록도 같이 갱신되게.)

### `client/src/components/FriendsModal.module.css` 변경

기존 `.rowNickname`은 `<span>`용(`flex:1; font-weight:600; text-align:left; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;`) — `<button>`으로 재사용 가능하게 버튼 기본 스타일 초기화 추가. 기존:

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

### `client/src/components/SpectatorCountBadge.tsx` 배선

관전자 목록의 각 닉네임을 클릭 가능하게 변경. 기존:

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

변경:

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

### `client/src/components/SpectatorCountBadge.module.css` 변경

기존 `.row`는 `<li>`용(`padding/border-radius/background/text-align: left`) — 이제 `<li>` 안의 `<button>`이 되므로 너비를 꽉 채우고 버튼 기본 스타일을 초기화해야 함. 기존:

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

## 테스트

- **서버**: `getFriendshipStatus`를 `friendships.test.ts`에 추가 — self, none(관계 없음), pending_sent, pending_received, friends(+friendshipId 정확성) 5가지 케이스. `/api/profile/:nickname` 라우트 자체는 이 프로젝트 관행대로 자동 테스트 없음.
- **클라이언트**: 테스트 프레임워크 없음. 브라우저로 실제 검증 — 계정 2~3개로 대기실/친구창/관전자 목록 각각에서 프로필 팝업 열기, 상태별(친구 아님/친구/대기중/본인) 버튼 분기, 실제 친구 요청 보내기·삭제 동작, 매치 진행 중 화면에서 플레이어 닉네임은 클릭이 아예 안 되는지(버튼이 아니라 그냥 텍스트인지) 확인.
