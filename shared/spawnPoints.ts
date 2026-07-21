export interface SpawnPoint {
  x: number;
  z: number;
}

/** Pontos de spawn distribuídos pelo mapa (pés no chão, y = 0). */
export const SPAWN_POINTS: SpawnPoint[] = [
  { x: 0, z: -18 },
  { x: 22, z: -22 },
  { x: -24, z: -20 },
  { x: 28, z: 8 },
  { x: -28, z: 10 },
  { x: 20, z: 26 },
  { x: -18, z: 26 },
  { x: 0, z: 30 },
  { x: 10, z: -30 },
  { x: -10, z: -32 },
];

export function randomSpawn(): SpawnPoint {
  return SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)];
}

/** Escolhe um spawn aleatório entre os 4 mais distantes de `avoid`. */
export function pickSpawnFarFrom(avoid: SpawnPoint | null): SpawnPoint {
  if (!avoid) return randomSpawn();
  const distSq = (p: SpawnPoint) =>
    (p.x - avoid.x) ** 2 + (p.z - avoid.z) ** 2;
  const sorted = [...SPAWN_POINTS].sort((a, b) => distSq(b) - distSq(a));
  const candidates = sorted.slice(0, 4);
  return candidates[Math.floor(Math.random() * candidates.length)];
}
