import { Server } from "colyseus";
import { DeathmatchRoom } from "./DeathmatchRoom";
import { CONFIG } from "../shared/config";

const port = Number(process.env.PORT) || CONFIG.serverPort;

const gameServer = new Server();
gameServer.define("deathmatch", DeathmatchRoom);

gameServer.listen(port).then(() => {
  console.log(`[fps-shooter] Colyseus ouvindo na porta ${port}`);
});
