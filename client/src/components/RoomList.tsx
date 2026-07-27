import { useEffect, useState } from "react";
import { listRooms, type RoomListEntry } from "../colyseus";
import { getReceivedRequests } from "../game/friends";
import { dismissInvite, getPendingInvite, type PendingInvite } from "../game/invites";
import { CreateRoomModal } from "./CreateRoomModal";
import { RankingModal } from "./RankingModal";
import { InquiryModal } from "./InquiryModal";
import { FriendsModal } from "./FriendsModal";
import styles from "./RoomList.module.css";

const POLL_INTERVAL_MS = 2000;

// 진짜 권한 시스템은 없음 — 닉네임 하나로 식별하는 임시 관리자 표시.
// client/src/components/MyTurnScreen.tsx의 KEYBOARD_PRESS_ALLOWED_NICKNAME과 같은 패턴.
const ADMIN_NICKNAME = "홍바들";

export function RoomList({
  nickname,
  onCreateRoom,
  onJoinRoom,
  onExit,
}: {
  nickname: string;
  onCreateRoom: (title: string, teamCount: number, allowSpectators: boolean, itemsEnabled: boolean) => void;
  onJoinRoom: (roomId: string) => void;
  onExit: () => void;
}) {
  const isAdmin = nickname === ADMIN_NICKNAME;
  const [rooms, setRooms] = useState<RoomListEntry[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showRankingModal, setShowRankingModal] = useState(false);
  const [showInquiryModal, setShowInquiryModal] = useState(false);
  const [showFriendsModal, setShowFriendsModal] = useState(false);
  const [pendingRequestCount, setPendingRequestCount] = useState(0);
  const [pendingInvite, setPendingInvite] = useState<PendingInvite>(null);

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      try {
        const [list, invite] = await Promise.all([listRooms(), getPendingInvite()]);
        if (!cancelled) {
          setRooms(list);
          setPendingInvite(invite);
        }
      } catch (err) {
        console.error("failed to list rooms", err);
      }
    }

    refresh();
    const interval = setInterval(refresh, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    getReceivedRequests()
      .then((requests) => setPendingRequestCount(requests.length))
      .catch(() => {});
  }, []);

  async function handleAcceptInvite() {
    if (!pendingInvite) return;
    const roomId = pendingInvite.roomId;
    await dismissInvite();
    setPendingInvite(null);
    onJoinRoom(roomId);
  }

  async function handleDismissInvite() {
    await dismissInvite();
    setPendingInvite(null);
  }

  return (
    <div className={styles.wrap}>
      <h1 className={styles.title}>송편 만들기</h1>
      {pendingInvite && (
        <div className={styles.inviteBanner}>
          <span>{pendingInvite.fromNickname}님이 초대했어요!</span>
          <div className={styles.inviteBannerActions}>
            <button className={styles.inviteAcceptButton} onClick={handleAcceptInvite}>
              참가하기
            </button>
            <button className={styles.inviteDismissButton} onClick={handleDismissInvite}>
              닫기
            </button>
          </div>
        </div>
      )}
      <div className={styles.topButtons}>
        <button className={styles.createButton} onClick={() => setShowCreateModal(true)}>
          방 만들기
        </button>
        <button className={styles.rankingButton} onClick={() => setShowRankingModal(true)}>
          랭킹
        </button>
        <button className={styles.friendsButton} onClick={() => setShowFriendsModal(true)}>
          친구
          {pendingRequestCount > 0 && <span className={styles.badge}>{pendingRequestCount}</span>}
        </button>
      </div>
      <div className={styles.list}>
        {rooms.length === 0 && <p className={styles.empty}>열려있는 방이 없어요</p>}
        {rooms.map((room) => {
          // `locked` is the only reliable "can't join" signal here — it's
          // not Colyseus's own maxClients-triggered auto-lock (that's
          // deliberately unused now; see createServer.ts's /api/rooms route,
          // which derives `locked` from room metadata's `phase` instead), so
          // a separate "room.clients >= room.maxClients" check can never
          // be true when `locked` isn't already true too. This listing can
          // still be stale in the other direction (a role slot held by a
          // reconnection-grace session doesn't count toward `clients`, so a
          // room can look joinable here for a couple seconds after it's
          // actually full) — that residual race is handled by
          // ConnectedOnlineFlow's error screen, not predicted here.
          return (
            <div key={room.roomId} className={styles.card}>
              <span className={styles.cardName}>
                {room.roomTitle} ({room.clients}/{room.maxClients})
              </span>
              <button
                className={styles.joinButton}
                disabled={room.locked && !room.allowSpectators && !isAdmin}
                onClick={() => onJoinRoom(room.roomId)}
              >
                {room.locked ? (room.allowSpectators || isAdmin ? "관전하기" : "게임 중") : "입장"}
              </button>
            </div>
          );
        })}
      </div>
      <button className={styles.exitButton} onClick={onExit}>
        나가기
      </button>
      <button className={styles.inquiryButton} onClick={() => setShowInquiryModal(true)}>
        문의하기
      </button>
      {showCreateModal && (
        <CreateRoomModal
          onClose={() => setShowCreateModal(false)}
          onCreate={(title, teamCount, allowSpectators, itemsEnabled) => {
            setShowCreateModal(false);
            onCreateRoom(title, teamCount, allowSpectators, itemsEnabled);
          }}
        />
      )}
      {showRankingModal && <RankingModal onClose={() => setShowRankingModal(false)} />}
      {showInquiryModal && <InquiryModal onClose={() => setShowInquiryModal(false)} />}
      {showFriendsModal && (
        <FriendsModal
          onJoinRoom={onJoinRoom}
          onClose={() => {
            setShowFriendsModal(false);
            getReceivedRequests()
              .then((requests) => setPendingRequestCount(requests.length))
              .catch(() => {});
          }}
        />
      )}
    </div>
  );
}
