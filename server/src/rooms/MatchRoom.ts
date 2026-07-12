import { Room, Client } from "colyseus";
import { MatchState } from "./MatchState";

// Placeholder room — proves client/server connectivity end to end.
// Full game state (teams, roles, sequence, cursor, mortars) lands in a later pass;
// see REQUIREMENTS.md / ARCHITECTURE.md for the target design.
export class MatchRoom extends Room<MatchState> {
  maxClients = 4;

  onCreate() {
    this.setState(new MatchState());
  }

  onJoin(client: Client) {
    console.log(`${client.sessionId} joined ${this.roomId}`);
  }

  onLeave(client: Client) {
    console.log(`${client.sessionId} left ${this.roomId}`);
  }
}
