import { PlayerState } from "./schema";
import { moveWithCollisions, segmentBlocked, distance3 } from "./physics";
import { randomSpawn, SpawnPoint } from "../shared/spawnPoints";
import { getWeapon, damageFalloff } from "../shared/weapons";

const EYE_HEIGHT = 1.6;
const WALK_SPEED = 4.0;
const COMBAT_SPEED = 3.2;
const BODY_RADIUS = 0.45;

const VIEW_DISTANCE = 45;
const REACTION_TIME = 0.45;
const FIRE_INTERVAL = 0.55;
/** Erro angular máximo de mira (radianos) — maior = mais "humano". */
const AIM_ERROR = 0.05;
const HEADSHOT_CHANCE = 0.15;
/** Bots dão dano reduzido (nível "médio"). */
const BOT_DAMAGE_SCALE = 0.7;

export interface ShotEvent {
  shooterId: string;
  targetId: string;
  hit: boolean;
  /** Ponto final do tracer no cliente. */
  endX: number;
  endY: number;
  endZ: number;
}

export interface BotWorld {
  /** Todos os combatentes vivos ou não (bots + humanos). */
  getPlayers(): Map<string, PlayerState>;
  applyDamage(
    targetId: string,
    amount: number,
    attackerId: string,
    weaponName: string
  ): void;
  broadcastShot(e: ShotEvent): void;
  isMatchOver(): boolean;
}

/**
 * IA de um bot rodando no servidor ("jogador fantasma" do GDD).
 * Sem raycast de malha: LOS e colisão usam as AABBs de `shared/mapData`,
 * e o acerto usa um modelo probabilístico (erro angular vs. tamanho do alvo).
 */
export class BotAi {
  readonly id: string;
  private readonly state: PlayerState;
  private readonly world: BotWorld;

  private patrolTarget: SpawnPoint = randomSpawn();
  private repathTimer = 0;
  private targetId: string | null = null;
  private timeSinceSeen = 0;
  private reactionRemaining = 0;
  private fireCooldown = 0;
  private readonly seed = Math.random() * 100;

  constructor(id: string, state: PlayerState, world: BotWorld) {
    this.id = id;
    this.state = state;
    this.world = world;
  }

  update(dt: number): void {
    if (!this.state.alive || this.world.isMatchOver()) return;

    this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    this.acquireTarget(dt);

    const target = this.targetId
      ? this.world.getPlayers().get(this.targetId)
      : undefined;

    if (target && target.alive) {
      this.combat(dt, target);
    } else {
      this.patrol(dt);
    }
  }

  /** Reinicia estado interno após respawn. */
  reset(): void {
    this.targetId = null;
    this.patrolTarget = randomSpawn();
    this.reactionRemaining = 0;
    this.fireCooldown = 0;
  }

  private acquireTarget(dt: number): void {
    const players = this.world.getPlayers();
    const current = this.targetId ? players.get(this.targetId) : undefined;

    if (current && current.alive && this.canSee(current)) {
      this.timeSinceSeen = 0;
      return;
    }

    this.timeSinceSeen += dt;
    if (this.timeSinceSeen > 2.5) this.targetId = null;

    let bestId: string | null = null;
    let bestDist = VIEW_DISTANCE;
    for (const [id, p] of players) {
      if (id === this.id || !p.alive) continue;
      const d = distance3(
        this.state.x, EYE_HEIGHT, this.state.z,
        p.x, p.y + EYE_HEIGHT, p.z
      );
      if (d < bestDist && this.canSee(p)) {
        bestId = id;
        bestDist = d;
      }
    }

    if (bestId && bestId !== this.targetId) {
      this.targetId = bestId;
      this.timeSinceSeen = 0;
      this.reactionRemaining = REACTION_TIME * (0.7 + Math.random() * 0.6);
    }
  }

  private canSee(p: PlayerState): boolean {
    return !segmentBlocked(
      this.state.x, EYE_HEIGHT, this.state.z,
      p.x, p.y + EYE_HEIGHT, p.z
    );
  }

  private patrol(dt: number): void {
    this.repathTimer -= dt;
    const dx = this.patrolTarget.x - this.state.x;
    const dz = this.patrolTarget.z - this.state.z;
    const dist = Math.hypot(dx, dz);

    if (dist < 1.5 || this.repathTimer <= 0) {
      this.patrolTarget = randomSpawn();
      this.repathTimer = 6 + Math.random() * 6;
      return;
    }

    const nx = dx / dist;
    const nz = dz / dist;
    this.state.yaw = Math.atan2(nx, nz);
    const pos = { x: this.state.x, z: this.state.z };
    moveWithCollisions(pos, nx * WALK_SPEED * dt, nz * WALK_SPEED * dt, BODY_RADIUS);
    this.state.x = pos.x;
    this.state.z = pos.z;
  }

  private combat(dt: number, target: PlayerState): void {
    const dx = target.x - this.state.x;
    const dz = target.z - this.state.z;
    const dist = Math.hypot(dx, dz);
    const nx = dist > 0 ? dx / dist : 0;
    const nz = dist > 0 ? dz / dist : 1;
    this.state.yaw = Math.atan2(nx, nz);

    // Avança se longe, recua se perto, senão strafe lateral.
    let mx = 0;
    let mz = 0;
    if (dist > 25) {
      mx = nx;
      mz = nz;
    } else if (dist < 8) {
      mx = -nx;
      mz = -nz;
    } else {
      const side = Math.sin(Date.now() / 900 + this.seed) > 0 ? 1 : -1;
      mx = -nz * side;
      mz = nx * side;
    }
    const pos = { x: this.state.x, z: this.state.z };
    moveWithCollisions(pos, mx * COMBAT_SPEED * dt, mz * COMBAT_SPEED * dt, BODY_RADIUS);
    this.state.x = pos.x;
    this.state.z = pos.z;

    if (this.reactionRemaining > 0) {
      this.reactionRemaining -= dt;
      return;
    }

    if (this.fireCooldown <= 0 && this.canSee(target)) {
      this.shoot(target);
      this.fireCooldown = FIRE_INTERVAL * (0.8 + Math.random() * 0.5);
    }
  }

  private shoot(target: PlayerState): void {
    const dist = distance3(
      this.state.x, EYE_HEIGHT, this.state.z,
      target.x, target.y + EYE_HEIGHT, target.z
    );

    // Modelo probabilístico: erro angular sorteado vs. tamanho angular do alvo.
    const aimError = Math.random() * AIM_ERROR;
    const angularSize = Math.atan2(BODY_RADIUS, Math.max(dist, 0.1));
    const hit = aimError < angularSize * 1.6;

    const headY = target.y + EYE_HEIGHT;
    const missOffset = () => (Math.random() - 0.5) * 2;

    this.world.broadcastShot({
      shooterId: this.id,
      targetId: hit ? this.targetId ?? "" : "",
      hit,
      endX: target.x + (hit ? 0 : missOffset()),
      endY: headY + (hit ? -0.3 : missOffset() * 0.5),
      endZ: target.z + (hit ? 0 : missOffset()),
    });

    if (!hit) return;

    const rifle = getWeapon("rifle")!;
    const part = Math.random() < HEADSHOT_CHANCE ? "head" : "body";
    const base = part === "head" ? rifle.damageHead : rifle.damageBody;
    const damage = base * damageFalloff(dist, rifle) * BOT_DAMAGE_SCALE;
    this.world.applyDamage(this.targetId!, damage, this.id, rifle.name);
  }
}
