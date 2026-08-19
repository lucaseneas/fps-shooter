/**
 * Inventário do jogador — compartilhado entre cliente (Inventário/Loja) e
 * servidor (persistência na conta). Modelo extensível: hoje guarda skins de
 * personagem e armas; no futuro skins de armas e equipamentos entram como
 * novas listas, sem mudar o formato salvo.
 */
import { SKINS, DEFAULT_SKIN } from "./skins";
import { WEAPONS, resolveWeaponId } from "./weapons";
import { allWeaponSkins, weaponSkinIds } from "./weaponSkins";

export type ItemType = "character_skin" | "weapon" | "weapon_skin" | "equipment";

export const ITEM_TYPE_LABELS: Record<ItemType, string> = {
  character_skin: "Skins de personagem",
  weapon: "Armas",
  weapon_skin: "Skins de armas",
  equipment: "Equipamentos",
};

export interface PlayerInventory {
  /** Ids de skins de personagem (shared/skins). */
  characterSkins: string[];
  /** Ids de armas desbloqueadas (shared/weapons). Hoje: todas. */
  weapons: string[];
  /** Futuro: ids de skins de armas. */
  weaponSkins: string[];
  /** Futuro: ids de equipamentos. */
  equipment: string[];
}

/** Inventário inicial: skin padrão + todas as armas (ainda gratuitas). */
export function defaultInventory(): PlayerInventory {
  return {
    characterSkins: [DEFAULT_SKIN],
    weapons: WEAPONS.map((w) => w.id),
    weaponSkins: [],
    equipment: [],
  };
}

const VALID_IDS: Record<keyof PlayerInventory, () => ReadonlySet<string>> = {
  characterSkins: () => new Set(SKINS.map((s) => s.id)),
  weapons: () => new Set([
    ...WEAPONS.map((w) => w.id),
    "rifle",
    "pistol",
    "sniper",
  ]),
  // Dinâmico: inclui skins custom registradas em runtime (servidor as serve).
  weaponSkins: () => new Set(weaponSkinIds()),
  equipment: () => new Set(),
};

/** Mapeia o tipo de item para a lista correspondente no inventário. */
export function inventoryKeyOf(type: ItemType): keyof PlayerInventory {
  switch (type) {
    case "character_skin":
      return "characterSkins";
    case "weapon":
      return "weapons";
    case "weapon_skin":
      return "weaponSkins";
    case "equipment":
      return "equipment";
  }
}

function remapWeaponIds(ids: string[]): string[] {
  const out: string[] = [];
  for (const id of ids) {
    const resolved = resolveWeaponId(id);
    if (resolved && !out.includes(resolved)) out.push(resolved);
  }
  return out;
}

function sanitizeIdList(
  raw: unknown,
  valid: ReadonlySet<string>,
  fallback: readonly string[]
): string[] {
  const out: string[] = [];
  if (Array.isArray(raw)) {
    for (const v of raw) {
      if (typeof v === "string" && valid.has(v) && !out.includes(v)) {
        out.push(v.slice(0, 64));
      }
    }
  }
  for (const id of fallback) {
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * Normaliza um inventário vindo de localStorage/JSONB: descarta ids que não
 * existem nos catálogos e garante os itens padrão (skin padrão + armas
 * gratuitas atuais).
 */
export function sanitizeInventory(raw: unknown): PlayerInventory {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const defaults = defaultInventory();
  return {
    characterSkins: sanitizeIdList(
      o.characterSkins,
      VALID_IDS.characterSkins(),
      defaults.characterSkins
    ),
    weapons: remapWeaponIds(
      sanitizeIdList(o.weapons, VALID_IDS.weapons(), defaults.weapons)
    ),
    weaponSkins: sanitizeIdList(o.weaponSkins, VALID_IDS.weaponSkins(), []),
    equipment: sanitizeIdList(o.equipment, VALID_IDS.equipment(), []),
  };
}

export function ownsItem(inv: PlayerInventory, type: ItemType, id: string): boolean {
  return inv[inventoryKeyOf(type)].includes(id);
}

/** Devolve uma cópia do inventário com o item adicionado (sem duplicar). */
export function withItem(inv: PlayerInventory, type: ItemType, id: string): PlayerInventory {
  const key = inventoryKeyOf(type);
  const list = inv[key];
  if (list.includes(id)) return inv;
  return { ...inv, [key]: [...list, id] };
}

/** Une dois inventários (usado para migrar itens locais ao logar na conta). */
export function mergeInventories(
  base: PlayerInventory,
  extra: PlayerInventory
): PlayerInventory {
  const merge = (a: string[], b: string[]) => [...new Set([...a, ...b])];
  return sanitizeInventory({
    characterSkins: merge(base.characterSkins, extra.characterSkins),
    weapons: merge(base.weapons, extra.weapons),
    weaponSkins: merge(base.weaponSkins, extra.weaponSkins),
    equipment: merge(base.equipment, extra.equipment),
  });
}

// --- Catálogo da Loja ---
// Tudo o que pode ser comprado com Gold. Skins de personagem vêm de
// shared/skins; quando existirem armas/skins de arma/equipamentos à venda,
// basta adicioná-los aqui (o servidor valida a compra por esta lista).

export interface ShopItemDef {
  type: ItemType;
  id: string;
  name: string;
  price: number;
  desc: string;
}

export const SHOP_ITEMS: ShopItemDef[] = SKINS.filter((s) => s.price > 0).map(
  (s) => ({
    type: "character_skin",
    id: s.id,
    name: s.name,
    price: s.price,
    desc: s.desc,
  })
);

/**
 * Catálogo completo da loja: itens estáticos + skins de arma (oficiais e
 * custom registradas em runtime). Dinâmico — chame a cada render.
 */
export function getShopItems(): ShopItemDef[] {
  const weaponSkinItems: ShopItemDef[] = allWeaponSkins()
    .filter((s) => s.price > 0)
    .map((s) => ({
      type: "weapon_skin",
      id: s.id,
      name: s.name,
      price: s.price,
      desc: `Skin para ${WEAPONS.find((w) => w.id === s.weaponId)?.name ?? s.weaponId}`,
    }));
  return [...SHOP_ITEMS, ...weaponSkinItems];
}

export function getShopItem(type: ItemType, id: string): ShopItemDef | undefined {
  return getShopItems().find((i) => i.type === type && i.id === id);
}
