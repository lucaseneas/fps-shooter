import { Room, Client } from "colyseus";

import { MatchState, PlayerState } from "./schema";
import { BotAi, BotWorld, ShotEvent } from "./BotAi";
import { CONFIG } from "../shared/config";
import { pickBotNames } from "../shared/names";
import { pickSpawnFarFrom, randomSpawn } from "../shared/spawnPoints";
import { getWeapon, damageFalloff, WeaponDef } from "../shared/weapons";
import {
  BodyState,
  PlayerInput,
  createBody,
  stepPlayer,
  EYE_HEIGHT,
} from "../shared/movement";
import { raycastMap, rayAabb, raySphere, Vec3 } from "./physics";

const MAX_RANGE = 200;
/** Quantos inputs processar por jogador a cada tick (anti-speedhack). */
const MAX_INPUTS_PER_TICK = 6;
/** Delay de interpolação estimado dos remotos no cliente (ms). */
const INTERP_DELAY_MS = 100;
/** Janela do histórico de posições para lag compensation (ms). */
const HISTORY_WINDOW_MS = 1000;

// Hitboxes server-side (alinhadas com o visual do RemotePlayer no cliente).
const HEAD_CENTER_Y = 1.7;
const HEAD_RADIUS = 0.225;
const BODY_CENTER_Y = 0.75;
const BODY_HALF = { x: 0.45, y: 0.65, z: 0.45 };

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
export class DeathmatchRoom extends Room<MatchState> {
  maxClients = CONFIG.roomSize;

  private bots = new Map<string, BotAi>();
  private botCounter = 0;
  private namePool: string[] = [];
  /** Quantos bots a sala deve manter (configurável pelos jogadores). */
  private desiredBots = CONFIG.roomSize - 1;

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

  /** Timestamp (ms) em que cada morto deve renascer. */
  private respawnAt = new Map<string, number>();
  /** Última posição de morte, para renascer longe dela. */
  private deathPos = new Map<string, { x: number; z: number }>();
  private matchResetAt = 0;

  onCreate(): void {
    this.setState(new MatchState());
    this.namePool = pickBotNames(16);

    // Metadata exibida na lista de salas do lobby.
    void this.setMetadata({ map: "Praça" });

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
      this.rtt.set(client.sessionId, Math.max(0, Date.now() - msg.t));
    });

    // Eco para o cliente medir o próprio ping (indicador no HUD).
    this.onMessage("cping", (client, msg: { t: number }) => {
      client.send("cpong", msg);
    });

    // Configuração da sala: quantos bots preenchem os slots vazios.
    this.onMessage("setBots", (_client, msg: { count: number }) => {
      if (typeof msg?.count !== "number" || !Number.isFinite(msg.count)) return;
      this.desiredBots = Math.max(
        0,
        Math.min(CONFIG.roomSize - 1, Math.floor(msg.count))
      );
      this.rebalanceBots();
    });

    this.setSimulationInterval(
      (dtMs) => this.update(dtMs / 1000),
      CONFIG.simulationIntervalMs
    );
  }

  onJoin(client: Client, options: { name?: string }): void {
    const name =
      typeof options?.name === "string" && options.name.trim().length > 0
        ? options.name.trim().slice(0, 16)
        : `Player${Math.floor(Math.random() * 900 + 100)}`;

    const p = new PlayerState();
    p.name = name;
    p.health = CONFIG.playerMaxHealth;
    const spawn = randomSpawn();
    p.x = spawn.x;
    p.z = spawn.z;
    p.y = 0;
    this.state.players.set(client.sessionId, p);

    this.bodies.set(client.sessionId, createBody(spawn.x, spawn.z));
    this.pendingInputs.set(client.sessionId, []);
    this.history.set(client.sessionId, []);

    this.rebalanceBots();
  }

  onLeave(client: Client): void {
    const id = client.sessionId;
    this.state.players.delete(id);
    this.bodies.delete(id);
    this.pendingInputs.delete(id);
    this.history.delete(id);
    this.rtt.delete(id);
    this.lastPingAt.delete(id);
    this.lastFireAt.delete(id);
    this.respawnAt.delete(id);
    this.deathPos.delete(id);
    this.rebalanceBots();
  }

  // --- Simulação ---

  private update(dt: number): void {
    this.processHumanInputs();
    for (const bot of this.bots.values()) bot.update(dt);
    this.pushHistory();
    this.pingClients();
    this.processRespawns();
    this.processMatchReset();
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
      if (now - last < 2000) continue;
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
    p.alive = true;

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

  private processMatchReset(): void {
    if (!this.state.matchOver || Date.now() < this.matchResetAt) return;

    this.state.matchOver = false;
    this.state.winnerName = "";
    this.respawnAt.clear();
    this.deathPos.clear();

    for (const [id, p] of this.state.players) {
      p.kills = 0;
      p.deaths = 0;
      this.respawnPlayer(id);
    }
    this.broadcast("matchReset");
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
    const eye: Vec3 = {
      x: shooter.x,
      y: shooter.y + EYE_HEIGHT,
      z: shooter.z,
    };
    const originDist = Math.sqrt(
      (msg.ox - eye.x) ** 2 + (msg.oy - eye.y) ** 2 + (msg.oz - eye.z) ** 2
    );
    if (originDist > 2) return;
    const origin: Vec3 = { x: msg.ox, y: msg.oy, z: msg.oz };

    // Rewind: metade do RTT + delay de interpolação dos remotos.
    const rewindMs = Math.min(
      HISTORY_WINDOW_MS,
      (this.rtt.get(shooterId) ?? 0) / 2 + INTERP_DELAY_MS
    );

    // Posições rebobinadas dos alvos possíveis.
    const targets: Array<{ id: string; pos: Vec3 }> = [];
    for (const [id, p] of this.state.players) {
      if (id === shooterId || !p.alive) continue;
      const pos = this.sampleHistory(id, rewindMs);
      if (pos) targets.push({ id, pos });
    }

    const ends: Array<{ x: number; y: number; z: number }> = [];

    for (const rawDir of msg.dirs) {
      const dlen = Math.hypot(rawDir.x, rawDir.y, rawDir.z);
      if (dlen < 1e-6) continue;
      const dir: Vec3 = {
        x: rawDir.x / dlen,
        y: rawDir.y / dlen,
        z: rawDir.z / dlen,
      };

      const tMap = raycastMap(origin, dir, MAX_RANGE);
      let tBest = tMap;
      let hitId: string | null = null;
      let hitPart: "head" | "body" = "body";

      for (const target of targets) {
        const tHead = raySphere(
          origin, dir,
          target.pos.x, target.pos.y + HEAD_CENTER_Y, target.pos.z,
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
          target.pos.x, target.pos.y + BODY_CENTER_Y, target.pos.z,
          BODY_HALF.x, BODY_HALF.y, BODY_HALF.z, tBest
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
        this.applyDamage(hitId, damage, shooterId, weapon.name);
      }
    }

    // Tracers para os outros clientes.
    this.broadcast(
      "remoteShots",
      { shooterId, ends },
      { except: client }
    );
  }

  private applyDamage(
    targetId: string,
    amount: number,
    attackerId: string,
    weaponName: string
  ): void {
    if (this.state.matchOver) return;
    const target = this.state.players.get(targetId);
    const attacker = this.state.players.get(attackerId);
    if (!target || !target.alive) return;

    target.health = Math.max(0, target.health - Math.round(amount));
    if (target.health > 0) return;

    target.alive = false;
    target.deaths++;
    if (attacker && attackerId !== targetId) attacker.kills++;

    const killerName = attacker?.name ?? "?";
    this.broadcast("kill", {
      killerId: attackerId,
      killerName,
      victimId: targetId,
      victimName: target.name,
      weaponName,
    });

    const victimClient = this.clients.find((c) => c.sessionId === targetId);
    victimClient?.send("died", { killerName, weaponName });

    this.deathPos.set(targetId, { x: target.x, z: target.z });
    this.respawnAt.set(targetId, Date.now() + CONFIG.respawnDelay * 1000);

    if (attacker && attacker.kills >= CONFIG.killsToWin) {
      this.state.matchOver = true;
      this.state.winnerName = attacker.name;
      this.matchResetAt = Date.now() + CONFIG.matchResetDelay * 1000;
      this.broadcast("matchEnd", { winnerName: attacker.name });
    }
  }

  // --- Bots ---

  /**
   * Mantém a quantidade de bots = min(desiredBots, slots livres).
   * Humano entra → bot sai; humano sai → bot volta (troca suave).
   */
  private rebalanceBots(): void {
    const humans = this.state.players.size - this.bots.size;
    const maxBots = Math.max(0, CONFIG.roomSize - humans);
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
