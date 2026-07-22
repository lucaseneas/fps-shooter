/** Regras da partida — compartilhado entre cliente e servidor. */
export const CONFIG = {
  /** Slots totais da sala: humanos + bots completam o resto. */
  roomSize: 8,
  /** Vitória por kills: primeiro a atingir esse número vence. */
  killsToWin: 20,
  /** Segundos até renascer. */
  respawnDelay: 3,
  playerMaxHealth: 100,
  /** Segundos sem dano antes de iniciar a regeneração. */
  healthRegenDelay: 3,
  /** Vida recuperada por segundo após o atraso. */
  healthRegenPerSecond: 20,
  /** Porta do servidor Colyseus. */
  serverPort: 2567,
  /** Tick da simulação do servidor (ms). */
  simulationIntervalMs: 50,
  /** Segundos após o fim da partida até resetar a sala. */
  matchResetDelay: 8,

  // --- Netcode (visual + lag compensation) ---
  /**
   * Atraso estimado da interpolação visual dos remotos (ms).
   * Usado no rewind do hitscan: RTT/2 + este valor.
   * Calibre com o modo debug (hitbox vermelha vs modelo).
   */
  interpDelayMs: 75,
  /** Velocidade da interpolação dos inimigos no cliente (maior = cola mais rápido). */
  remoteInterpSpeed: 20,
  /** Máximo de extrapolação além do último patch do servidor (ms). */
  remoteExtrapolationMs: 80,
} as const;
