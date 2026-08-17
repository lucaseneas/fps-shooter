import { Schema, MapSchema, type } from "@colyseus/schema";

export class PlayerState extends Schema {
  @type("string") name = "";
  @type("number") x = 0;
  @type("number") y = 0;
  @type("number") z = 0;
  @type("number") yaw = 0;
  @type("number") health = 100;
  @type("number") kills = 0;
  @type("number") deaths = 0;
  @type("boolean") alive = true;
  /** Agachado — sincronizado para visual remoto e hitboxes. */
  @type("boolean") crouch = false;
  /** Skin do jogador */
  @type("string") skinId = "skin_default";
  // Reconciliação do movimento (apenas humanos):
  /** Velocidade vertical da simulação server-side. */
  @type("number") vy = 0;
  @type("boolean") grounded = true;
  /** Último input processado pelo servidor (ack para o replay do cliente). */
  @type("number") lastSeq = 0;

  // Sistema de Kill Streaks
  @type("number") killStreak = 0;
  @type("string") activeStreak = "";
  @type("number") streakTimeLeft = 0;
  /** Segundos restantes de invencibilidade (spawn ou streak). */
  @type("number") invincibleTimeLeft = 0;

  // Pré-lobby:
  /** Jogador marcou "Pronto" no pré-lobby. */
  @type("boolean") ready = false;
  /** Jogador está dentro da partida (falso = aguardando no pré-lobby). */
  @type("boolean") inMatch = false;
  /** Combatente controlado pela IA. */
  @type("boolean") isBot = false;

  // Sistema de patentes (nível por XP de carreira):
  /** XP total da carreira — a patente é derivada dele (shared/ranks). */
  @type("number") xp = 0;
  /** XP ganho na partida atual (exibido na tela de fim de partida). */
  @type("number") matchXp = 0;
  /** Multi-kills da partida (detalhamento do XP na tela de fim). */
  @type("number") doubleKills = 0;
  @type("number") tripleKills = 0;
  @type("number") multiKills = 0;
}

export class MatchState extends Schema {
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
  @type("boolean") matchOver = false;
  @type("string") winnerName = "";
  /** sessionId do líder da sala (só ele altera bots / configs). */
  @type("string") hostId = "";
  @type("string") roomName = "Sala";
  @type("number") desiredBots = 7;
  @type("number") maxPlayers = 8;
  /** Modo de jogo da sala (ex: "ffa"). */
  @type("string") gameMode = "ffa";
  /** Kills necessárias para vencer a partida. */
  @type("number") killsToWin = 20;
  /** Mapa da partida (id em shared/config MAPS). */
  @type("string") mapId = "praca";
  /** Falso = sala em pré-lobby; verdadeiro = partida em andamento. */
  @type("boolean") matchStarted = false;
}
