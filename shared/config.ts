/** Regras da partida — compartilhado entre cliente e servidor. */
export const CONFIG = {
  /** Slots totais da sala: humanos + bots completam o resto. */
  roomSize: 8,
  /** Vitória por kills: primeiro a atingir esse número vence. */
  killsToWin: 20,
  /** Segundos até renascer. */
  respawnDelay: 3,
  playerMaxHealth: 100,
  /** Porta do servidor Colyseus. */
  serverPort: 2567,
  /** Tick da simulação do servidor (ms). */
  simulationIntervalMs: 50,
  /** Segundos após o fim da partida até resetar a sala. */
  matchResetDelay: 8,
} as const;
