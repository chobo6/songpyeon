import type { Room } from "colyseus.js";
import type { MatchState } from "../game/matchTypes";
import { RoleSelect } from "./RoleSelect";
import { MyTurnScreen } from "./MyTurnScreen";
import { SpectatorScreen } from "./SpectatorScreen";

export function Game({
  room,
  onLeave,
  onExit,
}: {
  room: Room<MatchState>;
  onLeave: () => void;
  onExit: () => void;
}) {
  const { phase } = room.state;

  if (phase === "lobby") return <RoleSelect room={room} onExit={onExit} />;

  const me = room.state.players.get(room.sessionId);
  const activeTeam = room.state.teams[room.state.activeTeamIndex];
  // activeTeam can itself be eliminated once every team has been wiped out
  // (the server freezes turns at that point instead of ending the match) —
  // that team's own players fall through to SpectatorScreen too, since
  // there's no turn left for anyone to take.
  const isMyTeamActive = me?.teamId === activeTeam?.id && !activeTeam?.eliminated;

  if (me && activeTeam && isMyTeamActive) {
    return <MyTurnScreen room={room} me={me} />;
  }
  if (activeTeam) {
    const myTeam = room.state.teams.find((t) => t.id === me?.teamId);
    return (
      <SpectatorScreen
        room={room}
        activeTeam={activeTeam}
        eliminated={myTeam?.eliminated ?? false}
        onLeave={onLeave}
      />
    );
  }
  return null;
}
