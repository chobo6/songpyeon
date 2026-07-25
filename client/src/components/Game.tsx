import { useCallback, useEffect, useRef } from "react";
import type { Room } from "colyseus.js";
import type { MatchState } from "../game/matchTypes";
import { usePersonalPressSpeed } from "../game/usePersonalPressSpeed";
import { RoleSelect } from "./RoleSelect";
import { MyTurnScreen } from "./MyTurnScreen";
import { SpectatorScreen } from "./SpectatorScreen";
import { SpectatorCountBadge } from "./SpectatorCountBadge";
import { TeamComboBadge } from "./TeamComboBadge";
import { MyAverageSpeedBadge } from "./MyAverageSpeedBadge";
import { ItemUseToast } from "./ItemUseToast";
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

  // Survives SpectatorScreen unmounting/remounting every time the active
  // turn hands off to/from the player's own team (Game itself doesn't
  // unmount on that switch, only which screen it renders) — see
  // ChatBox.tsx's initialDraft/onDraftChange doc comment. A ref, not state:
  // nothing here needs to re-render when the draft changes, only to read
  // the latest value back whenever SpectatorScreen next mounts.
  const chatDraftRef = useRef("");
  const handleChatDraftChange = useCallback((text: string) => {
    chatDraftRef.current = text;
  }, []);

  // 본인 평균 프레스 간격 — MyTurnScreen이 턴마다 언마운트/리마운트돼도
  // 여기(Game.tsx)에 살아있으므로 누적치가 유지됨. usePersonalPressSpeed.ts 참고.
  const { averageMs, recordPress, resetAnchor, resetAll } = usePersonalPressSpeed();

  // 재대결로 phase가 playing→lobby로 돌아갈 때 누적 평균도 완전히 리셋 —
  // Game 자체는 재대결 때 언마운트되지 않으므로(계속 playing↔lobby만 오감),
  // resetAnchor()(턴 경계용, 기준점만 지움)만으로는 이전 매치의 누적 합/
  // 횟수가 다음 매치로 그대로 넘어가버린다. 콤보는 팀이 서버에서 새로
  // 생성돼 자연히 0이 되지만, 이건 클라이언트 전용 상태라 직접 끊어줘야 함.
  useEffect(() => {
    if (phase === "lobby") resetAll();
  }, [phase, resetAll]);

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
    screen = (
      <MyTurnScreen
        room={room}
        me={me}
        clockOffsetMs={clockOffsetMs}
        onMyPress={recordPress}
        onMyTurnStart={resetAnchor}
      />
    );
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
        initialChatDraft={chatDraftRef.current}
        onChatDraftChange={handleChatDraftChange}
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
      {phase === "playing" && activeTeam && <TeamComboBadge combo={activeTeam.combo} />}
      {phase === "playing" && me && <MyAverageSpeedBadge averageMs={averageMs} />}
      {phase === "playing" && (
        <ItemUseToast itemId={room.state.lastUsedItemId} seq={room.state.lastUsedItemSeq} />
      )}
      {screen}
    </>
  );
}
