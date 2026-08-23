import { PlayerState } from "./schema";
import { segmentBlocked, distance3 } from "./physics";
import { randomSpawn, SpawnPoint } from "../shared/spawnPoints";
import { getWeapon, damageFalloff } from "../shared/weapons";
import type { MapCollision } from "../shared/mapRuntime";
import {
  BodyState,
  createBody,
  stepPlayer,
  FIXED_DT,
  EYE_HEIGHT,
  CROUCH_EYE_HEIGHT,
  STEP_HEIGHT,
  type PlayerInput,
} from "../shared/movement";
import {
  getNavGrid,
  shouldJumpObstacle,
  JUMP_CLEARANCE,
  type BotNavGrid,
  type NavPoint,
} from "./botNav";

const VIEW_DISTANCE = 65;
const HEAR_DISTANCE = 13;
const REACTION_TIME = 0.34;
const FIRE_INTERVAL = 0.26;
const BURST_SIZE = 4;
const BURST_PAUSE = 0.38;
const HEADSHOT_CHANCE = 0.11;
/** Bots dão dano reduzido (nível "médio"). */
const BOT_DAMAGE_SCALE = 0.65;
const TURN_SPEED = 6.2;
const STUCK_TIME = 0.55;
const PATH_REFRESH = 1.1;

export interface ShotEvent {
  shooterId: string;
  targetId: string;
  hit: boolean;
  headshot: boolean;
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
  getMap(): MapCollision;
  getSpawns(team?: string): SpawnPoint[];
}

/**
 * IA de um bot rodando no servidor ("jogador fantasma" do GDD).
 * Usa a mesma física dos humanos (`stepPlayer`) + malha de navegação AABB
 * para contornar paredes, pular degraus e atirar com linha de visão real.
 */
export class BotAi {
  readonly id: string;
  private readonly state: PlayerState;
  private readonly world: BotWorld;

  private body: BodyState;
  private physAcc = 0;

  private patrolTarget: SpawnPoint;
  private path: NavPoint[] = [];
  private repathTimer = 0;
  private targetId: string | null = null;
  private timeSinceSeen = 0;
  private reactionRemaining = 0;
  private fireCooldown = 0;
  private jumpCooldown = 0;
  private stuckTimer = 0;
  private lastX = 0;
  private lastZ = 0;
  private strafeSign = 1;
  private crouchHold = 0;
  private burstLeft = BURST_SIZE;
  private readonly seed = Math.random() * 100;
  private readonly prefersCrouch = Math.random() < 0.45;

  constructor(id: string, state: PlayerState, world: BotWorld) {
    this.id = id;
    this.state = state;
    this.world = world;
    this.body = createBody(state.x, state.z);
    this.body.y = state.y;
    this.patrolTarget = randomSpawn(world.getSpawns(state.team));
    this.lastX = state.x;
    this.lastZ = state.z;
    this.strafeSign = Math.sin(this.seed) >= 0 ? 1 : -1;
  }

  update(dt: number): void {
    if (!this.state.alive || this.world.isMatchOver()) return;

    this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    this.jumpCooldown = Math.max(0, this.jumpCooldown - dt);
    this.repathTimer -= dt;
    this.crouchHold = Math.max(0, this.crouchHold - dt);
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
    this.patrolTarget = randomSpawn(this.world.getSpawns(this.state.team));
    this.reactionRemaining = 0;
    this.fireCooldown = 0;
    this.jumpCooldown = 0;
    this.path = [];
    this.repathTimer = 0;
    this.stuckTimer = 0;
    this.physAcc = 0;
    this.crouchHold = 0;
    this.burstLeft = BURST_SIZE;
    this.body = createBody(this.state.x, this.state.z);
    this.body.y = this.state.y;
    this.state.crouch = false;
    this.lastX = this.state.x;
    this.lastZ = this.state.z;
  }

  private eyeY(p: PlayerState = this.state): number {
    return p.y + (p.crouch ? CROUCH_EYE_HEIGHT : EYE_HEIGHT);
  }

  private acquireTarget(dt: number): void {
    const players = this.world.getPlayers();
    const current = this.targetId ? players.get(this.targetId) : undefined;

    if (
      current &&
      current.alive &&
      !(this.state.team && current.team === this.state.team) &&
      this.canSee(current)
    ) {
      this.timeSinceSeen = 0;
      return;
    }

    this.timeSinceSeen += dt;
    if (this.timeSinceSeen > 2.8) this.targetId = null;

    let bestId: string | null = null;
    let bestDist = VIEW_DISTANCE;
    for (const [id, p] of players) {
      if (id === this.id || !p.alive) continue;
      if (this.state.team && p.team && p.team === this.state.team) continue;
      const d = Math.hypot(p.x - this.state.x, p.z - this.state.z);
      if (d >= bestDist) continue;
      if (d > HEAR_DISTANCE && !this.canSee(p)) continue;
      bestId = id;
      bestDist = d;
    }

    if (bestId && bestId !== this.targetId) {
      this.targetId = bestId;
      this.timeSinceSeen = 0;
      this.reactionRemaining = REACTION_TIME * (0.7 + Math.random() * 0.5);
    }
  }

  private canSee(p: PlayerState): boolean {
    return !segmentBlocked(
      this.state.x,
      this.eyeY(),
      this.state.z,
      p.x,
      this.eyeY(p),
      p.z,
      this.world.getMap()
    );
  }

  private patrol(dt: number): void {
    this.state.crouch = false;
    const dx = this.patrolTarget.x - this.state.x;
    const dz = this.patrolTarget.z - this.state.z;
    const dist = Math.hypot(dx, dz);

    if (dist < 1.8 || this.repathTimer < -8) {
      this.patrolTarget = randomSpawn(this.world.getSpawns(this.state.team));
      this.path = [];
      this.repathTimer = 4 + Math.random() * 5;
    }

    this.followGoal(dt, this.patrolTarget.x, this.patrolTarget.z, {
      lookAlongMove: true,
      run: false,
      crouch: false,
    });
  }

  private combat(dt: number, target: PlayerState): void {
    const dx = target.x - this.state.x;
    const dz = target.z - this.state.z;
    const dist = Math.hypot(dx, dz);
    const nx = dist > 0 ? dx / dist : 0;
    const nz = dist > 0 ? dz / dist : 1;
    const visible = this.canSee(target);
    if (visible) this.timeSinceSeen = 0;

    const lookYaw = Math.atan2(nx, nz);
    let goalX = target.x;
    let goalZ = target.z;
    let run = false;
    let crouch = false;
    let lookAlongMove = !visible;

    if (!visible) {
      run = dist > 18;
    } else if (dist > 20) {
      run = true;
    } else if (dist < 7) {
      goalX = this.state.x - nx * 12;
      goalZ = this.state.z - nz * 12;
      run = false;
    } else {
      const side = this.strafeSign;
      goalX = this.state.x - nz * side * 6 + nx * (dist > 16 ? 2 : 0);
      goalZ = this.state.z + nx * side * 6 + nz * (dist > 16 ? 2 : 0);
      lookAlongMove = false;
      const wantHold = this.prefersCrouch || dist > 14;
      crouch = wantHold && this.crouchHold > 0;
      if (this.crouchHold <= 0 && wantHold && Math.random() < 0.35) {
        this.crouchHold = 1.2 + Math.random() * 1.6;
        crouch = true;
      }
      if (Math.sin(Date.now() / 1400 + this.seed) > 0.85) {
        this.strafeSign *= -1;
      }
    }

    this.followGoal(dt, goalX, goalZ, {
      lookYaw: lookAlongMove ? undefined : lookYaw,
      lookAlongMove,
      run: run && !crouch,
      crouch,
    });

    if (this.reactionRemaining > 0) {
      this.reactionRemaining -= dt;
      return;
    }

    if (this.fireCooldown <= 0 && visible && this.facing(lookYaw, 0.28)) {
      this.shoot(target);
      this.burstLeft -= 1;
      if (this.burstLeft <= 0) {
        this.burstLeft = BURST_SIZE;
        this.fireCooldown = BURST_PAUSE * (0.85 + Math.random() * 0.4);
      } else {
        this.fireCooldown = FIRE_INTERVAL * (0.85 + Math.random() * 0.3);
      }
    }
  }

  private facing(desiredYaw: number, maxDelta: number): boolean {
    return angleDelta(this.state.yaw, desiredYaw) <= maxDelta;
  }

  private followGoal(
    dt: number,
    goalX: number,
    goalZ: number,
    opts: {
      lookYaw?: number;
      lookAlongMove: boolean;
      run: boolean;
      crouch: boolean;
    }
  ): void {
    const map = this.world.getMap();
    const nav = getNavGrid(map);

    if (this.repathTimer <= 0 || this.path.length === 0) {
      this.path = nav.findPath(this.state.x, this.state.z, goalX, goalZ);
      this.repathTimer = PATH_REFRESH * (0.75 + Math.random() * 0.5);
    }

    while (this.path.length > 1) {
      const wp = this.path[0];
      if (Math.hypot(wp.x - this.state.x, wp.z - this.state.z) < 1.15) {
        this.path.shift();
      } else break;
    }

    let tx = goalX;
    let tz = goalZ;
    if (this.path.length > 0) {
      tx = this.path[0].x;
      tz = this.path[0].z;
    }

    let mx = tx - this.state.x;
    let mz = tz - this.state.z;
    const md = Math.hypot(mx, mz);
    if (md > 0.05) {
      mx /= md;
      mz /= md;
    } else {
      mx = 0;
      mz = 0;
    }

    if (this.stuckTimer > STUCK_TIME * 0.5 && md > 0.2) {
      const side = this.strafeSign;
      const ox = mx;
      const oz = mz;
      mx = ox * 0.3 - oz * side;
      mz = oz * 0.3 + ox * side;
      const nd = Math.hypot(mx, mz);
      if (nd > 1e-4) {
        mx /= nd;
        mz /= nd;
      }
    }

    const moveYaw = md > 0.05 ? Math.atan2(mx, mz) : this.state.yaw;
    const lookYaw = opts.lookAlongMove
      ? moveYaw
      : (opts.lookYaw ?? moveYaw);
    this.state.yaw = turnToward(this.state.yaw, lookYaw, TURN_SPEED * dt);

    const jump =
      this.jumpCooldown <= 0 &&
      this.body.grounded &&
      !opts.crouch &&
      md > 0.25 &&
      (shouldJumpObstacle(this.state.x, this.body.y, this.state.z, mx, mz, map) ||
        this.needsClimbJump(tx, tz, nav) ||
        this.stuckTimer > STUCK_TIME);

    if (jump) this.jumpCooldown = 0.7;

    const moved = Math.hypot(this.state.x - this.lastX, this.state.z - this.lastZ);
    if (md > 0.4 && !opts.crouch) {
      this.stuckTimer = moved < 0.04 ? this.stuckTimer + dt : 0;
    } else {
      this.stuckTimer = 0;
    }
    if (this.stuckTimer > STUCK_TIME + 0.5) {
      this.path = [];
      this.repathTimer = 0;
      this.strafeSign *= -1;
      this.stuckTimer = 0;
      if (!this.targetId) {
        this.patrolTarget = randomSpawn(this.world.getSpawns(this.state.team));
      }
    }
    this.lastX = this.state.x;
    this.lastZ = this.state.z;

    this.applyMove(dt, mx, mz, opts.run, opts.crouch, jump);
  }

  private needsClimbJump(tx: number, tz: number, nav: BotNavGrid): boolean {
    const destY = nav.heightAt(tx, tz);
    const rise = destY - this.body.y;
    if (rise <= STEP_HEIGHT + 0.02 || rise > JUMP_CLEARANCE + 0.1) return false;
    return Math.hypot(tx - this.state.x, tz - this.state.z) < 1.8;
  }

  private applyMove(
    dt: number,
    worldX: number,
    worldZ: number,
    run: boolean,
    crouch: boolean,
    jump: boolean
  ): void {
    const map = this.world.getMap();
    const yaw = this.state.yaw;
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    let forward = worldX * sin + worldZ * cos;
    let strafe = worldX * cos - worldZ * sin;
    const mag = Math.hypot(forward, strafe);
    if (mag > 1) {
      forward /= mag;
      strafe /= mag;
    }

    const input: PlayerInput = {
      seq: 0,
      forward: clampUnit(forward),
      strafe: clampUnit(strafe),
      yaw,
      jump: false,
      run: run && !crouch,
      crouch,
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
    }

    this.state.x = this.body.x;
    this.state.y = this.body.y;
    this.state.z = this.body.z;
    this.state.vy = this.body.vy;
    this.state.grounded = this.body.grounded;
    this.state.crouch = crouch;
  }

  private shoot(target: PlayerState): void {
    const dist = distance3(
      this.state.x,
      this.eyeY(),
      this.state.z,
      target.x,
      this.eyeY(target),
      target.z
    );

    // ~58% perto, ~35% a 20 m, ~22% longe — ameaça sem laser.
    const t = Math.min(1, Math.max(0, (dist - 6) / 34));
    const hitChance = 0.58 * (1 - t) + 0.22 * t;
    const hit = Math.random() < hitChance;

    const headY = this.eyeY(target);
    const missOffset = () => (Math.random() - 0.5) * (1.2 + dist * 0.04);
    const part = hit && Math.random() < HEADSHOT_CHANCE ? "head" : "body";

    this.world.broadcastShot({
      shooterId: this.id,
      targetId: hit ? this.targetId ?? "" : "",
      hit,
      headshot: hit && part === "head",
      endX: target.x + (hit ? 0 : missOffset()),
      endY: hit ? (part === "head" ? headY : headY - 0.3) : headY + missOffset() * 0.5,
      endZ: target.z + (hit ? 0 : missOffset()),
    });

    if (!hit) return;

    const rifle = getWeapon("m4a1")!;
    const base = part === "head" ? rifle.damageHead : rifle.damageBody;
    const damage = base * damageFalloff(dist, rifle) * BOT_DAMAGE_SCALE;
    this.world.applyDamage(this.targetId!, damage, this.id, rifle.name);
  }
}

function turnToward(current: number, target: number, maxDelta: number): number {
  let d = target - current;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  if (d > maxDelta) d = maxDelta;
  if (d < -maxDelta) d = -maxDelta;
  return current + d;
}

function angleDelta(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}

function clampUnit(v: number): number {
  if (v > 1) return 1;
  if (v < -1) return -1;
  return v;
}
