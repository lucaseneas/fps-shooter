/** Modos de jogo disponíveis. */
export const GAME_MODES = [
  { id: "ffa", label: "Free-for-All" },
  { id: "tdm", label: "Mata-Mata em equipe" },
] as const;

export type GameModeId = (typeof GAME_MODES)[number]["id"];

export type TeamId = "alpha" | "echo";

export const TEAMS = {
  alpha: {
    id: "alpha" as const,
    label: "Equipe Alfa",
    short: "Alfa",
    color: "#4d8dff",
  },
  echo: {
    id: "echo" as const,
    label: "Equipe Echo",
    short: "Echo",
    color: "#e05545",
  },
} as const;

export function isTeamId(v: unknown): v is TeamId {
  return v === "alpha" || v === "echo";
}

export function isTdmMode(mode: string): boolean {
  return mode === "tdm";
}

export function gameModeLabel(mode: string): string {
  return GAME_MODES.find((m) => m.id === mode)?.label ?? mode;
}

/** Mapas oficiais disponíveis para as salas. */
export const MAPS = [
  { id: "praca", label: "Praça", kind: "boxes" as const },
] as const;

export type MapId = (typeof MAPS)[number]["id"];

export type MapDef =
  | { id: string; label: string; kind: "boxes" }
  | { id: string; label: string; kind: "glb"; glbUrl: string; scale: number };

export function getMapDef(mapId: string): MapDef {
  const found = MAPS.find((m) => m.id === mapId);
  if (found) return found;
  return MAPS[0];
}

/** Opções de kills para vencer a partida. */
export const KILLS_TO_WIN_OPTIONS = [5, 10, 15, 20, 25, 30, 40, 50] as const;

/** Regras da partida — compartilhado entre cliente e servidor. */
export const CONFIG = {
  /** Slots totais da sala: humanos + bots completam o resto. */
  roomSize: 8,
  /** Vitória por kills: primeiro a atingir esse número vence. */
  killsToWin: 20,
  /** Segundos até renascer. */
  respawnDelay: 3,
  /** Segundos de invencibilidade após respawn. */
  spawnInvincibilityDuration: 2,
  playerMaxHealth: 100,
  /** Segundos sem dano antes de iniciar a regeneração. */
  healthRegenDelay: 3,
  /** Vida recuperada por segundo após o atraso. */
  healthRegenPerSecond: 20,
  /** Porta do servidor Colyseus. */
  serverPort: 2567,
  /**
   * Tick da simulação do servidor (ms). 33ms ≈ 30Hz: os acks de input
   * chegam mais rápido ao cliente, encurtando a janela de reconciliação.
   */
  simulationIntervalMs: 33,
  /** Segundos após o fim da partida até resetar a sala. */
  matchResetDelay: 8,

  // --- Netcode (visual + lag compensation) ---
  /**
   * Folga no rewind do hitscan (ms), além de RTT/2.
   * Remotos no cliente amostram a mesma janela
   * (now - interpDelay + RTT/2) — boneco e hitbox colados nela.
   * Precisa cobrir ≥2 ticks (66ms) + jitter depois de descontar o RTT/2,
   * senão o cliente extrapola e o boneco dá mini-teleportes.
   */
  interpDelayMs: 100,
  /** @deprecated Visual remoto segue a pose do hitscan. */
  remoteInterpSpeed: 20,
  /** @deprecated Visual remoto segue a pose do hitscan. */
  remoteExtrapolationMs: 80,
} as const;
