/* Smoke test das prefs da conta (skin + loadout): roda contra o servidor local (http://localhost:2567). */
const BASE = "http://localhost:2567";
const results = [];

function check(name, cond) {
  results.push([name, !!cond]);
  console.log(`${cond ? "PASS" : "FAIL"} — ${name}`);
}

async function api(path, { method = "GET", token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

(async () => {
  const suffix = Math.floor(Math.random() * 1e6);
  const username = `prefs${suffix}`.slice(0, 16);

  // 1) Registro retorna prefs padrão
  const reg = await api("/api/auth/register", {
    method: "POST",
    body: { username, password: "senha-teste-123" },
  });
  check("registro ok", reg.status === 201 && reg.data.token);
  const token = reg.data.token;
  check(
    "prefs padrão no registro",
    reg.data.user.activeSkin === "skin_default" &&
      reg.data.user.loadout?.primary === "rifle" &&
      reg.data.user.loadout?.secondary === "pistol" &&
      reg.data.user.loadout?.melee === "knife"
  );

  // 2) Salva prefs válidas
  const save = await api("/api/account/prefs", {
    method: "POST",
    token,
    body: {
      activeSkin: "skinvip1",
      loadout: { primary: "sniper", secondary: "magnum", melee: "knife" },
    },
  });
  check(
    "salva prefs válidas",
    save.status === 200 &&
      save.data.prefs?.activeSkin === "skinvip1" &&
      save.data.prefs?.loadout?.primary === "sniper"
  );

  // 3) /me devolve as prefs salvas (simula um novo login)
  const me = await api("/api/auth/me", { token });
  check(
    "login devolve skin salva",
    me.status === 200 && me.data.user?.activeSkin === "skinvip1"
  );
  check(
    "login devolve loadout salvo",
    me.data.user?.loadout?.primary === "sniper" &&
      me.data.user?.loadout?.secondary === "magnum" &&
      me.data.user?.loadout?.melee === "knife"
  );

  // 4) Rejeita arma de categoria errada no slot
  const badSlot = await api("/api/account/prefs", {
    method: "POST",
    token,
    body: {
      activeSkin: "skinvip1",
      loadout: { primary: "pistol", secondary: "magnum", melee: "knife" },
    },
  });
  check("rejeita pistola no slot primário", badSlot.status === 400);

  // 5) Rejeita skin inexistente
  const badSkin = await api("/api/account/prefs", {
    method: "POST",
    token,
    body: {
      activeSkin: "skin_hacker",
      loadout: { primary: "sniper", secondary: "magnum", melee: "knife" },
    },
  });
  check("rejeita skin inexistente", badSkin.status === 400);

  // 6) Rejeita arma inexistente
  const badWeapon = await api("/api/account/prefs", {
    method: "POST",
    token,
    body: {
      activeSkin: "duckdoc",
      loadout: { primary: "railgun", secondary: "magnum", melee: "knife" },
    },
  });
  check("rejeita arma inexistente", badWeapon.status === 400);

  // 7) Rejeita sem token
  const noAuth = await api("/api/account/prefs", {
    method: "POST",
    body: {
      activeSkin: "duckdoc",
      loadout: { primary: "sniper", secondary: "magnum", melee: "knife" },
    },
  });
  check("rejeita sem autenticação", noAuth.status === 401);

  // 8) Prefs inválidas não corromperam o estado salvo
  const me2 = await api("/api/auth/me", { token });
  check(
    "prefs continuam íntegras após rejeições",
    me2.data.user?.activeSkin === "skinvip1" &&
      me2.data.user?.loadout?.primary === "sniper"
  );

  const failed = results.filter(([, ok]) => !ok);
  console.log(`\n${results.length - failed.length}/${results.length} passaram`);
  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  console.error("ERRO FATAL:", err.message);
  process.exit(1);
});
