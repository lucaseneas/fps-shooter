import { PLAYER_HEIGHT, PLAYER_RADIUS, type BodyState } from "./movement";
import type { MapCollision } from "./mapRuntime";
import { boxCollisionSize } from "./mapData";

/** Recompensas de kill streak (kills sem morrer). */
export interface KillStreakReward {
  /** Kills sem morrer necessários para ativar. */
  kills: number;
  id: string;
  name: string;
  icon: string;
  /** Duração do efeito em segundos. */
  duration: number;
}

export const KILL_STREAK_REWARDS: readonly KillStreakReward[] = [
  {
    kills: 4,
    id: "wall_hacker",
    name: "Wall Hacker",
    icon: "👁️",
    duration: 15,
  },
  {
    kills: 6,
    id: "no_recoil",
    name: "No Recoil",
    icon: "🎯",
    duration: 15,
  },
  {
    kills: 8,
    id: "invincibility",
    name: "Invincibility",
    icon: "🛡️",
    duration: 15,
  },
  {
    kills: 10,
    id: "predator",
    name: "Predator",
    icon: "🚁",
    duration: 20,
  },
] as const;

/** Helicóptero do Predator: vida, hitbox e câmera da minigun. */
export const PREDATOR = {
  hp: 600,
  /** Folga acima do ponto mais alto do mapa. */
  altitudeClearance: 16,
  /** Altura mínima mesmo em mapas baixos. */
  altitudeMin: 22,
  /** Olho / origem dos tiros relativa ao centro da fuselagem. */
  eyeY: -1.15,
  /** AABB centrada na posição do jogador (fuselagem). */
  hitHalf: { x: 1.7, y: 1.2, z: 3.6 },
  /** Velocidade horizontal com WASD (m/s) — mais lenta que andar no chão. */
  moveSpeed: 4.2,
  /** Queda de paraquedas (m/s) após o tempo acabar sem explosão. */
  fallSpeed: 6.8,
  /** Direção horizontal com WASD durante o paraquedas. */
  parachuteMoveSpeed: 5.0,
  /** Helicóptero vazio permanece no ar após o salto (s). */
  heliLinger: 4.5,
  /** Invencibilidade ao tocar o chão. */
  landInvuln: 1.5,
} as const;

export function isPredatorStreak(streakId: string | undefined | null): boolean {
  return streakId === "predator";
}

/** Próxima recompensa ainda não alcançada, ou null se já pegou todas. */
export function nextKillStreakReward(
  currentStreak: number
): KillStreakReward | null {
  return KILL_STREAK_REWARDS.find((r) => currentStreak < r.kills) ?? null;
}

/**
 * Tecla de ativação de cada recompensa (índice = posição na timeline).
 * O primeiro streak liberado ativa com Z, o segundo com X, o terceiro com C,
 * o quarto com B.
 */
export const KILL_STREAK_KEY_LABELS = ["Z", "X", "C", "B"] as const;

/** KeyboardEvent.code correspondente a cada slot de recompensa. */
export const KILL_STREAK_KEY_CODES = ["KeyZ", "KeyX", "KeyC", "KeyB"] as const;

/** Label da tecla de ativação de um streak pelo id ("" se desconhecido). */
export function killStreakKeyLabel(streakId: string): string {
  const index = KILL_STREAK_REWARDS.findIndex((r) => r.id === streakId);
  return index >= 0 ? KILL_STREAK_KEY_LABELS[index] : "";
}

/** Recompensa ligada a um keydown (`code` ou `key`). */
export function killStreakRewardForKey(
  code: string,
  key = ""
): KillStreakReward | null {
  const codes = KILL_STREAK_KEY_CODES as readonly string[];
  let index = codes.indexOf(code);
  if (index < 0 && key) {
    const lowered = key.toLowerCase();
    index = KILL_STREAK_KEY_LABELS.findIndex(
      (label) => label.toLowerCase() === lowered
    );
  }
  if (index < 0) return null;
  return KILL_STREAK_REWARDS[index] ?? null;
}

export interface PredatorBounds {
  playMinX: number;
  playMaxX: number;
  playMinZ: number;
  playMaxZ: number;
}

function clampHeli(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/**
 * Desloca o helicóptero no plano XZ (WASD relativo ao yaw).
 * Sem gravidade e sem colisão de prédios — só os limites jogáveis.
 */
export function stepPredator(
  s: { x: number; z: number },
  input: { forward: number; strafe: number; yaw: number },
  bounds: PredatorBounds,
  dt = 1 / 60
): void {
  const f = Math.sign(input.forward);
  const st = Math.sign(input.strafe);
  const sin = Math.sin(input.yaw);
  const cos = Math.cos(input.yaw);
  let wx = sin * f + cos * st;
  let wz = cos * f - sin * st;
  const len = Math.hypot(wx, wz);
  if (len > 1) {
    wx /= len;
    wz /= len;
  } else if (len < 1e-8) {
    return;
  }
  const pad = PREDATOR.hitHalf.x;
  s.x = clampHeli(
    s.x + wx * PREDATOR.moveSpeed * dt,
    bounds.playMinX + pad,
    bounds.playMaxX - pad
  );
  s.z = clampHeli(
    s.z + wz * PREDATOR.moveSpeed * dt,
    bounds.playMinZ + pad,
    bounds.playMaxZ - pad
  );
}

const CHUTE_EPS = 1e-4;

/**
 * Queda de paraquedas: WASD no plano XZ, descida constante, pouso em tetos.
 */
export function stepParachute(
  s: BodyState,
  input: { forward: number; strafe: number; yaw: number },
  map: PredatorBounds & Pick<MapCollision, "boxes">,
  dt = 1 / 60
): void {
  const prevFeet = s.y;
  const f = Math.sign(input.forward);
  const st = Math.sign(input.strafe);
  const sin = Math.sin(input.yaw);
  const cos = Math.cos(input.yaw);
  let wx = sin * f + cos * st;
  let wz = cos * f - sin * st;
  const len = Math.hypot(wx, wz);
  if (len > 1) {
    wx /= len;
    wz /= len;
  }
  if (len > 1e-8) {
    s.x += wx * PREDATOR.parachuteMoveSpeed * dt;
    s.z += wz * PREDATOR.parachuteMoveSpeed * dt;
  }

  for (const b of map.boxes) {
    const top = b.y + b.h / 2;
    const bottom = b.y - b.h / 2;
    if (top <= prevFeet + CHUTE_EPS) continue;
    if (bottom >= prevFeet + PLAYER_HEIGHT) continue;
    const dim = boxCollisionSize(b);
    const ex = dim.w / 2 + PLAYER_RADIUS;
    const ez = dim.d / 2 + PLAYER_RADIUS;
    const rx = s.x - b.x;
    const rz = s.z - b.z;
    if (Math.abs(rx) >= ex || Math.abs(rz) >= ez) continue;
    const penX = ex - Math.abs(rx);
    const penZ = ez - Math.abs(rz);
    if (penX < penZ) {
      s.x = b.x + Math.sign(rx || 1) * ex;
    } else {
      s.z = b.z + Math.sign(rz || 1) * ez;
    }
  }

  s.x = clampHeli(s.x, map.playMinX, map.playMaxX);
  s.z = clampHeli(s.z, map.playMinZ, map.playMaxZ);

  if (s.grounded) {
    s.vy = 0;
    return;
  }

  s.vy = -PREDATOR.fallSpeed;
  s.y += s.vy * dt;

  let landing = s.y <= 0 ? 0 : -Infinity;
  for (const b of map.boxes) {
    const top = b.y + b.h / 2;
    const dim = boxCollisionSize(b);
    const ex = dim.w / 2 + PLAYER_RADIUS;
    const ez = dim.d / 2 + PLAYER_RADIUS;
    if (Math.abs(s.x - b.x) >= ex || Math.abs(s.z - b.z) >= ez) continue;
    if (top <= prevFeet + CHUTE_EPS && s.y <= top && top > landing) {
      landing = top;
    }
  }

  if (landing > -Infinity) {
    s.y = landing;
    s.vy = 0;
    s.grounded = true;
  }
}
