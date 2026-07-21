import { Server } from "colyseus";
import { DeathmatchRoom } from "./DeathmatchRoom";
import { CONFIG } from "../shared/config";

const gameServer = new Server();
gameServer.define("deathmatch", DeathmatchRoom);

gameServer.listen(CONFIG.serverPort).then(() => {
  console.log(`[fps-shooter] Servidor Colyseus em ws://localhost:${CONFIG.serverPort}`);
});
