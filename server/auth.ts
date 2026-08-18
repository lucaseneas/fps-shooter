import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { getPool, isAuthEnabled } from "./db";
import { getWeapon, weaponCategory, DEFAULT_LOADOUT, type LoadoutSlots, type WeaponId } from "../shared/weapons";
import { isValidSkin, DEFAULT_SKIN } from "../shared/skins";
import {
  mergeInventories,
  ownsItem,
  sanitizeInventory,
  withItem,
  getShopItem,
  ITEM_TYPE_LABELS,
  type ItemType,
  type PlayerInventory,
} from "../shared/inventory";

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
  /** XP de carreira — a patente é derivada dele (shared/ranks). */
  xp: number;
  /** Gold acumulado — moeda de recompensa (shared/gold). */
  gold: number;
  /** Skin ativa persistida (shared/skins). */
  activeSkin: string;
  /** Loadout equipado persistido (shared/weapons). */
  loadout: LoadoutSlots;
  /** Inventário persistido: skins, armas e (futuro) skins de arma/equipamentos. */
  inventory: PlayerInventory;
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
  xp: number;
  gold: number;
  active_skin: string;
  loadout: unknown;
  inventory: unknown;
  created_at: Date | string;
}

function parseLoadout(raw: unknown): LoadoutSlots {
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    const pick = (slot: keyof LoadoutSlots, fallback: WeaponId): WeaponId => {
      const v = o[slot];
      if (typeof v === "string" && getWeapon(v) && weaponCategory(v as WeaponId) === slot) {
        return v as WeaponId;
      }
      return fallback;
    };
    return {
      primary: pick("primary", DEFAULT_LOADOUT.primary),
      secondary: pick("secondary", DEFAULT_LOADOUT.secondary),
      melee: pick("melee", DEFAULT_LOADOUT.melee),
    };
  }
  return { ...DEFAULT_LOADOUT };
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
    xp: row.xp,
    gold: row.gold,
    activeSkin: isValidSkin(row.active_skin) ? row.active_skin : DEFAULT_SKIN,
    loadout: parseLoadout(row.loadout),
    inventory: sanitizeInventory(row.inventory),
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
  id, username, total_kills, total_deaths, wins, matches_played, xp, gold, active_skin, loadout, inventory, created_at
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

/** XP e gold de carreira de um usuário (para sincronizar na sala). */
export async function getUserProgress(
  userId: number
): Promise<{ xp: number; gold: number } | null> {
  if (!isAuthEnabled()) return null;
  const result = await getPool().query<{ xp: number; gold: number }>(
    `SELECT xp, gold FROM users WHERE id = $1`,
    [userId]
  );
  const row = result.rows[0];
  return row ? { xp: row.xp, gold: row.gold } : null;
}

/**
 * Soma kills/deaths/xp/gold da partida e, se ganhou, incrementa wins.
 * Retorna os novos totais (para refletir no estado da sala).
 */
export async function recordMatchStats(
  userId: number,
  stats: {
    kills: number;
    deaths: number;
    won: boolean;
    xpEarned: number;
    goldEarned: number;
  }
): Promise<{ xp: number; gold: number } | null> {
  if (!isAuthEnabled()) return null;
  const kills = Math.max(0, Math.floor(stats.kills));
  const deaths = Math.max(0, Math.floor(stats.deaths));
  const xp = Math.max(0, Math.floor(stats.xpEarned));
  const gold = Math.max(0, Math.floor(stats.goldEarned));
  const result = await getPool().query<{ xp: number; gold: number }>(
    `UPDATE users SET
       total_kills = total_kills + $2,
       total_deaths = total_deaths + $3,
       wins = wins + $4,
       matches_played = matches_played + 1,
       xp = xp + $5,
       gold = gold + $6
     WHERE id = $1
     RETURNING xp, gold`,
      [userId, kills, deaths, stats.won ? 1 : 0, xp, gold]
  );
  const row = result.rows[0];
  return row ? { xp: row.xp, gold: row.gold } : null;
}

export interface AccountPrefs {
  activeSkin: string;
  loadout: LoadoutSlots;
}

/** Valida e persiste skin ativa + loadout da conta. Retorna as prefs efetivamente salvas. */
export async function saveAccountPrefs(
  userId: number,
  body: unknown
): Promise<AccountPrefs | string> {
  if (!isAuthEnabled()) return "Auth desativada (sem DATABASE_URL).";
  if (!body || typeof body !== "object") return "Payload inválido.";
  const o = body as Record<string, unknown>;

  const skin = typeof o.activeSkin === "string" ? o.activeSkin : "";
  if (!isValidSkin(skin)) return "Skin inválida.";

  // Só permite equipar skin que consta no inventário da conta.
  const invRow = await getPool().query<{ inventory: unknown }>(
    `SELECT inventory FROM users WHERE id = $1`,
    [userId]
  );
  const currentInv = sanitizeInventory(invRow.rows[0]?.inventory);
  if (!ownsItem(currentInv, "character_skin", skin)) {
    return "Você não possui esta skin.";
  }

  const rawLoadout = o.loadout;
  if (!rawLoadout || typeof rawLoadout !== "object") return "Loadout inválido.";
  const lo = rawLoadout as Record<string, unknown>;
  const slots: Array<keyof LoadoutSlots> = ["primary", "secondary", "melee"];
  const loadout = {} as LoadoutSlots;
  for (const slot of slots) {
    const v = lo[slot];
    if (typeof v !== "string" || !getWeapon(v) || weaponCategory(v as WeaponId) !== slot) {
      return `Arma inválida no slot ${slot}.`;
    }
    loadout[slot] = v as WeaponId;
  }

  await getPool().query(
    `UPDATE users SET active_skin = $2, loadout = $3 WHERE id = $1`,
    [userId, skin, JSON.stringify(loadout)]
  );
  return { activeSkin: skin, loadout };
}

// --- Loja / Inventário ---

export interface PurchaseResult {
  gold: number;
  inventory: PlayerInventory;
}

/**
 * Compra de item da loja: valida pelo catálogo compartilhado (SHOP_ITEMS),
 * desconta o gold e grava o item no inventário — tudo numa transação com
 * lock da linha, então o cliente não consegue comprar sem saldo ou em
 * duplicidade.
 */
export async function purchaseItem(
  userId: number,
  body: unknown
): Promise<PurchaseResult | string> {
  if (!isAuthEnabled()) return "Auth desativada (sem DATABASE_URL).";
  if (!body || typeof body !== "object") return "Payload inválido.";
  const o = body as Record<string, unknown>;
  const type = o.type;
  const itemId = typeof o.itemId === "string" ? o.itemId.slice(0, 64) : "";
  if (
    typeof type !== "string" ||
    !(type in ITEM_TYPE_LABELS) ||
    !itemId
  ) {
    return "Item inválido.";
  }
  const item = getShopItem(type as ItemType, itemId);
  if (!item) return "Este item não está à venda.";

  const db = getPool();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query<{ gold: number; inventory: unknown }>(
      `SELECT gold, inventory FROM users WHERE id = $1 FOR UPDATE`,
      [userId]
    );
    const row = r.rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      return "Conta não encontrada.";
    }
    const inventory = sanitizeInventory(row.inventory);
    if (ownsItem(inventory, item.type, item.id)) {
      await client.query("ROLLBACK");
      return "Você já possui este item.";
    }
    if (row.gold < item.price) {
      await client.query("ROLLBACK");
      return "Gold insuficiente.";
    }
    const nextInv = withItem(inventory, item.type, item.id);
    const upd = await client.query<{ gold: number }>(
      `UPDATE users SET gold = gold - $2, inventory = $3 WHERE id = $1 RETURNING gold`,
      [userId, item.price, JSON.stringify(nextInv)]
    );
    await client.query("COMMIT");
    return { gold: upd.rows[0].gold, inventory: nextInv };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[shop] purchase:", err);
    return "Erro ao concluir a compra.";
  } finally {
    client.release();
  }
}

/**
 * Une itens enviados pelo cliente ao inventário da conta (só adiciona, nunca
 * remove) — migra skins compradas como convidado / em localStorage antigo.
 */
export async function mergeAccountInventory(
  userId: number,
  body: unknown
): Promise<PlayerInventory | string> {
  if (!isAuthEnabled()) return "Auth desativada (sem DATABASE_URL).";
  const incoming = sanitizeInventory(body);
  const r = await getPool().query<{ inventory: unknown }>(
    `SELECT inventory FROM users WHERE id = $1`,
    [userId]
  );
  const row = r.rows[0];
  if (!row) return "Conta não encontrada.";
  const merged = mergeInventories(sanitizeInventory(row.inventory), incoming);
  await getPool().query(`UPDATE users SET inventory = $2 WHERE id = $1`, [
    userId,
    JSON.stringify(merged),
  ]);
  return merged;
}
