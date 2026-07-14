import { useState } from "react";
import { useMatchRoom } from "./game/useMatchRoom";
import { Game } from "./components/Game";
import { ModeSelect } from "./components/ModeSelect";
import { SoloRoleSelect } from "./components/SoloRoleSelect";
import { SoloPlayScreen } from "./components/SoloPlayScreen";
import type { Role } from "./game/colors";
import "./App.css";

type Mode = "select" | "online" | "offline";

function OnlineFlow({ onExit }: { onExit: () => void }) {
  const { room, status, leaveAndRejoin, cancelAndExit } = useMatchRoom();

  async function handleExit() {
    await cancelAndExit();
    onExit();
  }

  if (status !== "connected" || !room) {
    return (
      <main className="connecting">
        <h1>송편 만들기</h1>
        <p>server connection: {status}</p>
        <button onClick={handleExit}>나가기</button>
      </main>
    );
  }

  return <Game room={room} onLeave={leaveAndRejoin} onExit={handleExit} />;
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
