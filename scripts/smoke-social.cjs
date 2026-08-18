/* Smoke test do sistema Social: roda contra o servidor local (ws://localhost:2567). */
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

async function waitFor(fn, timeout = 4000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (fn()) return true;
    await wait(50);
  }
  return false;
}

(async () => {
  const suffix = Math.floor(Math.random() * 1e6);
  const nameA = `alfa${suffix}`.slice(0, 16);
  const nameB = `beta${suffix}`.slice(0, 16);
  const nameC = `gama${suffix}`.slice(0, 16);
  const [tokenA, tokenB, tokenC] = await Promise.all([
    registerToken(nameA),
    registerToken(nameB),
    registerToken(nameC),
  ]);

  // 1) A e B conectam na sala social
  const a = await client.joinOrCreate("social", { token: tokenA });
  const b = await client.joinOrCreate("social", { token: tokenB });
  check("mesma sala social", a.id === b.id);

  let aLists = null;
  let bLists = null;
  a.onMessage("socialUpdate", (m) => (aLists = m));
  b.onMessage("socialUpdate", (m) => (bLists = m));
  a.onMessage("socialToast", () => {});
  b.onMessage("socialToast", () => {});
  // O servidor só envia as listas após o aviso de pronto do cliente.
  a.send("socialReady");
  b.send("socialReady");

  check(
    "A recebeu listas iniciais",
    await waitFor(() => aLists && Array.isArray(aLists.friends))
  );
  check(
    "B recebeu listas iniciais",
    await waitFor(() => bLists && Array.isArray(bLists.friends))
  );

  // 2) userId do estado corresponde aos usuários
  let aUserId = 0;
  let bUserId = 0;
  a.state.users.forEach((u) => {
    if (u.name === nameA) aUserId = u.userId;
    if (u.name === nameB) bUserId = u.userId;
  });
  check("presença de A e B visível no estado", aUserId > 0 && bUserId > 0);

  // 3) A adiciona B pelo nome → B recebe notificação em tempo real
  let bGotRequest = null;
  b.onMessage("socialRequest", (m) => (bGotRequest = m));
  a.send("friendRequestByName", { username: nameB });
  check(
    "B recebeu socialRequest de A",
    await waitFor(() => bGotRequest && bGotRequest.from.name === nameA)
  );
  check(
    "pedido aparece na lista de B",
    await waitFor(() => bLists?.requests?.some((r) => r.userId === aUserId))
  );
  check(
    "pedido sai como outgoing de A",
    await waitFor(() => aLists?.outgoing?.some((r) => r.userId === bUserId))
  );

  // 4) B aceita → viram amigos nos dois lados
  b.send("friendRespond", { userId: aUserId, accept: true });
  check(
    "A vê B como amigo",
    await waitFor(() => aLists?.friends?.some((f) => f.userId === bUserId))
  );
  check(
    "B vê A como amigo",
    await waitFor(() => bLists?.friends?.some((f) => f.userId === aUserId))
  );
  check(
    "pedido some da lista de B",
    await waitFor(() => !bLists?.requests?.some((r) => r.userId === aUserId))
  );

  // 5) Pedido duplicado é recusado ("já são amigos")
  let aErrToast = null;
  a.onMessage("socialToast", (m) => {
    if (m.isError) aErrToast = m.message;
  });
  a.send("friendRequestByName", { username: nameB });
  check(
    "pedido duplicado recusado",
    await waitFor(() => aErrToast && aErrToast.includes("já são amigos"))
  );

  // 6) Presença: A entra numa sala de mata-mata → B vê no estado social
  const dmA = await client.create("deathmatch", {
    token: tokenA,
    roomName: "Sala Social",
    bots: 1,
    maxPlayers: 4,
    gameMode: "ffa",
    killsToWin: 20,
    mapId: "praca",
  });
  for (const type of ["sping", "cpong", "srtt"]) dmA.onMessage(type, () => {});
  check(
    "deathmatch expõe userId da conta",
    await waitFor(() => dmA.state.players.get(dmA.sessionId)?.userId === aUserId)
  );

  a.send("presence", {
    status: "lobby",
    roomId: dmA.id,
    roomName: "Sala Social",
    roomClients: 1,
    roomMax: 4,
    matchStarted: false,
    skinId: "skinvip1",
  });
  check(
    "B vê presença de A na sala",
    await waitFor(() => {
      let seen = null;
      b.state.users.forEach((u) => {
        if (u.userId === aUserId) seen = u;
      });
      return seen?.roomId === dmA.id && seen?.skinId === "skinvip1";
    })
  );

  // 7) B pede informações de A → perfil público + presença
  let bGotInfo = null;
  b.onMessage("socialInfo", (m) => (bGotInfo = m));
  b.send("friendInfo", { userId: aUserId });
  check(
    "friendInfo retorna perfil de A",
    await waitFor(
      () => bGotInfo?.profile?.username === nameA && bGotInfo?.presence?.online === true
    )
  );
  check("skin de A veio da presença", bGotInfo?.profile?.skin === "skinvip1");

  // 8) B (fora de sala) não pode convidar — erro amigável
  let bErrToast = null;
  b.onMessage("socialToast", (m) => {
    if (m.isError) bErrToast = m.message;
  });
  b.send("invite", { userId: aUserId });
  check(
    "convite sem sala é bloqueado",
    await waitFor(() => bErrToast && bErrToast.includes("precisa estar em uma sala"))
  );

  // 9) A convida B → B recebe socialInvite com roomId certo
  let bGotInvite = null;
  b.onMessage("socialInvite", (m) => (bGotInvite = m));
  a.send("invite", { userId: bUserId });
  check(
    "B recebeu convite para a sala de A",
    await waitFor(() => bGotInvite?.roomId === dmA.id && bGotInvite?.fromName === nameA)
  );

  // 10) Sala cheia bloqueia convite (A simula presença lotada)
  a.send("presence", {
    status: "lobby",
    roomId: dmA.id,
    roomName: "Sala Social",
    roomClients: 4,
    roomMax: 4,
    matchStarted: false,
    skinId: "skinvip1",
  });
  aErrToast = null;
  a.send("invite", { userId: bUserId });
  check(
    "convite com sala cheia é bloqueado",
    await waitFor(() => aErrToast && aErrToast.includes("cheia"))
  );
  // Volta a ter vaga na sala para o próximo teste (validação de amizade).
  a.send("presence", {
    status: "lobby",
    roomId: dmA.id,
    roomName: "Sala Social",
    roomClients: 1,
    roomMax: 4,
    matchStarted: false,
    skinId: "skinvip1",
  });

  // 11) C (não-amigo) não recebe convite de A
  const c = await client.joinOrCreate("social", { token: tokenC });
  c.onMessage("socialUpdate", () => {});
  c.onMessage("socialToast", () => {});
  c.onMessage("socialRequest", () => {});
  c.send("socialReady");
  aErrToast = null;
  let cUserId = 0;
  await waitFor(() => {
    a.state.users.forEach((u) => {
      if (u.name === nameC) cUserId = u.userId;
    });
    return cUserId > 0;
  });
  a.send("invite", { userId: cUserId });
  check(
    "convite para não-amigo é bloqueado",
    await waitFor(() => aErrToast && aErrToast.includes("só pode convidar amigos"))
  );

  // 12) Remover amizade some dos dois lados
  a.send("friendRemove", { userId: bUserId });
  check(
    "A removeu B",
    await waitFor(() => !aLists?.friends?.some((f) => f.userId === bUserId))
  );
  check(
    "B também perde A",
    await waitFor(() => !bLists?.friends?.some((f) => f.userId === aUserId))
  );

  // 13) Pedido cruzado vira amizade na hora
  a.send("friendRequest", { userId: cUserId });
  await waitFor(() => aLists?.outgoing?.some((r) => r.userId === cUserId));
  c.send("friendRequest", { userId: aUserId });
  check(
    "pedido cruzado cria amizade",
    await waitFor(
      () =>
        aLists?.friends?.some((f) => f.userId === cUserId)
    )
  );

  await Promise.all([a.leave(), b.leave(), c.leave(), dmA.leave()]);
  const failed = results.filter(([, ok]) => !ok);
  console.log(`\n${results.length - failed.length}/${results.length} passaram`);
  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  console.error("ERRO no smoke test:", err);
  process.exit(1);
});
