/**
 * Catálogo global de mapas custom (criador in-game).
 * Postgres é a única fonte — todos os jogadores vêem os mesmos mapas.
 */
import { getPool } from "./db";
import {
  MAX_CUSTOM_MAPS,
  sanitizeCustomMap,
  type CustomMapDef,
} from "../shared/customMap";

function rowToDef(row: { def: unknown }): CustomMapDef | null {
  return sanitizeCustomMap(row.def);
}

export async function listAllMaps(): Promise<CustomMapDef[]> {
  const r = await getPool().query<{ def: unknown }>(
    `SELECT def FROM custom_maps ORDER BY updated_at DESC`
  );
  const out: CustomMapDef[] = [];
  for (const row of r.rows) {
    const def = rowToDef(row);
    if (def) out.push(def);
  }
  return out;
}

export async function saveCatalogMap(
  userId: number,
  raw: unknown
): Promise<CustomMapDef | string> {
  const def = sanitizeCustomMap(raw);
  if (!def) return "Mapa inválido.";
  def.updatedAt = Date.now();

  const db = getPool();
  try {
    const exists = await db.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM custom_maps WHERE id = $1`,
      [def.id]
    );
    if ((exists.rows[0]?.n ?? 0) === 0) {
      const count = await db.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM custom_maps`
      );
      if ((count.rows[0]?.n ?? 0) >= MAX_CUSTOM_MAPS) {
        return `Limite de ${MAX_CUSTOM_MAPS} mapas no catálogo.`;
      }
    }
    await db.query(
      `INSERT INTO custom_maps (id, user_id, def, updated_at)
       VALUES ($1, $2, $3, to_timestamp($4 / 1000.0))
       ON CONFLICT (id) DO UPDATE SET
         user_id = EXCLUDED.user_id,
         def = EXCLUDED.def,
         updated_at = EXCLUDED.updated_at`,
      [def.id, userId, JSON.stringify(def), def.updatedAt]
    );
  } catch (err) {
    console.error("[maps] falha ao salvar:", err);
    return "Falha ao salvar o mapa no banco de dados.";
  }
  return def;
}

export async function deleteCatalogMap(
  idRaw: unknown
): Promise<true | string> {
  const id = typeof idRaw === "string" ? idRaw.slice(0, 48) : "";
  if (!id) return "Id inválido.";
  const r = await getPool().query(`DELETE FROM custom_maps WHERE id = $1`, [id]);
  if (r.rowCount === 0) return "Mapa não encontrado.";
  return true;
}
