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
   * Folga no rewind do hitscan (ms), além de RTT/2.
   * Remotos no cliente amostram a mesma janela
   * (now - interpDelay + RTT/2) — boneco e hitbox colados nela.
   */
  interpDelayMs: 50,
  /** @deprecated Visual remoto segue a pose do hitscan. */
  remoteInterpSpeed: 20,
  /** @deprecated Visual remoto segue a pose do hitscan. */
  remoteExtrapolationMs: 80,
} as const;
