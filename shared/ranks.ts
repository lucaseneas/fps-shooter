/**
 * Sistema de nível por patentes — inspirado nas patentes do Exército
 * Brasileiro. O XP é de carreira (acumula entre partidas) e a patente
 * é derivada dele de forma determinística.
 */

export interface RankDef {
  /** Id estável — também é o nome do arquivo do distintivo em /ranks. */
  id: string;
  /** Nome exibido. */
  name: string;
  /** XP total necessário para alcançar esta patente. */
  minXp: number;
}

export const RANKS: readonly RankDef[] = [
  { id: "recruta", name: "Recruta", minXp: 0 },
  { id: "soldado2", name: "Soldado 2ª Classe", minXp: 200 },
  { id: "soldado1", name: "Soldado 1ª Classe", minXp: 500 },
  { id: "cabo", name: "Cabo", minXp: 1000 },
  { id: "sargento3", name: "Sargento 3ª Classe", minXp: 1800 },
  { id: "sargento2", name: "Sargento 2ª Classe", minXp: 3000 },
  { id: "sargento1", name: "Sargento 1ª Classe", minXp: 4500 },
  { id: "subtenente", name: "Subtenente", minXp: 6500 },
  { id: "aspirante", name: "Aspirante", minXp: 9000 },
  { id: "tenente2", name: "Tenente 2ª Classe", minXp: 12500 },
  { id: "tenente1", name: "Tenente 1ª Classe", minXp: 17000 },
  { id: "capitao", name: "Capitão", minXp: 22500 },
  { id: "major", name: "Major", minXp: 30000 },
  { id: "tenente_coronel", name: "Tenente-Coronel", minXp: 40000 },
  { id: "coronel", name: "Coronel", minXp: 55000 },
  { id: "comandante", name: "Comandante", minXp: 75000 },
] as const;

/** Regras de XP concedido ao fim de cada partida. */
export const XP_RULES = {
  /** XP base por jogar a partida até o fim. */
  matchPlayed: 100,
  kill: 10,
  doubleKill: 25,
  tripleKill: 50,
  /** Cada kill além do triplo dentro da sequência (quadra, multi...). */
  multiKill: 100,
  victory: 150,
} as const;

/**
 * Janela da sequência de multi-kill (double/triple/multi) — a mesma do
 * HUD do cliente, mas aplicada no servidor para o cálculo de XP.
 */
export const MULTIKILL_WINDOW_MS = 5000;

/** Teto de XP aceito de convidados (o XP deles é informado pelo cliente). */
export const MAX_XP = 10_000_000;

/** Patente correspondente ao XP total. */
export function rankForXp(xp: number): RankDef {
  const safe = Math.max(0, Math.floor(xp));
  let current: RankDef = RANKS[0];
  for (const rank of RANKS) {
    if (safe >= rank.minXp) current = rank;
    else break;
  }
  return current;
}

export interface RankProgress {
  rank: RankDef;
  /** Próxima patente (null = patente máxima). */
  next: RankDef | null;
  /** XP acumulado dentro da patente atual. */
  intoRank: number;
  /** Tamanho do degrau atual em XP (0 = patente máxima). */
  needed: number;
  /** 0..1 — progresso até a próxima patente. */
  ratio: number;
}

export function rankProgress(xp: number): RankProgress {
  const safe = Math.max(0, Math.floor(xp));
  const rank = rankForXp(safe);
  const idx = RANKS.indexOf(rank);
  const next = idx + 1 < RANKS.length ? RANKS[idx + 1] : null;
  if (!next) {
    return { rank, next: null, intoRank: safe - rank.minXp, needed: 0, ratio: 1 };
  }
  const into = safe - rank.minXp;
  const needed = next.minXp - rank.minXp;
  return { rank, next, intoRank: into, needed, ratio: Math.min(1, into / needed) };
}

/** Caminho da imagem (distintivo) da patente. */
export function rankIconUrl(rank: RankDef): string {
  return `/ranks/${rank.id}.svg`;
}
