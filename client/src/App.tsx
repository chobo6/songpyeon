import { useState } from "react";
import { useMatchRoom } from "./game/useMatchRoom";
import { hasSavedSession, type JoinSpec } from "./colyseus";
import { Game } from "./components/Game";
import { ModeSelect } from "./components/ModeSelect";
import { NicknameEntry } from "./components/NicknameEntry";
import { RoomList } from "./components/RoomList";
import { SoloRoleSelect } from "./components/SoloRoleSelect";
import { SoloPlayScreen } from "./components/SoloPlayScreen";
import type { Role } from "./game/colors";
import "./App.css";

type Mode = "select" | "online" | "offline";

function ConnectedOnlineFlow({ joinSpec, onExit }: { joinSpec: JoinSpec; onExit: () => void }) {
  const { room, status, errorMessage, cancelAndExit } = useMatchRoom(joinSpec);

  async function handleExit() {
    await cancelAndExit();
    onExit();
  }

  if (status !== "connected" || !room) {
    return (
      <main className="connecting">
        <h1>송편 만들기</h1>
        <p>{status === "error" ? (errorMessage ?? "연결에 실패했어요") : `server connection: ${status}`}</p>
        <button onClick={handleExit}>{status === "error" ? "방 목록으로" : "나가기"}</button>
      </main>
    );
  }

  // Both the lobby's "나가기" and the spectator's "나가기" return to the room
  // list (not out of online mode entirely) — picking a different room is the
  // whole point of the list, so there's no separate "rejoin same room" path.
  return <Game room={room} onLeave={handleExit} onExit={handleExit} />;
}

function OnlineFlow({ onExit }: { onExit: () => void }) {
  const [nickname, setNickname] = useState<string | null>(null);
  const [joinSpec, setJoinSpec] = useState<JoinSpec | null>(null);
  // A saved reconnection token (page refresh mid-match/mid-lobby) is offered
  // exactly once, automatically, right after nickname entry — before the
  // room list ever renders. Once that attempt resolves (success or failure)
  // this flips true and the room list takes over; every subsequent
  // create/join is an explicit user pick that must never be silently
  // overridden by the token again (see colyseus.ts's hasSavedSession doc).
  const [resumeAttempted, setResumeAttempted] = useState(false);

  if (!nickname) {
    return <NicknameEntry onSubmit={setNickname} />;
  }

  if (!resumeAttempted && !joinSpec && hasSavedSession()) {
    return <ConnectedOnlineFlow joinSpec={{ type: "resume" }} onExit={() => setResumeAttempted(true)} />;
  }

  if (!joinSpec) {
    return (
      <RoomList
        onCreateRoom={() => setJoinSpec({ type: "create", nickname })}
        onJoinRoom={(roomId) => setJoinSpec({ type: "joinById", roomId, nickname })}
        onExit={onExit}
      />
    );
  }

  return <ConnectedOnlineFlow joinSpec={joinSpec} onExit={() => setJoinSpec(null)} />;
}

function OfflineFlow({ onExit }: { onExit: () => void }) {
  const [role, setRole] = useState<Role | null>(null);

  if (!role) {
    return <SoloRoleSelect onChoose={setRole} onBack={onExit} />;
  }

  return <SoloPlayScreen role={role} onExit={onExit} />;
}

function App() {
  const [mode, setMode] = useState<Mode>("select");

  if (mode === "online") return <OnlineFlow onExit={() => setMode("select")} />;
  if (mode === "offline") return <OfflineFlow onExit={() => setMode("select")} />;

  return <ModeSelect onSelectOnline={() => setMode("online")} onSelectOffline={() => setMode("offline")} />;
}

export default App;
