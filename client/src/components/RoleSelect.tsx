import type { Room } from "colyseus.js";
import type { MatchState } from "../game/matchTypes";
import type { Role } from "../game/colors";
import styles from "./RoleSelect.module.css";

export function RoleSelect({ room, onExit }: { room: Room<MatchState>; onExit: () => void }) {
  const me = room.state.players.get(room.sessionId);
  const myRole = me?.role;
  const teams = room.state.teams;

  function choose(role: Role) {
    room.send("chooseRole", { role });
  }

  function nicknameFor(sessionId: string): string {
    return sessionId ? (room.state.players.get(sessionId)?.nickname ?? "?") : "대기 중";
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <h1 className={styles.title}>송편 만들기</h1>
      </div>
      {myRole ? (
        <p className={styles.waiting}>{myRole === "pig" ? "돼지" : "토끼"} 역할로 대기 중...</p>
      ) : (
        <div className={styles.choices}>
          <button className={`${styles.roleButton} ${styles.pigButton}`} onClick={() => choose("pig")}>
            <img
              className={styles.roleIcon}
              src="/game-assets/ui/thanksgiving_room_start_player_pig.png"
              alt=""
            />
            <span>돼지</span>
          </button>
          <button className={`${styles.roleButton} ${styles.rabbitButton}`} onClick={() => choose("rabbit")}>
            <img
              className={styles.roleIcon}
              src="/game-assets/ui/thanksgiving_room_start_player_rabbit.png"
              alt=""
            />
            <span>토끼</span>
          </button>
        </div>
      )}
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
