/**
 * Skins de arma — compartilhado entre cliente (Loja/Inventário/studio) e
 * servidor (persistência + validação de compra).
 *
 * Uma skin é um mapa de nome de mesh do GLB → cor RGB (0–1). Os nomes vêm
 * dos meshes do modelo (ex.: MP5 tem "Cube", "Cylinder"...). O tint é
 * aplicado no carregamento do modelo (ViewModel.applyWeaponSkinParts).
 */
import { resolveWeaponId, type WeaponId } from "./weapons";

export interface WeaponSkinDef {
  id: string;
  weaponId: WeaponId;
  name: string;
  /** Preço em Gold na loja (0 = não vendida / apenas inventário). */
  price: number;
  /** meshName → cor RGB 0–1. Meshes não listados ficam na cor original. */
  parts: Record<string, [number, number, number]>;
  /** Criada pela ferramenta in-game (persistida no servidor), não em código. */
  custom?: boolean;
}

/** Skins "oficiais" definidas em código. */
const BUILTIN_WEAPON_SKINS: WeaponSkinDef[] = [];

/** Skins custom carregadas em runtime (servidor as serve via API). */
const customSkins = new Map<string, WeaponSkinDef>();

const SKIN_ID_MAX = 64;
const SKIN_NAME_MAX = 32;
const MAX_PARTS = 64;

function isValidColor(c: unknown): c is [number, number, number] {
  return (
    Array.isArray(c) &&
    c.length === 3 &&
    c.every((v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1)
  );
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

  const parts: Record<string, [number, number, number]> = {};
  if (o.parts && typeof o.parts === "object") {
    for (const [mesh, color] of Object.entries(o.parts as Record<string, unknown>)) {
      if (Object.keys(parts).length >= MAX_PARTS) break;
      if (!mesh || mesh.length > 64 || !isValidColor(color)) continue;
      parts[mesh] = [color[0], color[1], color[2]];
    }
  }
  if (Object.keys(parts).length === 0) return null;

  return { id, weaponId, name, price, parts, custom: true };
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
