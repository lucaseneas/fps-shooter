/**
 * Persistência das skins de arma custom (criadas pela ferramenta in-game).
 * Com DATABASE_URL: Postgres (catálogo global da loja).
 * Sem banco: ficheiro JSON em server/data (dev local).
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { getPool, isAuthEnabled } from "./db";
import {
  setCustomWeaponSkins,
  registerCustomWeaponSkins,
  unregisterCustomWeaponSkin,
  sanitizeWeaponSkin,
  packWeaponSkinParts,
  type WeaponSkinDef,
} from "../shared/weaponSkins";

const DATA_DIR = path.join(process.cwd(), "server", "data");
const FILE = path.join(DATA_DIR, "weapon-skins.json");

let cache: WeaponSkinDef[] = [];
let loaded = false;

function applyCache(defs: WeaponSkinDef[]): WeaponSkinDef[] {
  cache = defs;
  loaded = true;
  setCustomWeaponSkins(cache);
  return cache;
}

async function readJsonFile(): Promise<WeaponSkinDef[]> {
  try {
    const raw = await fs.readFile(FILE, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((s) => sanitizeWeaponSkin(s))
      .filter((s): s is WeaponSkinDef => s !== null);
  } catch {
    return [];
  }
}

async function writeJsonFile(defs: WeaponSkinDef[]): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(defs, null, 2), "utf8");
}

function rowToDef(row: {
  id: string;
  weapon_id: string;
  name: string;
  price: number;
  parts: unknown;
}): WeaponSkinDef | null {
  return sanitizeWeaponSkin({
    id: row.id,
    weaponId: row.weapon_id,
    name: row.name,
    price: Number(row.price),
    parts: row.parts,
  });
}

async function loadFromDb(): Promise<WeaponSkinDef[]> {
  const r = await getPool().query<{
    id: string;
    weapon_id: string;
    name: string;
    price: number;
    parts: unknown;
  }>(`SELECT id, weapon_id, name, price, parts FROM weapon_skins ORDER BY created_at DESC`);
  return r.rows
    .map((row) => rowToDef(row))
    .filter((s): s is WeaponSkinDef => s !== null);
}

/** Importa o JSON antigo para o Postgres na primeira vez (tabela vazia). */
async function migrateJsonFileIntoDb(): Promise<void> {
  const count = await getPool().query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM weapon_skins`
  );
  if ((count.rows[0]?.n ?? 0) > 0) return;
  const fromFile = await readJsonFile();
  if (fromFile.length === 0) return;
  for (const def of fromFile) {
    await getPool().query(
      `INSERT INTO weapon_skins (id, weapon_id, name, price, parts)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO NOTHING`,
      [def.id, def.weaponId, def.name, def.price, JSON.stringify(packWeaponSkinParts(def.parts, def.textures))]
    );
  }
  console.log(`[weapon-skins] ${fromFile.length} skin(s) migradas do JSON para o DB`);
}

/** Carrega o catálogo e registra no processo (para sanitizeInventory / loja). */
export async function loadCustomWeaponSkins(): Promise<WeaponSkinDef[]> {
  if (isAuthEnabled()) {
    try {
      if (!loaded) await migrateJsonFileIntoDb();
      const defs = await loadFromDb();
      if (!loaded) {
        console.log(`[weapon-skins] ${defs.length} skin(s) carregadas do Postgres`);
      }
      return applyCache(defs);
    } catch (err) {
      console.error("[weapon-skins] falha ao ler o DB, a cair para JSON:", err);
    }
  }
  if (loaded) return cache;
  const fromFile = await readJsonFile();
  console.log(`[weapon-skins] ${fromFile.length} skin(s) custom carregadas (JSON)`);
  return applyCache(fromFile);
}

/** Publica uma skin no catálogo global (loja). */
export async function saveCustomWeaponSkin(
  raw: unknown
): Promise<WeaponSkinDef | string> {
  const def = sanitizeWeaponSkin(raw);
  if (!def) return "Skin inválida.";

  await loadCustomWeaponSkins();

  if (isAuthEnabled()) {
    try {
      await getPool().query(
        `INSERT INTO weapon_skins (id, weapon_id, name, price, parts)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE SET
           weapon_id = EXCLUDED.weapon_id,
           name = EXCLUDED.name,
           price = EXCLUDED.price,
           parts = EXCLUDED.parts`,
        [def.id, def.weaponId, def.name, def.price, JSON.stringify(packWeaponSkinParts(def.parts, def.textures))]
      );
    } catch (err) {
      console.error("[weapon-skins] falha ao salvar no DB:", err);
      return "Falha ao salvar a skin no banco de dados.";
    }
    const defs = await loadFromDb();
    applyCache(defs);
    return def;
  }

  const idx = cache.findIndex((s) => s.id === def.id);
  if (idx >= 0) cache[idx] = def;
  else cache.push(def);
  try {
    await writeJsonFile(cache);
  } catch (err) {
    console.error("[weapon-skins] falha ao salvar JSON:", err);
    return "Falha ao salvar a skin no servidor.";
  }
  registerCustomWeaponSkins([def]);
  return def;
}

/** Remove uma skin do catálogo (some da loja). */
export async function deleteCustomWeaponSkin(
  idRaw: unknown
): Promise<true | string> {
  const id = typeof idRaw === "string" ? idRaw.slice(0, 64) : "";
  if (!id) return "Id inválido.";

  await loadCustomWeaponSkins();
  if (!cache.some((s) => s.id === id)) return "Skin não encontrada.";

  if (isAuthEnabled()) {
    try {
      await getPool().query(`DELETE FROM weapon_skins WHERE id = $1`, [id]);
    } catch (err) {
      console.error("[weapon-skins] falha ao apagar no DB:", err);
      return "Falha ao apagar a skin no banco de dados.";
    }
    applyCache(await loadFromDb());
    return true;
  }

  cache = cache.filter((s) => s.id !== id);
  try {
    await writeJsonFile(cache);
  } catch (err) {
    console.error("[weapon-skins] falha ao gravar JSON após delete:", err);
    return "Falha ao apagar a skin no servidor.";
  }
  unregisterCustomWeaponSkin(id);
  setCustomWeaponSkins(cache);
  return true;
}
