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
  /** Invencibilidade ao descer quando o tempo acaba. */
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
