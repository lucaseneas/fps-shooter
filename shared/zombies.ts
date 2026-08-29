/** Regras do modo cooperativo Zombies (hordas). */

export const ZOMBIES_MAX_PLAYERS = 4;
export const ZOMBIE_HP = 200;
/** HP base do boss por jogador no primeiro round de boss (5). */
export const ZOMBIE_BOSS_HP_BASE = 2000;
/** +HP relativo por round acima do primeiro boss (round 5 → 1.0, 10 → 1.5, …). */
export const ZOMBIE_BOSS_HP_ROUND_GROWTH = 0.1;
export const ZOMBIE_BOSS_SCALE = 2;
export const ZOMBIE_MELEE_DAMAGE = 18;
export const ZOMBIE_BOSS_MELEE_DAMAGE = 36;
export const ZOMBIE_MELEE_RANGE = 1.75;
export const ZOMBIE_BOSS_MELEE_RANGE = 2.45;
export const ZOMBIE_MELEE_INTERVAL = 1.05;
export const ZOMBIE_AMMO_DROP_CHANCE = 0.1;
export const ZOMBIES_PREP_SECONDS = 15;
export const ZOMBIES_INTERMISSION_SECONDS = 5;
export const ZOMBIES_REVIVE_SECONDS = 5;
export const ZOMBIES_REVIVE_RANGE = 2.5;
export const ZOMBIES_PICKUP_RANGE = 1.45;
export const ZOMBIES_BOSS_EVERY = 5;
/** Skins NPC (não entram na loja). Arquivos em `public/assets/skins/`. */
export const ZOMBIE_SKIN_IDS = ["zombie1", "zombie2", "zombie3"] as const;
/** Fração do walk do jogador — zumbis não correm. */
export const ZOMBIE_WALK_SPEED_MULT = 0.5;
export const ZOMBIE_BOSS_WALK_SPEED_MULT = 0.5;

export function randomZombieSkin(): string {
  return ZOMBIE_SKIN_IDS[Math.floor(Math.random() * ZOMBIE_SKIN_IDS.length)]!;
}

export type ZombiePhase = "" | "lobby" | "prep" | "wave" | "intermission";

export interface ZombieWavePlan {
  round: number;
  /** Quantidade total de zumbis deste round (nascem todos, sem teto de vivos). */
  totalZombies: number;
  /** Zumbis por segundo, cada um num spawn aleatório. */
  respawnSpeed: number;
  boss: boolean;
}

/**
 * Round 1: 8 zumbis, 1/s em spawn aleatório.
 * Cada round: +4 zumbis e spawn um pouco mais rápido.
 * A cada 5 rounds: um Boss extra (2× tamanho; HP escala com jogadores e round).
 */
export function zombieWavePlan(round: number): ZombieWavePlan {
  const n = Math.max(1, Math.floor(round));
  const totalZombies = 8 + (n - 1) * 4;
  const spawnInterval = Math.max(0.28, 1 - (n - 1) * 0.05);
  return {
    round: n,
    totalZombies,
    respawnSpeed: 1 / spawnInterval,
    boss: n % ZOMBIES_BOSS_EVERY === 0,
  };
}

/**
 * Vida do boss no spawn.
 * base × jogadores × (1 + (round − 5) × 10%)
 *
 * Round 5:  1p 2000 · 2p 4000 · 4p 8000
 * Round 10: 1p 3000 · 2p 6000 · 4p 12000
 * Round 15: 1p 4000 · 2p 8000 · 4p 16000
 */
export function zombieBossMaxHealth(playerCount: number, round: number): number {
  const players = Math.max(1, Math.min(ZOMBIES_MAX_PLAYERS, Math.floor(playerCount)));
  const r = Math.max(1, Math.floor(round));
  const roundsPastFirst = Math.max(0, r - ZOMBIES_BOSS_EVERY);
  const roundMult = 1 + roundsPastFirst * ZOMBIE_BOSS_HP_ROUND_GROWTH;
  return Math.round(ZOMBIE_BOSS_HP_BASE * players * roundMult);
}

export function zombieMaxHealth(boss: boolean, playerCount = 1, round = ZOMBIES_BOSS_EVERY): number {
  return boss ? zombieBossMaxHealth(playerCount, round) : ZOMBIE_HP;
}

export function zombieMeleeDamage(boss: boolean): number {
  return boss ? ZOMBIE_BOSS_MELEE_DAMAGE : ZOMBIE_MELEE_DAMAGE;
}

export function zombieMeleeRange(boss: boolean): number {
  return boss ? ZOMBIE_BOSS_MELEE_RANGE : ZOMBIE_MELEE_RANGE;
}
