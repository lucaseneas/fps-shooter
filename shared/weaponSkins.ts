/**
 * Skins de arma — compartilhado entre cliente (Loja/Inventário/studio) e
 * servidor (persistência + validação de compra).
 *
 * Uma skin é um mapa de nome de mesh do GLB → cor RGB (0–1) e, opcionalmente,
 * um id de textura do catálogo (`shared/textures.ts`). Os nomes vêm dos
 * meshes do modelo. O visual é aplicado no carregamento
 * (ViewModel.applyWeaponAppearance).
 */
import { resolveWeaponId, type WeaponId } from "./weapons";
import { sanitizeGameTextureId } from "./textures";

export interface WeaponSkinDef {
  id: string;
  weaponId: WeaponId;
  name: string;
  /** Preço em Gold na loja (0 = não vendida / apenas inventário). */
  price: number;
  /** meshName → cor RGB 0–1. Meshes não listados ficam na skin padrão. */
  parts: Record<string, [number, number, number]>;
  /** meshName → id de `GAME_TEXTURES` (mapa ou armamento). */
  textures?: Record<string, string>;
  /** Criada pela ferramenta in-game (persistida no servidor), não em código. */
  custom?: boolean;
}

export interface WeaponSkinLooks {
  parts: Record<string, [number, number, number]>;
  textures: Record<string, string>;
}

type Rgb = [number, number, number];

/** Paleta de arma real: polímero, aço, madeira, latão. */
const POLYMER: Rgb = [0.12, 0.12, 0.13];
const POLYMER_OD: Rgb = [0.2, 0.22, 0.18];
const GUNMETAL: Rgb = [0.22, 0.23, 0.25];
const STEEL: Rgb = [0.34, 0.35, 0.37];
const BLUED: Rgb = [0.16, 0.17, 0.19];
const MAG: Rgb = [0.09, 0.09, 0.1];
const RAIL: Rgb = [0.14, 0.14, 0.15];
const WOOD: Rgb = [0.42, 0.26, 0.12];
const WOOD_DARK: Rgb = [0.3, 0.17, 0.08];
const FDE: Rgb = [0.45, 0.38, 0.28];
const FDE_DARK: Rgb = [0.36, 0.3, 0.22];
const BRASS: Rgb = [0.72, 0.55, 0.22];
const COPPER: Rgb = [0.7, 0.4, 0.16];
const SCOPE: Rgb = [0.1, 0.1, 0.11];
const SLIDE: Rgb = [0.46, 0.47, 0.5];
const BLADE: Rgb = [0.78, 0.8, 0.83];
const EDGE: Rgb = [0.9, 0.92, 0.94];
const GUARD: Rgb = [0.18, 0.18, 0.2];

function magnumDefaultParts(): Record<string, Rgb> {
  const parts: Record<string, Rgb> = {
    "*": GUNMETAL,
    Grip: WOOD_DARK,
    magnum_grip: WOOD_DARK,
    Trigger: POLYMER,
    magnum_trigger: POLYMER,
    Mag357_Trigger: POLYMER,
    mag357_trigger: POLYMER,
    Hammer: POLYMER,
    magnum_hammer: POLYMER,
    Mag357_Hammer: POLYMER,
    mag357_hammer: POLYMER,
    mag_bullet: COPPER,
    magnum_bullet: COPPER,
    Mag357_Bullet: COPPER,
    mag_cartridge: BRASS,
    mag_case: BRASS,
    magnum_bulletcase: BRASS,
    Mag357_Cartridge: BRASS,
    Mag357_BulletCase: BRASS,
  };
  for (let i = 1; i <= 8; i++) {
    parts[`mag357_bullet_${i}`] = COPPER;
    parts[`Mag357_Bullet_${i}`] = COPPER;
    parts[`mag357_bulletcase_${i}`] = BRASS;
    parts[`Mag357_BulletCase_${i}`] = BRASS;
  }
  return parts;
}

/**
 * Skin padrão (cores de arma real) aplicada quando nenhuma skin custom
 * está equipada. Os GLBs novos quase não têm material — sem isto ficam cinza.
 * Chaves usam o nome do nó no GLB; `applyWeaponSkinParts` também casa
 * o prefixo "Clone of " do instantiateModelsToScene.
 */
const DEFAULT_WEAPON_PARTS: Record<WeaponId, Record<string, Rgb>> = {
  m4a1: {
    "*": POLYMER_OD,
    Cube: POLYMER_OD,
    "Cube.001": RAIL,
    "Cube.003": RAIL,
    "Cube.006": MAG,
    "Cube.008": RAIL,
    "Cube.009": RAIL,
    Cylinder: STEEL,
    "Cylinder.002": POLYMER,
  },
  ak47: {
    "*": GUNMETAL,
    Cube: WOOD_DARK,
    "Cube.001": RAIL,
    "Cube.002": WOOD,
    "Cube.003": MAG,
    "Cube.004": MAG,
    Cylinder: STEEL,
  },
  scarh: {
    "*": FDE,
    Cube: FDE,
    "Cube.001": RAIL,
    "Cube.002": MAG,
    "Cube.003": FDE_DARK,
    "Cube.004": FDE,
    Cylinder: POLYMER,
    "Cylinder.001": STEEL,
  },
  mp5: {
    "*": POLYMER,
    Cube: POLYMER,
    "Cube.001": RAIL,
    "Cube.002": GUNMETAL,
    "Cube.003": MAG,
    "Cube.004": POLYMER,
    "Cube.005": STEEL,
    "Cube.006": STEEL,
    Cylinder: GUNMETAL,
    "Cylinder.001": STEEL,
  },
  vector: {
    "*": POLYMER,
    Cube: POLYMER,
    "Cube.001": RAIL,
    "Cube.002": GUNMETAL,
    "Cube.003": POLYMER,
    "Cube.004": MAG,
    Cylinder: STEEL,
    "Cylinder.001": STEEL,
  },
  usp: {
    "*": POLYMER,
    Cube: SLIDE,
    "Cube.001": POLYMER,
    "Cube.002": STEEL,
    "Cube.003": MAG,
  },
  magnum: magnumDefaultParts(),
  shotgun: {
    "*": WOOD,
    Cube: WOOD,
    "Cube.001": RAIL,
    Cylinder: BLUED,
  },
  awp: {
    "*": POLYMER,
    Cube: POLYMER,
    "Cube.001": POLYMER,
    "Cube.002": RAIL,
    "Cube.003": GUNMETAL,
    "Cube.004": MAG,
    "Cube.005": POLYMER,
    "Cube.006": GUNMETAL,
    Cylinder: STEEL,
    "Cylinder.001": SCOPE,
    "Cylinder.002": SCOPE,
    "Cylinder.003": SCOPE,
  },
  knife: {
    knife_primitive0: POLYMER,
    knife_primitive1: GUARD,
    knife_primitive2: BLADE,
    knife_primitive3: EDGE,
    "Cube.058": POLYMER,
    "Cube.058_primitive1": GUARD,
    "Cube.058_primitive2": BLADE,
    "Cube.058_primitive3": EDGE,
  },
  minigun: {
    "*": GUNMETAL,
  },
};

/** Cores padrão da arma (polímero / aço / madeira). Sempre aplicadas por baixo da skin custom. */
export function defaultWeaponSkinParts(
  weaponId: WeaponId
): Record<string, [number, number, number]> {
  return DEFAULT_WEAPON_PARTS[weaponId] ?? { "*": GUNMETAL };
}

/** Skins "oficiais" definidas em código. */
const BUILTIN_WEAPON_SKINS: WeaponSkinDef[] = [];

/** Skins custom carregadas em runtime (servidor as serve via API). */
const customSkins = new Map<string, WeaponSkinDef>();

const SKIN_ID_MAX = 64;
const SKIN_NAME_MAX = 32;
const MAX_PARTS = 256;

function isValidColor(c: unknown): c is [number, number, number] {
  return (
    Array.isArray(c) &&
    c.length === 3 &&
    c.every((v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1)
  );
}

const WEAPON_SKIN_PARTS_JSON_MAX = 16384;
const WHITE: [number, number, number] = [1, 1, 1];

function parsePartEntry(
  val: unknown
): { color: [number, number, number]; texture?: string } | null {
  if (isValidColor(val)) return { color: [val[0], val[1], val[2]] };
  if (!val || typeof val !== "object") return null;
  const o = val as Record<string, unknown>;
  const color = isValidColor(o.color) ? o.color : WHITE;
  const texture = sanitizeGameTextureId(o.texture);
  if (!isValidColor(o.color) && !texture) return null;
  return texture ? { color, texture } : { color };
}

function unpackLooks(
  partsRaw: unknown,
  texturesRaw?: unknown
): WeaponSkinLooks | null {
  if (!partsRaw || typeof partsRaw !== "object") return null;
  const parts: Record<string, [number, number, number]> = {};
  const textures: Record<string, string> = {};
  for (const [mesh, val] of Object.entries(partsRaw as Record<string, unknown>)) {
    if (Object.keys(parts).length >= MAX_PARTS) break;
    if (!mesh || mesh.length > 64) continue;
    const parsed = parsePartEntry(val);
    if (!parsed) continue;
    parts[mesh] = parsed.color;
    if (parsed.texture) textures[mesh] = parsed.texture;
  }
  if (texturesRaw && typeof texturesRaw === "object") {
    for (const [mesh, id] of Object.entries(texturesRaw as Record<string, unknown>)) {
      if (Object.keys(textures).length >= MAX_PARTS) break;
      if (!mesh || mesh.length > 64) continue;
      const tex = sanitizeGameTextureId(id);
      if (!tex) continue;
      textures[mesh] = tex;
      if (!parts[mesh]) parts[mesh] = WHITE;
    }
  }
  return Object.keys(parts).length > 0 ? { parts, textures } : null;
}

/** Empacota cores+texturas no JSONB `parts` (sem coluna extra no Postgres). */
export function packWeaponSkinParts(
  parts: Record<string, [number, number, number]>,
  textures?: Record<string, string>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const meshes = new Set([
    ...Object.keys(parts),
    ...Object.keys(textures ?? {}),
  ]);
  for (const mesh of meshes) {
    const color = parts[mesh] ?? WHITE;
    const texture = textures?.[mesh];
    out[mesh] = texture ? { color, texture } : color;
  }
  return out;
}

/** Valida o mapa mesh → RGB (e v2 com texturas) vindo da rede. */
export function sanitizeWeaponSkinParts(
  raw: unknown
): Record<string, [number, number, number]> | null {
  return decodeWeaponSkinLooks(raw)?.parts ?? null;
}

export function decodeWeaponSkinLooks(raw: unknown): WeaponSkinLooks | null {
  let value: unknown = raw;
  if (typeof raw === "string") {
    if (!raw || raw.length > WEAPON_SKIN_PARTS_JSON_MAX) return null;
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;
  if (o.v === 2 && o.p && typeof o.p === "object") {
    return unpackLooks(o.p, o.t);
  }
  return unpackLooks(value);
}

export function encodeWeaponSkinParts(
  parts: Record<string, [number, number, number]> | null | undefined,
  textures?: Record<string, string> | null
): string {
  if (!parts || Object.keys(parts).length === 0) return "";
  const tex = textures && Object.keys(textures).length > 0 ? textures : undefined;
  try {
    const payload = tex ? { v: 2, p: parts, t: tex } : parts;
    const json = JSON.stringify(payload);
    return json.length > WEAPON_SKIN_PARTS_JSON_MAX ? "" : json;
  } catch {
    return "";
  }
}

/** Valida um payload vindo da rede antes de registrar/persistir. */
export function sanitizeWeaponSkin(raw: unknown): WeaponSkinDef | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;

  const id = typeof o.id === "string" ? o.id.slice(0, SKIN_ID_MAX) : "";
  const name = typeof o.name === "string" ? o.name.trim().slice(0, SKIN_NAME_MAX) : "";
  const price = typeof o.price === "number" && Number.isFinite(o.price)
    ? Math.max(0, Math.min(1_000_000, Math.round(o.price)))
    : -1;
  const weaponId = resolveWeaponId(String(o.weaponId ?? ""));

  if (!id || !name || price < 0) return null;
  if (!weaponId) return null;

  const looks = unpackLooks(o.parts, o.textures);
  if (!looks) return null;

  return {
    id,
    weaponId,
    name,
    price,
    parts: looks.parts,
    textures: Object.keys(looks.textures).length > 0 ? looks.textures : undefined,
    custom: true,
  };
}

/**
 * Registra skins custom (chamado pelo cliente após o fetch e pelo servidor
 * ao carregar o disco). Deve rodar ANTES de sanitizeInventory para que os
 * ids não sejam descartados como inválidos.
 */
export function registerCustomWeaponSkins(defs: WeaponSkinDef[]): void {
  for (const def of defs) {
    if (def?.id) customSkins.set(def.id, def);
  }
}

/** Substitui o catálogo custom (reload do servidor). */
export function setCustomWeaponSkins(defs: WeaponSkinDef[]): void {
  customSkins.clear();
  registerCustomWeaponSkins(defs);
}

export function unregisterCustomWeaponSkin(id: string): void {
  customSkins.delete(id);
}

export function getWeaponSkin(id: string): WeaponSkinDef | undefined {
  return (
    BUILTIN_WEAPON_SKINS.find((s) => s.id === id) ?? customSkins.get(id)
  );
}

/** Todas as skins (oficiais + custom) de uma arma específica. */
export function weaponSkinsFor(weaponId: WeaponId): WeaponSkinDef[] {
  return [
    ...BUILTIN_WEAPON_SKINS.filter((s) => s.weaponId === weaponId),
    ...[...customSkins.values()].filter((s) => s.weaponId === weaponId),
  ];
}

/** Catálogo completo (loja). */
export function allWeaponSkins(): WeaponSkinDef[] {
  return [...BUILTIN_WEAPON_SKINS, ...customSkins.values()];
}

/** Ids válidos para sanitizeInventory. */
export function weaponSkinIds(): string[] {
  return allWeaponSkins().map((s) => s.id);
}
