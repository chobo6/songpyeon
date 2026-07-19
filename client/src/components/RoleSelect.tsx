import { useCallback } from "react";
import type { Room } from "colyseus.js";
import type { MatchState } from "../game/matchTypes";
import type { Role } from "../game/colors";
import { ChatBox } from "./ChatBox";
import styles from "./RoleSelect.module.css";

export function RoleSelect({ room, onExit }: { room: Room<MatchState>; onExit: () => void }) {
  const me = room.state.players.get(room.sessionId);
  const myRole = me?.role;
  const teams = room.state.teams;
  const lobbyChat = room.state.lobbyChat;
  const unassignedPlayers = Array.from(room.state.players.values()).filter((p) => p.role === "");

  function choose(role: Role) {
    room.send("chooseRole", { role });
  }

  // Stable reference (room never changes for this hook's lifetime) so it
  // doesn't defeat ChatBox's memoization — see ChatBox.tsx.
  const sendChat = useCallback(
    (text: string) => {
      room.send("sendChat", { text });
    },
    [room],
  );

  function nicknameFor(sessionId: string): string {
    return sessionId ? (room.state.players.get(sessionId)?.nickname ?? "?") : "대기 중";
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <h1 className={styles.title}>송편 만들기</h1>
      </div>
      {/* min-height 고정 슬롯 — 대기 중인 사람 표시가 나타나거나 사라질 때
          이 영역의 실제 콘텐츠 높이가 바뀌면서 아래 역할 선택 버튼/채팅/
          나가기 버튼까지 통째로 밀리는 걸 막는다. */}
      <div className={styles.statusArea}>
        {room.state.countdownSecondsLeft > 0 ? (
          <p className={styles.countdown}>{room.state.countdownSecondsLeft}초 뒤에 시작합니다.</p>
        ) : unassignedPlayers.length > 0 ? (
          <div className={styles.pending}>
            <span className={styles.pendingLabel}>역할 선택 중</span>
            <div className={styles.pendingNames}>
              {unassignedPlayers.map((p) => (
                <span key={p.sessionId} className={styles.pendingName}>
                  {p.nickname}
                </span>
              ))}
            </div>
          </div>
        ) : (
          myRole && <p className={styles.waiting}>{myRole === "pig" ? "돼지" : "토끼"} 역할로 대기 중...</p>
        )}
      </div>
      <div className={styles.choices}>
        <button
          className={`${styles.roleButton} ${styles.pigButton} ${myRole === "pig" ? styles.selected : ""} ${myRole && myRole !== "pig" ? styles.dimmed : ""}`}
          onClick={() => choose("pig")}
          disabled={room.state.countdownSecondsLeft > 0}
        >
          <img className={styles.roleIcon} src="/game-assets/ui/thanksgiving_room_start_player_pig.png" alt="" />
          <span>돼지</span>
        </button>
        <button
          className={`${styles.roleButton} ${styles.rabbitButton} ${myRole === "rabbit" ? styles.selected : ""} ${myRole && myRole !== "rabbit" ? styles.dimmed : ""}`}
          onClick={() => choose("rabbit")}
          disabled={room.state.countdownSecondsLeft > 0}
        >
          <img className={styles.roleIcon} src="/game-assets/ui/thanksgiving_room_start_player_rabbit.png" alt="" />
          <span>토끼</span>
        </button>
      </div>
      <ChatBox
        messages={lobbyChat}
        messageCount={lobbyChat.length}
        lastMessageAt={lobbyChat.length ? lobbyChat[lobbyChat.length - 1].sentAt : 0}
        onSend={sendChat}
      />
      <div className={styles.roster}>
        {teams.map((team) => (
          <div key={team.id} className={styles.rosterTeam}>
            <span className={styles.rosterName}>{nicknameFor(team.pigSessionId)}</span>
            <span className={styles.rosterName}>{nicknameFor(team.rabbitSessionId)}</span>
          </div>
        ))}
      </div>
      <button className={styles.leaveButton} onClick={onExit}>
        나가기
      </button>
    </div>
  );
}
