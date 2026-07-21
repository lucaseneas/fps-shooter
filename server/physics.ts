import { MAP_BOXES, PLAY_BOUND } from "../shared/mapData";

export interface Vec2 {
  x: number;
  z: number;
}

/**
 * Move um corpo circular (raio `radius`) no plano XZ, resolvendo colisão
 * contra as AABBs do mapa por "push-out" no eixo de menor penetração.
 * Suficiente para bots que andam no chão.
 */
export function moveWithCollisions(
  pos: Vec2,
  dx: number,
  dz: number,
  radius: number
): void {
  pos.x += dx;
  pos.z += dz;

  for (const b of MAP_BOXES) {
    const ex = b.w / 2 + radius;
    const ez = b.d / 2 + radius;
    const rx = pos.x - b.x;
    const rz = pos.z - b.z;
    if (Math.abs(rx) >= ex || Math.abs(rz) >= ez) continue;

    const penX = ex - Math.abs(rx);
    const penZ = ez - Math.abs(rz);
    if (penX < penZ) {
      pos.x = b.x + Math.sign(rx || 1) * ex;
    } else {
      pos.z = b.z + Math.sign(rz || 1) * ez;
    }
  }

  pos.x = Math.max(-PLAY_BOUND, Math.min(PLAY_BOUND, pos.x));
  pos.z = Math.max(-PLAY_BOUND, Math.min(PLAY_BOUND, pos.z));
}

/**
 * Testa se o segmento A→B é bloqueado por alguma AABB do mapa (slab method).
 * Usado para linha de visão dos bots.
 */
export function segmentBlocked(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number
): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;

  for (const b of MAP_BOXES) {
    const min = [b.x - b.w / 2, b.y - b.h / 2, b.z - b.d / 2];
    const max = [b.x + b.w / 2, b.y + b.h / 2, b.z + b.d / 2];
    const origin = [ax, ay, az];
    const dir = [dx, dy, dz];

    let tMin = 0;
    let tMax = 1;
    let hit = true;

    for (let i = 0; i < 3; i++) {
      if (Math.abs(dir[i]) < 1e-8) {
        if (origin[i] < min[i] || origin[i] > max[i]) {
          hit = false;
          break;
        }
        continue;
      }
      let t1 = (min[i] - origin[i]) / dir[i];
      let t2 = (max[i] - origin[i]) / dir[i];
      if (t1 > t2) [t1, t2] = [t2, t1];
      tMin = Math.max(tMin, t1);
      tMax = Math.min(tMax, t2);
      if (tMin > tMax) {
        hit = false;
        break;
      }
    }

    if (hit) return true;
  }
  return false;
}

export function distance3(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number
): number {
  return Math.sqrt((bx - ax) ** 2 + (by - ay) ** 2 + (bz - az) ** 2);
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Distância `t` até a primeira interseção do raio com uma AABB
 * (slab method), ou null se não intersecta dentro de [0, maxDist].
 */
export function rayAabb(
  o: Vec3,
  d: Vec3,
  cx: number,
  cy: number,
  cz: number,
  hx: number,
  hy: number,
  hz: number,
  maxDist: number
): number | null {
  const min = [cx - hx, cy - hy, cz - hz];
  const max = [cx + hx, cy + hy, cz + hz];
  const origin = [o.x, o.y, o.z];
  const dir = [d.x, d.y, d.z];

  let tMin = 0;
  let tMax = maxDist;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(dir[i]) < 1e-8) {
      if (origin[i] < min[i] || origin[i] > max[i]) return null;
      continue;
    }
    let t1 = (min[i] - origin[i]) / dir[i];
    let t2 = (max[i] - origin[i]) / dir[i];
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return null;
  }
  return tMin;
}

/** Distância `t` até a interseção do raio com uma esfera, ou null. */
export function raySphere(
  o: Vec3,
  d: Vec3,
  cx: number,
  cy: number,
  cz: number,
  radius: number,
  maxDist: number
): number | null {
  const lx = cx - o.x;
  const ly = cy - o.y;
  const lz = cz - o.z;
  const tca = lx * d.x + ly * d.y + lz * d.z;
  if (tca < 0) return null;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  const r2 = radius * radius;
  if (d2 > r2) return null;
  const thc = Math.sqrt(r2 - d2);
  const t = tca - thc;
  if (t < 0 || t > maxDist) return null;
  return t;
}

/**
 * Menor `t` de interseção do raio com a geometria do mapa (AABBs + chão),
 * ou maxDist se não bate em nada.
 */
export function raycastMap(o: Vec3, d: Vec3, maxDist: number): number {
  let best = maxDist;

  // Plano do chão (y = 0).
  if (d.y < -1e-8) {
    const t = -o.y / d.y;
    if (t >= 0 && t < best) best = t;
  }

  for (const b of MAP_BOXES) {
    const t = rayAabb(o, d, b.x, b.y, b.z, b.w / 2, b.h / 2, b.d / 2, best);
    if (t !== null && t < best) best = t;
  }
  return best;
}
