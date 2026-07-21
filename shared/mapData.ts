/**
 * Geometria do mapa como dados — fonte única usada pelo cliente (render +
 * colisão Babylon) e pelo servidor (colisão AABB + linha de visão dos bots).
 * Todas as caixas são AABBs: centro (x, y, z) + dimensões completas (w, h, d).
 */
export interface BoxDef {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
  kind: "wall" | "box" | "platform";
}

export const MAP_SIZE = 80;
export const WALL_HEIGHT = 6;
const HALF = MAP_SIZE / 2;
const T = 1; // espessura da parede

const walls: BoxDef[] = [
  { x: 0, y: WALL_HEIGHT / 2, z: HALF, w: MAP_SIZE, h: WALL_HEIGHT, d: T, kind: "wall" },
  { x: 0, y: WALL_HEIGHT / 2, z: -HALF, w: MAP_SIZE, h: WALL_HEIGHT, d: T, kind: "wall" },
  { x: HALF, y: WALL_HEIGHT / 2, z: 0, w: T, h: WALL_HEIGHT, d: MAP_SIZE, kind: "wall" },
  { x: -HALF, y: WALL_HEIGHT / 2, z: 0, w: T, h: WALL_HEIGHT, d: MAP_SIZE, kind: "wall" },
];

// Caixas de cobertura (s = lado do cubo).
const covers = [
  { x: 8, z: 6, s: 3 },
  { x: -10, z: 4, s: 2 },
  { x: 4, z: -12, s: 4 },
  { x: -6, z: -8, s: 2.5 },
  { x: 14, z: -4, s: 3 },
  { x: -16, z: -14, s: 3.5 },
  { x: 0, z: 16, s: 2 },
  { x: 18, z: 14, s: 3 },
].map(
  (b): BoxDef => ({
    x: b.x,
    y: b.s / 2,
    z: b.z,
    w: b.s,
    h: b.s,
    d: b.s,
    kind: "box",
  })
);

const platforms: BoxDef[] = [
  { x: -2, y: 0.5, z: 10, w: 6, h: 1, d: 6, kind: "platform" },
  { x: -2, y: 0.25, z: 6, w: 6, h: 0.5, d: 2, kind: "platform" },
];

export const MAP_BOXES: BoxDef[] = [...walls, ...covers, ...platforms];

/** Limite jogável no plano XZ (com margem para o raio do corpo). */
export const PLAY_BOUND = HALF - 1.5;
