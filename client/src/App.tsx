import { useEffect, useState } from "react";
import type { Room } from "colyseus.js";
import { client } from "./colyseus";
import "./App.css";

type ConnectionStatus = "connecting" | "connected" | "error";

function App() {
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [round, setRound] = useState(0);

  useEffect(() => {
    let room: Room | undefined;
    let disposed = false;

    client
      .joinOrCreate("match")
      .then((joinedRoom) => {
        if (disposed) {
          joinedRoom.leave();
          return;
        }
        room = joinedRoom;
        setStatus("connected");
        room.onStateChange((state) => {
          setRound((state as { round: number }).round);
        });
      })
      .catch((err) => {
        console.error("failed to join room", err);
        setStatus("error");
      });

    return () => {
      disposed = true;
      room?.leave();
    };
  }, []);

  return (
    <main style={{ fontFamily: "sans-serif", padding: "2rem" }}>
      <h1>송편 만들기</h1>
      <p>server connection: {status}</p>
      <p>round: {round}</p>
    </main>
  );
}

export default App;
