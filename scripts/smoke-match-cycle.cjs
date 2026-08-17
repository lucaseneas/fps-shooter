/* Smoke test do ciclo: start → kill → matchEnd → reset → volta ao pré-lobby. */
const { Client } = require("colyseus.js");

const client = new Client("ws://localhost:2567");
const results = [];

function check(name, cond) {
  results.push([name, !!cond]);
  console.log(`${cond ? "PASS" : "FAIL"} — ${name}`);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, timeout = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (fn()) return true;
    await wait(50);
  }
  return false;
}

async function registerToken(username) {
  const res = await fetch("http://localhost:2567/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: "senha-teste-123" }),
  });
  if (!res.ok) throw new Error(`register ${username}: ${res.status}`);
  return (await res.json()).token;
}

(async () => {
  const suffix = Math.floor(Math.random() * 1e6);
  const token = await registerToken(`ciclo${suffix}`);

  // Sala 1v1 com 1 bot; vitória com 1 kill.
  const a = await client.create("deathmatch", {
    token,
    roomName: "Ciclo",
    bots: 1,
    maxPlayers: 2,
    gameMode: "ffa",
    killsToWin: 1,
    mapId: "praca",
  });
  for (const type of ["sping", "shot", "respawn", "cpong", "srtt", "chat"]) {
    a.onMessage(type, () => {});
  }
  check("host no estado", await waitFor(() => a.state?.players?.get(a.sessionId) != null));

  let gotMatchStart = false;
  let gotBackToLobby = false;
  a.onMessage("matchStart", () => (gotMatchStart = true));
  a.onMessage("backToLobby", () => (gotBackToLobby = true));

  a.send("startMatch");
  check("recebeu matchStart", await waitFor(() => gotMatchStart));
  check("matchStarted=true", a.state.matchStarted === true);

  // Entra no mapa.
  a.send("requestSpawn");
  check("host spawnou", await waitFor(() => a.state.players.get(a.sessionId).alive === true));

  // Atira de sniper na cabeça do bot até matar (vitória com 1 kill).
  let botId = null;
  a.state.players.forEach((p, id) => { if (p.isBot) botId = id; });
  check("bot presente", botId !== null);

  const shootInterval = setInterval(() => {
    const me = a.state.players.get(a.sessionId);
    const bot = a.state.players.get(botId);
    if (!me || !bot || !me.alive || !bot.alive || a.state.matchOver) return;
    const ox = me.x, oy = me.y + 1.7, oz = me.z;
    const tx = bot.x, ty = bot.y + 1.72, tz = bot.z;
    const len = Math.hypot(tx - ox, ty - oy, tz - oz) || 1;
    a.send("fire", {
      weaponId: "sniper",
      ox, oy, oz,
      dirs: [{ x: (tx - ox) / len, y: (ty - oy) / len, z: (tz - oz) / len }],
    });
  }, 1300);

  check("partida terminou (matchOver)", await waitFor(() => a.state.matchOver === true, 30000));
  clearInterval(shootInterval);
  check("host venceu", a.state.winnerName === a.state.players.get(a.sessionId)?.name);

  // Reset (~8s): sala volta ao pré-lobby.
  check(
    "recebeu backToLobby",
    await waitFor(() => gotBackToLobby, 15000)
  );
  check("matchStarted=false após reset", await waitFor(() => a.state.matchStarted === false));
  check("host voltou ao pré-lobby (inMatch=false)", a.state.players.get(a.sessionId).inMatch === false);
  check("placar zerado", a.state.players.get(a.sessionId).kills === 0);

  // Sala pronta para nova partida: ready + start de novo.
  a.send("startMatch");
  check("restart funciona (matchStarted=true de novo)", await waitFor(() => a.state.matchStarted === true));

  await a.leave();
  const failed = results.filter(([, ok]) => !ok);
  console.log(`\n${results.length - failed.length}/${results.length} passaram`);
  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  console.error("ERRO no smoke test:", err);
  process.exit(1);
});
