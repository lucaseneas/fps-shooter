import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { getPool, isAuthEnabled } from "./db";

const USERNAME_RE = /^[a-zA-Z0-9_]{3,16}$/;
const BCRYPT_ROUNDS = 10;
const TOKEN_TTL = "7d";

export interface AuthUser {
  id: number;
  username: string;
  kills: number;
  deaths: number;
  wins: number;
  matches: number;
  createdAt: string;
}

export interface AuthResult {
  ok: true;
  token: string;
  user: AuthUser;
}

export interface AuthError {
  ok: false;
  status: number;
  error: string;
}

interface UserRow {
  id: number;
  username: string;
  total_kills: number;
  total_deaths: number;
  wins: number;
  matches_played: number;
  created_at: Date | string;
}

function jwtSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret) {
    throw new Error("JWT_SECRET não definida");
  }
  return secret;
}

function mapUser(row: UserRow): AuthUser {
  const created =
    row.created_at instanceof Date
      ? row.created_at.toISOString()
      : String(row.created_at);
  return {
    id: row.id,
    username: row.username,
    kills: row.total_kills,
    deaths: row.total_deaths,
    wins: row.wins,
    matches: row.matches_played,
    createdAt: created,
  };
}

function signToken(user: Pick<AuthUser, "id" | "username">): string {
  return jwt.sign(
    { sub: user.id, username: user.username },
    jwtSecret(),
    { expiresIn: TOKEN_TTL }
  );
}

function validateCredentials(
  username: unknown,
  password: unknown
): { username: string; password: string } | string {
  if (typeof username !== "string" || typeof password !== "string") {
    return "Username e password são obrigatórios.";
  }
  const u = username.trim();
  if (!USERNAME_RE.test(u)) {
    return "Username: 3–16 caracteres (letras, números ou _).";
  }
  if (password.length < 6 || password.length > 72) {
    return "Password: entre 6 e 72 caracteres.";
  }
  return { username: u, password };
}

const USER_SELECT = `
  id, username, total_kills, total_deaths, wins, matches_played, created_at
`;

export async function register(
  username: unknown,
  password: unknown
): Promise<AuthResult | AuthError> {
  if (!isAuthEnabled()) {
    return { ok: false, status: 503, error: "Auth desativada (sem DATABASE_URL)." };
  }
  const parsed = validateCredentials(username, password);
  if (typeof parsed === "string") {
    return { ok: false, status: 400, error: parsed };
  }

  const hash = await bcrypt.hash(parsed.password, BCRYPT_ROUNDS);
  try {
    const result = await getPool().query<UserRow>(
      `INSERT INTO users (username, password_hash)
       VALUES ($1, $2)
       RETURNING ${USER_SELECT}`,
      [parsed.username, hash]
    );
    const user = mapUser(result.rows[0]);
    return { ok: true, token: signToken(user), user };
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === "23505") {
      return { ok: false, status: 409, error: "Esse username já existe." };
    }
    console.error("[auth] register:", err);
    return { ok: false, status: 500, error: "Erro ao criar conta." };
  }
}

export async function login(
  username: unknown,
  password: unknown
): Promise<AuthResult | AuthError> {
  if (!isAuthEnabled()) {
    return { ok: false, status: 503, error: "Auth desativada (sem DATABASE_URL)." };
  }
  const parsed = validateCredentials(username, password);
  if (typeof parsed === "string") {
    return { ok: false, status: 400, error: parsed };
  }

  const result = await getPool().query<UserRow & { password_hash: string }>(
    `SELECT ${USER_SELECT}, password_hash FROM users WHERE username = $1`,
    [parsed.username]
  );

  const row = result.rows[0];
  if (!row || !(await bcrypt.compare(parsed.password, row.password_hash))) {
    return { ok: false, status: 401, error: "Username ou password incorretos." };
  }

  const user = mapUser(row);
  return { ok: true, token: signToken(user), user };
}

/** Valida JWT e devolve id/username, ou null se inválido. */
export function verifyToken(
  token: unknown
): { id: number; username: string } | null {
  if (!isAuthEnabled() || typeof token !== "string" || !token.trim()) {
    return null;
  }
  try {
    const payload = jwt.verify(token.trim(), jwtSecret()) as {
      sub: number | string;
      username: string;
    };
    const id = Number(payload.sub);
    if (!Number.isFinite(id) || typeof payload.username !== "string") {
      return null;
    }
    return { id, username: payload.username.slice(0, 16) };
  } catch {
    return null;
  }
}

/** Perfil completo a partir do token. */
export async function getProfile(token: unknown): Promise<AuthUser | null> {
  const account = verifyToken(token);
  if (!account) return null;
  const result = await getPool().query<UserRow>(
    `SELECT ${USER_SELECT} FROM users WHERE id = $1`,
    [account.id]
  );
  const row = result.rows[0];
  return row ? mapUser(row) : null;
}

/** Soma kills/deaths da partida e, se ganhou, incrementa wins. */
export async function recordMatchStats(
  userId: number,
  stats: { kills: number; deaths: number; won: boolean }
): Promise<void> {
  if (!isAuthEnabled()) return;
  const kills = Math.max(0, Math.floor(stats.kills));
  const deaths = Math.max(0, Math.floor(stats.deaths));
  await getPool().query(
    `UPDATE users SET
       total_kills = total_kills + $2,
       total_deaths = total_deaths + $3,
       wins = wins + $4,
       matches_played = matches_played + 1
     WHERE id = $1`,
    [userId, kills, deaths, stats.won ? 1 : 0]
  );
}
