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
