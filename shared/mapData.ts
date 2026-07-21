/**
 * Geometria do mapa como dados — fonte única usada pelo cliente (render +
 * colisão Babylon) e pelo servidor (física, hitscan e LOS dos bots).
 * Todas as caixas são AABBs: centro (x, y, z) + dimensões completas (w, h, d).
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
  kind: "wall" | "building" | "box" | "platform" | "pillar";
}

export const MAP_SIZE = 80;
export const WALL_HEIGHT = 6;
const HALF = MAP_SIZE / 2;
const T = 1; // espessura de parede

// --- Paredes de borda ---
const borders: BoxDef[] = [
  { x: 0, y: WALL_HEIGHT / 2, z: HALF, w: MAP_SIZE, h: WALL_HEIGHT, d: T, kind: "wall" },
  { x: 0, y: WALL_HEIGHT / 2, z: -HALF, w: MAP_SIZE, h: WALL_HEIGHT, d: T, kind: "wall" },
  { x: HALF, y: WALL_HEIGHT / 2, z: 0, w: T, h: WALL_HEIGHT, d: MAP_SIZE, kind: "wall" },
  { x: -HALF, y: WALL_HEIGHT / 2, z: 0, w: T, h: WALL_HEIGHT, d: MAP_SIZE, kind: "wall" },
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
  { x: -14, y: 1.75, z: 0, w: 1, h: 3.5, d: 10, kind: "building" },
  { x: 14, y: 1.75, z: 0, w: 1, h: 3.5, d: 10, kind: "building" },
];

// --- Noroeste: armazém (paredes sem teto, entradas ao sul e leste) ---
const warehouse: BoxDef[] = [
  { x: -24, y: 1.75, z: 30, w: 16, h: 3.5, d: 1, kind: "building" },
  { x: -32, y: 1.75, z: 24, w: 1, h: 3.5, d: 13, kind: "building" },
  { x: -27, y: 1.75, z: 17, w: 9, h: 3.5, d: 1, kind: "building" },
  { x: -16, y: 1.75, z: 26, w: 1, h: 3.5, d: 9, kind: "building" },
  { x: -27, y: 1, z: 25, w: 2, h: 2, d: 2, kind: "box" },
  { x: -20, y: 0.75, z: 21, w: 1.5, h: 1.5, d: 1.5, kind: "box" },
];

// --- Nordeste: corredor fechado (zona de escopeta) + caixas de apoio ---
const corridor: BoxDef[] = [
  { x: 24, y: 1.75, z: 28, w: 20, h: 3.5, d: 1, kind: "building" },
  { x: 24, y: 1.75, z: 21, w: 20, h: 3.5, d: 1, kind: "building" },
  { x: 24, y: 0.6, z: 24.5, w: 1.2, h: 1.2, d: 1.2, kind: "box" },
  { x: 18, y: 1.25, z: 12, w: 2.5, h: 2.5, d: 2.5, kind: "box" },
  { x: 28, y: 1, z: 10, w: 2, h: 2, d: 2, kind: "box" },
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
  { x: 22, y: 1.75, z: -20, w: 12, h: 3.5, d: 1, kind: "building" },
  { x: 28, y: 1.75, z: -26, w: 1, h: 3.5, d: 13, kind: "building" },
  { x: 20, y: 1, z: -26, w: 2, h: 2, d: 2, kind: "box" },
  { x: 24.5, y: 0.75, z: -23, w: 1.5, h: 1.5, d: 1.5, kind: "box" },
  { x: 12, y: 2, z: -14, w: 2, h: 4, d: 2, kind: "pillar" },
];

// --- Coberturas soltas nas rotas norte/sul e diagonais ---
const scatter: BoxDef[] = [
  { x: 0, y: 1, z: 20, w: 2, h: 2, d: 2, kind: "box" },
  { x: 0, y: 1, z: -20, w: 2, h: 2, d: 2, kind: "box" },
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
