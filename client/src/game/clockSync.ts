import type { Room } from "colyseus.js";

const SAMPLE_COUNT = 5;

interface PongMessage {
  clientSentAt: number;
  serverTime: number;
}

// Estimates how far this client's clock is from the server's, so
// server-issued absolute timestamps (MatchState.turnEndsAt) can be compared
// against a locally-corrected "now" instead of raw Date.now(). Without this,
// a client whose system clock disagrees with the server's (common — phones
// aren't NTP-synced the way an EC2 instance is) sees the turn timer visibly
// out of phase with when the server actually ends the turn: counting down
// too fast if the client clock runs ahead, stuck near zero if it runs
// behind. Taking the median of several round-trip samples (rather than one)
// smooths out any single sample's network jitter.
export function estimateClockOffset<T>(room: Room<T>): Promise<number> {
  return new Promise((resolve) => {
    const samples: number[] = [];

    const unsubscribe = room.onMessage<PongMessage>("pong", (message) => {
      const receivedAt = Date.now();
      const roundTripMs = receivedAt - message.clientSentAt;
      samples.push(message.serverTime + roundTripMs / 2 - receivedAt);

      if (samples.length < SAMPLE_COUNT) {
        room.send("ping", Date.now());
        return;
      }

      unsubscribe();
      samples.sort((a, b) => a - b);
      resolve(samples[Math.floor(samples.length / 2)]);
    });

    room.send("ping", Date.now());
  });
}
