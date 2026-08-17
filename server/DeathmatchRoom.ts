import { Room, Client } from "colyseus";

import { MatchState, PlayerState } from "./schema";
import { BotAi, BotWorld, ShotEvent } from "./BotAi";
import { CONFIG, GAME_MODES, MAPS } from "../shared/config";
import { KILL_STREAK_REWARDS } from "../shared/killStreaks";
import { pickBotNames } from "../shared/names";
import { pickSpawnFarFrom, randomSpawn } from "../shared/spawnPoints";
import {
  getWeapon,
  damageFalloff,
  weaponMaxRange,
} from "../shared/weapons";
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
import { verifyToken, recordMatchStats, getUserXp } from "./auth";
import { isAuthEnabled } from "./db";
import { XP_RULES, MAX_XP, MULTIKILL_WINDOW_MS } from "../shared/ranks";

const HISTORY_WINDOW_MS = 1000;
/** Quantos inputs processar por jogador a cada tick (anti-speedhack). */
const MAX_INPUTS_PER_TICK = 6;

const HEAD_CENTER_Y = HITBOX.headCenterY;
const HEAD_RADIUS = HITBOX.headRadius;
const BODY_CENTER_Y = HITBOX.bodyCenterY;
const BODY_HALF = HITBOX.bodyHalf;
const CROUCH_HEAD_CENTER_Y = HITBOX.crouchHeadCenterY;
const CROUCH_BODY_CENTER_Y = HITBOX.crouchBodyCenterY;
const CROUCH_BODY_HALF_Y = HITBOX.crouchBodyHalfY;

interface FireMessage {
  weaponId: string;
  ox: number;
  oy: number;
  oz: number;
  dirs: Array<{ x: number; y: number; z: number }>;
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
}

/** Payload do líder para alterar as configurações da sala (pré-lobby). */
interface RoomSettingsMessage {
  roomName?: unknown;
  mapId?: unknown;
  gameMode?: unknown;
  killsToWin?: unknown;
  maxPlayers?: unknown;
  bots?: unknown;
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
  private debugClients = new Set<string>();
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

  /** Timestamp (ms) em que cada morto deve renascer. */
  private respawnAt = new Map<string, number>();
  /** Última posição de morte, para renascer longe dela. */
  private deathPos = new Map<string, { x: number; z: number }>();
  private matchResetAt = 0;

  onCreate(options: RoomCreateOptions = {}): void {
    this.setState(new MatchState());
    // Estado (inclui os acks de input) flui a ~30Hz, casado com o tick —
    // encurta a janela de inputs pendentes na reconciliação do cliente.
    this.setPatchRate(CONFIG.simulationIntervalMs);
    this.namePool = pickBotNames(16);

    const maxPlayers = clampInt(options.maxPlayers, 2, CONFIG.roomSize, CONFIG.roomSize);
    const desiredBots = clampInt(options.bots, 0, maxPlayers - 1, Math.max(0, maxPlayers - 1));
    const roomName = sanitizeRoomName(options.roomName);
    const gameMode =
      typeof options.gameMode === "string" &&
      GAME_MODES.some((m) => m.id === options.gameMode)
        ? options.gameMode
        : "ffa";
    const killsToWin = clampInt(options.killsToWin, 1, 100, CONFIG.killsToWin);
    const mapId =
      typeof options.mapId === "string" && MAPS.some((m) => m.id === options.mapId)
        ? options.mapId
        : MAPS[0].id;

    this.maxClients = maxPlayers;
    this.roomCapacity = maxPlayers;
    this.desiredBots = desiredBots;
    this.state.roomName = roomName;
    this.state.desiredBots = desiredBots;
    this.state.maxPlayers = maxPlayers;
    this.state.gameMode = gameMode;
    this.state.killsToWin = killsToWin;
    this.state.mapId = mapId;

    // Metadata exibida na lista de salas do lobby.
    void this.syncMetadata();

    // Sala nunca fica vazia: bots preenchem os slots (pilar #1 do GDD).
    this.rebalanceBots();

    this.onMessage("input", (client, input: PlayerInput) => {
      const p = this.state.players.get(client.sessionId);
      if (!p || !p.alive) return;
      if (typeof input?.seq !== "number") return;
      const queue = this.pendingInputs.get(client.sessionId);
      if (!queue) return;
      queue.push(input);
      if (queue.length > 60) queue.splice(0, queue.length - 60);
    });

    this.onMessage("fire", (client, msg: FireMessage) => {
      this.handleFire(client, msg);
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

    this.onMessage("setDebug", (client, msg: { enabled: boolean }) => {
      if (msg?.enabled === true) this.debugClients.add(client.sessionId);
      else this.debugClients.delete(client.sessionId);
    });

    this.onMessage("change_skin", (client, skinId: string) => {
      if (typeof skinId !== "string") return;
      const p = this.state.players.get(client.sessionId);
      if (p) {
        p.skinId = skinId.slice(0, 32);
        // Se for o líder, atualiza a skin de todos os bots
        if (client.sessionId === this.state.hostId) {
          for (const botId of this.bots.keys()) {
            const botPlayer = this.state.players.get(botId);
            if (botPlayer) botPlayer.skinId = p.skinId;
          }
        }
      }
    });

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
      if (!p || !p.inMatch || p.alive) return;
      // Morte: o timer de respawn manda; aqui só o spawn inicial / pós-reset.
      if (this.respawnAt.has(id)) return;
      this.respawnPlayer(id);
    });

    this.setSimulationInterval(
      (dtMs) => this.update(dtMs / 1000),
      CONFIG.simulationIntervalMs
    );
  }

  onJoin(client: Client, options: RoomCreateOptions): void {
    const account = verifyToken(options?.token);
    if (isAuthEnabled() && !account) {
      throw new Error("login_required");
    }

    const name = account
      ? account.username
      : typeof options?.name === "string" && options.name.trim().length > 0
        ? options.name.trim().slice(0, 16)
        : `Player${Math.floor(Math.random() * 900 + 100)}`;

    const p = new PlayerState();
    p.name = name;
    p.health = CONFIG.playerMaxHealth;
    // Entra em espectador: só aparece no mapa após requestSpawn.
    p.alive = false;
    p.x = 0;
    p.y = 0;
    p.z = 0;
    this.state.players.set(client.sessionId, p);

    // Criador (primeiro humano) vira líder da sala.
    if (!this.state.hostId) {
      this.state.hostId = client.sessionId;
    }

    if (account) {
      this.userIds.set(client.sessionId, account.id);
      // Patente: carrega o XP de carreira do banco para o estado da sala.
      void getUserXp(account.id)
        .then((xp) => {
          const pl = this.state.players.get(client.sessionId);
          if (pl && typeof xp === "number") pl.xp = xp;
        })
        .catch((err) => console.error("[auth] xp:", err));
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
    this.state.players.delete(id);
    this.userIds.delete(id);
    this.bodies.delete(id);
    this.pendingInputs.delete(id);
    this.history.delete(id);
    this.rtt.delete(id);
    this.lastPingAt.delete(id);
    this.lastFireAt.delete(id);
    this.debugClients.delete(id);
    this.lastDamagedAt.delete(id);
    this.lastChatAt.delete(id);
    this.respawnAt.delete(id);
    this.deathPos.delete(id);
    this.matchMultis.delete(id);
    this.matchXpEarned.delete(id);

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
  }

  // --- Simulação ---

  private update(dt: number): void {
    this.processHumanInputs();
    // No pré-lobby os bots aguardam parados nos spawns.
    if (this.state.matchStarted) {
      for (const bot of this.bots.values()) bot.update(dt);
    }
    this.pushHistory();
    this.pingClients();
    this.processRespawns();
    this.processHealthRegen(dt);
    this.processMatchReset();
    this.processKillStreaks(dt);
  }

  private processKillStreaks(dt: number): void {
    for (const [, p] of this.state.players) {
      if (p.streakTimeLeft > 0) {
        p.streakTimeLeft = Math.max(0, p.streakTimeLeft - dt);
        if (p.streakTimeLeft === 0) {
          p.activeStreak = "";
        }
      }
      if (p.invincibleTimeLeft > 0) {
        p.invincibleTimeLeft = Math.max(0, p.invincibleTimeLeft - dt);
      }
    }
  }

  /** Concede (ou estende) invencibilidade no jogador. */
  private grantInvincibility(player: PlayerState, seconds: number): void {
    player.invincibleTimeLeft = Math.max(player.invincibleTimeLeft, seconds);
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
      for (let i = 0; i < count; i++) {
        const input = queue[i];
        stepPlayer(body, input);
        p.lastSeq = input.seq;
        p.yaw = input.yaw;
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
      if (!player.alive || player.health >= CONFIG.playerMaxHealth) continue;
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

    const spawn = pickSpawnFarFrom(this.deathPos.get(id) ?? null);
    p.x = spawn.x;
    p.z = spawn.z;
    p.y = 0;
    p.vy = 0;
    p.grounded = true;
    p.health = CONFIG.playerMaxHealth;
    this.lastDamagedAt.delete(id);
    p.alive = true;
    this.grantInvincibility(p, CONFIG.spawnInvincibilityDuration);

    const bot = this.bots.get(id);
    if (bot) {
      bot.reset();
      return;
    }

    this.bodies.set(id, createBody(spawn.x, spawn.z));
    this.pendingInputs.get(id)?.splice(0);
    this.history.set(id, []);
    const client = this.clients.find((c) => c.sessionId === id);
    client?.send("respawn", { x: spawn.x, z: spawn.z });
  }

  /** Fim de partida: placar zera e todos os humanos voltam ao pré-lobby. */
  private processMatchReset(): void {
    if (!this.state.matchOver || Date.now() < this.matchResetAt) return;

    this.state.matchOver = false;
    this.state.winnerName = "";
    this.state.matchStarted = false;
    this.statsRecorded = false;
    this.matchResetAt = 0;
    this.respawnAt.clear();
    this.deathPos.clear();
    this.matchMultis.clear();
    this.matchXpEarned.clear();

    for (const [id, p] of this.state.players) {
      p.kills = 0;
      p.deaths = 0;
      p.killStreak = 0;
      p.activeStreak = "";
      p.streakTimeLeft = 0;
      p.invincibleTimeLeft = 0;
      p.matchXp = 0;
      p.doubleKills = 0;
      p.tripleKills = 0;
      p.multiKills = 0;
      p.health = CONFIG.playerMaxHealth;
      p.alive = false;
      this.history.set(id, []);
      if (this.bots.has(id)) {
        // Bot aguarda o próximo start num spawn limpo.
        const spawn = randomSpawn();
        p.x = spawn.x;
        p.z = spawn.z;
        p.y = 0;
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
    // Captura quem entra ANTES de limpar os flags de pronto.
    const joining = new Set<string>();
    for (const client of this.clients) {
      const p = this.state.players.get(client.sessionId);
      if (!p) continue;
      if (client.sessionId === this.state.hostId || p.ready) {
        joining.add(client.sessionId);
      }
    }

    this.state.matchStarted = true;
    this.state.matchOver = false;
    this.state.winnerName = "";
    this.statsRecorded = false;
    this.matchResetAt = 0;
    this.respawnAt.clear();
    this.deathPos.clear();
    this.matchMultis.clear();
    this.matchXpEarned.clear();

    for (const [, p] of this.state.players) {
      p.kills = 0;
      p.deaths = 0;
      p.killStreak = 0;
      p.activeStreak = "";
      p.streakTimeLeft = 0;
      p.invincibleTimeLeft = 0;
      p.matchXp = 0;
      p.doubleKills = 0;
      p.tripleKills = 0;
      p.multiKills = 0;
      p.health = CONFIG.playerMaxHealth;
      p.alive = false;
      p.ready = false;
    }

    // Bots sempre participam — nascem direto nos spawns.
    for (const id of this.bots.keys()) {
      const p = this.state.players.get(id);
      if (!p) continue;
      p.inMatch = true;
      this.respawnPlayer(id);
    }

    // O spawn dos humanos acontece via requestSpawn após o loadout no cliente.
    for (const client of this.clients) {
      const p = this.state.players.get(client.sessionId);
      if (!p) continue;
      p.inMatch = joining.has(client.sessionId);
      if (p.inMatch) client.send("matchStart");
    }
    void this.syncMetadata();
  }

  /** Aplica as configurações enviadas pelo líder (somente pré-lobby). */
  private applySettings(msg: RoomSettingsMessage): void {
    if (typeof msg.roomName === "string") {
      this.state.roomName = sanitizeRoomName(msg.roomName);
    }
    if (typeof msg.mapId === "string" && MAPS.some((m) => m.id === msg.mapId)) {
      this.state.mapId = msg.mapId;
    }
    if (
      typeof msg.gameMode === "string" &&
      GAME_MODES.some((m) => m.id === msg.gameMode)
    ) {
      this.state.gameMode = msg.gameMode;
    }
    if (typeof msg.killsToWin === "number") {
      this.state.killsToWin = clampInt(msg.killsToWin, 1, 100, this.state.killsToWin);
    }
    if (typeof msg.maxPlayers === "number") {
      const humans = this.state.players.size - this.bots.size;
      const maxPlayers = clampInt(
        msg.maxPlayers,
        Math.max(2, humans),
        CONFIG.roomSize,
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
    if (typeof msg.bots === "number") {
      this.desiredBots = clampInt(msg.bots, 0, this.roomCapacity - 1, this.desiredBots);
      this.state.desiredBots = this.desiredBots;
    }
    void this.syncMetadata();
    this.rebalanceBots();
  }

  /** Publica o estado atual da sala na listagem do lobby. */
  private syncMetadata(): Promise<unknown> {
    const mapLabel =
      MAPS.find((m) => m.id === this.state.mapId)?.label ?? this.state.mapId;
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

  // --- Combate (hitscan server-side com lag compensation) ---

  private handleFire(client: Client, msg: FireMessage): void {
    if (this.state.matchOver) return;

    const shooterId = client.sessionId;
    const shooter = this.state.players.get(shooterId);
    const weapon = getWeapon(msg?.weaponId);
    if (!shooter || !shooter.alive || !weapon) return;
    if (!Array.isArray(msg.dirs) || msg.dirs.length === 0) return;
    if (msg.dirs.length > weapon.pellets) return;

    // Rate limit por arma (com tolerância para jitter).
    const now = Date.now();
    const last = this.lastFireAt.get(shooterId) ?? 0;
    if (now - last < weapon.fireInterval * 1000 * 0.8) return;
    this.lastFireAt.set(shooterId, now);

    // Origem precisa estar perto do olho do jogador no servidor.
    const eyeH = shooter.crouch ? CROUCH_EYE_HEIGHT : EYE_HEIGHT;
    const eye: Vec3 = {
      x: shooter.x,
      y: shooter.y + eyeH,
      z: shooter.z,
    };
    const originDist = Math.sqrt(
      (msg.ox - eye.x) ** 2 + (msg.oy - eye.y) ** 2 + (msg.oz - eye.z) ** 2
    );
    if (originDist > 2) return;
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
      const pos = this.sampleHistory(id, rewindMs);
      if (pos) targets.push({ id, pos });
    }

    const ends: Array<{ x: number; y: number; z: number }> = [];
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
      const tMap = raycastMap(origin, dir, range);
      let tBest = tMap;
      let hitId: string | null = null;
      let hitPart: "head" | "body" = "body";

      for (const target of targets) {
        const crouched = Boolean(this.state.players.get(target.id)?.crouch);
        const headY = crouched ? CROUCH_HEAD_CENTER_Y : HEAD_CENTER_Y;
        const bodyY = crouched ? CROUCH_BODY_CENTER_Y : BODY_CENTER_Y;
        const bodyHalfY = crouched ? CROUCH_BODY_HALF_Y : BODY_HALF.y;
        const tHead = raySphere(
          origin, dir,
          target.pos.x, target.pos.y + headY, target.pos.z,
          HEAD_RADIUS, tBest
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
          BODY_HALF.x, bodyHalfY, BODY_HALF.z, tBest
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
    if (this.debugClients.has(shooterId)) {
      client.send("debugShot", { origin, ends });
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

    // Spawn protection / killstreak invincibility.
    if (target.invincibleTimeLeft > 0) return false;

    // Vida infinita precisa ser aplicada aqui, no lado autoritativo.
    if (this.debugClients.has(targetId)) {
      target.health = CONFIG.playerMaxHealth;
      return false;
    }
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

    target.alive = false;
    target.deaths++;
    target.killStreak = 0;
    target.activeStreak = "";
    target.streakTimeLeft = 0;
    target.invincibleTimeLeft = 0;

    if (attacker && attackerId !== targetId) {
      attacker.kills++;
      attacker.killStreak++;
      this.trackMultikill(attackerId);
      const reward = KILL_STREAK_REWARDS.find((r) => r.kills === attacker.killStreak);
      if (reward) {
        attacker.activeStreak = reward.id;
        attacker.streakTimeLeft = reward.duration;
        if (reward.id === "invincibility") {
          this.grantInvincibility(attacker, reward.duration);
        }
        this.broadcast("killstreakEarned", {
          playerName: attacker.name,
          streakName: reward.name,
        });
      }
    }

    const killerName = attacker?.name ?? "?";
    this.broadcast("kill", {
      killerId: attackerId,
      killerName,
      victimId: targetId,
      victimName: target.name,
      weaponName,
    });

    victimClient?.send("died", { killerName, weaponName });

    this.deathPos.set(targetId, { x: target.x, z: target.z });
    this.respawnAt.set(targetId, Date.now() + CONFIG.respawnDelay * 1000);

    if (attacker && attacker.kills >= this.state.killsToWin) {
      this.state.matchOver = true;
      this.state.winnerName = attacker.name;
      this.matchResetAt = Date.now() + CONFIG.matchResetDelay * 1000;
      this.awardMatchXp(attackerId);
      this.broadcast("matchEnd", { winnerName: attacker.name });
      void this.persistMatchStats(attackerId);
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
   * Concede o XP de fim de partida a todo humano que participou:
   * base + kills + multi-kills + vitória. O total (p.xp) é otimista —
   * contas autenticadas são corrigidas pelo RETURNING do banco.
   */
  private awardMatchXp(winnerId: string): void {
    for (const [id, p] of this.state.players) {
      if (this.bots.has(id) || !p.inMatch) continue;
      const earned =
        XP_RULES.matchPlayed +
        p.kills * XP_RULES.kill +
        p.doubleKills * XP_RULES.doubleKill +
        p.tripleKills * XP_RULES.tripleKill +
        p.multiKills * XP_RULES.multiKill +
        (id === winnerId ? XP_RULES.victory : 0);
      p.matchXp = earned;
      p.xp += earned;
      this.matchXpEarned.set(id, earned);
    }
  }

  /** Grava kills/deaths/wins/xp dos humanos autenticados no fim da partida. */
  private async persistMatchStats(winnerId: string): Promise<void> {
    if (this.statsRecorded || !isAuthEnabled()) return;
    this.statsRecorded = true;
    const jobs: Promise<void>[] = [];
    for (const [sessionId, userId] of this.userIds) {
      const p = this.state.players.get(sessionId);
      // Quem ficou no pré-lobby não jogou: sem stats nem XP.
      if (!p || !p.inMatch) continue;
      const xpEarned = this.matchXpEarned.get(sessionId) ?? 0;
      jobs.push(
        recordMatchStats(userId, {
          kills: p.kills,
          deaths: p.deaths,
          won: sessionId === winnerId,
          xpEarned,
        })
          .then((totalXp) => {
            const pl = this.state.players.get(sessionId);
            if (pl && typeof totalXp === "number") pl.xp = totalXp;
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
    const humans = this.state.players.size - this.bots.size;
    const maxBots = Math.max(0, this.roomCapacity - humans);
    const target = Math.min(this.desiredBots, maxBots);

    while (this.bots.size > target) this.removeOneBot();
    while (this.bots.size < target) this.addBot();
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

    // O bot clona a skin do líder, se não achar usa a default
    const host = this.state.hostId ? this.state.players.get(this.state.hostId) : null;
    p.skinId = host ? host.skinId : "skin_default";

    const spawn = randomSpawn();
    p.x = spawn.x;
    p.z = spawn.z;
    this.state.players.set(id, p);
    this.history.set(id, []);

    const world: BotWorld = {
      getPlayers: () =>
        this.state.players as unknown as Map<string, PlayerState>,
      applyDamage: (t, a, k, w) => this.applyDamage(t, a, k, w),
      broadcastShot: (e: ShotEvent) => this.broadcast("shot", e),
      isMatchOver: () => this.state.matchOver,
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
}
