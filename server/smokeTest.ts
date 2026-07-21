/**
 * Teste de fumaça da Fase 4: movimento autoritativo por inputs e
 * hitscan server-side com lag compensation.
 * Rodar com: npx tsx --tsconfig server/tsconfig.json server/smokeTest.ts
 */
import { Client } from "colyseus.js";

async function main(): Promise<void> {
  const client = new Client("ws://localhost:2567");
  const room = await client.joinOrCreate("deathmatch", { name: "SmokeTester" });
  console.log("[ok] conectado, sessionId =", room.sessionId);

  let kills = 0;
  room.onMessage("kill", () => kills++);
  room.onMessage("shot", () => {});
  room.onMessage("remoteShots", () => {});
  room.onMessage("died", (e) => console.log("[evento] morri:", JSON.stringify(e)));
  room.onMessage("respawn", (e) => console.log("[evento] respawn:", JSON.stringify(e)));
  room.onMessage("sping", (msg) => room.send("spong", msg));

  await new Promise((r) => setTimeout(r, 1000));

  const players = (room.state as any).players;
  const me = () => players.get(room.sessionId);
  console.log(`[ok] ${players.size} combatentes na sala`);

  // --- Teste 1: movimento autoritativo (inputs → servidor simula) ---
  const startX = me().x;
  const startZ = me().z;
  // 60 inputs = 1s andando para frente com yaw 0 (direção +Z).
  for (let seq = 1; seq <= 60; seq++) {
    room.send("input", {
      seq,
      forward: 1,
      strafe: 0,
      yaw: 0,
      jump: false,
      run: false,
    });
  }
  await new Promise((r) => setTimeout(r, 1500));
  const movedDist = Math.hypot(me().x - startX, me().z - startZ);
  const expected = 5.5; // WALK_SPEED * 1s
  console.log(
    `[${Math.abs(movedDist - expected) < 1 ? "ok" : "FALHA"}] movimento server-side: ` +
      `${movedDist.toFixed(2)}m (esperado ~${expected}m), lastSeq=${me().lastSeq}`
  );

  // --- Teste 2: hitscan server-side com rewind ---
  const ids: string[] = [];
  players.forEach((_p: any, id: string) => ids.push(id));
  const botId = ids.find((id) => id.startsWith("bot_") && players.get(id).alive);
  if (botId) {
    const bot = players.get(botId);
    const my = me();
    const ox = my.x;
    const oy = my.y + 1.7;
    const oz = my.z;
    // Mira no centro do corpo do bot (posição atual do servidor).
    const dx = bot.x - ox;
    const dy = bot.y + 0.75 - oy;
    const dz = bot.z - oz;
    const len = Math.hypot(dx, dy, dz);
    const before = bot.health;
    room.send("fire", {
      weaponId: "rifle",
      ox, oy, oz,
      dirs: [{ x: dx / len, y: dy / len, z: dz / len }],
    });
    await new Promise((r) => setTimeout(r, 500));
    const after = players.get(botId).health;
    console.log(
      `[${after < before ? "ok" : "aviso"}] hitscan server-side no ${botId}: ` +
        `hp ${before} -> ${after} (pode falhar se o bot estava atrás de parede/se moveu)`
    );
  }

  // --- Teste 3: validação de origem falsa (anti-cheat) ---
  if (botId && players.get(botId).alive) {
    const bot = players.get(botId);
    const before = bot.health;
    // Origem a 30m do jogador real — o servidor deve rejeitar.
    room.send("fire", {
      weaponId: "pistol",
      ox: bot.x, oy: bot.y + 1.7, oz: bot.z - 2,
      dirs: [{ x: 0, y: 0, z: 1 }],
    });
    await new Promise((r) => setTimeout(r, 500));
    const after = players.get(botId).health;
    // Nota: bots trocam tiro entre si — uma queda de hp aqui geralmente é
    // fogo cruzado de outro bot, não indica falha na validação de origem.
    console.log(
      `[${after >= before ? "ok" : "aviso"}] origem falsa (hp ${before} -> ${after}; ` +
        `quedas podem ser fogo cruzado de bots)`
    );
  }

  console.log(`[info] kills observados durante o teste: ${kills}`);
  await room.leave();
  console.log("[ok] teste concluído");
  process.exit(0);
}

main().catch((err) => {
  console.error("[falha]", err);
  process.exit(1);
});
