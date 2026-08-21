import type { SpawnPoint } from "./mapData";

export type { SpawnPoint };

/** Pontos de spawn distribuídos pelo mapa "Praça" (pés no chão, y = 0). */
export const SPAWN_POINTS: SpawnPoint[] = [
  { x: 0, z: -34 },
  { x: 26, z: -34 },
  { x: -26, z: -34 },
  { x: 34, z: -14 },
  { x: -34, z: -14 },
  { x: 34, z: 14 },
  { x: -34, z: 14 },
  { x: 0, z: 34 },
  { x: 30, z: 33 },
  { x: -8, z: 34 },
];

/** Equipe Alfa — norte da Praça (+Z). */
export const SPAWN_POINTS_ALPHA: SpawnPoint[] = [
  { x: 0, z: 34 },
  { x: 30, z: 33 },
  { x: -8, z: 34 },
  { x: 34, z: 14 },
  { x: -34, z: 14 },
];

/** Equipe Echo — sul da Praça (−Z). */
export const SPAWN_POINTS_ECHO: SpawnPoint[] = [
  { x: 0, z: -34 },
  { x: 26, z: -34 },
  { x: -26, z: -34 },
  { x: 34, z: -14 },
  { x: -34, z: -14 },
];

function listOrDefault(points?: readonly SpawnPoint[]): readonly SpawnPoint[] {
  return points && points.length > 0 ? points : SPAWN_POINTS;
}

export function randomSpawn(points?: readonly SpawnPoint[]): SpawnPoint {
  const list = listOrDefault(points);
  return list[Math.floor(Math.random() * list.length)];
}

/** Escolhe um spawn aleatório entre os 4 mais distantes de `avoid`. */
export function pickSpawnFarFrom(
  avoid: SpawnPoint | null,
  points?: readonly SpawnPoint[]
): SpawnPoint {
  const list = listOrDefault(points);
  if (!avoid) return randomSpawn(list);
  const distSq = (p: SpawnPoint) =>
    (p.x - avoid.x) ** 2 + (p.z - avoid.z) ** 2;
  const sorted = [...list].sort((a, b) => distSq(b) - distSq(a));
  const candidates = sorted.slice(0, Math.min(4, sorted.length));
  return candidates[Math.floor(Math.random() * candidates.length)];
}

export function spawnsForTeam(
  team: string,
  map: {
    spawns: readonly SpawnPoint[];
    spawnsAlpha?: readonly SpawnPoint[];
    spawnsEcho?: readonly SpawnPoint[];
  }
): readonly SpawnPoint[] {
  if (team === "alpha" && map.spawnsAlpha && map.spawnsAlpha.length > 0) {
    return map.spawnsAlpha;
  }
  if (team === "echo" && map.spawnsEcho && map.spawnsEcho.length > 0) {
    return map.spawnsEcho;
  }
  return listOrDefault(map.spawns);
}
