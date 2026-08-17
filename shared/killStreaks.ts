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
] as const;

/** Próxima recompensa ainda não alcançada, ou null se já pegou todas. */
export function nextKillStreakReward(
  currentStreak: number
): KillStreakReward | null {
  return KILL_STREAK_REWARDS.find((r) => currentStreak < r.kills) ?? null;
}

/**
 * Tecla de ativação de cada recompensa (índice = posição na timeline).
 * O primeiro streak liberado ativa com Z, o segundo com X, o terceiro com C.
 */
export const KILL_STREAK_KEY_LABELS = ["Z", "X", "C"] as const;

/** KeyboardEvent.code correspondente a cada slot de recompensa. */
export const KILL_STREAK_KEY_CODES = ["KeyZ", "KeyX", "KeyC"] as const;

/** Label da tecla de ativação de um streak pelo id ("" se desconhecido). */
export function killStreakKeyLabel(streakId: string): string {
  const index = KILL_STREAK_REWARDS.findIndex((r) => r.id === streakId);
  return index >= 0 ? KILL_STREAK_KEY_LABELS[index] : "";
}
