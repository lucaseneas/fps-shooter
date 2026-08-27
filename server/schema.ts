import { Schema, MapSchema, ArraySchema, type } from "@colyseus/schema";

export class PlayerState extends Schema {
  @type("string") name = "";
  /** Id da conta autenticada (0 = convidado) — usado pelo sistema Social. */
  @type("number") userId = 0;
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
  /** Arma equipada (visual para outros jogadores). */
  @type("string") weaponId = "m4a1";
  /** Skin de arma equipada na arma atual (vazio = padrão). */
  @type("string") weaponSkinId = "";
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
  /** Streaks liberados aguardando ativação manual (teclas Z/X/C). */
  @type(["string"]) availableStreaks = new ArraySchema<string>();
  /** Segundos restantes de invencibilidade (spawn ou streak). */
  @type("number") invincibleTimeLeft = 0;
  /** Vida do helicóptero Predator (0 = inativo). */
  @type("number") heliHp = 0;
  /** Caindo de paraquedas após o Predator acabar sem explosão. */
  @type("boolean") parachuting = false;

  // Pré-lobby:
  /** Jogador marcou "Pronto" no pré-lobby. */
  @type("boolean") ready = false;
  /** Jogador está dentro da partida (falso = aguardando no pré-lobby). */
  @type("boolean") inMatch = false;
  /** Combatente controlado pela IA. */
  @type("boolean") isBot = false;
  /** Time no Mata-Mata em equipe: "alpha" | "echo" | "" (FFA). */
  @type("string") team = "";
  /** Zumbi no modo Zombies (IA de horda). */
  @type("boolean") isZombie = false;
  /** Boss da horda (2× tamanho, 10× HP). */
  @type("boolean") isBoss = false;
  /** Humano nocauteado à espera de reanimação (corpo no chão). */
  @type("boolean") downed = false;
  /** Progresso da reanimação 0–1 (exibido no corpo). */
  @type("number") reviveProgress = 0;

  // Sistema de patentes (nível por XP de carreira):
  /** XP total da carreira — a patente é derivada dele (shared/ranks). */
  @type("number") xp = 0;
  /** XP ganho na partida atual (exibido na tela de fim de partida). */
  @type("number") matchXp = 0;
  /** Multi-kills da partida (detalhamento do XP na tela de fim). */
  @type("number") doubleKills = 0;
  @type("number") tripleKills = 0;
  @type("number") multiKills = 0;

  // Sistema de gold (moeda de recompensa — shared/gold):
  /** Gold total acumulado entre partidas. */
  @type("number") gold = 0;
  /** Gold ganho na partida atual (exibido na tela de fim de partida). */
  @type("number") matchGold = 0;
  /** JSON das cores da skin de arma (independente do catálogo do cliente). */
  @type("string") weaponSkinParts = "";
}

export class AmmoDropState extends Schema {
  @type("number") x = 0;
  @type("number") y = 0;
  @type("number") z = 0;
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
  /** JSON do mapa custom (vazio = mapa oficial). */
  @type("string") mapPayload = "";
  /** Falso = sala em pré-lobby; verdadeiro = partida em andamento. */
  @type("boolean") matchStarted = false;
  /** Kills da Equipe Alfa (modo tdm). */
  @type("number") teamKillsAlpha = 0;
  /** Kills da Equipe Echo (modo tdm). */
  @type("number") teamKillsEcho = 0;
  /** Time vencedor no tdm: "alpha" | "echo" | "". */
  @type("string") winnerTeam = "";
  /** Round atual no modo Zombies (0 = ainda não começou). */
  @type("number") zombieRound = 0;
  /** Zumbis ainda vivos neste round. */
  @type("number") zombiesAlive = 0;
  /** Zumbis que ainda vão nascer + vivos (HUD). */
  @type("number") zombiesLeft = 0;
  /** Segundos restantes da preparação / intermissão. */
  @type("number") prepTimeLeft = 0;
  /** "lobby" | "wave" | "intermission" | "". */
  @type("string") zombiePhase = "";
  @type({ map: AmmoDropState }) ammoDrops = new MapSchema<AmmoDropState>();
}

// --- Sala Social (presença global: amigos online, sala atual, convites) ---

export class SocialUserState extends Schema {
  @type("number") userId = 0;
  @type("string") name = "";
  /** "home" | "lobby" | "playing". */
  @type("string") status = "home";
  /** Sala de mata-mata em que está (vazio = fora de sala). */
  @type("string") roomId = "";
  @type("string") roomName = "";
  /** Humanos na sala atual (para o check "sala cheia"). */
  @type("number") roomClients = 0;
  @type("number") roomMax = 0;
  @type("boolean") matchStarted = false;
  @type("string") skinId = "skin_default";
}

export class SocialState extends Schema {
  /** Presença por sessionId — cada aba conectada é uma entrada. */
  @type({ map: SocialUserState }) users = new MapSchema<SocialUserState>();
}
