import type { Room } from "colyseus.js";
import type { MatchState } from "../game/matchTypes";
import { RoleSelect } from "./RoleSelect";
import { MyTurnScreen } from "./MyTurnScreen";
import { SpectatorScreen } from "./SpectatorScreen";
import { WinnerScreen } from "./WinnerScreen";

export function Game({ room }: { room: Room<MatchState> }) {
  const { phase } = room.state;

  if (phase === "lobby") return <RoleSelect room={room} />;

  if (phase === "finished") return <WinnerScreen winnerTeamId={room.state.winnerTeamId} />;

  const me = room.state.players.get(room.sessionId);
  const activeTeam = room.state.teams[room.state.activeTeamIndex];
  const isMyTeamActive = me?.teamId === activeTeam?.id;

  if (me && activeTeam && isMyTeamActive) {
    return <MyTurnScreen room={room} me={me} activeTeam={activeTeam} />;
  }
  if (activeTeam) {
    return <SpectatorScreen room={room} activeTeam={activeTeam} />;
  }
  return null;
}
