import { getPool, isAuthEnabled } from "./db";

/** Entrada enxuta de amigo/pedido enviada aos clientes da sala social. */
export interface FriendEntry {
  userId: number;
  name: string;
  xp: number;
}

/** Perfil público exibido no modal "Informações" do amigo. */
export interface PublicProfile {
  id: number;
  username: string;
  kills: number;
  deaths: number;
  wins: number;
  matches: number;
  xp: number;
  gold: number;
  createdAt: string;
  skin: string;
}

interface FriendRow {
  id: number;
  username: string;
  xp: number;
}

function mapFriend(row: FriendRow): FriendEntry {
  return { userId: row.id, name: row.username, xp: row.xp };
}

/** Amigos aceitos (ambas as direções do par normalizado). */
export async function listFriends(userId: number): Promise<FriendEntry[]> {
  const result = await getPool().query<FriendRow>(
    `SELECT u.id, u.username, u.xp
       FROM friendships f
       JOIN users u ON u.id = CASE WHEN f.user_a = $1 THEN f.user_b ELSE f.user_a END
      WHERE f.user_a = $1 OR f.user_b = $1
      ORDER BY LOWER(u.username)`,
    [userId]
  );
  return result.rows.map(mapFriend);
}

/** Pedidos de amizade RECEBIDOS (aguardando a minha resposta). */
export async function listRequests(userId: number): Promise<FriendEntry[]> {
  const result = await getPool().query<FriendRow>(
    `SELECT r.from_user AS id, u.username, u.xp
       FROM friend_requests r
       JOIN users u ON u.id = r.from_user
      WHERE r.to_user = $1
      ORDER BY r.created_at`,
    [userId]
  );
  return result.rows.map(mapFriend);
}

/** Pedidos que EU enviei e ainda aguardam resposta (estado do menu). */
export async function listOutgoing(userId: number): Promise<FriendEntry[]> {
  const result = await getPool().query<FriendRow>(
    `SELECT r.to_user AS id, u.username, u.xp
       FROM friend_requests r
       JOIN users u ON u.id = r.to_user
      WHERE r.from_user = $1
      ORDER BY r.created_at`,
    [userId]
  );
  return result.rows.map(mapFriend);
}

export async function findUserByName(
  username: string
): Promise<{ id: number; username: string } | null> {
  const result = await getPool().query<{ id: number; username: string }>(
    `SELECT id, username FROM users WHERE LOWER(username) = LOWER($1)`,
    [username]
  );
  return result.rows[0] ?? null;
}

export async function findUserById(
  userId: number
): Promise<{ id: number; username: string } | null> {
  const result = await getPool().query<{ id: number; username: string }>(
    `SELECT id, username FROM users WHERE id = $1`,
    [userId]
  );
  return result.rows[0] ?? null;
}

export async function areFriends(a: number, b: number): Promise<boolean> {
  const [lo, hi] = a < b ? [a, b] : [b, a];
  const result = await getPool().query(
    `SELECT 1 FROM friendships WHERE user_a = $1 AND user_b = $2`,
    [lo, hi]
  );
  return (result.rowCount ?? 0) > 0;
}

/** Existe pedido pendente de `from` para `to`? */
export async function hasRequest(from: number, to: number): Promise<boolean> {
  const result = await getPool().query(
    `SELECT 1 FROM friend_requests WHERE from_user = $1 AND to_user = $2`,
    [from, to]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function createRequest(from: number, to: number): Promise<void> {
  await getPool().query(
    `INSERT INTO friend_requests (from_user, to_user)
     VALUES ($1, $2)
     ON CONFLICT (from_user, to_user) DO NOTHING`,
    [from, to]
  );
}

export async function deleteRequest(from: number, to: number): Promise<boolean> {
  const result = await getPool().query(
    `DELETE FROM friend_requests WHERE from_user = $1 AND to_user = $2`,
    [from, to]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function createFriendship(a: number, b: number): Promise<void> {
  const [lo, hi] = a < b ? [a, b] : [b, a];
  await getPool().query(
    `INSERT INTO friendships (user_a, user_b)
     VALUES ($1, $2)
     ON CONFLICT (user_a, user_b) DO NOTHING`,
    [lo, hi]
  );
}

export async function deleteFriendship(a: number, b: number): Promise<boolean> {
  const [lo, hi] = a < b ? [a, b] : [b, a];
  const result = await getPool().query(
    `DELETE FROM friendships WHERE user_a = $1 AND user_b = $2`,
    [lo, hi]
  );
  return (result.rowCount ?? 0) > 0;
}

interface ProfileRow {
  id: number;
  username: string;
  total_kills: number;
  total_deaths: number;
  wins: number;
  matches_played: number;
  xp: number;
  gold: number;
  created_at: Date | string;
  active_skin: string;
}

/** Perfil público de qualquer usuário (modal de informações do amigo). */
export async function getPublicProfile(
  userId: number
): Promise<PublicProfile | null> {
  if (!isAuthEnabled()) return null;
  const result = await getPool().query<ProfileRow>(
    `SELECT id, username, total_kills, total_deaths, wins, matches_played,
            xp, gold, created_at, active_skin
       FROM users WHERE id = $1`,
    [userId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    kills: row.total_kills,
    deaths: row.total_deaths,
    wins: row.wins,
    matches: row.matches_played,
    xp: row.xp,
    gold: row.gold,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at),
    skin: row.active_skin || "skin_default",
  };
}

/** Skin gravada do usuário (para exibir amigos offline). */
export async function getStoredSkin(userId: number): Promise<string> {
  const result = await getPool().query<{ active_skin: string }>(
    `SELECT active_skin FROM users WHERE id = $1`,
    [userId]
  );
  return result.rows[0]?.active_skin || "skin_default";
}

/** Persiste a skin ativa informada pela presença do cliente. */
export async function storeSkin(userId: number, skinId: string): Promise<void> {
  const skin = skinId.slice(0, 32) || "skin_default";
  await getPool().query(`UPDATE users SET active_skin = $2 WHERE id = $1`, [
    userId,
    skin,
  ]);
}
