/**
 * Geometria do mapa como dados — fonte única usada pelo cliente (render +
 * colisão Babylon) e pelo servidor (física, hitscan e LOS dos bots).
 * Colisão usa AABBs: centro (x, y, z) + dimensões (w, h, d). Peças com `yaw`
 * mantêm w/d visuais; a AABB de colisão é o envelope via `boxCollisionSize`.
 *
 * Mapa "Praça" (Fase 5): arena 80x80 com uma praça elevada no centro,
 * um armazém (NO), um corredor fechado (NE, zona de escopeta), um campo
 * aberto com pilares (SO, zona de rifle) e um composto em L (SE).
 * Sem tetos/overhangs — a física vertical não os trata.
 */
export interface BoxDef {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
  kind: "border" | "wall" | "building" | "box" | "platform" | "pillar";
  /** Tint "#rrggbb" (mapa custom). */
  color?: string;
  /** Id de textura do editor (mapa custom). */
  texture?: string;
  /** Yaw visual em graus (0 / 45 / … / 315). Colisão usa o AABB envelopado. */
  yaw?: number;
}

/** Envelope AABB no plano XZ após o yaw da caixa (idêntico a 0°/90°). */
export function boxCollisionSize(b: {
  w: number;
  d: number;
  yaw?: number;
}): { w: number; d: number } {
  const deg = ((b.yaw ?? 0) % 360 + 360) % 360;
  if (deg === 0 || deg === 180) return { w: b.w, d: b.d };
  if (deg === 90 || deg === 270) return { w: b.d, d: b.w };
  const rad = (deg * Math.PI) / 180;
  const c = Math.abs(Math.cos(rad));
  const s = Math.abs(Math.sin(rad));
  return { w: b.w * c + b.d * s, d: b.w * s + b.d * c };
}

export const MAP_SIZE = 80;
export const WALL_HEIGHT = 6;
const HALF = MAP_SIZE / 2;
const T = 1; // espessura de parede

// --- Paredes de borda ---
const borders: BoxDef[] = [
  { x: 0, y: WALL_HEIGHT / 2, z: HALF, w: MAP_SIZE, h: WALL_HEIGHT, d: T, kind: "border" },
  { x: 0, y: WALL_HEIGHT / 2, z: -HALF, w: MAP_SIZE, h: WALL_HEIGHT, d: T, kind: "border" },
  { x: HALF, y: WALL_HEIGHT / 2, z: 0, w: T, h: WALL_HEIGHT, d: MAP_SIZE, kind: "border" },
  { x: -HALF, y: WALL_HEIGHT / 2, z: 0, w: T, h: WALL_HEIGHT, d: MAP_SIZE, kind: "border" },
];

// --- Centro: praça elevada com escadas ao norte e ao sul ---
const plaza: BoxDef[] = [
  { x: 0, y: 0.5, z: 0, w: 12, h: 1, d: 12, kind: "platform" },
  { x: 0, y: 0.25, z: 7, w: 6, h: 0.5, d: 2, kind: "platform" },
  { x: 0, y: 0.25, z: -7, w: 6, h: 0.5, d: 2, kind: "platform" },
  // Cobertura em cima da praça.
  { x: -3, y: 1.75, z: 3, w: 1.5, h: 1.5, d: 1.5, kind: "box" },
  { x: 3, y: 1.75, z: -3, w: 1.5, h: 1.5, d: 1.5, kind: "box" },
  // Muros laterais que fecham a visão leste-oeste pelo meio.
  { x: -14, y: 1.75, z: 0, w: 1, h: 3.5, d: 10, kind: "wall" },
  { x: 14, y: 1.75, z: 0, w: 1, h: 3.5, d: 10, kind: "wall" },
];

// --- Noroeste: armazém (paredes sem teto, entradas ao sul e leste) ---
const warehouse: BoxDef[] = [
  { x: -24, y: 1.75, z: 30, w: 16, h: 3.5, d: 1, kind: "wall" },
  { x: -32, y: 1.75, z: 24, w: 1, h: 3.5, d: 13, kind: "wall" },
  { x: -27, y: 1.75, z: 17, w: 9, h: 3.5, d: 1, kind: "wall" },
  { x: -16, y: 1.75, z: 26, w: 1, h: 3.5, d: 9, kind: "wall" },
  { x: -27, y: 0.75, z: 25, w: 1.5, h: 1.5, d: 1.5, kind: "box" },
  { x: -20, y: 0.75, z: 21, w: 1.5, h: 1.5, d: 1.5, kind: "box" },
];

// --- Nordeste: corredor fechado (zona de escopeta) + caixas de apoio ---
const corridor: BoxDef[] = [
  { x: 24, y: 1.75, z: 28, w: 20, h: 3.5, d: 1, kind: "wall" },
  { x: 24, y: 1.75, z: 21, w: 20, h: 3.5, d: 1, kind: "wall" },
  { x: 24, y: 0.6, z: 24.5, w: 1.2, h: 1.2, d: 1.2, kind: "box" },
  { x: 18, y: 0.9, z: 12, w: 1.8, h: 1.8, d: 1.8, kind: "box" },
  { x: 28, y: 0.8, z: 10, w: 1.6, h: 1.6, d: 1.6, kind: "box" },
];

// --- Sudoeste: campo aberto com pilares (zona de rifle) ---
const field: BoxDef[] = [
  { x: -20, y: 2, z: -12, w: 2, h: 4, d: 2, kind: "pillar" },
  { x: -28, y: 2, z: -24, w: 2, h: 4, d: 2, kind: "pillar" },
  { x: -12, y: 2, z: -28, w: 2, h: 4, d: 2, kind: "pillar" },
  { x: -22, y: 0.75, z: -18, w: 1.5, h: 1.5, d: 1.5, kind: "box" },
];

// --- Sudeste: composto em L ---
const compound: BoxDef[] = [
  { x: 22, y: 1.75, z: -20, w: 12, h: 3.5, d: 1, kind: "wall" },
  { x: 28, y: 1.75, z: -26, w: 1, h: 3.5, d: 13, kind: "wall" },
  { x: 20, y: 0.75, z: -26, w: 1.5, h: 1.5, d: 1.5, kind: "box" },
  { x: 24.5, y: 0.75, z: -23, w: 1.5, h: 1.5, d: 1.5, kind: "box" },
  { x: 12, y: 2, z: -14, w: 2, h: 4, d: 2, kind: "pillar" },
];

// --- Coberturas soltas nas rotas norte/sul e diagonais ---
const scatter: BoxDef[] = [
  { x: 0, y: 0.8, z: 20, w: 1.6, h: 1.6, d: 1.6, kind: "box" },
  { x: 0, y: 0.8, z: -20, w: 1.6, h: 1.6, d: 1.6, kind: "box" },
  { x: -10, y: 0.9, z: 8, w: 1.8, h: 1.8, d: 1.8, kind: "box" },
  { x: 10, y: 0.9, z: -8, w: 1.8, h: 1.8, d: 1.8, kind: "box" },
];

export const MAP_BOXES: BoxDef[] = [
  ...borders,
  ...plaza,
  ...warehouse,
  ...corridor,
  ...field,
  ...compound,
  ...scatter,
];

/** Limite jogável no plano XZ (com margem para o raio do corpo). */
export const PLAY_BOUND = HALF - 1.5;

/** Caixa rotacionada no yaw (mapa GLB / editor). */
export interface ObbDef extends BoxDef {
  yaw: number;
}

/** Rampa: sobe ao longo de `yaw` de yMin até yMax. */
export interface RampDef {
  x: number;
  z: number;
  yMin: number;
  yMax: number;
  width: number;
  length: number;
  yaw: number;
  solid?: boolean;
}

export interface SpawnPoint {
  x: number;
  z: number;
  /** Altura dos pés (0 = chão). Mesmo eixo Y da física do jogador. */
  y?: number;
}

/** Elevação dos pés no spawn (0–40). Mapas antigos sem `y` ficam no chão. */
export function spawnFeetY(s: Pick<SpawnPoint, "y">): number {
  const y = s.y;
  if (typeof y !== "number" || !Number.isFinite(y)) return 0;
  if (y < 0) return 0;
  if (y > 40) return 40;
  return y;
}

/** Geometria de colisão de um mapa (caixas + OBB + rampas). */
export interface MapGeometry {
  id: string;
  boxes: BoxDef[];
  obbs: ObbDef[];
  ramps: RampDef[];
  playMinX: number;
  playMaxX: number;
  playMinZ: number;
  playMaxZ: number;
  mapSizeX: number;
  mapSizeZ: number;
  mapSize: number;
  /** Spawns do Free-for-All. */
  spawns: SpawnPoint[];
  /** Spawns da Equipe Alfa (Mata-Mata em equipe). */
  spawnsAlpha: SpawnPoint[];
  /** Spawns da Equipe Echo (Mata-Mata em equipe). */
  spawnsEcho: SpawnPoint[];
  groundColor?: string;
  groundTexture?: string;
}

/** Praça hardcoded — usada como mapa padrão e como template no editor. */
export function buildPracaGeometry(): MapGeometry {
  return {
    id: "praca",
    boxes: MAP_BOXES,
    obbs: [],
    ramps: [],
    playMinX: -PLAY_BOUND,
    playMaxX: PLAY_BOUND,
    playMinZ: -PLAY_BOUND,
    playMaxZ: PLAY_BOUND,
    mapSizeX: MAP_SIZE,
    mapSizeZ: MAP_SIZE,
    mapSize: MAP_SIZE,
    spawns: [],
    spawnsAlpha: [],
    spawnsEcho: [],
  };
}
