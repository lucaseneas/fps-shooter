/**
 * Persistência das skins de arma custom (criadas pela ferramenta in-game).
 * Arquivo JSON em disco — funciona sem banco (dev local) e em qualquer
 * deploy com filesystem.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  registerCustomWeaponSkins,
  sanitizeWeaponSkin,
  type WeaponSkinDef,
} from "../shared/weaponSkins";

// O servidor é iniciado da raiz do projeto (scripts npm na raiz).
const DATA_DIR = path.join(process.cwd(), "server", "data");
const FILE = path.join(DATA_DIR, "weapon-skins.json");

let cache: WeaponSkinDef[] = [];
let loaded = false;

/** Carrega do disco e registra no catálogo (para sanitizeInventory valer). */
export async function loadCustomWeaponSkins(): Promise<WeaponSkinDef[]> {
  if (loaded) return cache;
  loaded = true;
  try {
    const raw = await fs.readFile(FILE, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      cache = parsed
        .map((s) => sanitizeWeaponSkin(s))
        .filter((s): s is WeaponSkinDef => s !== null);
    }
  } catch {
    // Arquivo inexistente ou inválido: começa vazio.
    cache = [];
  }
  registerCustomWeaponSkins(cache);
  console.log(`[weapon-skins] ${cache.length} skin(s) custom carregadas`);
  return cache;
}

/** Salva uma nova skin (id novo ou mesmo id = sobrescreve). */
export async function saveCustomWeaponSkin(
  raw: unknown
): Promise<WeaponSkinDef | string> {
  const def = sanitizeWeaponSkin(raw);
  if (!def) return "Skin inválida.";

  await loadCustomWeaponSkins();
  const idx = cache.findIndex((s) => s.id === def.id);
  if (idx >= 0) cache[idx] = def;
  else cache.push(def);

  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(FILE, JSON.stringify(cache, null, 2), "utf8");
  } catch (err) {
    console.error("[weapon-skins] falha ao salvar:", err);
    return "Falha ao salvar a skin no servidor.";
  }

  registerCustomWeaponSkins([def]);
  return def;
}
