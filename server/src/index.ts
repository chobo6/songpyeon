import "dotenv/config";
import { createGameServer } from "./createServer";

const port = Number(process.env.PORT) || 2567;
const gameServer = createGameServer();

gameServer.listen(port).then(() => {
  console.log(`songpyeon server listening on ws://localhost:${port}`);
});
