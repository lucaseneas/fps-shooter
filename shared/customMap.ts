import {
  MAP_BOXES,
  MAP_SIZE,
  WALL_HEIGHT,
  buildPracaGeometry,
  type BoxDef,
  type MapGeometry,
  type SpawnPoint,
} from "./mapData";
import { SPAWN_POINTS } from "./spawnPoints";

export const CUSTOM_MAP_PREFIX = "custom:";
export const MAP_SIZE_OPTIONS = [40, 60, 80, 100, 120] as const;
export type MapSizeOption = (typeof MAP_SIZE_OPTIONS)[number];

export const MAX_MAP_PIECES = 250;
export const MAX_SPAWNS = 24;
export const MIN_SPAWNS = 1;

export type EditorPieceKind = "wall" | "box" | "pillar" | "platform" | "stair";

export interface EditorPiece {
  id: string;
  kind: EditorPieceKind;
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
  /** 0 / 90 / 180 / 270 — só muda o AABB em múltiplos de 90°. */
  yawDeg: number;
}

export interface CustomMapDef {
  id: string;
  name: string;
  size: number;
  pieces: EditorPiece[];
  spawns: SpawnPoint[];
  updatedAt: number;
}

export interface PiecePreset {
  kind: EditorPieceKind;
  label: string;
  w: number;
  h: number;
  d: number;
}

export const PIECE_PRESETS: Record<EditorPieceKind, PiecePreset> = {
  wall: { kind: "wall", label: "Parede", w: 8, h: 3.5, d: 1 },
  box: { kind: "box", label: "Caixa", w: 1.5, h: 1.5, d: 1.5 },
  pillar: { kind: "pillar", label: "Pilar", w: 2, h: 4, d: 2 },
  platform: { kind: "platform", label: "Plataforma", w: 8, h: 1, d: 8 },
  stair: { kind: "stair", label: "Escada", w: 4, h: 2, d: 6 },
};

const KINDS = new Set<EditorPieceKind>([
  "wall",
  "box",
  "pillar",
  "platform",
  "stair",
]);

export function isCustomMapId(id: string): boolean {
  return id.startsWith(CUSTOM_MAP_PREFIX);
}

export function newCustomMapId(): string {
  return `${CUSTOM_MAP_PREFIX}${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

export function newPieceId(): string {
  return `p_${Math.random().toString(36).slice(2, 10)}`;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function num(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return clamp(n, min, max);
}

export function snapTo(value: number, grid: number): number {
  if (grid <= 0) return value;
  return Math.round(value / grid) * grid;
}

export function yawTo90(deg: number): number {
  const wrapped = ((Math.round(deg / 90) * 90) % 360 + 360) % 360;
  return wrapped;
}

/** Dimensões AABB depois da rotação de 90° (troca largura/profundidade). */
export function aabbAfterYaw(
  w: number,
  d: number,
  yawDeg: number
): { w: number; d: number } {
  return yawTo90(yawDeg) % 180 === 90 ? { w: d, d: w } : { w, d };
}

export function defaultSpawnsForSize(size: number): SpawnPoint[] {
  const inset = size / 2 - 6;
  return [
    { x: 0, z: -inset },
    { x: inset, z: 0 },
    { x: 0, z: inset },
    { x: -inset, z: 0 },
  ];
}

export function makeEmptyMap(name: string, size: number): CustomMapDef {
  const safeSize = MAP_SIZE_OPTIONS.includes(size as MapSizeOption)
    ? size
    : MAP_SIZE;
  return {
    id: newCustomMapId(),
    name: name.trim().slice(0, 32) || "Mapa novo",
    size: safeSize,
    pieces: [],
    spawns: defaultSpawnsForSize(safeSize),
    updatedAt: Date.now(),
  };
}

function boxKindToPiece(kind: BoxDef["kind"]): EditorPieceKind {
  if (kind === "wall" || kind === "box" || kind === "pillar" || kind === "platform") {
    return kind;
  }
  return "wall";
}

export function pracaToCustomMap(): CustomMapDef {
  const pieces: EditorPiece[] = [];
  for (const b of MAP_BOXES) {
    if (b.kind === "border") continue;
    pieces.push({
      id: newPieceId(),
      kind: boxKindToPiece(b.kind),
      x: b.x,
      y: b.y,
      z: b.z,
      w: b.w,
      h: b.h,
      d: b.d,
      yawDeg: 0,
    });
  }
  return {
    id: newCustomMapId(),
    name: "Cópia da Praça",
    size: MAP_SIZE,
    pieces,
    spawns: SPAWN_POINTS.map((s) => ({ x: s.x, z: s.z })),
    updatedAt: Date.now(),
  };
}

export function borderBoxes(size: number): BoxDef[] {
  const half = size / 2;
  const t = 1;
  const h = WALL_HEIGHT;
  return [
    { x: 0, y: h / 2, z: half, w: size, h, d: t, kind: "border" },
    { x: 0, y: h / 2, z: -half, w: size, h, d: t, kind: "border" },
    { x: half, y: h / 2, z: 0, w: t, h, d: size, kind: "border" },
    { x: -half, y: h / 2, z: 0, w: t, h, d: size, kind: "border" },
  ];
}

export function stairToBoxes(p: EditorPiece): BoxDef[] {
  const rise = Math.max(0.5, p.h);
  const stepH = 0.5;
  const steps = Math.max(2, Math.round(rise / stepH));
  const actualStep = rise / steps;
  const length = Math.max(1, p.d);
  const width = Math.max(0.8, p.w);
  const yaw = yawTo90(p.yawDeg);
  const alongX = yaw === 90 ? 1 : yaw === 270 ? -1 : 0;
  const alongZ = yaw === 0 ? 1 : yaw === 180 ? -1 : 0;
  const stepLen = length / steps;
  const boxes: BoxDef[] = [];
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) / steps - 0.5;
    const along = t * length;
    const h = (i + 1) * actualStep;
    const swapped = yaw === 90 || yaw === 270;
    boxes.push({
      x: p.x + alongX * along,
      y: h / 2,
      z: p.z + alongZ * along,
      w: swapped ? stepLen : width,
      h,
      d: swapped ? width : stepLen,
      kind: "platform",
    });
  }
  return boxes;
}

function pieceToBoxes(p: EditorPiece): BoxDef[] {
  if (p.kind === "stair") return stairToBoxes(p);
  const dim = aabbAfterYaw(p.w, p.d, p.yawDeg);
  return [
    {
      x: p.x,
      y: p.y,
      z: p.z,
      w: dim.w,
      h: p.h,
      d: dim.d,
      kind: p.kind,
    },
  ];
}

export function customMapToBoxes(def: CustomMapDef): BoxDef[] {
  const boxes = borderBoxes(def.size);
  for (const p of def.pieces) boxes.push(...pieceToBoxes(p));
  return boxes;
}

export function customMapToGeometry(def: CustomMapDef): MapGeometry {
  const boxes = customMapToBoxes(def);
  const half = def.size / 2;
  const play = half - 1.5;
  const spawns =
    def.spawns.length > 0 ? def.spawns : defaultSpawnsForSize(def.size);
  return {
    id: def.id,
    boxes,
    obbs: [],
    ramps: [],
    playMinX: -play,
    playMaxX: play,
    playMinZ: -play,
    playMaxZ: play,
    mapSizeX: def.size,
    mapSizeZ: def.size,
    mapSize: def.size,
    spawns: spawns.map((s) => ({ x: s.x, z: s.z })),
  };
}

function sanitizePiece(raw: unknown): EditorPiece | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const kind = o.kind;
  if (typeof kind !== "string" || !KINDS.has(kind as EditorPieceKind)) return null;
  const preset = PIECE_PRESETS[kind as EditorPieceKind];
  const id = typeof o.id === "string" && o.id.length > 0 ? o.id.slice(0, 24) : newPieceId();
  return {
    id,
    kind: kind as EditorPieceKind,
    x: num(o.x, 0, -200, 200),
    y: num(o.y, preset.h / 2, 0.05, 40),
    z: num(o.z, 0, -200, 200),
    w: num(o.w, preset.w, 0.4, 80),
    h: num(o.h, preset.h, 0.2, 20),
    d: num(o.d, preset.d, 0.4, 80),
    yawDeg: yawTo90(num(o.yawDeg, 0, 0, 360)),
  };
}

function sanitizeSpawn(raw: unknown, size: number): SpawnPoint | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const bound = size / 2 - 2;
  return {
    x: num(o.x, 0, -bound, bound),
    z: num(o.z, 0, -bound, bound),
  };
}

/** Aceita JSON desconhecido (sala / localStorage) e devolve um mapa válido ou null. */
export function sanitizeCustomMap(raw: unknown): CustomMapDef | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const sizeRaw = num(o.size, MAP_SIZE, 20, 200);
  const size = (MAP_SIZE_OPTIONS as readonly number[]).includes(sizeRaw)
    ? sizeRaw
    : MAP_SIZE_OPTIONS.reduce((best, n) =>
        Math.abs(n - sizeRaw) < Math.abs(best - sizeRaw) ? n : best
      );
  const id =
    typeof o.id === "string" && isCustomMapId(o.id)
      ? o.id.slice(0, 48)
      : newCustomMapId();
  const name =
    typeof o.name === "string" && o.name.trim().length > 0
      ? o.name.trim().slice(0, 32)
      : "Mapa";
  const piecesIn = Array.isArray(o.pieces) ? o.pieces : [];
  const pieces: EditorPiece[] = [];
  for (const p of piecesIn) {
    const s = sanitizePiece(p);
    if (s) pieces.push(s);
    if (pieces.length >= MAX_MAP_PIECES) break;
  }
  const spawnsIn = Array.isArray(o.spawns) ? o.spawns : [];
  const spawns: SpawnPoint[] = [];
  for (const s of spawnsIn) {
    const sp = sanitizeSpawn(s, size);
    if (sp) spawns.push(sp);
    if (spawns.length >= MAX_SPAWNS) break;
  }
  if (spawns.length < MIN_SPAWNS) {
    spawns.push(...defaultSpawnsForSize(size));
  }
  return {
    id,
    name,
    size,
    pieces,
    spawns: spawns.slice(0, MAX_SPAWNS),
    updatedAt: num(o.updatedAt, Date.now(), 0, Date.now() + 1e12),
  };
}

export function cloneCustomMap(def: CustomMapDef): CustomMapDef {
  return {
    id: def.id,
    name: def.name,
    size: def.size,
    pieces: def.pieces.map((p) => ({ ...p })),
    spawns: def.spawns.map((s) => ({ ...s })),
    updatedAt: def.updatedAt,
  };
}

export function geometryPlayBound(geo: MapGeometry): number {
  return Math.min(-geo.playMinX, geo.playMaxX, -geo.playMinZ, geo.playMaxZ);
}

export function defaultPracaGeometry(): MapGeometry {
  const geo = buildPracaGeometry();
  geo.spawns = SPAWN_POINTS.map((s) => ({ x: s.x, z: s.z }));
  return geo;
}
