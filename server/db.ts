import { Pool } from "pg";

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
      ADD COLUMN IF NOT EXISTS matches_played INTEGER NOT NULL DEFAULT 0
  `);
  console.log("[auth] tabela users pronta");
}
