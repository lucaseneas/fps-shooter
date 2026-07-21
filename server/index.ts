import { createServer } from "node:http";
import { Server } from "colyseus";
import { DeathmatchRoom } from "./DeathmatchRoom";
import { CONFIG } from "../shared/config";

const port = Number(process.env.PORT) || CONFIG.serverPort;
/** Render (e outros PaaS) exigem escutar em 0.0.0.0, não só localhost. */
const host = process.env.HOST || "0.0.0.0";

const httpServer = createServer((req, res) => {
  const path = req.url?.split("?")[0];
  if (path === "/" || path === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }
  res.writeHead(404);
  res.end();
});

const gameServer = new Server({ server: httpServer });
gameServer.define("deathmatch", DeathmatchRoom);

gameServer.listen(port, host).then(() => {
  console.log(`[fps-shooter] Colyseus ouvindo em http://${host}:${port}`);
});
