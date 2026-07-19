import { useEffect, useState } from "react";
import { useMatchRoom } from "./game/useMatchRoom";
import type { JoinSpec } from "./colyseus";
import { fetchMe, loginWithGoogle, type Profile } from "./game/auth";
import { Game } from "./components/Game";
import { GoogleLoginScreen } from "./components/GoogleLoginScreen";
import { ModeSelect } from "./components/ModeSelect";
import { NicknameEntry } from "./components/NicknameEntry";
import { RoomList } from "./components/RoomList";
import { SoloRoleSelect } from "./components/SoloRoleSelect";
import { SoloPlayScreen } from "./components/SoloPlayScreen";
import type { Role } from "./game/colors";
import { AnnouncementBanner } from "./components/AnnouncementBanner";
import "./App.css";

type Mode = "select" | "online" | "offline";

function ConnectedOnlineFlow({ joinSpec, onExit }: { joinSpec: JoinSpec; onExit: () => void }) {
  const { room, status, errorMessage, clockOffsetMs, cancelAndExit } = useMatchRoom(joinSpec);

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
  return <Game room={room} clockOffsetMs={clockOffsetMs} onLeave={handleExit} onExit={handleExit} />;
}

function OnlineFlow({ onExit }: { onExit: () => void }) {
  const [me, setMe] = useState<Profile | null | undefined>(undefined);
  const [joinSpec, setJoinSpec] = useState<JoinSpec | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);

  useEffect(() => {
    fetchMe()
      .then(setMe)
      .catch(() => setMe(null));
  }, []);

  if (me === undefined) {
    return (
      <main className="connecting">
        <h1>송편 만들기</h1>
        <p>불러오는 중...</p>
      </main>
    );
  }

  if (me === null) {
    return (
      <GoogleLoginScreen
        error={loginError}
        onCredential={async (credential) => {
          setLoginError(null);
          try {
            const profile = await loginWithGoogle(credential);
            setMe(profile);
          } catch (err) {
            console.error("구글 로그인 실패", err);
            setLoginError("로그인에 실패했어요. 다시 시도해주세요.");
          }
        }}
      />
    );
  }

  if (!me.nickname) {
    return <NicknameEntry onSubmit={(nickname) => setMe({ ...me, nickname })} />;
  }

  // A refresh or a dropped connection always lands back on the room list —
  // no automatic resume into whatever room you were last in. Combined with
  // RoleSelect now allowing free role changes without leaving the room,
  // there's no scenario left where losing your place mid-lobby is costly
  // enough to need a silent resume.
  if (!joinSpec) {
    return (
      <RoomList
        onCreateRoom={(teamCount) => setJoinSpec({ type: "create", teamCount })}
        onJoinRoom={(roomId) => setJoinSpec({ type: "joinById", roomId })}
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

  return (
    <>
      <AnnouncementBanner />
      {mode === "online" && <OnlineFlow onExit={() => setMode("select")} />}
      {mode === "offline" && <OfflineFlow onExit={() => setMode("select")} />}
      {mode === "select" && (
        <ModeSelect onSelectOnline={() => setMode("online")} onSelectOffline={() => setMode("offline")} />
      )}
    </>
  );
}

export default App;
