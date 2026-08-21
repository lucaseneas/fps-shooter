import {
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  STEP_HEIGHT,
} from "../shared/movement";
import type { MapCollision } from "../shared/mapRuntime";
import type { BoxDef } from "../shared/mapData";

/** Malha de navegação no plano XZ, com altura de piso por célula. */
export const NAV_CELL = 1.25;
/** Altura máxima que o bot consegue alcançar com um pulo (~1.28 m de física). */
export const JUMP_CLEARANCE = 1.15;

export interface NavPoint {
  x: number;
  z: number;
}

const cache = new WeakMap<MapCollision, BotNavGrid>();

export function getNavGrid(map: MapCollision): BotNavGrid {
  let g = cache.get(map);
  if (!g) {
    g = BotNavGrid.build(map);
    cache.set(map, g);
  }
  return g;
}

export class BotNavGrid {
  readonly cell: number;
  readonly originX: number;
  readonly originZ: number;
  readonly cols: number;
  readonly rows: number;
  private readonly walkable: Uint8Array;
  private readonly standY: Float32Array;

  private constructor(
    cell: number,
    originX: number,
    originZ: number,
    cols: number,
    rows: number,
    walkable: Uint8Array,
    standY: Float32Array
  ) {
    this.cell = cell;
    this.originX = originX;
    this.originZ = originZ;
    this.cols = cols;
    this.rows = rows;
    this.walkable = walkable;
    this.standY = standY;
  }

  static build(map: MapCollision): BotNavGrid {
    const cell = NAV_CELL;
    const bound = map.playBound;
    const originX = -bound;
    const originZ = -bound;
    const cols = Math.max(1, Math.ceil((bound * 2) / cell));
    const rows = cols;
    const n = cols * rows;
    const walkable = new Uint8Array(n);
    const standY = new Float32Array(n);

    for (let iz = 0; iz < rows; iz++) {
      for (let ix = 0; ix < cols; ix++) {
        const x = originX + (ix + 0.5) * cell;
        const z = originZ + (iz + 0.5) * cell;
        const i = iz * cols + ix;
        const feet = standHeight(x, z, map);
        standY[i] = feet;
        walkable[i] = capsuleBlocked(x, feet, z, map) ? 0 : 1;
      }
    }

    return new BotNavGrid(cell, originX, originZ, cols, rows, walkable, standY);
  }

  isWalkableWorld(x: number, z: number): boolean {
    const i = this.indexAt(x, z);
    return i >= 0 && this.walkable[i] === 1;
  }

  heightAt(x: number, z: number): number {
    const i = this.indexAt(x, z);
    return i >= 0 ? this.standY[i] : 0;
  }

  nearestWalkable(x: number, z: number): NavPoint | null {
    const start = this.indexAt(x, z);
    if (start >= 0 && this.walkable[start] === 1) {
      return { x, z };
    }

    const maxR = Math.max(this.cols, this.rows);
    const ix0 = this.clampIx(Math.floor((x - this.originX) / this.cell));
    const iz0 = this.clampIz(Math.floor((z - this.originZ) / this.cell));
    for (let r = 1; r < maxR; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
          const ix = ix0 + dx;
          const iz = iz0 + dz;
          if (ix < 0 || iz < 0 || ix >= this.cols || iz >= this.rows) continue;
          const i = iz * this.cols + ix;
          if (this.walkable[i] === 1) return this.worldOf(i);
        }
      }
    }
    return null;
  }

  findPath(sx: number, sz: number, gx: number, gz: number): NavPoint[] {
    const startPt = this.nearestWalkable(sx, sz);
    const goalPt = this.nearestWalkable(gx, gz);
    if (!startPt || !goalPt) return [];

    const start = this.indexAt(startPt.x, startPt.z);
    const goal = this.indexAt(goalPt.x, goalPt.z);
    if (start < 0 || goal < 0) return [];
    if (start === goal) return [{ x: gx, z: gz }];

    const n = this.cols * this.rows;
    const came = new Int32Array(n);
    came.fill(-1);
    const seen = new Uint8Array(n);
    const q = new Int32Array(n);
    let qh = 0;
    let qt = 0;
    q[qt++] = start;
    seen[start] = 1;

    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ];

    while (qh < qt) {
      const cur = q[qh++];
      if (cur === goal) break;
      const cx = cur % this.cols;
      const cz = (cur / this.cols) | 0;
      const cy = this.standY[cur];

      for (const [dx, dz] of dirs) {
        const nx = cx + dx;
        const nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= this.cols || nz >= this.rows) continue;
        const ni = nz * this.cols + nx;
        if (seen[ni] || this.walkable[ni] === 0) continue;
        if (dx !== 0 && dz !== 0) {
          const a = cz * this.cols + nx;
          const b = nz * this.cols + cx;
          if (this.walkable[a] === 0 || this.walkable[b] === 0) continue;
        }
        if (Math.abs(this.standY[ni] - cy) > JUMP_CLEARANCE + 0.05) continue;
        seen[ni] = 1;
        came[ni] = cur;
        q[qt++] = ni;
      }
    }

    if (came[goal] < 0 && start !== goal) return [];

    const rev: number[] = [];
    for (let i = goal; i >= 0; i = came[i]) {
      rev.push(i);
      if (i === start) break;
    }
    rev.reverse();

    const pts: NavPoint[] = rev.map((i) => this.worldOf(i));
    if (pts.length > 0) {
      pts[pts.length - 1] = { x: gx, z: gz };
    }
    return simplifyPath(pts, (x, z) => this.isWalkableWorld(x, z), this.cell);
  }

  private indexAt(x: number, z: number): number {
    const ix = Math.floor((x - this.originX) / this.cell);
    const iz = Math.floor((z - this.originZ) / this.cell);
    if (ix < 0 || iz < 0 || ix >= this.cols || iz >= this.rows) return -1;
    return iz * this.cols + ix;
  }

  private worldOf(i: number): NavPoint {
    const ix = i % this.cols;
    const iz = (i / this.cols) | 0;
    return {
      x: this.originX + (ix + 0.5) * this.cell,
      z: this.originZ + (iz + 0.5) * this.cell,
    };
  }

  private clampIx(v: number): number {
    return v < 0 ? 0 : v >= this.cols ? this.cols - 1 : v;
  }

  private clampIz(v: number): number {
    return v < 0 ? 0 : v >= this.rows ? this.rows - 1 : v;
  }
}

function standHeight(x: number, z: number, map: MapCollision): number {
  let y = 0;
  for (const b of map.boxes) {
    if (!containsXz(b, x, z, 0)) continue;
    const top = b.y + b.h / 2;
    if (top <= y || top > 4) continue;
    const standable =
      b.kind === "platform" || (b.h <= 1.25 && top <= 2.2);
    if (standable) y = top;
  }
  return y;
}

function capsuleBlocked(
  x: number,
  feet: number,
  z: number,
  map: MapCollision
): boolean {
  if (Math.abs(x) > map.playBound || Math.abs(z) > map.playBound) return true;
  const head = feet + PLAYER_HEIGHT * 0.92;
  const r = PLAYER_RADIUS * 0.82;
  for (const b of map.boxes) {
    const top = b.y + b.h / 2;
    const bottom = b.y - b.h / 2;
    if (top <= feet + STEP_HEIGHT) continue;
    if (bottom >= head) continue;
    if (containsXz(b, x, z, r)) return true;
  }
  return false;
}

function containsXz(b: BoxDef, x: number, z: number, extra: number): boolean {
  return (
    Math.abs(x - b.x) < b.w / 2 + extra && Math.abs(z - b.z) < b.d / 2 + extra
  );
}

/** Há um obstáculo à frente baixo o bastante para pular. */
export function shouldJumpObstacle(
  x: number,
  y: number,
  z: number,
  dirX: number,
  dirZ: number,
  map: MapCollision
): boolean {
  const len = Math.hypot(dirX, dirZ);
  if (len < 1e-4) return false;
  const nx = dirX / len;
  const nz = dirZ / len;
  const px = x + nx * 0.85;
  const pz = z + nz * 0.85;
  const head = y + PLAYER_HEIGHT * 0.92;
  const r = PLAYER_RADIUS * 0.7;
  let lowestTop = Infinity;
  for (const b of map.boxes) {
    const top = b.y + b.h / 2;
    const bottom = b.y - b.h / 2;
    if (top <= y + STEP_HEIGHT) continue;
    if (bottom >= head) continue;
    if (!containsXz(b, px, pz, r)) continue;
    if (top < lowestTop) lowestTop = top;
  }
  if (!Number.isFinite(lowestTop)) return false;
  const rise = lowestTop - y;
  return rise > STEP_HEIGHT && rise <= JUMP_CLEARANCE;
}

function simplifyPath(
  pts: NavPoint[],
  walkable: (x: number, z: number) => boolean,
  cell: number
): NavPoint[] {
  if (pts.length <= 2) return pts;
  const out: NavPoint[] = [pts[0]];
  let i = 0;
  while (i < pts.length - 1) {
    let best = i + 1;
    for (let j = pts.length - 1; j > i + 1; j--) {
      if (lineWalkable(pts[i], pts[j], walkable, cell)) {
        best = j;
        break;
      }
    }
    out.push(pts[best]);
    i = best;
  }
  return out;
}

function lineWalkable(
  a: NavPoint,
  b: NavPoint,
  walkable: (x: number, z: number) => boolean,
  cell: number
): boolean {
  const dist = Math.hypot(b.x - a.x, b.z - a.z);
  const steps = Math.max(2, Math.ceil(dist / (cell * 0.5)));
  for (let s = 1; s < steps; s++) {
    const t = s / steps;
    const x = a.x + (b.x - a.x) * t;
    const z = a.z + (b.z - a.z) * t;
    if (!walkable(x, z)) return false;
  }
  return true;
}
