/**
 * Sistema de gold — moeda de recompensa ganha ao fim de cada partida
 * (base + desempenho + vitória), paralela ao XP de carreira
 * (shared/ranks). O ouro acumula entre partidas e, no futuro, poderá
 * ser gasto em itens/skins.
 */

/**
 * Regras de gold concedido ao fim de cada partida.
 * Uma partida boa (20 kills + vitória) vale ~100 gold.
 */
export const GOLD_RULES = {
  /** Gold base por jogar a partida até o fim. */
  matchPlayed: 20,
  kill: 2,
  doubleKill: 6,
  tripleKill: 12,
  /** Cada kill além do triplo dentro da sequência (quadra, multi...). */
  multiKill: 25,
  victory: 40,
} as const;

/** Teto de gold aceito de convidados (o gold deles é informado pelo cliente). */
export const MAX_GOLD = 100_000_000;

/** Gold de fim de partida a partir do desempenho (mesma fórmula do servidor). */
export function matchGoldFor(stats: {
  kills: number;
  doubleKills: number;
  tripleKills: number;
  multiKills: number;
  won: boolean;
}): number {
  return (
    GOLD_RULES.matchPlayed +
    stats.kills * GOLD_RULES.kill +
    stats.doubleKills * GOLD_RULES.doubleKill +
    stats.tripleKills * GOLD_RULES.tripleKill +
    stats.multiKills * GOLD_RULES.multiKill +
    (stats.won ? GOLD_RULES.victory : 0)
  );
}
