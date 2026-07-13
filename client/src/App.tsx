import { useMatchRoom } from "./game/useMatchRoom";
import { Game } from "./components/Game";
import "./App.css";

function App() {
  const { room, status, leaveAndRejoin } = useMatchRoom();

  if (status !== "connected" || !room) {
    return (
      <main className="connecting">
        <h1>송편 만들기</h1>
        <p>server connection: {status}</p>
      </main>
    );
  }

  return <Game room={room} onLeave={leaveAndRejoin} />;
}

export default App;
