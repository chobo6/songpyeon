import { useEffect, useRef, useState } from "react";
import { useMatchRoom } from "./game/useMatchRoom";
import { hasStoredReconnectToken, type JoinSpec } from "./colyseus";
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

  // A failed auto-reconnect attempt (stale/expired token) falls back to the
  // normal room list silently instead of an error screen — from here there's
  // no way to tell "genuinely expired mid-match reconnect" apart from "token
  // left over from just sitting in the lobby or a finished match", and an
  // error screen implying the latter mid-match story would usually be wrong.
  // See docs/superpowers/specs/2026-07-20-mid-match-reconnection-design.md,
  // "데이터 흐름 요약" 3-b.
  //
  // autoExitedRef guards against calling handleExit() more than once — status
  // only ever settles into "error" a single time in practice (useMatchRoom
  // has no retry path back to "connecting"), but StrictMode's dev-only
  // double-invoke of effects makes a defensive guard cheap insurance against
  // cancelAndExit()/onExit() firing twice.
  const autoExitedRef = useRef(false);
  useEffect(() => {
    if (joinSpec.type === "reconnect" && status === "error" && !autoExitedRef.current) {
      autoExitedRef.current = true;
      handleExit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

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
  // 저장된 재접속 토큰이 있으면 방 목록을 건너뛰고 곧장 재접속을 시도한다 — App 함수의 mode
  // 초기값과 짝을 이뤄서 동작한다(아래 참고). 로그인 확인(fetchMe)은 그대로 거치되, 통과된
  // 뒤에는 joinSpec이 이미 세팅돼 있으니 방 목록 없이 바로 ConnectedOnlineFlow로 들어간다.
  const [joinSpec, setJoinSpec] = useState<JoinSpec | null>(() =>
    hasStoredReconnectToken() ? { type: "reconnect" } : null,
  );
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

  // Reached only when there's no stored reconnect token (see App()'s `mode`
  // and this component's `joinSpec` initializers above, both gated on
  // hasStoredReconnectToken()) — a mid-match refresh skips this branch
  // entirely and auto-resumes straight into ConnectedOnlineFlow instead.
  // So this is just the lobby case: a refresh/drop with no match in flight
  // always lands back on the room list, no silent resume into it. Combined
  // with RoleSelect now allowing free role changes without leaving the
  // room, there's no scenario left where losing your place mid-lobby is
  // costly enough to need one either.
  if (!joinSpec) {
    return (
      <RoomList
        onCreateRoom={(roomTitle, teamCount, allowSpectators) =>
          setJoinSpec({ type: "create", teamCount, roomTitle, allowSpectators })
        }
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
  // 게임 도중 새로고침/탭을 닫았다 다시 열었을 때 모드 선택 화면 없이 곧장 재접속을 시도하기
  // 위한 진입점 — 위 OnlineFlow의 joinSpec 초기값과 짝을 이룬다.
  const [mode, setMode] = useState<Mode>(() => (hasStoredReconnectToken() ? "online" : "select"));

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
