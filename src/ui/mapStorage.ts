import { sanitizeCustomMap, type CustomMapDef } from "../../shared/customMap";
import { MAPS } from "../../shared/config";
import {
  deleteCustomMapRemote,
  fetchCustomMaps,
  loadStoredToken,
  saveCustomMapRemote,
} from "../net/authApi";

let cache: CustomMapDef[] = [];
let chain: Promise<CustomMapDef[]> = Promise.resolve([]);

try {
  localStorage.removeItem("fps.customMaps");
  localStorage.removeItem("fps.customMaps.syncedUser");
} catch {
  /* ignore */
}

function runExclusive(fn: () => Promise<CustomMapDef[]>): Promise<CustomMapDef[]> {
  const next = chain.then(fn, fn);
  chain = next.then(
    (maps) => maps,
    () => cache
  );
  return next;
}

function parseMapList(raw: unknown): CustomMapDef[] {
  if (!Array.isArray(raw)) return [];
  const out: CustomMapDef[] = [];
  for (const item of raw) {
    const def = sanitizeCustomMap(item);
    if (def) out.push(def);
  }
  return out;
}

function setCache(maps: CustomMapDef[]): CustomMapDef[] {
  cache = maps;
  return maps;
}

/** Lista síncrona do catálogo em memória (preenchido pelo Postgres). */
export function listCustomMaps(): CustomMapDef[] {
  return cache;
}

export function getCustomMap(id: string): CustomMapDef | null {
  return cache.find((m) => m.id === id) ?? null;
}

export type PersistMapResult =
  | { ok: true; map: CustomMapDef }
  | { ok: false; error: string };

export async function saveCustomMap(def: CustomMapDef): Promise<PersistMapResult> {
  const clean = sanitizeCustomMap({ ...def, updatedAt: Date.now() });
  if (!clean) return { ok: false, error: "Mapa inválido." };
  if (!loadStoredToken()) {
    return { ok: false, error: "Entre na conta para publicar o mapa." };
  }
  const remote = await saveCustomMapRemote(clean);
  if (!remote.ok) return { ok: false, error: remote.error };
  const saved = sanitizeCustomMap(remote.map) ?? clean;
  setCache([saved, ...cache.filter((m) => m.id !== saved.id)]);
  return { ok: true, map: saved };
}

export async function deleteCustomMap(
  id: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!loadStoredToken()) {
    return { ok: false, error: "Entre na conta para excluir o mapa." };
  }
  const remote = await deleteCustomMapRemote(id);
  if (!remote.ok) return { ok: false, error: remote.error };
  setCache(cache.filter((m) => m.id !== id));
  return { ok: true };
}

/** Recarrega o catálogo global do servidor. */
export function refreshCustomMaps(): Promise<CustomMapDef[]> {
  return runExclusive(loadMaps);
}

async function loadMaps(): Promise<CustomMapDef[]> {
  const remote = await fetchCustomMaps();
  if (!remote.ok) return cache;
  return setCache(parseMapList(remote.maps));
}

export function playableMapOptions(): Array<{ value: string; label: string }> {
  return [
    ...MAPS.map((m) => ({ value: m.id, label: m.label })),
    ...cache.map((m) => ({ value: m.id, label: m.name })),
  ];
}
