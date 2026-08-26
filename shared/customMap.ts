import {
  MAP_BOXES,
  MAP_SIZE,
  WALL_HEIGHT,
  buildPracaGeometry,
  boxCollisionSize,
  spawnFeetY,
  type BoxDef,
  type MapGeometry,
  type SpawnPoint,
} from "./mapData";
import { SPAWN_POINTS, SPAWN_POINTS_ALPHA, SPAWN_POINTS_ECHO } from "./spawnPoints";
import { GAME_TEXTURES, isGameTextureId, textureUrlById } from "./textures";

export const CUSTOM_MAP_PREFIX = "custom:";
export const MAP_SIZE_OPTIONS = [40, 60, 80, 100, 120] as const;
export type MapSizeOption = (typeof MAP_SIZE_OPTIONS)[number];
export const MIN_MAP_AXIS = 20;
export const MAX_MAP_AXIS = 200;

export const MAX_MAP_PIECES = 250;
export const MAX_SPAWNS = 24;
export const MIN_SPAWNS = 1;
/** Teto do catálogo global no Postgres. */
export const MAX_CUSTOM_MAPS = 80;

export type EditorPieceKind = "wall" | "box" | "pillar" | "platform" | "stair";

/** `default` / `none` ou qualquer id de `GAME_TEXTURES` (mapa ou armamento). */
export type MapTextureId = "default" | "none" | string;

export const MAP_TEXTURES: ReadonlyArray<{
  id: MapTextureId;
  label: string;
  url: string | null;
}> = [
  { id: "default", label: "Padrão da peça", url: null },
  { id: "none", label: "Só cor", url: null },
  ...GAME_TEXTURES.map((t) => ({ id: t.id, label: t.label, url: t.url })),
];

const TEXTURE_IDS = new Set<string>(["default", "none", ...GAME_TEXTURES.map((t) => t.id)]);

export const KIND_DEFAULT_TEXTURE: Record<EditorPieceKind | "border", MapTextureId> = {
  wall: "wall",
  box: "crate",
  pillar: "post",
  platform: "floor",
  stair: "floor",
  border: "bg_wall",
};

export const KIND_DEFAULT_HEX: Record<
  EditorPieceKind | "border" | "ground" | "spawn" | "spawnAlpha" | "spawnEcho",
  string
> = {
  wall: "#525f75",
  box: "#b06a35",
  pillar: "#9ea3b2",
  platform: "#598c66",
  stair: "#9e9480",
  border: "#383d47",
  ground: "#cfd2d8",
  spawn: "#40d96b",
  spawnAlpha: "#4d8dff",
  spawnEcho: "#e05545",
};

export function textureUrlFor(
  kind: EditorPieceKind | BoxDef["kind"] | "ground",
  texture?: string
): string | null {
  if (texture === "none") return null;
  if (texture && texture !== "default" && isGameTextureId(texture)) {
    return textureUrlById(texture);
  }
  if (kind === "building") return null;
  if (kind === "ground") return textureUrlById("floor");
  const fallback =
    KIND_DEFAULT_TEXTURE[kind === "border" ? "border" : (kind as EditorPieceKind)] ?? "wall";
  return textureUrlById(fallback);
}

export interface MapSurfaceLook {
  color: string;
  texture: MapTextureId;
}

export function resolveGroundLook(def: CustomMapDef): MapSurfaceLook {
  return {
    color: def.groundColor ?? "#cfd2d8",
    texture: def.groundTexture ?? "floor",
  };
}

export function resolveBorderLook(def: CustomMapDef): MapSurfaceLook {
  return {
    color: def.borderColor ?? KIND_DEFAULT_HEX.border,
    texture: def.borderTexture ?? "bg_wall",
  };
}

/** `#rrggbb` (opaco) ou `#rrggbbaa`. */
export function parseHexColor(
  hex: string
): { r: number; g: number; b: number; a: number } | null {
  const s = hex.trim();
  const m8 = /^#?([0-9a-f]{8})$/i.exec(s);
  const m6 = m8 ? null : /^#?([0-9a-f]{6})$/i.exec(s);
  const body = m8?.[1] ?? m6?.[1];
  if (!body) return null;
  const v = parseInt(body.slice(0, 6), 16);
  return {
    r: ((v >> 16) & 255) / 255,
    g: ((v >> 8) & 255) / 255,
    b: (v & 255) / 255,
    a: body.length === 8 ? parseInt(body.slice(6, 8), 16) / 255 : 1,
  };
}

function toHex2(n: number): string {
  return Math.round(Math.max(0, Math.min(1, n)) * 255)
    .toString(16)
    .padStart(2, "0");
}

/** RGB para `<input type="color">` (`#rrggbb`). */
export function hexColorRgb(hex: string): string {
  const p = parseHexColor(hex);
  if (!p) return "#ffffff";
  return `#${toHex2(p.r)}${toHex2(p.g)}${toHex2(p.b)}`;
}

export function hexColorAlpha(hex: string): number {
  return parseHexColor(hex)?.a ?? 1;
}

/** Opaco → `#rrggbb`; com alpha → `#rrggbbaa`. */
export function composeHexColor(rgb: string, alpha: number): string {
  const p = parseHexColor(rgb);
  const rgbPart = `#${toHex2(p?.r ?? 1)}${toHex2(p?.g ?? 1)}${toHex2(p?.b ?? 1)}`;
  const a = Math.max(0, Math.min(1, alpha));
  if (a >= 254.5 / 255) return rgbPart;
  return `${rgbPart}${toHex2(a)}`;
}

export function sanitizeHexColor(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const p = parseHexColor(v);
  if (!p) return undefined;
  return composeHexColor(hexColorRgb(`#${toHex2(p.r)}${toHex2(p.g)}${toHex2(p.b)}`), p.a);
}

export function sanitizeTextureId(v: unknown): MapTextureId {
  return typeof v === "string" && TEXTURE_IDS.has(v) ? v : "default";
}

export const MIN_PIECE_ELEV = 0;
export const MAX_PIECE_ELEV = 40;

export interface EditorPiece {
  id: string;
  kind: EditorPieceKind;
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
  /** Altura da base acima do chão (0 = apoiado no chão). */
  elev: number;
  /** 0 / 45 / … / 315 — visual gira; colisão usa o AABB envelopado. */
  yawDeg: number;
  color?: string;
  texture?: MapTextureId;
}

export interface CustomMapDef {
  id: string;
  name: string;
  /** Compat: max(sizeX, sizeZ). Mapas antigos só tinham este campo (quadrado). */
  size: number;
  /** Largura no eixo X. */
  sizeX: number;
  /** Profundidade no eixo Z. */
  sizeZ: number;
  pieces: EditorPiece[];
  /** Spawns do Free-for-All. */
  spawns: SpawnPoint[];
  /** Spawns da Equipe Alfa (Mata-Mata em equipe). */
  spawnsAlpha: SpawnPoint[];
  /** Spawns da Equipe Echo (Mata-Mata em equipe). */
  spawnsEcho: SpawnPoint[];
  /** Aparência do chão (opcional; padrão = pedra). */
  groundColor?: string;
  groundTexture?: MapTextureId;
  /** Aparência das paredes da borda (opcional; padrão = concreto escuro). */
  borderColor?: string;
  borderTexture?: MapTextureId;
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

export function clampMapAxis(n: number): number {
  if (!Number.isFinite(n)) return MAP_SIZE;
  return Math.round(clamp(n, MIN_MAP_AXIS, MAX_MAP_AXIS));
}

export function clampElev(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return clamp(n, MIN_PIECE_ELEV, MAX_PIECE_ELEV);
}

/** Centro Y do AABB a partir da elevação da base. */
export function centerYFromElev(h: number, elev: number): number {
  return clampElev(elev) + Math.max(0.2, h) / 2;
}

export function pieceElev(p: Pick<EditorPiece, "kind" | "y" | "h" | "elev">): number {
  if (typeof p.elev === "number" && Number.isFinite(p.elev)) return clampElev(p.elev);
  return inferElevFromY(p.kind, p.h, p.y);
}

function inferElevFromY(kind: EditorPieceKind, h: number, y: number): number {
  if (kind === "stair" && Math.abs(y - h) < 0.051) return 0;
  return clampElev(y - h / 2);
}

export function applyPieceElev(p: EditorPiece, elev: number): void {
  p.elev = clampElev(elev);
  p.y = centerYFromElev(p.h, p.elev);
}

export function mapAxes(def: Pick<CustomMapDef, "size" | "sizeX" | "sizeZ">): {
  sizeX: number;
  sizeZ: number;
} {
  return {
    sizeX: clampMapAxis(def.sizeX ?? def.size),
    sizeZ: clampMapAxis(def.sizeZ ?? def.size),
  };
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

export function yawTo45(deg: number): number {
  const wrapped = ((Math.round(deg / 45) * 45) % 360 + 360) % 360;
  return wrapped;
}

export function yawTo90(deg: number): number {
  const wrapped = ((Math.round(deg / 90) * 90) % 360 + 360) % 360;
  return wrapped;
}

/** Envelope AABB no plano XZ depois do yaw (45° inclusive). */
export function aabbAfterYaw(
  w: number,
  d: number,
  yawDeg: number
): { w: number; d: number } {
  return boxCollisionSize({ w, d, yaw: yawDeg });
}

export function defaultSpawnsForSize(sizeX: number, sizeZ: number = sizeX): SpawnPoint[] {
  const insetX = sizeX / 2 - 6;
  const insetZ = sizeZ / 2 - 6;
  return [
    { x: 0, z: -insetZ },
    { x: insetX, z: 0 },
    { x: 0, z: insetZ },
    { x: -insetX, z: 0 },
  ];
}

/** Spawns TDM padrão: Alfa no norte (+Z), Echo no sul (−Z). */
export function defaultTeamSpawnsForSize(
  sizeX: number,
  sizeZ: number = sizeX
): {
  alpha: SpawnPoint[];
  echo: SpawnPoint[];
} {
  const insetX = Math.min(6, sizeX / 2 - 4);
  const insetZ = sizeZ / 2 - 6;
  return {
    alpha: [
      { x: -insetX, z: insetZ },
      { x: insetX, z: insetZ },
    ],
    echo: [
      { x: -insetX, z: -insetZ },
      { x: insetX, z: -insetZ },
    ],
  };
}

export function makeEmptyMap(name: string, sizeX: number, sizeZ: number = sizeX): CustomMapDef {
  const x = clampMapAxis(sizeX);
  const z = clampMapAxis(sizeZ);
  return {
    id: newCustomMapId(),
    name: name.trim().slice(0, 32) || "Mapa novo",
    size: Math.max(x, z),
    sizeX: x,
    sizeZ: z,
    pieces: [],
    spawns: defaultSpawnsForSize(x, z),
    spawnsAlpha: [],
    spawnsEcho: [],
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
      elev: clampElev(b.y - b.h / 2),
      yawDeg: 0,
    });
  }
  return {
    id: newCustomMapId(),
    name: "Cópia da Praça",
    size: MAP_SIZE,
    sizeX: MAP_SIZE,
    sizeZ: MAP_SIZE,
    pieces,
    spawns: SPAWN_POINTS.map((s) => ({ x: s.x, z: s.z })),
    spawnsAlpha: SPAWN_POINTS_ALPHA.map((s) => ({ x: s.x, z: s.z })),
    spawnsEcho: SPAWN_POINTS_ECHO.map((s) => ({ x: s.x, z: s.z })),
    updatedAt: Date.now(),
  };
}

export function borderBoxes(
  sizeX: number,
  sizeZ: number = sizeX,
  look?: Pick<BoxDef, "color" | "texture">
): BoxDef[] {
  const halfX = sizeX / 2;
  const halfZ = sizeZ / 2;
  const t = 1;
  const h = WALL_HEIGHT;
  const extra: Pick<BoxDef, "color" | "texture"> = {};
  if (look?.color) extra.color = look.color;
  if (look?.texture && look.texture !== "default") extra.texture = look.texture;
  return [
    { x: 0, y: h / 2, z: halfZ, w: sizeX, h, d: t, kind: "border", ...extra },
    { x: 0, y: h / 2, z: -halfZ, w: sizeX, h, d: t, kind: "border", ...extra },
    { x: halfX, y: h / 2, z: 0, w: t, h, d: sizeZ, kind: "border", ...extra },
    { x: -halfX, y: h / 2, z: 0, w: t, h, d: sizeZ, kind: "border", ...extra },
  ];
}

export function stairToBoxes(p: EditorPiece): BoxDef[] {
  const rise = Math.max(0.5, p.h);
  const stepH = 0.5;
  const steps = Math.max(2, Math.round(rise / stepH));
  const actualStep = rise / steps;
  const length = Math.max(1, p.d);
  const width = Math.max(0.8, p.w);
  const elev = pieceElev(p);
  const yaw = yawTo45(p.yawDeg);
  const rad = (yaw * Math.PI) / 180;
  const alongX = Math.sin(rad);
  const alongZ = Math.cos(rad);
  const stepLen = length / steps;
  const boxes: BoxDef[] = [];
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) / steps - 0.5;
    const along = t * length;
    const h = (i + 1) * actualStep;
    boxes.push({
      x: p.x + alongX * along,
      y: elev + h / 2,
      z: p.z + alongZ * along,
      w: width,
      h,
      d: stepLen,
      yaw,
      kind: "platform",
      ...lookFromPiece(p),
    });
  }
  return boxes;
}

function lookFromPiece(p: EditorPiece): Pick<BoxDef, "color" | "texture"> {
  const look: Pick<BoxDef, "color" | "texture"> = {};
  if (p.color) look.color = p.color;
  if (p.texture && p.texture !== "default") look.texture = p.texture;
  return look;
}

function pieceToBoxes(p: EditorPiece): BoxDef[] {
  if (p.kind === "stair") return stairToBoxes(p);
  const yaw = yawTo45(p.yawDeg);
  return [
    {
      x: p.x,
      y: p.y,
      z: p.z,
      w: p.w,
      h: p.h,
      d: p.d,
      yaw,
      kind: p.kind,
      ...lookFromPiece(p),
    },
  ];
}

export function customMapToBoxes(def: CustomMapDef): BoxDef[] {
  const { sizeX, sizeZ } = mapAxes(def);
  const border = resolveBorderLook(def);
  const boxes = borderBoxes(sizeX, sizeZ, {
    color: border.color,
    texture: border.texture,
  });
  for (const p of def.pieces) boxes.push(...pieceToBoxes(p));
  return boxes;
}

export function customMapToGeometry(def: CustomMapDef): MapGeometry {
  const boxes = customMapToBoxes(def);
  const { sizeX, sizeZ } = mapAxes(def);
  const playX = sizeX / 2 - 1.5;
  const playZ = sizeZ / 2 - 1.5;
  const spawns =
    def.spawns.length > 0 ? def.spawns : defaultSpawnsForSize(sizeX, sizeZ);
  const teamFallback = defaultTeamSpawnsForSize(sizeX, sizeZ);
  const spawnsAlpha =
    def.spawnsAlpha.length > 0 ? def.spawnsAlpha : teamFallback.alpha;
  const spawnsEcho =
    def.spawnsEcho.length > 0 ? def.spawnsEcho : teamFallback.echo;
  return {
    id: def.id,
    boxes,
    obbs: [],
    ramps: [],
    playMinX: -playX,
    playMaxX: playX,
    playMinZ: -playZ,
    playMaxZ: playZ,
    mapSizeX: sizeX,
    mapSizeZ: sizeZ,
    mapSize: Math.max(sizeX, sizeZ),
    spawns: spawns.map(copySpawnPoint),
    spawnsAlpha: spawnsAlpha.map(copySpawnPoint),
    spawnsEcho: spawnsEcho.map(copySpawnPoint),
    groundColor: resolveGroundLook(def).color,
    groundTexture: resolveGroundLook(def).texture,
  };
}

function sanitizePiece(raw: unknown): EditorPiece | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const kind = o.kind;
  if (typeof kind !== "string" || !KINDS.has(kind as EditorPieceKind)) return null;
  const preset = PIECE_PRESETS[kind as EditorPieceKind];
  const id = typeof o.id === "string" && o.id.length > 0 ? o.id.slice(0, 24) : newPieceId();
  const h = num(o.h, preset.h, 0.2, 20);
  const yRaw = num(o.y, preset.h / 2, 0.05, 80);
  const elev =
    o.elev !== undefined
      ? num(o.elev, 0, MIN_PIECE_ELEV, MAX_PIECE_ELEV)
      : inferElevFromY(kind as EditorPieceKind, h, yRaw);
  return {
    id,
    kind: kind as EditorPieceKind,
    x: num(o.x, 0, -200, 200),
    y: centerYFromElev(h, elev),
    z: num(o.z, 0, -200, 200),
    w: num(o.w, preset.w, 0.4, 80),
    h,
    d: num(o.d, preset.d, 0.4, 80),
    elev,
    yawDeg: yawTo45(num(o.yawDeg, 0, 0, 360)),
    color: sanitizeHexColor(o.color),
    texture: sanitizeTextureId(o.texture),
  };
}

function copySpawnPoint(s: SpawnPoint): SpawnPoint {
  const y = spawnFeetY(s);
  return y > 0 ? { x: s.x, z: s.z, y } : { x: s.x, z: s.z };
}

function sanitizeSpawn(raw: unknown, sizeX: number, sizeZ: number): SpawnPoint | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const boundX = sizeX / 2 - 2;
  const boundZ = sizeZ / 2 - 2;
  const yRaw = o.y !== undefined ? o.y : o.elev;
  const y = spawnFeetY({ y: num(yRaw, 0, MIN_PIECE_ELEV, MAX_PIECE_ELEV) });
  return {
    x: num(o.x, 0, -boundX, boundX),
    z: num(o.z, 0, -boundZ, boundZ),
    ...(y > 0 ? { y } : {}),
  };
}

/** Aceita JSON desconhecido (sala / localStorage) e devolve um mapa válido ou null. */
export function sanitizeCustomMap(raw: unknown): CustomMapDef | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const sizeX = clampMapAxis(num(o.sizeX ?? o.size, MAP_SIZE, MIN_MAP_AXIS, MAX_MAP_AXIS));
  const sizeZ = clampMapAxis(num(o.sizeZ ?? o.size, MAP_SIZE, MIN_MAP_AXIS, MAX_MAP_AXIS));
  const size = Math.max(sizeX, sizeZ);
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
  const spawns = sanitizeSpawnList(o.spawns, sizeX, sizeZ);
  if (spawns.length < MIN_SPAWNS) {
    spawns.push(...defaultSpawnsForSize(sizeX, sizeZ));
  }
  return {
    id,
    name,
    size,
    sizeX,
    sizeZ,
    pieces,
    spawns: spawns.slice(0, MAX_SPAWNS),
    spawnsAlpha: sanitizeSpawnList(o.spawnsAlpha, sizeX, sizeZ),
    spawnsEcho: sanitizeSpawnList(o.spawnsEcho, sizeX, sizeZ),
    groundColor: sanitizeHexColor(o.groundColor),
    groundTexture:
      o.groundTexture !== undefined ? sanitizeTextureId(o.groundTexture) : undefined,
    borderColor: sanitizeHexColor(o.borderColor),
    borderTexture:
      o.borderTexture !== undefined ? sanitizeTextureId(o.borderTexture) : undefined,
    updatedAt: num(o.updatedAt, Date.now(), 0, Date.now() + 1e12),
  };
}

function sanitizeSpawnList(raw: unknown, sizeX: number, sizeZ: number): SpawnPoint[] {
  const src = Array.isArray(raw) ? raw : [];
  const out: SpawnPoint[] = [];
  for (const s of src) {
    const sp = sanitizeSpawn(s, sizeX, sizeZ);
    if (sp) out.push(sp);
    if (out.length >= MAX_SPAWNS) break;
  }
  return out;
}

export function cloneCustomMap(def: CustomMapDef): CustomMapDef {
  const { sizeX, sizeZ } = mapAxes(def);
  return {
    id: def.id,
    name: def.name,
    size: Math.max(sizeX, sizeZ),
    sizeX,
    sizeZ,
    pieces: def.pieces.map((p) => ({ ...p })),
    spawns: def.spawns.map((s) => ({ ...s })),
    spawnsAlpha: (def.spawnsAlpha ?? []).map((s) => ({ ...s })),
    spawnsEcho: (def.spawnsEcho ?? []).map((s) => ({ ...s })),
    groundColor: def.groundColor,
    groundTexture: def.groundTexture,
    borderColor: def.borderColor,
    borderTexture: def.borderTexture,
    updatedAt: def.updatedAt,
  };
}

/** Nova entrada com id próprio; o nome fica "Cópia de …". */
export function duplicateCustomMap(def: CustomMapDef): CustomMapDef {
  const copy = cloneCustomMap(def);
  const base = def.name.trim() || "Mapa";
  copy.id = newCustomMapId();
  copy.name = `Cópia de ${base}`.slice(0, 32);
  copy.updatedAt = Date.now();
  return copy;
}

export function geometryPlayBound(geo: MapGeometry): number {
  return Math.min(-geo.playMinX, geo.playMaxX, -geo.playMinZ, geo.playMaxZ);
}

export function defaultPracaGeometry(): MapGeometry {
  const geo = buildPracaGeometry();
  geo.spawns = SPAWN_POINTS.map((s) => ({ x: s.x, z: s.z }));
  geo.spawnsAlpha = SPAWN_POINTS_ALPHA.map((s) => ({ x: s.x, z: s.z }));
  geo.spawnsEcho = SPAWN_POINTS_ECHO.map((s) => ({ x: s.x, z: s.z }));
  return geo;
}
