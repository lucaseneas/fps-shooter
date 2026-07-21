/**
 * Teste do lobby (Fase 6): listar salas, criar, entrar por id e metadata.
 * Rodar com: npx tsx --tsconfig server/tsconfig.json server/lobbyTest.ts
 */
import { Client } from "colyseus.js";

async function main(): Promise<void> {
  const client = new Client("ws://localhost:2567");

  // 1. Sem salas no início (ou lista as existentes).
  const before = await client.getAvailableRooms("deathmatch");
  console.log(`[ok] salas antes: ${before.length}`);

  // 2. Cria uma sala.
  const roomA = await client.create("deathmatch", { name: "Criador" });
  console.log("[ok] sala criada:", roomA.roomId);
  roomA.onMessage("sping", (msg) => roomA.send("spong", msg));
  roomA.onMessage("*", () => {});

  await new Promise((r) => setTimeout(r, 500));

  // 3. A sala aparece na lista com metadata do mapa.
  const list = await client.getAvailableRooms("deathmatch");
  const entry = list.find((r) => r.roomId === roomA.roomId);
  if (!entry) throw new Error("FALHA: sala criada não aparece na lista");
  console.log(
    `[ok] listagem: ${entry.clients}/${entry.maxClients} jogadores, metadata =`,
    JSON.stringify(entry.metadata)
  );
  if ((entry.metadata as any)?.map !== "Praça") {
    throw new Error("FALHA: metadata.map incorreta");
  }

  // 4. Segundo cliente entra pelo id.
  const client2 = new Client("ws://localhost:2567");
  const roomB = await client2.joinById(roomA.roomId, { name: "Convidado" });
  roomB.onMessage("sping", (msg) => roomB.send("spong", msg));
  roomB.onMessage("*", () => {});
  console.log("[ok] segundo cliente entrou por joinById");

  await new Promise((r) => setTimeout(r, 500));

  const after = await client.getAvailableRooms("deathmatch");
  const entry2 = after.find((r) => r.roomId === roomA.roomId);
  console.log(`[ok] listagem agora: ${entry2?.clients} humanos na sala`);
  if (entry2?.clients !== 2) throw new Error("FALHA: contagem de clients != 2");

  await roomB.leave();
  await roomA.leave();
  console.log("[ok] lobby funcionando — teste completo");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
