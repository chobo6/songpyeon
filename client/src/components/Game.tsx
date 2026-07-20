import { useEffect } from "react";
import type { Room } from "colyseus.js";
import type { MatchState } from "../game/matchTypes";
import { RoleSelect } from "./RoleSelect";
import { MyTurnScreen } from "./MyTurnScreen";
import { SpectatorScreen } from "./SpectatorScreen";
import { SpectatorCountBadge } from "./SpectatorCountBadge";
import { BgmPlayer } from "./BgmPlayer";

export function Game({
  room,
  clockOffsetMs,
  onLeave,
  onExit,
}: {
  room: Room<MatchState>;
  clockOffsetMs: number;
  onLeave: () => void;
  onExit: () => void;
}) {
  const { phase } = room.state;
  const isSpectator = room.state.spectators.has(room.sessionId);

  // 매치가 끝나 재경기 로비로 돌아가는 순간, 관전자는 그 로비(플레이어들끼리의 재경기
  // 대기실)에 남아있을 이유가 없다 — 자동으로 방을 나가 방 목록으로 돌아간다.
  useEffect(() => {
    if (isSpectator && phase === "lobby") {
      onLeave();
    }
  }, [isSpectator, phase, onLeave]);

  if (phase === "lobby") {
    // 관전자가 여기 도달하는 건 위 effect가 아직 반영되기 전의 찰나뿐이므로, 그 사이엔
    // 로비 화면을 보여줄 필요 없이 아무것도 렌더링하지 않는다.
    if (isSpectator) return null;
    return <RoleSelect room={room} onExit={onExit} />;
  }

  const me = room.state.players.get(room.sessionId);
  const activeTeam = room.state.teams[room.state.activeTeamIndex];
  // activeTeam can itself be eliminated once every team has been wiped out
  // (the server freezes turns at that point instead of ending the match) —
  // that team's own players fall through to SpectatorScreen too, since
  // there's no turn left for anyone to take.
  const isMyTeamActive = me?.teamId === activeTeam?.id && !activeTeam?.eliminated;

  let screen = null;
  if (me && activeTeam && isMyTeamActive) {
    screen = <MyTurnScreen room={room} me={me} clockOffsetMs={clockOffsetMs} />;
  } else if (activeTeam) {
    const myTeam = room.state.teams.find((t) => t.id === me?.teamId);
    screen = (
      <SpectatorScreen
        room={room}
        activeTeam={activeTeam}
        eliminated={myTeam?.eliminated ?? false}
        isSpectator={isSpectator}
        clockOffsetMs={clockOffsetMs}
        onLeave={onLeave}
      />
    );
  }

  // BgmPlayer stays at this fixed position in the tree across every
  // MyTurnScreen <-> SpectatorScreen switch (every turn), so React never
  // remounts it while phase stays "playing" — that's what keeps the BGM
  // from restarting each turn.
  return (
    <>
      <BgmPlayer />
      {phase === "playing" && <SpectatorCountBadge room={room} />}
      {screen}
    </>
  );
}
