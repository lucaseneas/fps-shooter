import { PlayerState } from "./schema";
import { randomSpawn, type SpawnPoint } from "../shared/spawnPoints";
import type { MapCollision } from "../shared/mapRuntime";
import { boxCollisionSize } from "../shared/mapData";
import {
  zombieMeleeDamage,
  zombieMeleeRange,
  ZOMBIE_MELEE_INTERVAL,
  ZOMBIE_WALK_SPEED_MULT,
  ZOMBIE_BOSS_WALK_SPEED_MULT,
} from "../shared/zombies";
import {
  BodyState,
  createBody,
  stepPlayer,
  FIXED_DT,
  STEP_HEIGHT,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  type PlayerInput,
} from "../shared/movement";
import { shouldJumpObstacle } from "./botNav";

/** Giro lento — zumbi não “snap” a câmera como bot de FFA. */
const TURN_SPEED = 2.35;
const STUCK_TIME = 0.7;
const CLIMB_SPEED = 3.6;
/** Paredes da arena têm 6 m; sobe prédios/muros, não a borda do mapa. */
const MAX_CLIMB = 7.2;

export interface ZombieWorld {
  getPlayers(): Map<string, PlayerState>;
  applyDamage(
    targetId: string,
    amount: number,
    attackerId: string,
    weaponName: string
  ): void;
  isMatchOver(): boolean;
  getMap(): MapCollision;
  getZombieSpawns(): SpawnPoint[];
}

/**
 * IA só de zumbi (não reutiliza BotAi).
 * Anda lento, só para frente, sem strafe; escala muros quando o alvo está do outro lado.
 */
export class ZombieAi {
  readonly id: string;
  private readonly state: PlayerState;
  private readonly world: ZombieWorld;
  private readonly boss: boolean;

  private body: BodyState;
  private physAcc = 0;
  private targetId: string | null = null;
  private meleeCooldown = 0;
  private jumpCooldown = 0;
  private stuckTimer = 0;
  private lastX = 0;
  private lastZ = 0;
  private climbTo: number | null = null;
  private wanderGoal: SpawnPoint | null = null;

  constructor(id: string, state: PlayerState, world: ZombieWorld, boss: boolean) {
    this.id = id;
    this.state = state;
    this.world = world;
    this.boss = boss;
    this.body = createBody(state.x, state.z, state.y);
    this.lastX = state.x;
    this.lastZ = state.z;
  }

  update(dt: number): void {
    if (!this.state.alive || this.world.isMatchOver()) return;

    this.meleeCooldown = Math.max(0, this.meleeCooldown - dt);
    this.jumpCooldown = Math.max(0, this.jumpCooldown - dt);

    this.acquireTarget();
    const target = this.targetId
      ? this.world.getPlayers().get(this.targetId)
      : undefined;

    if (target && target.alive && !target.isZombie) {
      this.chase(dt, target);
    } else {
      this.wander(dt);
    }
  }

  reset(): void {
    this.targetId = null;
    this.stuckTimer = 0;
    this.physAcc = 0;
    this.meleeCooldown = 0;
    this.climbTo = null;
    this.wanderGoal = null;
    this.body = createBody(this.state.x, this.state.z, this.state.y);
    this.lastX = this.state.x;
    this.lastZ = this.state.z;
  }

  snapBody(x: number, y: number, z: number, grounded = true, vy = 0): void {
    this.body.x = x;
    this.body.y = y;
    this.body.z = z;
    this.body.vy = vy;
    this.body.grounded = grounded;
    this.state.x = x;
    this.state.y = y;
    this.state.z = z;
    this.state.vy = vy;
    this.state.grounded = grounded;
    this.lastX = x;
    this.lastZ = z;
    this.physAcc = 0;
    this.climbTo = null;
  }

  private acquireTarget(): void {
    let bestId: string | null = null;
    let bestDist = 1e9;
    for (const [id, p] of this.world.getPlayers()) {
      if (id === this.id || p.isZombie || !p.alive || !p.inMatch) continue;
      const d = Math.hypot(p.x - this.state.x, p.z - this.state.z);
      if (d < bestDist) {
        bestDist = d;
        bestId = id;
      }
    }
    this.targetId = bestId;
  }

  private wander(dt: number): void {
    if (
      !this.wanderGoal ||
      Math.hypot(this.wanderGoal.x - this.state.x, this.wanderGoal.z - this.state.z) < 1.4
    ) {
      this.wanderGoal = randomSpawn(this.world.getZombieSpawns());
    }
    this.walkStraight(dt, this.wanderGoal.x, this.wanderGoal.z);
  }

  private chase(dt: number, target: PlayerState): void {
    const dx = target.x - this.state.x;
    const dz = target.z - this.state.z;
    const dist = Math.hypot(dx, dz);
    const lookYaw = Math.atan2(dx, dz);
    this.state.yaw = turnToward(this.state.yaw, lookYaw, TURN_SPEED * dt);

    const range = zombieMeleeRange(this.boss);
    if (dist > range * 0.85) {
      this.walkStraight(dt, target.x, target.z);
    } else {
      this.applyMove(dt, false, false);
    }

    if (dist <= range && this.meleeCooldown <= 0 && this.targetId) {
      this.meleeCooldown = ZOMBIE_MELEE_INTERVAL * (0.85 + Math.random() * 0.3);
      this.world.applyDamage(
        this.targetId,
        zombieMeleeDamage(this.boss),
        this.id,
        "Mãos"
      );
    }
  }

  /** Sempre de frente para o ponto; zero strafe. */
  private walkStraight(dt: number, goalX: number, goalZ: number): void {
    const dx = goalX - this.state.x;
    const dz = goalZ - this.state.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 0.12) {
      this.state.yaw = turnToward(
        this.state.yaw,
        Math.atan2(dx, dz),
        TURN_SPEED * dt
      );
    }

    const fx = Math.sin(this.state.yaw);
    const fz = Math.cos(this.state.yaw);
    const map = this.world.getMap();
    const climbing = this.climbTo !== null && this.body.y < this.climbTo - 0.1;

    const jump =
      !climbing &&
      this.jumpCooldown <= 0 &&
      this.body.grounded &&
      dist > 0.3 &&
      (shouldJumpObstacle(this.state.x, this.body.y, this.state.z, fx, fz, map) ||
        this.stuckTimer > STUCK_TIME);

    if (jump) this.jumpCooldown = 0.85;

    const moved = Math.hypot(this.state.x - this.lastX, this.state.z - this.lastZ);
    if (dist > 0.35 && !climbing) {
      this.stuckTimer = moved < 0.035 ? this.stuckTimer + dt : 0;
    } else {
      this.stuckTimer = 0;
    }
    this.lastX = this.state.x;
    this.lastZ = this.state.z;

    this.applyMove(dt, dist > 0.12, jump);
  }

  private applyMove(dt: number, walk: boolean, jump: boolean): void {
    const map = this.world.getMap();
    const yaw = this.state.yaw;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);

    if (this.climbTo !== null && this.body.y >= this.climbTo - 0.12) {
      this.climbTo = null;
    }
    if (this.climbTo === null && walk) {
      const ledge = wallLedgeAhead(this.body.x, this.body.y, this.body.z, fx, fz, map);
      if (ledge !== null && ledge - this.body.y > STEP_HEIGHT + 0.04) {
        this.climbTo = ledge;
      }
    }

    const input: PlayerInput = {
      seq: 0,
      forward: walk ? 1 : 0,
      strafe: 0,
      yaw,
      jump: false,
      run: false,
      crouch: false,
      speedMult: this.boss ? ZOMBIE_BOSS_WALK_SPEED_MULT : ZOMBIE_WALK_SPEED_MULT,
      npc: true,
    };

    this.physAcc += dt;
    let jumped = false;
    let steps = 0;
    while (this.physAcc >= FIXED_DT && steps < 8) {
      this.physAcc -= FIXED_DT;
      steps++;
      input.jump = jump && !jumped;
      if (input.jump) jumped = true;
      stepPlayer(this.body, input, map);
      this.applyClimb(FIXED_DT);
    }

    this.state.x = this.body.x;
    this.state.y = this.body.y;
    this.state.z = this.body.z;
    this.state.vy = this.body.vy;
    this.state.grounded = this.body.grounded;
    this.state.crouch = false;
  }

  private applyClimb(dt: number): void {
    if (this.climbTo === null) return;
    if (this.body.y >= this.climbTo - 0.08) {
      this.climbTo = null;
      return;
    }
    this.body.y = Math.min(this.climbTo - 0.04, this.body.y + CLIMB_SPEED * dt);
    this.body.vy = CLIMB_SPEED;
    this.body.grounded = false;
  }
}

function wallLedgeAhead(
  x: number,
  feetY: number,
  z: number,
  dirX: number,
  dirZ: number,
  map: MapCollision
): number | null {
  const len = Math.hypot(dirX, dirZ);
  if (len < 1e-4) return null;
  const nx = dirX / len;
  const nz = dirZ / len;
  const px = x + nx * (PLAYER_RADIUS + 0.32);
  const pz = z + nz * (PLAYER_RADIUS + 0.32);
  const head = feetY + PLAYER_HEIGHT * 0.95;
  let ledge: number | null = null;

  for (const b of map.boxes) {
    if (b.kind === "border") continue;
    const top = b.y + b.h / 2;
    const bottom = b.y - b.h / 2;
    if (top <= feetY + STEP_HEIGHT + 0.02) continue;
    if (bottom >= head) continue;
    if (top - feetY > MAX_CLIMB) continue;
    const dim = boxCollisionSize(b);
    const ex = dim.w / 2 + PLAYER_RADIUS * 0.75;
    const ez = dim.d / 2 + PLAYER_RADIUS * 0.75;
    if (Math.abs(px - b.x) >= ex || Math.abs(pz - b.z) >= ez) continue;
    if (ledge === null || top < ledge) ledge = top;
  }
  return ledge;
}

function turnToward(current: number, target: number, maxDelta: number): number {
  let d = target - current;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  if (d > maxDelta) d = maxDelta;
  if (d < -maxDelta) d = -maxDelta;
  return current + d;
}
