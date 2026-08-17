import dns from "node:dns";
import { Pool } from "pg";

// Render free/não tem rota IPv6 fiável; o host Direct do Supabase
// (db.*.supabase.co) resolve muitas vezes só em AAAA → ENETUNREACH.
// Preferir A (IPv4). Mesmo assim, usa a URI do *Session pooler* no Render.
dns.setDefaultResultOrder("ipv4first");

let pool: Pool | null = null;

/** True quando DATABASE_URL está definida (auth ativo). */
export function isAuthEnabled(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL?.trim();
    if (!connectionString) {
      throw new Error("DATABASE_URL não definida");
    }
    if (/db\.[a-z0-9]+\.supabase\.co/i.test(connectionString)) {
      console.warn(
        "[auth] DATABASE_URL parece ser a conexão Direct do Supabase. " +
          "No Render usa Session pooler (host *.pooler.supabase.com) — Direct falha com ENETUNREACH (IPv6)."
      );
    }
    pool = new Pool({
      connectionString,
      ssl: connectionString.includes("localhost")
        ? undefined
        : { rejectUnauthorized: false },
    });
  }
  return pool;
}

/** Cria / atualiza o schema de utilizadores e estatísticas. */
export async function migrate(): Promise<void> {
  if (!isAuthEnabled()) return;
  const db = getPool();
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(16) UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS total_kills INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS total_deaths INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS wins INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS matches_played INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS xp INTEGER NOT NULL DEFAULT 0
    `);
    console.log("[auth] tabela users pronta");
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === "ENETUNREACH" || code === "ENOTFOUND" || code === "ETIMEDOUT") {
      throw new Error(
        "Não foi possível ligar ao Postgres. No Render usa a URI " +
          "Session pooler do Supabase (*.pooler.supabase.com:5432), não a Direct (db.*.supabase.co). Causa: " + String(err)
      );
    }
    throw err;
  }
}
