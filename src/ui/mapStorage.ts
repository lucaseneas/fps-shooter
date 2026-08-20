import { sanitizeCustomMap, type CustomMapDef } from "../../shared/customMap";
import { MAPS } from "../../shared/config";

const KEY = "fps.customMaps";

export function listCustomMaps(): CustomMapDef[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: CustomMapDef[] = [];
    for (const item of parsed) {
      const def = sanitizeCustomMap(item);
      if (def) out.push(def);
    }
    return out;
  } catch {
    return [];
  }
}

export function getCustomMap(id: string): CustomMapDef | null {
  return listCustomMaps().find((m) => m.id === id) ?? null;
}

export function saveCustomMap(def: CustomMapDef): CustomMapDef {
  const clean = sanitizeCustomMap({ ...def, updatedAt: Date.now() });
  if (!clean) throw new Error("Mapa inválido");
  const maps = listCustomMaps().filter((m) => m.id !== clean.id);
  maps.unshift(clean);
  localStorage.setItem(KEY, JSON.stringify(maps));
  return clean;
}

export function deleteCustomMap(id: string): void {
  localStorage.setItem(
    KEY,
    JSON.stringify(listCustomMaps().filter((m) => m.id !== id))
  );
}

export function playableMapOptions(): Array<{ value: string; label: string }> {
  return [
    ...MAPS.map((m) => ({ value: m.id, label: m.label })),
    ...listCustomMaps().map((m) => ({ value: m.id, label: m.name })),
  ];
}
