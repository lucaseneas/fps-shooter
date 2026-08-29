import { Room, Client } from "colyseus";

import { MatchState, PlayerState, AmmoDropState, WeaponDropState } from "./schema";
import { BotAi, BotWorld, ShotEvent } from "./BotAi";
import { ZombieAi, type ZombieWorld } from "./ZombieAi";
import { CONFIG, GAME_MODES, MAPS, isTeamId, isTdmMode, isZombiesMode, TEAMS, type TeamId } from "../shared/config";
import { KILL_STREAK_REWARDS, PREDATOR, isPredatorStreak, stepPredator, stepParachute } from "../shared/killStreaks";
import { pickBotNames } from "../shared/names";
import { pickSpawnFarFrom, randomSpawn, spawnsForTeam, zombieSpawnsFor } from "../shared/spawnPoints";
import {
  customMapToGeometry,
  defaultPracaGeometry,
  isCustomMapId,
  sanitizeCustomMap,
} from "../shared/customMap";
import { geometryToCollision, type MapCollision } from "../shared/mapRuntime";
import {
  getWeapon,
  damageFalloff,
  weaponMaxRange,
  resolveWeaponId,
  isDroppableWeapon,
  WEAPON_DROP_PICKUP_RANGE,
  WEAPON_DROP_THROW_DISTANCE,
} from "../shared/weapons";
import {
  encodeWeaponSkinParts,
  getWeaponSkin,
  decodeWeaponSkinLooks,
} from "../shared/weaponSkins";
import {
  BodyState,
  PlayerInput,
  createBody,
  stepPlayer,
  EYE_HEIGHT,
  CROUCH_EYE_HEIGHT,
} from "../shared/movement";
import { raycastMap, rayAabb, raySphere, Vec3 } from "./physics";
import { HITBOX } from "../shared/hitboxes";
import { authenticateToken, recordMatchStats, getUserProgress } from "./auth";
import { bindClient, unbindClient } from "./sessionRegistry";
import { isAuthEnabled } from "./db";
import { XP_RULES, MAX_XP, MULTIKILL_WINDOW_MS } from "../shared/ranks";
import { MAX_GOLD, matchGoldFor } from "../shared/gold";
import { DEFAULT_SKIN } from "../shared/skins";
import {
  ZOMBIES_MAX_PLAYERS,
  ZOMBIES_PREP_SECONDS,
  ZOMBIES_INTERMISSION_SECONDS,
  ZOMBIES_REVIVE_SECONDS,
  ZOMBIES_REVIVE_RANGE,
  ZOMBIES_PICKUP_RANGE,
  ZOMBIE_AMMO_DROP_CHANCE,
  ZOMBIE_BOSS_SCALE,
  zombieWavePlan,
  zombieMaxHealth,
  randomZombieSkin,
} from "../shared/zombies";

const HISTORY_WINDOW_MS = 1000;
/** Quantos inputs processar por jogador a cada tick (anti-speedhack). */
const MAX_INPUTS_PER_TICK = 6;

const HEAD_CENTER_Y = HITBOX.headCenterY;
const HEAD_RADIUS = HITBOX.headRadius;
const BODY_CENTER_Y = HITBOX.bodyCenterY;
const BODY_HALF = HITBOX.bodyHalf;
const CROUCH_HEAD_CENTER_Y = HITBOX.crouchHeadCenterY;
const CROUCH_HEAD_FORWARD = HITBOX.crouchHeadForward;
const CROUCH_BODY_CENTER_Y = HITBOX.crouchBodyCenterY;
const CROUCH_BODY_HALF_Y = HITBOX.crouchBodyHalfY;

interface FireMessage {
  weaponId: string;
  weaponSkinId?: unknown;
  weaponSkinParts?: unknown;
  ox: number;
  oy: number;
  oz: number;
  dirs: Array<{ x: number; y: number; z: number }>;
}

interface DropWeaponMessage {
  weaponId?: unknown;
  mag?: unknown;
  reserve?: unknown;
  weaponSkinId?: unknown;
  weaponSkinParts?: unknown;
}

interface HistoryEntry {
  t: number;
  x: number;
  y: number;
  z: number;
}

/**
 * Sala autoritativa do mata-mata (FFA) — Fase 4.
 *
 * O servidor é autoridade de TUDO: posição (simula os inputs dos clientes
 * com a mesma física compartilhada usada na prediction), dano (hitscan
 * server-side com lag compensation via rewind do histórico de posições),
 * kills, respawn, vitória e IA dos bots.
 */
interface RoomCreateOptions {
  name?: string;
  token?: string;
  roomName?: string;
  bots?: number;
  maxPlayers?: number;
  gameMode?: string;
  killsToWin?: number;
  mapId?: string;
  customMap?: unknown;
}

/** Payload do líder para alterar as configurações da sala (pré-lobby). */
interface RoomSettingsMessage {
  roomName?: unknown;
  mapId?: unknown;
  gameMode?: unknown;
  killsToWin?: unknown;
  maxPlayers?: unknown;
  bots?: unknown;
  customMap?: unknown;
}

/** Código de close usado ao remover um jogador da sala (kick pelo líder). */
const KICK_CLOSE_CODE = 4000;

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function sanitizeRoomName(value: unknown): string {
  if (typeof value !== "string") return "Sala";
  const name = value.trim().slice(0, 24);
  return name.length > 0 ? name : "Sala";
}

export class DeathmatchRoom extends Room<MatchState> {
  maxClients: number = CONFIG.roomSize;

  private bots = new Map<string, BotAi>();
  private botCounter = 0;
  private namePool: string[] = [];
  private zombies = new Map<string, ZombieAi>();
  private zombieCounter = 0;
  private zombieToSpawn = 0;
  private zombieSpawnAcc = 0;
  private zombieSpawnInterval = 1;
  private zombieBossQueued = false;
  private intermissionLeft = 0;
  private ammoDropCounter = 0;
  private weaponDropCounter = 0;
  /** Rate limit de drop de arma por jogador. */
  private lastWeaponDropAt = new Map<string, number>();
  /** Rate limit de pickup de arma por jogador. */
  private lastWeaponPickupAt = new Map<string, number>();
  /** Quem está a segurar F para reanimar, e o alvo. */
  private reviveHold = new Map<string, { targetId: string; elapsed: number }>();
  /** Capacidade total (humanos + bots) usada no rebalance. */
  private roomCapacity: number = CONFIG.roomSize;
  /** Quantos bots a sala deve manter (só o líder altera). */
  private desiredBots: number = CONFIG.roomSize - 1;

  /** Corpo físico server-side de cada humano. */
  private bodies = new Map<string, BodyState>();
  /** Fila de inputs pendentes por humano. */
  private pendingInputs = new Map<string, PlayerInput[]>();
  /** Histórico de posições (lag compensation), por combatente. */
  private history = new Map<string, HistoryEntry[]>();
  /** RTT medido por cliente (ms). */
  private rtt = new Map<string, number>();
  private lastPingAt = new Map<string, number>();
  /** Rate limit de disparo por humano. */
  private lastFireAt = new Map<string, number>();
  /** Clientes que ativaram o modo de depuração para a sessão atual. */
  private devInfiniteClients = new Set<string>();
  private devTracerClients = new Set<string>();
  private devUnlockStreaksClients = new Set<string>();
  /** Último instante em que cada combatente recebeu dano. */
  private lastDamagedAt = new Map<string, number>();
  private lastChatAt = new Map<string, number>();

  /** userId da conta autenticada por sessionId (humanos). */
  private userIds = new Map<string, number>();
  /** Evita gravar stats duas vezes no mesmo fim de partida. */
  private statsRecorded = false;

  // Sistema de patentes:
  /** Multi-kills da partida por combatente (janela = MULTIKILL_WINDOW_MS). */
  private matchMultis = new Map<
    string,
    { chain: number; expiresAt: number; double: number; triple: number; multi: number }
  >();
  /** XP calculado no fim da partida por sessionId (base do persist). */
  private matchXpEarned = new Map<string, number>();
  /** Gold calculado no fim da partida por sessionId (base do persist). */
  private matchGoldEarned = new Map<string, number>();

  /** Timestamp (ms) em que cada morto deve renascer. */
  private respawnAt = new Map<string, number>();
  /** Última posição de morte, para renascer longe dela. */
  private deathPos = new Map<string, { x: number; z: number }>();
  /** Arma que o Predator substituiu (restaurada no salto). */
  private predatorWeapons = new Map<string, string>();
  private matchResetAt = 0;
  private roomMap: MapCollision = geometryToCollision(defaultPracaGeometry(), "Praça");

  onCreate(options: RoomCreateOptions = {}): void {
    this.setState(new MatchState());
    // Estado (inclui os acks de input) flui a ~30Hz, casado com o tick —
    // encurta a janela de inputs pendentes na reconciliação do cliente.
    this.setPatchRate(CONFIG.simulationIntervalMs);
    this.namePool = pickBotNames(16);

    const roomName = sanitizeRoomName(options.roomName);
    const gameMode =
      typeof options.gameMode === "string" &&
      GAME_MODES.some((m) => m.id === options.gameMode)
        ? options.gameMode
        : "ffa";
    const zombies = isZombiesMode(gameMode);
    const maxCap = zombies ? ZOMBIES_MAX_PLAYERS : CONFIG.roomSize;
    const maxPlayers = clampInt(
      options.maxPlayers,
      zombies ? 1 : 2,
      maxCap,
      zombies ? ZOMBIES_MAX_PLAYERS : CONFIG.roomSize
    );
    const desiredBots = zombies
      ? 0
      : clampInt(options.bots, 0, maxPlayers - 1, Math.max(0, maxPlayers - 1));
    const killsToWin = clampInt(options.killsToWin, 1, 100, CONFIG.killsToWin);

    this.maxClients = maxPlayers;
    this.roomCapacity = maxPlayers;
    this.desiredBots = desiredBots;
    this.state.roomName = roomName;
    this.state.desiredBots = desiredBots;
    this.state.maxPlayers = maxPlayers;
    this.state.gameMode = gameMode;
    this.state.killsToWin = killsToWin;
    if (zombies) this.state.zombiePhase = "lobby";
    this.applyRoomMap(options.mapId, options.customMap);

    // Metadata exibida na lista de salas do lobby.
    void this.syncMetadata();

    // Sala nunca fica vazia: bots preenchem os slots (pilar #1 do GDD).
    this.rebalanceBots();

    this.onMessage("input", (client, input: PlayerInput) => {
      const p = this.state.players.get(client.sessionId);
      if (!p || !p.alive || p.downed) return;
      if (typeof input?.seq !== "number") return;
      const queue = this.pendingInputs.get(client.sessionId);
      if (!queue) return;
      queue.push(input);
      if (queue.length > 60) queue.splice(0, queue.length - 60);
    });

    this.onMessage("fire", (client, msg: FireMessage) => {
      this.handleFire(client, msg);
    });

    /**
     * Ativação manual de kill streak (teclas Z/X/C). Apenas um streak
     * ativo por vez — o próximo só pode ser ligado quando o atual acabar.
     */
    this.onMessage("activateStreak", (client, msg: { id?: unknown }) => {
      if (this.state.matchOver) return;
      if (this.isZombies()) return;
      const p = this.state.players.get(client.sessionId);
      if (!p || !p.alive || !p.inMatch) return;
      const id = typeof msg?.id === "string" ? msg.id : "";
      const devUnlock = this.devUnlockStreaksClients.has(client.sessionId);
      if (!id || (!devUnlock && p.availableStreaks.indexOf(id) < 0)) return;
      if (p.activeStreak) {
        client.send("streakDenied", { activeStreak: p.activeStreak });
        return;
      }
      this.tryActivateStreak(client.sessionId, p, id, devUnlock);
    });

    this.onMessage("spong", (client, msg: { t: number }) => {
      if (typeof msg?.t !== "number") return;
      const rtt = Math.max(0, Date.now() - msg.t);
      this.rtt.set(client.sessionId, rtt);
      // Mesmo RTT que o rewind usa — o cliente alinha modelo/hitbox com ele.
      client.send("srtt", { rtt });
    });

    // Eco para o cliente medir o próprio ping (indicador no HUD).
    this.onMessage("cping", (client, msg: { t: number }) => {
      client.send("cpong", msg);
    });

    // Só o líder altera quantos bots preenchem os slots vazios.
    this.onMessage("setBots", (client, msg: { count: number }) => {
      if (client.sessionId !== this.state.hostId) return;
      if (this.isZombies()) return;
      if (typeof msg?.count !== "number" || !Number.isFinite(msg.count)) return;
      this.desiredBots = Math.max(
        0,
        Math.min(this.roomCapacity - 1, Math.floor(msg.count))
      );
      this.state.desiredBots = this.desiredBots;
      void this.syncMetadata();
      this.rebalanceBots();
    });

    // --- Pré-lobby ---

    /** Jogador marca/desmarca "Pronto" (só vale com a partida parada). */
    this.onMessage("setReady", (client, msg: { ready?: unknown }) => {
      if (this.state.matchStarted) return;
      const p = this.state.players.get(client.sessionId);
      if (!p) return;
      p.ready = msg?.ready === true;
    });

    /** Líder inicia a partida com todos que estavam prontos. */
    this.onMessage("startMatch", (client) => {
      if (client.sessionId !== this.state.hostId) return;
      if (this.state.matchStarted) return;
      this.startMatch();
    });

    /** Entrada tardia: jogador no pré-lobby entra na partida em andamento. */
    this.onMessage("playMatch", (client) => {
      if (!this.state.matchStarted || this.state.matchOver) return;
      const p = this.state.players.get(client.sessionId);
      if (!p || p.inMatch) return;
      p.inMatch = true;
      p.ready = false;
      client.send("matchStart");
      if (this.isZombies()) this.respawnPlayer(client.sessionId);
    });

    /** Líder altera mapa/modo/kills/etc. — apenas no pré-lobby. */
    this.onMessage("updateSettings", (client, msg: RoomSettingsMessage) => {
      if (client.sessionId !== this.state.hostId) return;
      if (this.state.matchStarted) return;
      this.applySettings(msg ?? {});
    });

    /** Líder remove um humano da sala (bots se controlam pelo slider). */
    this.onMessage("kickPlayer", (client, msg: { playerId?: unknown }) => {
      if (client.sessionId !== this.state.hostId) return;
      const targetId = typeof msg?.playerId === "string" ? msg.playerId : "";
      if (!targetId || targetId === client.sessionId) return;
      if (this.bots.has(targetId)) return;
      const target = this.clients.find((c) => c.sessionId === targetId);
      target?.leave(KICK_CLOSE_CODE);
    });

    this.onMessage("setTeam", (client, msg: { team?: unknown }) => {
      this.handleSetTeam(client, msg?.team);
    });

    this.onMessage("holdRevive", (client, msg: { holding?: unknown }) => {
      this.handleHoldRevive(client.sessionId, msg?.holding === true);
    });

    this.onMessage("dropWeapon", (client, msg: DropWeaponMessage) => {
      this.handleDropWeapon(client, msg);
    });

    this.onMessage("pickupWeapon", (client, msg: { dropId?: unknown; swap?: unknown }) => {
      this.handlePickupWeapon(client, msg);
    });

    this.onMessage("flashlight", (client, msg: { on?: unknown }) => {
      if (!this.isZombies()) return;
      const p = this.state.players.get(client.sessionId);
      if (!p) return;
      p.flashlightOn = msg?.on === true;
    });

    this.onMessage(
      "setDevOptions",
      (
        client,
        msg: {
          infinite?: boolean;
          tracers?: boolean;
          unlockStreaks?: boolean;
        }
      ) => {
        const id = client.sessionId;
        if (typeof msg?.infinite === "boolean") {
          if (msg.infinite) this.devInfiniteClients.add(id);
          else this.devInfiniteClients.delete(id);
        }
        if (typeof msg?.tracers === "boolean") {
          if (msg.tracers) this.devTracerClients.add(id);
          else this.devTracerClients.delete(id);
        }
        if (typeof msg?.unlockStreaks === "boolean") {
          if (msg.unlockStreaks) this.devUnlockStreaksClients.add(id);
          else this.devUnlockStreaksClients.delete(id);
        }
      }
    );

    this.onMessage("change_skin", (client, skinId: string) => {
      if (typeof skinId !== "string") return;
      const p = this.state.players.get(client.sessionId);
      if (p) {
        p.skinId = skinId.slice(0, 32);
      }
    });

    /** Arma + skin de arma visíveis para os outros jogadores. */
    this.onMessage(
      "sync_visual",
      (client, msg: { weaponId?: unknown; weaponSkinId?: unknown; weaponSkinParts?: unknown }) => {
        const p = this.state.players.get(client.sessionId);
        if (!p) return;
        this.applyWeaponVisual(p, msg?.weaponId, msg?.weaponSkinId, msg?.weaponSkinParts);
      }
    );

    /**
     * Convidados informam o XP guardado no navegador para a patente
     * aparecer no pré-lobby/placar. Com conta autenticada o banco manda.
     */
    this.onMessage("syncXp", (client, msg: { xp?: unknown }) => {
      if (this.userIds.has(client.sessionId)) return;
      const p = this.state.players.get(client.sessionId);
      if (!p) return;
      p.xp = clampInt(msg?.xp, 0, MAX_XP, 0);
    });

    /** Convidados também informam o gold guardado no navegador. */
    this.onMessage("syncGold", (client, msg: { gold?: unknown }) => {
      if (this.userIds.has(client.sessionId)) return;
      const p = this.state.players.get(client.sessionId);
      if (!p) return;
      p.gold = clampInt(msg?.gold, 0, MAX_GOLD, 0);
    });

    this.onMessage("chat", (client, msg: { text?: unknown }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || typeof msg?.text !== "string") return;
      const text = msg.text.trim().slice(0, 160);
      if (!text) return;
      const now = Date.now();
      const last = this.lastChatAt.get(client.sessionId) ?? 0;
      if (now - last < 500) return;
      this.lastChatAt.set(client.sessionId, now);
      this.broadcast("chat", { senderId: client.sessionId, name: player.name, text });
    });

    /** Primeiro spawn do humano (após escolher kit no cliente). */
    this.onMessage("requestSpawn", (client) => {
      if (this.state.matchOver) return;
      const id = client.sessionId;
      const p = this.state.players.get(id);
      // Só spawna quem realmente entrou na partida (Start/Play).
      if (!p || !p.inMatch || p.alive || p.downed) return;
      if (this.isTdm() && !isTeamId(p.team)) return;
      // Morte: o timer de respawn manda; aqui só o spawn inicial / pós-reset.
      if (this.respawnAt.has(id)) return;
      this.respawnPlayer(id);
    });

    /** Suicídio voluntário — renasce na hora (troca de kit na partida). */
    this.onMessage("suicideRespawn", (client) => {
      if (this.state.matchOver) return;
      const id = client.sessionId;
      const p = this.state.players.get(id);
      if (!p || !p.alive || !p.inMatch) return;
      this.killSelf(id, { immediateRespawn: true });
    });

    /** Suicídio voluntário — fica em espectador até renascer manualmente. */
    this.onMessage("suicideSpectate", (client) => {
      if (this.state.matchOver) return;
      const id = client.sessionId;
      const p = this.state.players.get(id);
      if (!p || !p.alive || !p.inMatch) return;
      this.killSelf(id, { spectate: true });
    });

    this.setSimulationInterval(
      (dtMs) => this.update(dtMs / 1000),
      CONFIG.simulationIntervalMs
    );
  }

  async onJoin(client: Client, options: RoomCreateOptions): Promise<void> {
    let account: { id: number; username: string } | null = null;
    if (isAuthEnabled()) {
      const auth = await authenticateToken(options?.token);
      if (!auth.ok) {
        throw new Error(
          auth.reason === "session_replaced"
            ? "session_replaced"
            : "login_required"
        );
      }
      account = auth.account;
      bindClient(account.id, "deathmatch", client);
    }

    const name = account
      ? account.username
      : typeof options?.name === "string" && options.name.trim().length > 0
        ? options.name.trim().slice(0, 16)
        : `Player${Math.floor(Math.random() * 900 + 100)}`;

    const p = new PlayerState();
    p.name = name;
    p.userId = account?.id ?? 0;
    p.health = CONFIG.playerMaxHealth;
    // Entra em espectador: só aparece no mapa após requestSpawn.
    p.alive = false;
    p.x = 0;
    p.y = 0;
    p.z = 0;
    this.state.players.set(client.sessionId, p);
    if (this.isTdm()) p.team = this.smallerTeam();

    // Criador (primeiro humano) vira líder da sala.
    if (!this.state.hostId) {
      this.state.hostId = client.sessionId;
    }

    if (account) {
      this.userIds.set(client.sessionId, account.id);
      // Patente/gold: carrega o progresso de carreira do banco para a sala.
      void getUserProgress(account.id)
        .then((progress) => {
          const pl = this.state.players.get(client.sessionId);
          if (pl && progress) {
            pl.xp = progress.xp;
            pl.gold = progress.gold;
          }
        })
        .catch((err) => console.error("[auth] progress:", err));
    }

    this.pendingInputs.set(client.sessionId, []);
    this.history.set(client.sessionId, []);

    // Primeiro RTT o quanto antes — rewind com rtt=0 faz o hit “à frente” da hitbox.
    this.lastPingAt.set(client.sessionId, Date.now());
    client.send("sping", { t: Date.now() });

    this.rebalanceBots();
  }

  onLeave(client: Client): void {
    const id = client.sessionId;
    const userId = this.userIds.get(id);
    if (userId !== undefined) unbindClient(userId, client);
    this.state.players.delete(id);
    this.userIds.delete(id);
    this.bodies.delete(id);
    this.pendingInputs.delete(id);
    this.history.delete(id);
    this.rtt.delete(id);
    this.lastPingAt.delete(id);
    this.lastFireAt.delete(id);
    this.devInfiniteClients.delete(id);
    this.devTracerClients.delete(id);
    this.devUnlockStreaksClients.delete(id);
    this.lastDamagedAt.delete(id);
    this.lastChatAt.delete(id);
    this.respawnAt.delete(id);
    this.deathPos.delete(id);
    this.matchMultis.delete(id);
    this.matchXpEarned.delete(id);
    this.matchGoldEarned.delete(id);

    this.reviveHold.delete(id);

    if (this.state.hostId === id) {
      let nextHost = "";
      for (const pid of this.state.players.keys()) {
        if (!this.bots.has(pid)) {
          nextHost = pid;
          break;
        }
      }
      this.state.hostId = nextHost;
    }

    this.rebalanceBots();
    if (this.isZombies() && this.state.matchStarted && !this.state.matchOver) {
      this.checkZombieWipe();
    }
  }

  private update(dt: number): void {
    this.processPrepCountdown(dt);
    this.processHumanInputs();
    if (this.state.matchStarted) {
      for (const bot of this.bots.values()) bot.update(dt);
      for (const z of this.zombies.values()) z.update(dt);
    }
    this.pushHistory();
    this.pingClients();
    this.processRespawns();
    this.processHealthRegen(dt);
    this.processZombieWave(dt);
    this.processRevives(dt);
    this.processAmmoPickups();
    this.processMatchReset();
    this.processInvincibility(dt);
    if (!this.isZombies()) this.processKillStreaks(dt);
    this.processParachuteLandings();
  }

  private processKillStreaks(dt: number): void {
    for (const [id, p] of this.state.players) {
      if (p.streakTimeLeft > 0) {
        p.streakTimeLeft = Math.max(0, p.streakTimeLeft - dt);
        if (p.streakTimeLeft === 0) {
          if (isPredatorStreak(p.activeStreak)) this.jumpFromPredator(id, p);
          p.activeStreak = "";
        }
      }
      // Bots não têm tecla: ativam assim que um slot fica livre.
      const firstAvailable = p.availableStreaks[0];
      if (
        this.bots.has(id) &&
        p.alive &&
        !p.activeStreak &&
        !p.parachuting &&
        firstAvailable !== undefined
      ) {
        this.tryActivateStreak(id, p, firstAvailable);
      }
    }
  }

  /** Spawn-protect / streaks: o timer precisa correr também no modo Zombies. */
  private processInvincibility(dt: number): void {
    for (const p of this.state.players.values()) {
      if (p.invincibleTimeLeft > 0) {
        p.invincibleTimeLeft = Math.max(0, p.invincibleTimeLeft - dt);
      }
    }
  }

  /** Concede (ou estende) invencibilidade no jogador. */
  private grantInvincibility(player: PlayerState, seconds: number): void {
    player.invincibleTimeLeft = Math.max(player.invincibleTimeLeft, seconds);
  }

  /**
   * Ativa um streak liberado. Só vale se o jogador possuir o streak na
   * pilha de disponíveis e não houver nenhum outro ativo no momento.
   */
  private tryActivateStreak(
    playerId: string,
    p: PlayerState,
    id: string,
    devUnlock = false
  ): boolean {
    if (this.isZombies()) return false;
    if (p.activeStreak || p.parachuting) return false;
    const index = p.availableStreaks.indexOf(id);
    if (index < 0 && !devUnlock) return false;
    const reward = KILL_STREAK_REWARDS.find((r) => r.id === id);
    if (!reward) return false;
    if (index >= 0) p.availableStreaks.splice(index, 1);
    p.activeStreak = reward.id;
    p.streakTimeLeft = reward.duration;
    if (reward.id === "invincibility") {
      this.grantInvincibility(p, reward.duration);
    }
    if (reward.id === "predator") {
      this.mountPredator(playerId, p);
    }
    this.broadcast("killstreakActivated", {
      playerName: p.name,
      streakName: reward.name,
    });
    return true;
  }

  private predatorAltitude(): number {
    let maxTop = 6;
    for (const b of this.roomMap.boxes) {
      maxTop = Math.max(maxTop, b.y + b.h / 2);
    }
    return Math.max(PREDATOR.altitudeMin, maxTop + PREDATOR.altitudeClearance);
  }

  private predatorHoverPos(p: PlayerState): { x: number; y: number; z: number } {
    const cx = (this.roomMap.playMinX + this.roomMap.playMaxX) * 0.5;
    const cz = (this.roomMap.playMinZ + this.roomMap.playMaxZ) * 0.5;
    const x = p.x * 0.4 + cx * 0.6;
    const z = p.z * 0.4 + cz * 0.6;
    return { x, y: this.predatorAltitude(), z };
  }

  /** Sobe o jogador ao helicóptero e trava a física no chão. */
  private mountPredator(id: string, p: PlayerState): void {
    if (!id) return;
    const prevWeapon = p.weaponId && p.weaponId !== "minigun" ? p.weaponId : "m4a1";
    this.predatorWeapons.set(id, prevWeapon);
    p.parachuting = false;
    const hover = this.predatorHoverPos(p);
    p.x = hover.x;
    p.y = hover.y;
    p.z = hover.z;
    p.vy = 0;
    p.grounded = true;
    p.crouch = false;
    p.heliHp = PREDATOR.hp;
    p.weaponId = "minigun";
    const body = this.bodies.get(id);
    if (body) {
      body.x = hover.x;
      body.y = hover.y;
      body.z = hover.z;
      body.vy = 0;
      body.grounded = true;
    }
    this.bots.get(id)?.snapBody(hover.x, hover.y, hover.z);
  }

  /**
   * Salto de paraquedas quando o tempo do Predator acaba sem explosão.
   * Os pés ficam alinhados com a câmera da minigun para a transição não pular.
   */
  private jumpFromPredator(id: string, p: PlayerState): void {
    p.heliHp = 0;
    p.parachuting = true;
    p.crouch = false;
    const feetY = p.y + PREDATOR.eyeY - EYE_HEIGHT;
    p.y = feetY;
    p.vy = -PREDATOR.fallSpeed;
    p.grounded = false;
    const restored = this.predatorWeapons.get(id) ?? "m4a1";
    this.predatorWeapons.delete(id);
    p.weaponId = restored;
    const body = this.bodies.get(id);
    if (body) {
      body.x = p.x;
      body.y = feetY;
      body.z = p.z;
      body.vy = -PREDATOR.fallSpeed;
      body.grounded = false;
    }
    this.pendingInputs.get(id)?.splice(0);
    this.bots.get(id)?.snapBody(p.x, feetY, p.z, false, -PREDATOR.fallSpeed);
  }

  private clearPredator(id: string, p: PlayerState): void {
    this.predatorWeapons.delete(id);
    p.heliHp = 0;
    p.parachuting = false;
  }

  /** Termina o paraquedas ao tocar o chão (ou um teto). */
  private processParachuteLandings(): void {
    for (const p of this.state.players.values()) {
      if (!p.parachuting) continue;
      if (!p.alive) {
        p.parachuting = false;
        continue;
      }
      if (p.grounded) {
        p.parachuting = false;
        this.grantInvincibility(p, PREDATOR.landInvuln);
      }
    }
  }

  /** Aplica os inputs enfileirados de cada humano com a física compartilhada. */
  private processHumanInputs(): void {
    for (const [id, queue] of this.pendingInputs) {
      const p = this.state.players.get(id);
      const body = this.bodies.get(id);
      if (!p || !body) continue;

      if (!p.alive) {
        queue.length = 0;
        continue;
      }

      const count = Math.min(queue.length, MAX_INPUTS_PER_TICK);
      if (isPredatorStreak(p.activeStreak)) {
        for (let i = 0; i < count; i++) {
          const input = queue[i];
          stepPredator(body, input, this.roomMap);
          p.lastSeq = input.seq;
          p.yaw = input.yaw;
          if (typeof input.pitch === "number") p.pitch = input.pitch;
        }
        queue.splice(0, count);
        p.x = body.x;
        p.y = body.y;
        p.z = body.z;
        p.vy = 0;
        p.grounded = true;
        p.crouch = false;
        body.vy = 0;
        body.grounded = true;
        continue;
      }
      if (p.parachuting) {
        if (count === 0) {
          const idle = {
            seq: p.lastSeq,
            forward: 0,
            strafe: 0,
            yaw: p.yaw,
            jump: false,
            run: false,
            crouch: false,
          };
          stepParachute(body, idle, this.roomMap);
          stepParachute(body, idle, this.roomMap);
        } else {
          for (let i = 0; i < count; i++) {
            const input = queue[i];
            stepParachute(body, input, this.roomMap);
            p.lastSeq = input.seq;
            p.yaw = input.yaw;
            if (typeof input.pitch === "number") p.pitch = input.pitch;
          }
          queue.splice(0, count);
        }
        p.x = body.x;
        p.y = body.y;
        p.z = body.z;
        p.vy = body.vy;
        p.grounded = body.grounded;
        p.crouch = false;
        continue;
      }
      for (let i = 0; i < count; i++) {
        const input = queue[i];
        stepPlayer(body, input, this.roomMap);
        p.lastSeq = input.seq;
        p.yaw = input.yaw;
        if (typeof input.pitch === "number") p.pitch = input.pitch;
        p.crouch = Boolean(input.crouch);
      }
      queue.splice(0, count);

      p.x = body.x;
      p.y = body.y;
      p.z = body.z;
      p.vy = body.vy;
      p.grounded = body.grounded;
    }
  }

  /** Grava a posição de todos (humanos e bots) para o rewind do hitscan. */
  private pushHistory(): void {
    const now = Date.now();
    for (const [id, p] of this.state.players) {
      let h = this.history.get(id);
      if (!h) {
        h = [];
        this.history.set(id, h);
      }
      h.push({ t: now, x: p.x, y: p.y, z: p.z });
      while (h.length > 0 && now - h[0].t > HISTORY_WINDOW_MS) h.shift();
    }
  }

  /** Ping periódico para medir RTT (usado no rewind). */
  private pingClients(): void {
    const now = Date.now();
    for (const client of this.clients) {
      const last = this.lastPingAt.get(client.sessionId) ?? 0;
      if (now - last < 500) continue;
      this.lastPingAt.set(client.sessionId, now);
      client.send("sping", { t: now });
    }
  }

  /** Posição de um combatente há `rewindMs` atrás (lerp no histórico). */
  private sampleHistory(id: string, rewindMs: number): Vec3 | null {
    const p = this.state.players.get(id);
    if (!p) return null;
    const h = this.history.get(id);
    const targetT = Date.now() - rewindMs;

    if (!h || h.length === 0) return { x: p.x, y: p.y, z: p.z };
    if (targetT >= h[h.length - 1].t) {
      const last = h[h.length - 1];
      return { x: last.x, y: last.y, z: last.z };
    }
    if (targetT <= h[0].t) return { x: h[0].x, y: h[0].y, z: h[0].z };

    for (let i = h.length - 2; i >= 0; i--) {
      if (h[i].t <= targetT) {
        const a = h[i];
        const b = h[i + 1];
        const f = (targetT - a.t) / Math.max(1, b.t - a.t);
        return {
          x: a.x + (b.x - a.x) * f,
          y: a.y + (b.y - a.y) * f,
          z: a.z + (b.z - a.z) * f,
        };
      }
    }
    return { x: p.x, y: p.y, z: p.z };
  }

  private processRespawns(): void {
    if (this.state.matchOver) return;
    const now = Date.now();
    for (const [id, at] of this.respawnAt) {
      if (now < at) continue;
      this.respawnAt.delete(id);
      this.respawnPlayer(id);
    }
  }

  /** Regenera apenas jogadores vivos que ficaram três segundos sem dano. */
  private processHealthRegen(dt: number): void {
    if (this.state.matchOver) return;
    const now = Date.now();
    for (const [id, player] of this.state.players) {
      if (!player.alive || player.isZombie || player.health >= CONFIG.playerMaxHealth) continue;
      if (isPredatorStreak(player.activeStreak)) continue;
      const lastDamage = this.lastDamagedAt.get(id) ?? now;
      if (now - lastDamage < CONFIG.healthRegenDelay * 1000) continue;
      player.health = Math.min(
        CONFIG.playerMaxHealth,
        player.health + CONFIG.healthRegenPerSecond * dt
      );
    }
  }

  private respawnPlayer(id: string): void {
    const p = this.state.players.get(id);
    if (!p) return;

    const spawn = pickSpawnFarFrom(
      this.deathPos.get(id) ?? null,
      this.spawnPointsFor(p)
    );
    p.x = spawn.x;
    p.z = spawn.z;
    p.y = spawn.y ?? 0;
    p.vy = 0;
    p.grounded = true;
    p.health = CONFIG.playerMaxHealth;
    p.heliHp = 0;
    p.parachuting = false;
    this.predatorWeapons.delete(id);
    this.lastDamagedAt.delete(id);
    p.alive = true;
    p.downed = false;
    p.reviveProgress = 0;
    p.weaponSkinId = "";
    p.weaponSkinParts = "";
    this.grantInvincibility(p, CONFIG.spawnInvincibilityDuration);

    const bot = this.bots.get(id);
    if (bot) {
      bot.reset();
      return;
    }

    this.bodies.set(id, createBody(spawn.x, spawn.z, spawn.y ?? 0));
    this.pendingInputs.get(id)?.splice(0);
    this.history.set(id, []);
    const client = this.clients.find((c) => c.sessionId === id);
    client?.send("respawn", { x: spawn.x, z: spawn.z, y: spawn.y ?? 0 });
  }

  /** Fim de partida: placar zera e todos os humanos voltam ao pré-lobby. */
  private processMatchReset(): void {
    if (!this.state.matchOver || Date.now() < this.matchResetAt) return;

    this.state.matchOver = false;
    this.state.winnerName = "";
    this.state.winnerTeam = "";
    this.state.teamKillsAlpha = 0;
    this.state.teamKillsEcho = 0;
    this.state.matchStarted = false;
    this.state.zombieRound = 0;
    this.state.zombiesAlive = 0;
    this.state.zombiesLeft = 0;
    this.state.prepTimeLeft = 0;
    this.state.zombiePhase = this.isZombies() ? "lobby" : "";
    this.clearZombies();
    this.clearAmmoDrops();
    this.clearWeaponDrops();
    this.reviveHold.clear();
    this.statsRecorded = false;
    this.matchResetAt = 0;
    this.respawnAt.clear();
    this.deathPos.clear();
    this.predatorWeapons.clear();
    this.matchMultis.clear();
    this.matchXpEarned.clear();
    this.matchGoldEarned.clear();

    for (const [id, p] of this.state.players) {
      p.kills = 0;
      p.deaths = 0;
      p.killStreak = 0;
      p.activeStreak = "";
      p.streakTimeLeft = 0;
      p.invincibleTimeLeft = 0;
      p.heliHp = 0;
      p.parachuting = false;
      p.flashlightOn = false;
      p.availableStreaks.clear();
      p.matchXp = 0;
      p.doubleKills = 0;
      p.tripleKills = 0;
      p.multiKills = 0;
      p.health = CONFIG.playerMaxHealth;
      p.alive = false;
      p.downed = false;
      p.reviveProgress = 0;
      this.history.set(id, []);
      if (this.bots.has(id)) {
        // Bot aguarda o próximo start num spawn limpo.
        const spawn = randomSpawn(this.spawnPointsFor(p));
        p.x = spawn.x;
        p.z = spawn.z;
        p.y = spawn.y ?? 0;
        p.vy = 0;
        this.bots.get(id)?.reset();
      } else {
        p.inMatch = false;
        p.ready = false;
        this.bodies.delete(id);
        this.pendingInputs.get(id)?.splice(0);
      }
    }
    this.broadcast("matchReset");
    this.broadcast("backToLobby");
    void this.syncMetadata();
  }

  /** Inicia a partida com o líder + todos os humanos prontos (e os bots). */
  private startMatch(): void {
    const zombies = this.isZombies();
    const joining = new Set<string>();
    for (const client of this.clients) {
      const p = this.state.players.get(client.sessionId);
      if (!p) continue;
      if (zombies || client.sessionId === this.state.hostId || p.ready) {
        joining.add(client.sessionId);
      }
    }

    this.state.matchStarted = true;
    this.state.matchOver = false;
    this.state.winnerName = "";
    this.state.winnerTeam = "";
    this.state.teamKillsAlpha = 0;
    this.state.teamKillsEcho = 0;
    this.state.zombieRound = zombies ? 1 : 0;
    this.state.zombiesAlive = 0;
    this.state.zombiesLeft = 0;
    this.state.prepTimeLeft = zombies ? ZOMBIES_PREP_SECONDS : 0;
    this.state.zombiePhase = zombies ? "prep" : "";
    this.statsRecorded = false;
    this.matchResetAt = 0;
    this.respawnAt.clear();
    this.deathPos.clear();
    this.predatorWeapons.clear();
    this.matchMultis.clear();
    this.matchXpEarned.clear();
    this.matchGoldEarned.clear();
    this.reviveHold.clear();
    this.clearZombies();
    this.clearAmmoDrops();
    this.clearWeaponDrops();

    for (const [, p] of this.state.players) {
      p.kills = 0;
      p.deaths = 0;
      p.killStreak = 0;
      p.activeStreak = "";
      p.streakTimeLeft = 0;
      p.invincibleTimeLeft = 0;
      p.heliHp = 0;
      p.parachuting = false;
      p.flashlightOn = false;
      p.availableStreaks.clear();
      p.matchXp = 0;
      p.doubleKills = 0;
      p.tripleKills = 0;
      p.multiKills = 0;
      p.health = CONFIG.playerMaxHealth;
      p.alive = false;
      p.ready = false;
      p.downed = false;
      p.reviveProgress = 0;
    }

    if (this.isTdm()) this.rebalanceBotTeams();
    for (const id of this.bots.keys()) {
      const p = this.state.players.get(id);
      if (!p) continue;
      p.inMatch = true;
      this.respawnPlayer(id);
    }

    for (const client of this.clients) {
      const p = this.state.players.get(client.sessionId);
      if (!p) continue;
      p.inMatch = joining.has(client.sessionId);
      if (p.inMatch) {
        client.send("matchStart");
        if (zombies) this.respawnPlayer(client.sessionId);
      }
    }
    void this.syncMetadata();
  }

  /** Aplica as configurações enviadas pelo líder (somente pré-lobby). */
  private applySettings(msg: RoomSettingsMessage): void {
    if (typeof msg.roomName === "string") {
      this.state.roomName = sanitizeRoomName(msg.roomName);
    }
    if (typeof msg.mapId === "string") {
      this.applyRoomMap(msg.mapId, msg.customMap);
    }
    if (
      typeof msg.gameMode === "string" &&
      GAME_MODES.some((m) => m.id === msg.gameMode)
    ) {
      const next = msg.gameMode;
      if (next !== this.state.gameMode) {
        this.state.gameMode = next;
        this.applyGameModeTeams();
        if (isZombiesMode(next)) {
          this.desiredBots = 0;
          this.state.desiredBots = 0;
          const humans = this.state.players.size - this.bots.size;
          const maxPlayers = clampInt(
            this.state.maxPlayers,
            Math.max(1, humans),
            ZOMBIES_MAX_PLAYERS,
            ZOMBIES_MAX_PLAYERS
          );
          this.maxClients = maxPlayers;
          this.roomCapacity = maxPlayers;
          this.state.maxPlayers = maxPlayers;
          this.state.zombiePhase = "lobby";
        } else {
          this.state.zombiePhase = "";
          this.state.prepTimeLeft = 0;
        }
      }
    }
    if (typeof msg.killsToWin === "number") {
      this.state.killsToWin = clampInt(msg.killsToWin, 1, 100, this.state.killsToWin);
    }
    if (typeof msg.maxPlayers === "number") {
      const humans = this.state.players.size - this.bots.size - this.zombies.size;
      const cap = this.isZombies() ? ZOMBIES_MAX_PLAYERS : CONFIG.roomSize;
      const minP = this.isZombies() ? Math.max(1, humans) : Math.max(2, humans);
      const maxPlayers = clampInt(
        msg.maxPlayers,
        minP,
        cap,
        this.state.maxPlayers
      );
      this.maxClients = maxPlayers;
      this.roomCapacity = maxPlayers;
      this.state.maxPlayers = maxPlayers;
      if (this.desiredBots > maxPlayers - 1) {
        this.desiredBots = Math.max(0, maxPlayers - 1);
        this.state.desiredBots = this.desiredBots;
      }
    }
    if (typeof msg.bots === "number" && !this.isZombies()) {
      this.desiredBots = clampInt(msg.bots, 0, this.roomCapacity - 1, this.desiredBots);
      this.state.desiredBots = this.desiredBots;
    }
    if (this.isZombies()) {
      this.desiredBots = 0;
      this.state.desiredBots = 0;
    }
    void this.syncMetadata();
    this.rebalanceBots();
  }

  /** Define o mapa da sala (oficial ou JSON custom enviado pelo host). */
  private applyRoomMap(mapId: unknown, customMap?: unknown): void {
    if (typeof mapId === "string" && isCustomMapId(mapId)) {
      const def = sanitizeCustomMap(customMap);
      if (def) {
        def.id = mapId.slice(0, 48);
        const geo = customMapToGeometry(def);
        this.roomMap = geometryToCollision(geo, def.name);
        this.state.mapId = def.id;
        this.state.mapPayload = JSON.stringify(def);
        return;
      }
    }
    if (typeof mapId === "string" && MAPS.some((m) => m.id === mapId)) {
      this.roomMap = geometryToCollision(defaultPracaGeometry(), "Praça");
      this.state.mapId = mapId;
      this.state.mapPayload = "";
      return;
    }
    this.roomMap = geometryToCollision(defaultPracaGeometry(), "Praça");
    this.state.mapId = MAPS[0].id;
    this.state.mapPayload = "";
  }

  /** Publica o estado atual da sala na listagem do lobby. */
  private syncMetadata(): Promise<unknown> {
    const mapLabel =
      MAPS.find((m) => m.id === this.state.mapId)?.label ?? this.roomMap.label;
    return this.setMetadata({
      map: mapLabel,
      name: this.state.roomName,
      bots: this.desiredBots,
      maxPlayers: this.state.maxPlayers,
      gameMode: this.state.gameMode,
      killsToWin: this.state.killsToWin,
      matchStarted: this.state.matchStarted,
    });
  }

  /**
   * Arma + skin visíveis para os outros clientes.
   * Prefere o catálogo do servidor; se a skin ainda não estiver lá,
   * usa as cores enviadas pelo dono (estúdio / catálogo atrasado).
   */
  private applyWeaponVisual(
    p: PlayerState,
    weaponIdRaw: unknown,
    skinIdRaw: unknown,
    partsRaw: unknown
  ): void {
    if (typeof weaponIdRaw === "string") {
      const w = resolveWeaponId(weaponIdRaw);
      if (w) p.weaponId = w;
    }
    if (p.weaponId === "minigun") return;
    if (skinIdRaw === undefined && partsRaw === undefined) return;

    const skinId =
      typeof skinIdRaw === "string" ? skinIdRaw.slice(0, 64) : "";
    if (!skinId) {
      p.weaponSkinId = "";
      p.weaponSkinParts = "";
      return;
    }

    const catalog = getWeaponSkin(skinId);
    if (catalog && catalog.weaponId === p.weaponId) {
      p.weaponSkinId = catalog.id;
      p.weaponSkinParts = encodeWeaponSkinParts(catalog.parts, catalog.textures);
      return;
    }

    const looks = decodeWeaponSkinLooks(partsRaw);
    if (looks) {
      p.weaponSkinId = skinId;
      p.weaponSkinParts = encodeWeaponSkinParts(looks.parts, looks.textures);
      return;
    }

    p.weaponSkinId = "";
    p.weaponSkinParts = "";
  }

  // --- Combate (hitscan server-side com lag compensation) ---

  private handleFire(client: Client, msg: FireMessage): void {
    if (this.state.matchOver) return;

    const shooterId = client.sessionId;
    const shooter = this.state.players.get(shooterId);
    const weapon = getWeapon(msg?.weaponId);
    if (!shooter || !shooter.alive || !weapon) return;
    const aerial = isPredatorStreak(shooter.activeStreak);
    if (aerial && weapon.id !== "minigun") return;
    if (!aerial && weapon.id === "minigun") return;
    this.applyWeaponVisual(shooter, weapon.id, msg?.weaponSkinId, msg?.weaponSkinParts);
    if (!Array.isArray(msg.dirs) || msg.dirs.length === 0) return;
    if (msg.dirs.length > weapon.pellets) return;

    // Rate limit por arma (com tolerância para jitter).
    const now = Date.now();
    const last = this.lastFireAt.get(shooterId) ?? 0;
    if (now - last < weapon.fireInterval * 1000 * 0.8) return;
    this.lastFireAt.set(shooterId, now);

    // Origem precisa estar perto do olho do jogador no servidor.
    const eyeH = aerial
      ? PREDATOR.eyeY
      : shooter.crouch
        ? CROUCH_EYE_HEIGHT
        : EYE_HEIGHT;
    const eye: Vec3 = {
      x: shooter.x,
      y: shooter.y + eyeH,
      z: shooter.z,
    };
    const originDist = Math.sqrt(
      (msg.ox - eye.x) ** 2 + (msg.oy - eye.y) ** 2 + (msg.oz - eye.z) ** 2
    );
    if (originDist > (aerial ? 3.5 : 2)) return;
    // Após validar o pedido, o traço parte sempre do olho calculado pelo
    // servidor — nunca da posição declarada pelo cliente.
    const origin: Vec3 = eye;

    // Rewind: RTT/2 + interpDelay (mesma janela do RemotePlayer no cliente).
    const rewindMs = Math.min(
      HISTORY_WINDOW_MS,
      (this.rtt.get(shooterId) ?? 0) / 2 + CONFIG.interpDelayMs
    );

    // Posições rebobinadas dos alvos possíveis.
    const targets: Array<{ id: string; pos: Vec3 }> = [];
    for (const [id, p] of this.state.players) {
      if (id === shooterId || !p.alive) continue;
      if (this.sameTeam(shooter, p)) continue;
      const pos = this.sampleHistory(id, rewindMs);
      if (pos) targets.push({ id, pos });
    }

    const ends: Array<{ x: number; y: number; z: number; hit: boolean; head: boolean }> = [];
    let confirmedHit = false;
    let confirmedHeadshot = false;

    for (const rawDir of msg.dirs) {
      const dlen = Math.hypot(rawDir.x, rawDir.y, rawDir.z);
      if (dlen < 1e-6) continue;
      const dir: Vec3 = {
        x: rawDir.x / dlen,
        y: rawDir.y / dlen,
        z: rawDir.z / dlen,
      };

      const range = weaponMaxRange(weapon);
      const tMap = raycastMap(origin, dir, range, this.roomMap);
      let tBest = tMap;
      let hitId: string | null = null;
      let hitPart: "head" | "body" = "body";

      for (const target of targets) {
        const targetPlayer = this.state.players.get(target.id);
        if (isPredatorStreak(targetPlayer?.activeStreak)) {
          const tHeli = rayAabb(
            origin,
            dir,
            target.pos.x,
            target.pos.y,
            target.pos.z,
            PREDATOR.hitHalf.x,
            PREDATOR.hitHalf.y,
            PREDATOR.hitHalf.z,
            tBest
          );
          if (tHeli !== null && tHeli < tBest) {
            tBest = tHeli;
            hitId = target.id;
            hitPart = "body";
          }
          continue;
        }
        const crouched = Boolean(targetPlayer?.crouch);
        const scale = targetPlayer?.isBoss ? ZOMBIE_BOSS_SCALE : 1;
        const yaw = targetPlayer?.yaw ?? 0;
        const headY = (crouched ? CROUCH_HEAD_CENTER_Y : HEAD_CENTER_Y) * scale;
        const headFwd = crouched ? CROUCH_HEAD_FORWARD * scale : 0;
        const headX = target.pos.x + Math.sin(yaw) * headFwd;
        const headZ = target.pos.z + Math.cos(yaw) * headFwd;
        const bodyY = (crouched ? CROUCH_BODY_CENTER_Y : BODY_CENTER_Y) * scale;
        const bodyHalfY = (crouched ? CROUCH_BODY_HALF_Y : BODY_HALF.y) * scale;
        const tHead = raySphere(
          origin, dir,
          headX, target.pos.y + headY, headZ,
          HEAD_RADIUS * scale, tBest
        );
        if (tHead !== null && tHead < tBest) {
          tBest = tHead;
          hitId = target.id;
          hitPart = "head";
          continue;
        }
        const tBody = rayAabb(
          origin, dir,
          target.pos.x, target.pos.y + bodyY, target.pos.z,
          BODY_HALF.x * scale, bodyHalfY, BODY_HALF.z * scale, tBest
        );
        if (tBody !== null && tBody < tBest) {
          tBest = tBody;
          hitId = target.id;
          hitPart = "body";
        }
      }

      ends.push({
        x: origin.x + dir.x * tBest,
        y: origin.y + dir.y * tBest,
        z: origin.z + dir.z * tBest,
        hit: hitId !== null,
        head: hitId !== null && hitPart === "head",
      });

      if (hitId) {
        const base =
          hitPart === "head" ? weapon.damageHead : weapon.damageBody;
        const damage = base * damageFalloff(tBest, weapon);
        if (this.applyDamage(hitId, damage, shooterId, weapon.name)) {
          confirmedHit = true;
          confirmedHeadshot ||= hitPart === "head";
        }
      }
    }

    // O hitmarker do atirador só aparece após dano realmente aplicado.
    if (confirmedHit) client.send("hitConfirm", { headshot: confirmedHeadshot });

    // Tracers para os outros clientes.
    this.broadcast(
      "remoteShots",
      { shooterId, ends },
      { except: client }
    );

    // Só o jogador em debug recebe o traço que o servidor realmente usou.
    if (this.devTracerClients.has(shooterId)) {
      client.send("debugShot", { origin, ends });
    }
  }

  /** Morte voluntária (renascer / espectador) — sem kill feed nem crédito de abate. */
  private killSelf(
    targetId: string,
    opts: { immediateRespawn?: boolean; spectate?: boolean }
  ): void {
    const target = this.state.players.get(targetId);
    if (!target || !target.alive) return;

    target.alive = false;
    target.deaths++;
    target.killStreak = 0;
    target.activeStreak = "";
    target.streakTimeLeft = 0;
    target.invincibleTimeLeft = 0;
    target.availableStreaks.clear();
    this.clearPredator(targetId, target);

    const victimClient = this.clients.find((c) => c.sessionId === targetId);
    victimClient?.send("died", {
      killerName: target.name,
      weaponName: "Suicídio",
      killerHealth: 0,
      voluntary: opts.spectate ? "spectate" : "respawn",
      downed: this.isZombies(),
    });

    this.deathPos.set(targetId, { x: target.x, z: target.z });

    if (this.isZombies()) {
      target.downed = true;
      target.reviveProgress = 0;
      this.checkZombieWipe();
      return;
    }

    if (opts.spectate) {
      this.bodies.delete(targetId);
      this.pendingInputs.get(targetId)?.splice(0);
      this.history.set(targetId, []);
    } else {
      this.respawnAt.set(targetId, Date.now() + CONFIG.respawnDelay * 1000);
    }
  }

  private applyDamage(
    targetId: string,
    amount: number,
    attackerId: string,
    weaponName: string
  ): boolean {
    if (this.state.matchOver) return false;
    const target = this.state.players.get(targetId);
    const attacker = this.state.players.get(attackerId);
    if (!target || !target.alive) return false;
    if (this.sameTeam(attacker, target)) return false;

    // Spawn protection / killstreak invincibility.
    if (target.invincibleTimeLeft > 0) return false;

    // Vida infinita precisa ser aplicada aqui, no lado autoritativo.
    if (this.devInfiniteClients.has(targetId)) {
      target.health = CONFIG.playerMaxHealth;
      return false;
    }

    if (isPredatorStreak(target.activeStreak)) {
      target.heliHp = Math.max(0, target.heliHp - Math.round(amount));
      this.lastDamagedAt.set(targetId, Date.now());
      const victimClient = this.clients.find((c) => c.sessionId === targetId);
      if (attacker) {
        victimClient?.send("damaged", {
          x: attacker.x,
          y: attacker.y,
          z: attacker.z,
        });
      }
      if (target.heliHp > 0) return true;
      this.broadcast("heliExploded", {
        x: target.x,
        y: target.y,
        z: target.z,
        victimId: targetId,
      });
      target.health = 0;
    } else {
      target.health = Math.max(0, target.health - Math.round(amount));
      this.lastDamagedAt.set(targetId, Date.now());

      const victimClient = this.clients.find((c) => c.sessionId === targetId);
      if (attacker) {
        victimClient?.send("damaged", {
          x: attacker.x,
          y: attacker.y,
          z: attacker.z,
        });
      }

      if (target.health > 0) return true;
    }

    target.alive = false;
    target.deaths++;
    target.killStreak = 0;
    target.activeStreak = "";
    target.streakTimeLeft = 0;
    target.invincibleTimeLeft = 0;
    target.availableStreaks.clear();
    this.clearPredator(targetId, target);

    if (attacker && attackerId !== targetId) {
      attacker.kills++;
      if (!this.isZombies()) {
        attacker.killStreak++;
        this.trackMultikill(attackerId);
        const reward = KILL_STREAK_REWARDS.find((r) => r.kills === attacker.killStreak);
        if (reward && !attacker.availableStreaks.includes(reward.id)) {
          attacker.availableStreaks.push(reward.id);
          this.broadcast("killstreakEarned", {
            playerName: attacker.name,
            streakName: reward.name,
          });
        }
      }
    }

    const killerName = attacker?.name ?? "?";
    const killerHealth = attacker ? Math.round(attacker.health) : 0;
    this.broadcast("kill", {
      killerId: attackerId,
      killerName,
      victimId: targetId,
      victimName: target.name,
      weaponName,
    });

    const victimClient = this.clients.find((c) => c.sessionId === targetId);
    victimClient?.send("died", {
      killerName,
      weaponName,
      killerHealth,
      downed: this.isZombies() && !target.isZombie,
    });

    this.deathPos.set(targetId, { x: target.x, z: target.z });

    if (this.isZombies()) {
      if (target.isZombie) {
        this.onZombieKilled(targetId, target);
      } else {
        target.downed = true;
        target.reviveProgress = 0;
        this.checkZombieWipe();
      }
      return true;
    }

    this.respawnAt.set(targetId, Date.now() + CONFIG.respawnDelay * 1000);

    if (this.isTdm() && attacker && isTeamId(attacker.team)) {
      if (attacker.team === "alpha") this.state.teamKillsAlpha++;
      else this.state.teamKillsEcho++;
      const teamKills =
        attacker.team === "alpha"
          ? this.state.teamKillsAlpha
          : this.state.teamKillsEcho;
      if (teamKills >= this.state.killsToWin) {
        this.finishMatch(attackerId, attacker.team);
      }
    } else if (attacker && attacker.kills >= this.state.killsToWin) {
      this.finishMatch(attackerId);
    }
    return true;
  }

  /**
   * Contabiliza a sequência de multi-kill (double/triple/multi) para o
   * XP de fim de partida — mesma janela de 5s das medalhas do HUD.
   * Os contadores vão ao estado para o detalhamento do XP no cliente.
   */
  private trackMultikill(id: string): void {
    const now = Date.now();
    let m = this.matchMultis.get(id);
    if (!m) {
      m = { chain: 0, expiresAt: 0, double: 0, triple: 0, multi: 0 };
      this.matchMultis.set(id, m);
    }
    m.chain = now <= m.expiresAt ? m.chain + 1 : 1;
    m.expiresAt = now + MULTIKILL_WINDOW_MS;
    const p = this.state.players.get(id);
    if (m.chain === 2) {
      m.double++;
      if (p) p.doubleKills = m.double;
    } else if (m.chain === 3) {
      m.triple++;
      if (p) p.tripleKills = m.triple;
    } else if (m.chain >= 4) {
      m.multi++;
      if (p) p.multiKills = m.multi;
    }
  }

  /**
   * Concede o XP e o gold de fim de partida a todo humano que participou:
   * base + kills + multi-kills + vitória. Os totais (p.xp / p.gold) são
   * otimistas — contas autenticadas são corrigidas pelo RETURNING do banco.
   */
  private awardMatchRewards(winnerId: string): void {
    for (const [id, p] of this.state.players) {
      if (this.bots.has(id) || !p.inMatch) continue;
      const earned =
        XP_RULES.matchPlayed +
        p.kills * XP_RULES.kill +
        p.doubleKills * XP_RULES.doubleKill +
        p.tripleKills * XP_RULES.tripleKill +
        p.multiKills * XP_RULES.multiKill +
        (this.isMatchWinner(id, p.team, winnerId) ? XP_RULES.victory : 0);
      p.matchXp = earned;
      p.xp += earned;
      this.matchXpEarned.set(id, earned);

      const goldEarned = matchGoldFor({
        kills: p.kills,
        doubleKills: p.doubleKills,
        tripleKills: p.tripleKills,
        multiKills: p.multiKills,
        won: this.isMatchWinner(id, p.team, winnerId),
      });
      p.matchGold = goldEarned;
      p.gold += goldEarned;
      this.matchGoldEarned.set(id, goldEarned);
    }
  }

  /** Grava kills/deaths/wins/xp/gold dos humanos autenticados no fim da partida. */
  private async persistMatchStats(winnerId: string): Promise<void> {
    if (this.statsRecorded || !isAuthEnabled()) return;
    this.statsRecorded = true;
    const jobs: Promise<void>[] = [];
    for (const [sessionId, userId] of this.userIds) {
      const p = this.state.players.get(sessionId);
      // Quem ficou no pré-lobby não jogou: sem stats nem recompensas.
      if (!p || !p.inMatch) continue;
      const xpEarned = this.matchXpEarned.get(sessionId) ?? 0;
      const goldEarned = this.matchGoldEarned.get(sessionId) ?? 0;
      jobs.push(
        recordMatchStats(userId, {
          kills: p.kills,
          deaths: p.deaths,
          won: this.isMatchWinner(sessionId, p.team, winnerId),
          xpEarned,
          goldEarned,
        })
          .then((totals) => {
            const pl = this.state.players.get(sessionId);
            if (pl && totals) {
              pl.xp = totals.xp;
              pl.gold = totals.gold;
            }
          })
          .catch((err) => console.error("[auth] stats:", err))
      );
    }
    await Promise.all(jobs);
  }

  // --- Bots ---

  /**
   * Mantém a quantidade de bots = min(desiredBots, slots livres).
   * Humano entra → bot sai; humano sai → bot volta (troca suave).
   */
  private rebalanceBots(): void {
    if (this.isZombies()) {
      this.desiredBots = 0;
      this.state.desiredBots = 0;
      while (this.bots.size > 0) this.removeOneBot();
      return;
    }
    const humans = this.state.players.size - this.bots.size;
    const maxBots = Math.max(0, this.roomCapacity - humans);
    const target = Math.min(this.desiredBots, maxBots);

    while (this.bots.size > target) this.removeOneBot();
    while (this.bots.size < target) this.addBot();
    this.rebalanceBotTeams();
  }

  private addBot(): void {
    const id = `bot_${this.botCounter++}`;
    const name =
      this.namePool.pop() ?? `Recruta${Math.floor(Math.random() * 99)}`;

    const p = new PlayerState();
    p.name = name;
    p.health = CONFIG.playerMaxHealth;
    p.isBot = true;
    // Bots nunca ficam no pré-lobby: entram em toda partida.
    p.inMatch = true;

    // Bots sempre usam a skin Padrão
    p.skinId = DEFAULT_SKIN;
    if (this.isTdm()) p.team = this.smallerTeam();

    const spawn = randomSpawn(this.spawnPointsFor(p));
    p.x = spawn.x;
    p.z = spawn.z;
    p.y = spawn.y ?? 0;
    this.state.players.set(id, p);
    this.history.set(id, []);

    const world: BotWorld = {
      getPlayers: () =>
        this.state.players as unknown as Map<string, PlayerState>,
      applyDamage: (t, a, k, w) => this.applyDamage(t, a, k, w),
      broadcastShot: (e: ShotEvent) => this.broadcast("shot", e),
      isMatchOver: () => this.state.matchOver,
      getMap: () => this.roomMap,
      getSpawns: (team) => [...this.spawnPointsForTeam(team ?? "")],
    };
    this.bots.set(id, new BotAi(id, p, world));
  }

  private removeOneBot(): void {
    const first = this.bots.keys().next();
    if (first.done) return;
    const id = first.value;
    this.bots.delete(id);
    this.state.players.delete(id);
    this.history.delete(id);
    this.respawnAt.delete(id);
    this.deathPos.delete(id);
  }

  private isTdm(): boolean {
    return isTdmMode(this.state.gameMode);
  }

  private isZombies(): boolean {
    return isZombiesMode(this.state.gameMode);
  }

  private sameTeam(a: PlayerState | undefined, b: PlayerState | undefined): boolean {
    if (!a || !b) return false;
    if (this.isZombies()) return a.isZombie === b.isZombie;
    if (!this.isTdm()) return false;
    return isTeamId(a.team) && a.team === b.team;
  }

  private teamCount(team: TeamId): number {
    let n = 0;
    for (const p of this.state.players.values()) {
      if (p.team === team) n++;
    }
    return n;
  }

  private smallerTeam(): TeamId {
    return this.teamCount("alpha") <= this.teamCount("echo") ? "alpha" : "echo";
  }

  private spawnPointsFor(p: PlayerState): readonly { x: number; z: number; y?: number }[] {
    return this.spawnPointsForTeam(p.team);
  }

  private spawnPointsForTeam(team: string): readonly { x: number; z: number; y?: number }[] {
    return spawnsForTeam(team, this.roomMap);
  }

  private applyGameModeTeams(): void {
    if (this.isZombies() || !this.isTdm()) {
      this.state.teamKillsAlpha = 0;
      this.state.teamKillsEcho = 0;
      this.state.winnerTeam = "";
      for (const p of this.state.players.values()) p.team = "";
      return;
    }
    for (const p of this.state.players.values()) {
      if (!isTeamId(p.team)) p.team = this.smallerTeam();
    }
    this.rebalanceBotTeams();
  }

  private handleSetTeam(client: Client, raw: unknown): void {
    if (!this.isTdm() || !isTeamId(raw)) return;
    const id = client.sessionId;
    const p = this.state.players.get(id);
    if (!p) return;
    if (p.team === raw) return;
    p.team = raw;
    if (p.alive && p.inMatch && this.state.matchStarted && !this.state.matchOver) {
      this.respawnPlayer(id);
    }
    this.rebalanceBotTeams();
  }

  /**
   * Distribui os bots para os totais (humanos + bots) ficarem o mais iguais possível.
   */
  private rebalanceBotTeams(): void {
    if (!this.isTdm()) {
      for (const id of this.bots.keys()) {
        const p = this.state.players.get(id);
        if (p) p.team = "";
      }
      return;
    }
    let humanAlpha = 0;
    let humanEcho = 0;
    for (const [id, p] of this.state.players) {
      if (this.bots.has(id)) continue;
      if (p.team === "alpha") humanAlpha++;
      else if (p.team === "echo") humanEcho++;
    }
    const botIds = [...this.bots.keys()];
    const wantAlpha = Math.round((humanEcho - humanAlpha + botIds.length) / 2);
    const nAlpha = Math.max(0, Math.min(botIds.length, wantAlpha));
    botIds.forEach((id, i) => {
      const p = this.state.players.get(id);
      if (!p) return;
      const team: TeamId = i < nAlpha ? "alpha" : "echo";
      if (p.team === team) return;
      p.team = team;
      if (this.state.matchStarted && p.alive && !this.state.matchOver) {
        this.respawnPlayer(id);
      } else {
        const spawn = randomSpawn(this.spawnPointsFor(p));
        p.x = spawn.x;
        p.z = spawn.z;
        p.y = spawn.y ?? 0;
      }
    });
  }

  private isMatchWinner(id: string, team: string, winnerId: string): boolean {
    if (this.isZombies()) return false;
    if (this.isTdm()) {
      return isTeamId(this.state.winnerTeam) && team === this.state.winnerTeam;
    }
    return id === winnerId;
  }

  private finishMatch(winnerId: string, winnerTeam?: TeamId): void {
    this.state.matchOver = true;
    if (this.isZombies()) {
      this.state.winnerTeam = "";
      this.state.winnerName = `Round ${this.state.zombieRound}`;
      this.state.zombiePhase = "";
      this.clearZombies();
    } else if (this.isTdm() && winnerTeam) {
      this.state.winnerTeam = winnerTeam;
      this.state.winnerName = TEAMS[winnerTeam].label;
    } else {
      this.state.winnerTeam = "";
      const winner = this.state.players.get(winnerId);
      this.state.winnerName = winner?.name ?? "?";
    }
    this.matchResetAt = Date.now() + CONFIG.matchResetDelay * 1000;
    this.awardMatchRewards(winnerId);
    this.broadcast("matchEnd", {
      winnerName: this.state.winnerName,
      winnerTeam: this.state.winnerTeam,
    });
    void this.persistMatchStats(winnerId);
  }

  private processPrepCountdown(dt: number): void {
    if (!this.isZombies() || !this.state.matchStarted || this.state.matchOver) return;
    if (this.state.zombiePhase !== "prep") return;
    this.state.prepTimeLeft = Math.max(0, this.state.prepTimeLeft - dt);
    if (this.state.prepTimeLeft > 0) return;
    this.beginZombieRound(1);
  }

  private beginZombieRound(round: number): void {
    const plan = zombieWavePlan(round);
    this.state.zombieRound = plan.round;
    this.state.zombiePhase = "wave";
    this.state.prepTimeLeft = 0;
    this.intermissionLeft = 0;
    this.zombieToSpawn = plan.totalZombies;
    this.zombieSpawnInterval = 1 / Math.max(0.01, plan.respawnSpeed);
    this.zombieSpawnAcc = this.zombieSpawnInterval;
    this.zombieBossQueued = plan.boss;
    this.refreshZombieCounts();
    this.broadcast("waveStart", {
      round: plan.round,
      count: plan.totalZombies,
      boss: plan.boss,
    });
  }

  private processZombieWave(dt: number): void {
    if (!this.isZombies() || !this.state.matchStarted || this.state.matchOver) return;

    if (this.state.zombiePhase === "intermission") {
      this.intermissionLeft = Math.max(0, this.intermissionLeft - dt);
      this.state.prepTimeLeft = this.intermissionLeft;
      if (this.intermissionLeft <= 0) {
        this.beginZombieRound(this.state.zombieRound + 1);
      }
      return;
    }

    if (this.state.zombiePhase !== "wave") return;

    if (this.zombieBossQueued) {
      this.spawnZombie(true);
      this.zombieBossQueued = false;
    }

    this.zombieSpawnAcc += dt;
    while (this.zombieToSpawn > 0 && this.zombieSpawnAcc >= this.zombieSpawnInterval) {
      this.zombieSpawnAcc -= this.zombieSpawnInterval;
      this.spawnZombie(false);
      this.zombieToSpawn--;
    }
    this.refreshZombieCounts();

    if (this.zombieToSpawn <= 0 && !this.zombieBossQueued && this.zombies.size === 0) {
      this.state.zombiePhase = "intermission";
      this.intermissionLeft = ZOMBIES_INTERMISSION_SECONDS;
      this.state.prepTimeLeft = this.intermissionLeft;
      this.broadcast("waveClear", { round: this.state.zombieRound });
    }
  }

  private spawnZombie(boss: boolean): void {
    const id = `zom_${this.zombieCounter++}`;
    const p = new PlayerState();
    p.name = boss ? "Zumbi Boss" : "Zumbi";
    p.isBot = true;
    p.isZombie = true;
    p.isBoss = boss;
    p.inMatch = true;
    p.alive = true;
    const hp = zombieMaxHealth(boss, this.zombieSquadSize(), this.state.zombieRound);
    p.maxHealth = hp;
    p.health = hp;
    p.skinId = randomZombieSkin();
    p.weaponId = "";
    const spawn = randomSpawn(this.zombieSpawnPoints());
    p.x = spawn.x;
    p.z = spawn.z;
    p.y = spawn.y ?? 0;
    this.state.players.set(id, p);
    this.history.set(id, []);
    const world: ZombieWorld = {
      getPlayers: () => this.state.players as unknown as Map<string, PlayerState>,
      applyDamage: (t, a, k, w) => this.applyDamage(t, a, k, w),
      isMatchOver: () => this.state.matchOver,
      getMap: () => this.roomMap,
      getZombieSpawns: () => [...this.zombieSpawnPoints()],
    };
    this.zombies.set(id, new ZombieAi(id, p, world, boss));
    this.refreshZombieCounts();
  }

  private zombieSpawnPoints(): readonly { x: number; z: number; y?: number }[] {
    return zombieSpawnsFor(this.roomMap);
  }

  /** Humanos na partida (inclui nocauteados) — usado no HP do boss. */
  private zombieSquadSize(): number {
    let n = 0;
    this.state.players.forEach((p) => {
      if (p.inMatch && !p.isZombie) n++;
    });
    return Math.max(1, Math.min(ZOMBIES_MAX_PLAYERS, n));
  }

  private refreshZombieCounts(): void {
    this.state.zombiesAlive = this.zombies.size;
    this.state.zombiesLeft = this.zombies.size + this.zombieToSpawn + (this.zombieBossQueued ? 1 : 0);
  }

  private onZombieKilled(id: string, target: PlayerState): void {
    if (Math.random() < ZOMBIE_AMMO_DROP_CHANCE) {
      this.spawnAmmoDrop(target.x, target.y, target.z);
    }
    this.removeZombie(id);
    this.refreshZombieCounts();
  }

  private removeZombie(id: string): void {
    this.zombies.delete(id);
    this.state.players.delete(id);
    this.history.delete(id);
    this.respawnAt.delete(id);
    this.deathPos.delete(id);
  }

  private clearZombies(): void {
    for (const id of [...this.zombies.keys()]) this.removeZombie(id);
    this.zombieToSpawn = 0;
    this.zombieBossQueued = false;
    this.refreshZombieCounts();
  }

  private spawnAmmoDrop(x: number, y: number, z: number): void {
    const id = `ammo_${this.ammoDropCounter++}`;
    const drop = new AmmoDropState();
    drop.x = x;
    drop.y = y;
    drop.z = z;
    this.state.ammoDrops.set(id, drop);
  }

  private clearAmmoDrops(): void {
    this.state.ammoDrops.clear();
  }

  private spawnWeaponDrop(opts: {
    weaponId: string;
    mag: number;
    reserve: number;
    x: number;
    y: number;
    z: number;
    yaw: number;
    weaponSkinId: string;
    weaponSkinParts: string;
  }): void {
    const MAX_DROPS = 48;
    if (this.state.weaponDrops.size >= MAX_DROPS) {
      const oldest = this.state.weaponDrops.keys().next().value;
      if (typeof oldest === "string") this.state.weaponDrops.delete(oldest);
    }
    const id = `wpn_${this.weaponDropCounter++}`;
    const drop = new WeaponDropState();
    drop.weaponId = opts.weaponId;
    drop.mag = opts.mag;
    drop.reserve = opts.reserve;
    drop.x = opts.x;
    drop.y = opts.y;
    drop.z = opts.z;
    drop.yaw = opts.yaw;
    drop.weaponSkinId = opts.weaponSkinId;
    drop.weaponSkinParts = opts.weaponSkinParts;
    this.state.weaponDrops.set(id, drop);
  }

  private clearWeaponDrops(): void {
    this.state.weaponDrops.clear();
  }

  private parseDropPayload(
    raw: unknown
  ): {
    weaponId: string;
    mag: number;
    reserve: number;
    weaponSkinId: string;
    weaponSkinParts: string;
  } | null {
    if (!raw || typeof raw !== "object") return null;
    const msg = raw as DropWeaponMessage;
    const weapon = getWeapon(typeof msg.weaponId === "string" ? msg.weaponId : "");
    if (!weapon || !isDroppableWeapon(weapon.id)) return null;
    const mag = clampInt(msg.mag, 0, Math.max(1, weapon.magSize), 0);
    const reserve = clampInt(msg.reserve, 0, Math.max(0, weapon.reserveAmmo * 4), 0);
    const skinId = typeof msg.weaponSkinId === "string" ? msg.weaponSkinId.slice(0, 64) : "";
    const parts =
      typeof msg.weaponSkinParts === "string" ? msg.weaponSkinParts.slice(0, 16384) : "";
    return {
      weaponId: weapon.id,
      mag,
      reserve,
      weaponSkinId: skinId,
      weaponSkinParts: parts,
    };
  }

  private canInteractWithWeaponDrops(p: PlayerState | undefined): p is PlayerState {
    if (!p || !p.alive || p.downed || !p.inMatch || p.isZombie) return false;
    if (this.state.matchOver || !this.state.matchStarted) return false;
    if (isPredatorStreak(p.activeStreak)) return false;
    return true;
  }

  private rateLimitWeaponDrop(id: string): boolean {
    const now = Date.now();
    const last = this.lastWeaponDropAt.get(id) ?? 0;
    if (now - last < 80) return false;
    this.lastWeaponDropAt.set(id, now);
    return true;
  }

  private rateLimitWeaponPickup(id: string): boolean {
    const now = Date.now();
    const last = this.lastWeaponPickupAt.get(id) ?? 0;
    if (now - last < 280) return false;
    this.lastWeaponPickupAt.set(id, now);
    return true;
  }

  private handleDropWeapon(client: Client, msg: DropWeaponMessage): void {
    const p = this.state.players.get(client.sessionId);
    if (!this.canInteractWithWeaponDrops(p)) return;
    if (!this.rateLimitWeaponDrop(client.sessionId)) return;
    const payload = this.parseDropPayload(msg);
    if (!payload) return;
    const yaw = p.yaw;
    this.spawnWeaponDrop({
      ...payload,
      x: p.x + Math.sin(yaw) * WEAPON_DROP_THROW_DISTANCE,
      y: p.y,
      z: p.z + Math.cos(yaw) * WEAPON_DROP_THROW_DISTANCE,
      yaw,
    });
  }

  private handlePickupWeapon(
    client: Client,
    msg: { dropId?: unknown; swap?: unknown }
  ): void {
    const p = this.state.players.get(client.sessionId);
    if (!this.canInteractWithWeaponDrops(p)) return;
    if (!this.rateLimitWeaponPickup(client.sessionId)) return;
    const dropId = typeof msg?.dropId === "string" ? msg.dropId : "";
    const drop = this.state.weaponDrops.get(dropId);
    if (!drop) return;
    const dist = Math.hypot(p.x - drop.x, p.z - drop.z);
    if (dist > WEAPON_DROP_PICKUP_RANGE) return;

    const picked = {
      weaponId: drop.weaponId,
      mag: drop.mag,
      reserve: drop.reserve,
      weaponSkinId: drop.weaponSkinId,
      weaponSkinParts: drop.weaponSkinParts,
    };
    this.state.weaponDrops.delete(dropId);

    const swap = this.parseDropPayload(msg.swap);
    if (swap) {
      this.spawnWeaponDrop({
        ...swap,
        x: p.x + Math.sin(p.yaw) * WEAPON_DROP_THROW_DISTANCE,
        y: p.y,
        z: p.z + Math.cos(p.yaw) * WEAPON_DROP_THROW_DISTANCE,
        yaw: p.yaw,
      });
    }

    client.send("weaponPickup", picked);
  }

  private processAmmoPickups(): void {
    if (!this.isZombies() || !this.state.matchStarted || this.state.matchOver) return;
    if (this.state.ammoDrops.size === 0) return;
    for (const [dropId, drop] of this.state.ammoDrops) {
      for (const [pid, p] of this.state.players) {
        if (p.isZombie || !p.alive || p.downed || !p.inMatch) continue;
        const d = Math.hypot(p.x - drop.x, p.z - drop.z);
        if (d > ZOMBIES_PICKUP_RANGE) continue;
        const client = this.clients.find((c) => c.sessionId === pid);
        client?.send("ammoPickup", { x: drop.x, y: drop.y, z: drop.z });
        this.state.ammoDrops.delete(dropId);
        break;
      }
    }
  }

  private handleHoldRevive(reviverId: string, holding: boolean): void {
    if (!holding) {
      this.reviveHold.delete(reviverId);
      return;
    }
    if (!this.isZombies() || this.state.matchOver) return;
    const reviver = this.state.players.get(reviverId);
    if (!reviver || !reviver.alive || reviver.downed || !reviver.inMatch) return;
    const target = this.nearestDowned(reviver);
    if (!target) {
      this.reviveHold.delete(reviverId);
      return;
    }
    const cur = this.reviveHold.get(reviverId);
    if (!cur || cur.targetId !== target.id) {
      this.reviveHold.set(reviverId, { targetId: target.id, elapsed: 0 });
    }
  }

  private nearestDowned(reviver: PlayerState): { id: string; p: PlayerState } | null {
    let best: { id: string; p: PlayerState } | null = null;
    let bestD = ZOMBIES_REVIVE_RANGE;
    for (const [id, p] of this.state.players) {
      if (!p.downed || p.isZombie || !p.inMatch) continue;
      const d = Math.hypot(p.x - reviver.x, p.z - reviver.z);
      if (d <= bestD) {
        bestD = d;
        best = { id, p };
      }
    }
    return best;
  }

  private processRevives(dt: number): void {
    if (!this.isZombies() || !this.state.matchStarted || this.state.matchOver) return;

    for (const p of this.state.players.values()) {
      if (p.downed) p.reviveProgress = 0;
    }

    for (const [reviverId, hold] of [...this.reviveHold]) {
      const reviver = this.state.players.get(reviverId);
      const target = this.state.players.get(hold.targetId);
      if (
        !reviver ||
        !reviver.alive ||
        reviver.downed ||
        !target ||
        !target.downed
      ) {
        this.reviveHold.delete(reviverId);
        continue;
      }
      const d = Math.hypot(reviver.x - target.x, reviver.z - target.z);
      if (d > ZOMBIES_REVIVE_RANGE) {
        this.reviveHold.delete(reviverId);
        continue;
      }
      hold.elapsed += dt;
      target.reviveProgress = Math.min(1, hold.elapsed / ZOMBIES_REVIVE_SECONDS);
      if (hold.elapsed >= ZOMBIES_REVIVE_SECONDS) {
        this.revivePlayer(hold.targetId);
        this.reviveHold.delete(reviverId);
      }
    }
  }

  private revivePlayer(id: string): void {
    const p = this.state.players.get(id);
    if (!p || !p.downed) return;
    p.downed = false;
    p.alive = true;
    p.reviveProgress = 0;
    p.health = CONFIG.playerMaxHealth;
    this.grantInvincibility(p, CONFIG.spawnInvincibilityDuration);
    this.lastDamagedAt.delete(id);
    this.bodies.set(id, createBody(p.x, p.z, p.y));
    this.pendingInputs.get(id)?.splice(0);
    this.history.set(id, []);
    const client = this.clients.find((c) => c.sessionId === id);
    client?.send("revived", { x: p.x, z: p.z, y: p.y });
  }

  private checkZombieWipe(): void {
    if (!this.isZombies() || this.state.matchOver) return;
    let anyAlive = false;
    for (const p of this.state.players.values()) {
      if (p.isZombie || !p.inMatch) continue;
      if (p.alive && !p.downed) {
        anyAlive = true;
        break;
      }
    }
    if (!anyAlive) this.finishMatch("");
  }
}
