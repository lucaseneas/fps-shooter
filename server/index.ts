import "dotenv/config";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { Server } from "colyseus";
import { DeathmatchRoom } from "./DeathmatchRoom";
import { CONFIG } from "../shared/config";
import { isAuthEnabled, migrate } from "./db";
import { login, register, getProfile } from "./auth";

const port = Number(process.env.PORT) || CONFIG.serverPort;
/** Render (e outros PaaS) exigem escutar em 0.0.0.0, não só localhost. */
const host = process.env.HOST || "0.0.0.0";

function setCors(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
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

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      chunks.push(c);
      if (chunks.reduce((n, b) => n + b.length, 0) > 32_768) {
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
      sendJson(res, 201, { token: result.token, user: result.user });
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
      sendJson(res, 200, { token: result.token, user: result.user });
    } catch {
      sendJson(res, 400, { error: "JSON inválido." });
    }
    return true;
  }

  if (req.method === "GET" && path === "/api/auth/me") {
    try {
      const user = await getProfile(bearerToken(req));
      if (!user) {
        sendJson(res, 401, { error: "Não autenticado." });
        return true;
      }
      sendJson(res, 200, { user });
    } catch (err) {
      console.error("[auth] /me:", err);
      sendJson(res, 500, { error: "Erro ao carregar perfil." });
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

  await gameServer.listen(port, host);
  console.log(`[fps-shooter] Colyseus ouvindo em http://${host}:${port}`);
}

boot().catch((err) => {
  console.error("[fps-shooter] falha ao iniciar:", err);
  process.exit(1);
});
