/* Smoke test do pré-lobby: roda contra o servidor local (ws://localhost:2567). */
const { Client } = require("colyseus.js");

const client = new Client("ws://localhost:2567");
const results = [];

async function registerToken(username) {
  const res = await fetch("http://localhost:2567/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: "senha-teste-123" }),
  });
  if (!res.ok) throw new Error(`register ${username}: ${res.status}`);
  const data = await res.json();
  return data.token;
}

function check(name, cond) {
  results.push([name, !!cond]);
  console.log(`${cond ? "PASS" : "FAIL"} — ${name}`);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, timeout = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (fn()) return true;
    await wait(50);
  }
  return false;
}

(async () => {
  const suffix = Math.floor(Math.random() * 1e6);
  const [tokenA, tokenB, tokenC] = await Promise.all([
    registerToken(`host${suffix}`),
    registerToken(`nilo${suffix}`),
    registerToken(`tardio${suffix}`),
  ]);

  // 1) Host cria a sala
  const a = await client.create("deathmatch", {
    token: tokenA,
    roomName: "Sala Teste",
    bots: 2,
    maxPlayers: 4,
    gameMode: "ffa",
    killsToWin: 20,
    mapId: "praca",
  });
  check(
    "host aparece no estado",
    await waitFor(() => a.state?.players?.get(a.sessionId) != null)
  );
  check("sala criada em pré-lobby (matchStarted=false)", a.state.matchStarted === false);
  check("host é o criador", a.state.hostId === a.sessionId);
  check("host não está em partida", a.state.players.get(a.sessionId).inMatch === false);

  let aStarted = false;
  a.onMessage("matchStart", () => (aStarted = true));

  // 2) Host altera configurações no pré-lobby
  a.send("updateSettings", { killsToWin: 5, roomName: "Sala Renomeada" });
  await waitFor(() => a.state.killsToWin === 5);
  check("host alterou killsToWin para 5", a.state.killsToWin === 5);
  check("host renomeou a sala", a.state.roomName === "Sala Renomeada");

  // 3) Segundo jogador entra (vai ao pré-lobby, não à partida)
  const b = await client.joinById(a.id, { token: tokenB });
  let bStarted = false;
  b.onMessage("matchStart", () => (bStarted = true));
  await waitFor(() => b.state.players.size >= 2);
  check("B entra sem ready", b.state.players.get(b.sessionId).ready === false);
  check("B entra fora da partida", b.state.players.get(b.sessionId).inMatch === false);

  // 4) Não-host não pode alterar settings
  b.send("updateSettings", { killsToWin: 9 });
  await wait(300);
  check("não-host bloqueado em updateSettings", a.state.killsToWin === 5);

  // 5) B fica pronto
  b.send("setReady", { ready: true });
  await waitFor(() => a.state.players.get(b.sessionId).ready === true);
  check("B marcou pronto", a.state.players.get(b.sessionId).ready === true);

  // 6) Não-host não pode iniciar
  b.send("startMatch");
  await wait(300);
  check("não-host bloqueado em startMatch", a.state.matchStarted === false);

  // 7) Host inicia — host + prontos entram
  a.send("startMatch");
  const started = await waitFor(() => a.state.matchStarted === true);
  check("partida iniciou (matchStarted=true)", started);
  check("host recebeu matchStart", await waitFor(() => aStarted));
  check("B (pronto) recebeu matchStart", await waitFor(() => bStarted));
  check("host inMatch=true", a.state.players.get(a.sessionId).inMatch === true);
  check("B inMatch=true", a.state.players.get(b.sessionId).inMatch === true);
  check("ready resetado após start", a.state.players.get(b.sessionId).ready === false);

  const botIds = [];
  a.state.players.forEach((p, id) => { if (p.isBot) botIds.push(id); });
  check("bots marcados como isBot", botIds.length >= 2);
  check("bots estão na partida", botIds.every((id) => a.state.players.get(id).inMatch));

  // Silencia warnings de mensagens sem handler no teste.
  for (const r of [a, b]) {
    for (const type of ["sping", "shot", "chat", "respawn", "cpong", "srtt"]) {
      r.onMessage(type, () => {});
    }
  }

  // 8) Entrada tardia: C entra com a partida rolando
  const c = await client.joinById(a.id, { token: tokenC });
  for (const type of ["sping", "shot", "respawn", "cpong", "srtt"]) {
    c.onMessage(type, () => {});
  }
  let cStarted = false;
  c.onMessage("matchStart", () => (cStarted = true));
  await waitFor(() => c.state.players.get(c.sessionId));
  await wait(200);
  check("C entra fora da partida", c.state.players.get(c.sessionId).inMatch === false);
  check("C não recebe matchStart ao entrar", cStarted === false);

  // 9) C clica em "Jogar agora"
  c.send("playMatch");
  check("C recebe matchStart após playMatch", await waitFor(() => cStarted));
  check("C inMatch=true", await waitFor(() => c.state.players.get(c.sessionId).inMatch === true));

  // 10) Spawn tardio via requestSpawn
  c.send("requestSpawn");
  check(
    "C spawnou após requestSpawn",
    await waitFor(() => c.state.players.get(c.sessionId).alive === true)
  );

  // 11) Host remove C da sala
  let cLeaveCode = -1;
  c.onLeave((code) => (cLeaveCode = code));
  a.send("kickPlayer", { playerId: c.sessionId });
  check("kick desconecta com código 4000", await waitFor(() => cLeaveCode === 4000));

  // 12) Kick de bot é ignorado; kick de si mesmo também.
  // (C entrou depois: o rebalance já ajustou os bots — re-coleta o atual.)
  let currentBot = null;
  a.state.players.forEach((p, id) => { if (p.isBot && !currentBot) currentBot = id; });
  a.send("kickPlayer", { playerId: currentBot });
  a.send("kickPlayer", { playerId: a.sessionId });
  await wait(300);
  check("bot não é kickado", currentBot !== null && a.state.players.has(currentBot));
  check("host não se kicka", a.state.players.has(a.sessionId));

  // 13) Settings bloqueadas com partida em andamento
  a.send("updateSettings", { killsToWin: 30 });
  await wait(300);
  check("settings bloqueadas in-game", a.state.killsToWin === 5);

  // 14) Chat da sala funciona
  let bGotChat = false;
  b.onMessage("chat", (m) => { if (m.text === "ola lobby") bGotChat = true; });
  a.send("chat", { text: "ola lobby" });
  check("chat broadcast para a sala", await waitFor(() => bGotChat));

  // 15) Host sai → liderança migra para outro humano
  a.leave();
  check(
    "host migra para B",
    await waitFor(() => b.state.hostId === b.sessionId)
  );

  await b.leave();
  const failed = results.filter(([, ok]) => !ok);
  console.log(`\n${results.length - failed.length}/${results.length} passaram`);
  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  console.error("ERRO no smoke test:", err);
  process.exit(1);
});
