import "dotenv/config";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { Server } from "colyseus";
import { DeathmatchRoom } from "./DeathmatchRoom";
import { SocialRoom } from "./SocialRoom";
import { CONFIG } from "../shared/config";
import { isAuthEnabled, migrate } from "./db";
import {
  login,
  register,
  getProfileResult,
  authenticateToken,
  AUTH_SESSION_REPLACED,
  saveAccountPrefs,
  purchaseItem,
  mergeAccountInventory,
} from "./auth";
import {
  loadCustomWeaponSkins,
  saveCustomWeaponSkin,
  deleteCustomWeaponSkin,
} from "./weaponSkinsStore";
import {
  listAllMaps,
  saveCatalogMap,
  deleteCatalogMap,
} from "./customMapsStore";

const port = Number(process.env.PORT) || CONFIG.serverPort;
/** Render (e outros PaaS) exigem escutar em 0.0.0.0, não só localhost. */
const host = process.env.HOST || "0.0.0.0";

function setCors(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  setCors(res);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function readJson(req: IncomingMessage, maxBytes = 32_768): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      chunks.push(c);
      if (chunks.reduce((n, b) => n + b.length, 0) > maxBytes) {
        reject(new Error("body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("invalid json"));
      }
    });
    req.on("error", reject);
  });
}

function sendUnauthorized(res: ServerResponse, reason?: string): void {
  const replaced = reason === "session_replaced";
  sendJson(res, 401, {
    error: replaced
      ? "Sessão encerrada — entrou noutro dispositivo."
      : "Não autenticado.",
    code: replaced ? AUTH_SESSION_REPLACED : undefined,
  });
}

function bearerToken(req: IncomingMessage): string | null {
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer ")) return null;
  return h.slice(7).trim() || null;
}

async function handleApi(
  req: IncomingMessage,
  res: ServerResponse,
  path: string
): Promise<boolean> {
  if (req.method === "OPTIONS" && path.startsWith("/api/")) {
    setCors(res);
    res.writeHead(204);
    res.end();
    return true;
  }

  if (req.method === "GET" && path === "/api/auth/status") {
    sendJson(res, 200, { enabled: isAuthEnabled() });
    return true;
  }

  if (req.method === "POST" && path === "/api/auth/register") {
    try {
      const body = (await readJson(req)) as { username?: unknown; password?: unknown };
      const result = await register(body.username, body.password);
      if (!result.ok) {
        sendJson(res, result.status, { error: result.error });
        return true;
      }
      sendJson(res, 201, {
        token: result.token,
        user: result.user,
        sessionReplaced: result.sessionReplaced,
      });
    } catch {
      sendJson(res, 400, { error: "JSON inválido." });
    }
    return true;
  }

  if (req.method === "POST" && path === "/api/auth/login") {
    try {
      const body = (await readJson(req)) as { username?: unknown; password?: unknown };
      const result = await login(body.username, body.password);
      if (!result.ok) {
        sendJson(res, result.status, { error: result.error });
        return true;
      }
      sendJson(res, 200, {
        token: result.token,
        user: result.user,
        sessionReplaced: result.sessionReplaced,
      });
    } catch {
      sendJson(res, 400, { error: "JSON inválido." });
    }
    return true;
  }

  if (req.method === "GET" && path === "/api/auth/me") {
    try {
      const profile = await getProfileResult(bearerToken(req));
      if (!profile.ok) {
        const isReplaced = profile.reason === "session_replaced";
        sendJson(res, 401, {
          error: isReplaced
            ? "Sessão encerrada — entrou noutro dispositivo."
            : "Não autenticado.",
          code: isReplaced ? AUTH_SESSION_REPLACED : undefined,
        });
        return true;
      }
      sendJson(res, 200, { user: profile.user });
    } catch (err) {
      console.error("[auth] /me:", err);
      sendJson(res, 500, { error: "Erro ao carregar perfil." });
    }
    return true;
  }

  if (req.method === "POST" && path === "/api/account/prefs") {
    try {
      const auth = await authenticateToken(bearerToken(req));
      if (!auth.ok) {
        sendJson(res, 401, {
          error:
            auth.reason === "session_replaced"
              ? "Sessão encerrada — entrou noutro dispositivo."
              : "Não autenticado.",
          code: auth.reason === "session_replaced" ? AUTH_SESSION_REPLACED : undefined,
        });
        return true;
      }
      const body = await readJson(req);
      const result = await saveAccountPrefs(auth.account.id, body);
      if (typeof result === "string") {
        sendJson(res, 400, { error: result });
        return true;
      }
      sendJson(res, 200, { prefs: result });
    } catch (err) {
      console.error("[auth] prefs:", err);
      sendJson(res, 400, { error: "JSON inválido." });
    }
    return true;
  }

  // Loja: compra servidor-autoritativa (valida preço, desconta gold, grava item).
  if (req.method === "POST" && path === "/api/shop/buy") {
    try {
      const auth = await authenticateToken(bearerToken(req));
      if (!auth.ok) {
        sendJson(res, 401, {
          error:
            auth.reason === "session_replaced"
              ? "Sessão encerrada — entrou noutro dispositivo."
              : "Não autenticado.",
          code: auth.reason === "session_replaced" ? AUTH_SESSION_REPLACED : undefined,
        });
        return true;
      }
      const body = await readJson(req);
      const result = await purchaseItem(auth.account.id, body);
      if (typeof result === "string") {
        sendJson(res, 400, { error: result });
        return true;
      }
      sendJson(res, 200, result);
    } catch (err) {
      console.error("[shop] buy:", err);
      sendJson(res, 400, { error: "JSON inválido." });
    }
    return true;
  }

  // Skins de arma custom (criadas pela ferramenta in-game).
  // TODO(admin): restringir o POST para administradores quando houver papel
  // de admin na conta — hoje qualquer cliente pode publicar na loja.
  //
  if (req.method === "GET" && path === "/api/weapon-skins") {
    try {
      const skins = await loadCustomWeaponSkins();
      sendJson(res, 200, { skins });
    } catch (err) {
      console.error("[weapon-skins] list:", err);
      sendJson(res, 500, { error: "Falha ao listar skins." });
    }
    return true;
  }

  if (req.method === "POST" && path === "/api/weapon-skins") {
    try {
      const body = await readJson(req);
      const result = await saveCustomWeaponSkin(body);
      if (typeof result === "string") {
        sendJson(res, 400, { error: result });
        return true;
      }
      sendJson(res, 200, { skin: result });
    } catch (err) {
      console.error("[weapon-skins] save:", err);
      sendJson(res, 400, { error: "JSON inválido." });
    }
    return true;
  }

  if (req.method === "DELETE" && path === "/api/weapon-skins") {
    try {
      const body = (await readJson(req)) as { id?: unknown };
      const result = await deleteCustomWeaponSkin(body.id);
      if (result !== true) {
        sendJson(res, 400, { error: result });
        return true;
      }
      sendJson(res, 200, { ok: true });
    } catch (err) {
      console.error("[weapon-skins] delete:", err);
      sendJson(res, 400, { error: "JSON inválido." });
    }
    return true;
  }

  // Catálogo global de mapas custom. GET é público; gravar exige conta.
  if (path === "/api/maps") {
    if (!isAuthEnabled()) {
      sendJson(res, 503, { error: "Banco de dados indisponível." });
      return true;
    }

    if (req.method === "GET") {
      try {
        const maps = await listAllMaps();
        sendJson(res, 200, { maps });
      } catch (err) {
        console.error("[maps] list:", err);
        sendJson(res, 500, { error: "Falha ao listar mapas." });
      }
      return true;
    }

    try {
      const auth = await authenticateToken(bearerToken(req));
      if (!auth.ok) {
        sendUnauthorized(res, auth.reason);
        return true;
      }

      if (req.method === "POST") {
        const body = await readJson(req, 262_144);
        const result = await saveCatalogMap(auth.account.id, body);
        if (typeof result === "string") {
          sendJson(res, 400, { error: result });
          return true;
        }
        sendJson(res, 200, { map: result });
        return true;
      }

      if (req.method === "DELETE") {
        const body = (await readJson(req)) as { id?: unknown };
        const result = await deleteCatalogMap(body.id);
        if (result !== true) {
          sendJson(res, 400, { error: result });
          return true;
        }
        sendJson(res, 200, { ok: true });
        return true;
      }

      sendJson(res, 405, { error: "Método não suportado." });
      return true;
    } catch (err) {
      console.error("[maps]", path, err);
      sendJson(res, 400, { error: "JSON inválido." });
      return true;
    }
  }

  // Inventário: migra itens locais (convidado/localStorage) para a conta.
  if (req.method === "POST" && path === "/api/inventory/sync") {
    try {
      const auth = await authenticateToken(bearerToken(req));
      if (!auth.ok) {
        sendJson(res, 401, {
          error:
            auth.reason === "session_replaced"
              ? "Sessão encerrada — entrou noutro dispositivo."
              : "Não autenticado.",
          code: auth.reason === "session_replaced" ? AUTH_SESSION_REPLACED : undefined,
        });
        return true;
      }
      const body = await readJson(req);
      const result = await mergeAccountInventory(auth.account.id, body);
      if (typeof result === "string") {
        sendJson(res, 400, { error: result });
        return true;
      }
      sendJson(res, 200, { inventory: result });
    } catch (err) {
      console.error("[inventory] sync:", err);
      sendJson(res, 400, { error: "JSON inválido." });
    }
    return true;
  }

  return false;
}

const httpServer = createServer((req, res) => {
  const path = req.url?.split("?")[0] ?? "/";

  void handleApi(req, res, path).then((handled) => {
    if (handled) return;
    if (path === "/" || path === "/health") {
      setCors(res);
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("ok");
      return;
    }
    setCors(res);
    res.writeHead(404);
    res.end();
  });
});

const gameServer = new Server({ server: httpServer });
gameServer.define("deathmatch", DeathmatchRoom);
// Sala global do Social: presença, amigos e convites (clientes ficam
// conectados nela o tempo todo, mesmo dentro de uma partida).
gameServer.define("social", SocialRoom);

async function boot(): Promise<void> {
  if (isAuthEnabled()) {
    if (!process.env.JWT_SECRET?.trim()) {
      console.error("[auth] DATABASE_URL definida mas JWT_SECRET em falta — a abortar.");
      process.exit(1);
    }
    await migrate();
  } else {
    console.log("[auth] DATABASE_URL ausente — modo convidado (sem contas).");
  }

  // Catálogo de skins (Postgres ou JSON) ANTES de aceitar conexões:
  // o sanitizeInventory descarta ids que ainda não foram registrados.
  await loadCustomWeaponSkins();

  await gameServer.listen(port, host);
  console.log(`[fps-shooter] Colyseus ouvindo em http://${host}:${port}`);
}

boot().catch((err) => {
  console.error("[fps-shooter] falha ao iniciar:", err);
  process.exit(1);
});
