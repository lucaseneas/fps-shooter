import { Scene } from "@babylonjs/core/scene";
import { Vector3, Color3 } from "@babylonjs/core/Maths/math";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Material } from "@babylonjs/core/Materials/material";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";

import { CONFIG } from "../../shared/config";
import { HITBOX } from "../../shared/hitboxes";
import { CROUCH_EYE_HEIGHT, EYE_HEIGHT } from "../../shared/movement";
import { PlayerVisual } from "../player/PlayerVisual";

const STAND_HEIGHT = 1.8;
const CROUCH_HEIGHT = 1.15;
const MAX_EXTRAP_SPEED = 10;
const HISTORY_MS = 1000;
/** Prever no máximo ~2 ticks: além disso segura a última pose (evita drift). */
const EXTRAP_CAP_MS = 70;
/** Janela para estimar velocidade a partir do histórico (ms). */
const VEL_WINDOW_MS = 90;
/** Pose idêntica abaixo disso = parado (não cria sample novo). */
const REST_EPS = 0.002;
/** Salto acima disso = teleporte/respawn: limpa histórico em vez de interpolar. */
const TELEPORT_SNAP_DIST = 4;
/** Correção máxima por segundo rumo à pose amostrada (além da vel. do alvo). */
const CORRECTION_SPEED = 12;

// Alturas/posições visuais derivadas do HITBOX (modelo player_dummy.glb: 1.0×2.0×0.5).
const STAND_BODY_H = HITBOX.bodyHalf.y * 2;
const CROUCH_BODY_H = HITBOX.crouchBodyHalfY * 2;
/** Y relativo ao centro do root (root fica a height/2 acima dos pés). */
const STAND_BODY_Y = HITBOX.bodyCenterY - STAND_HEIGHT / 2;
const CROUCH_BODY_Y = HITBOX.crouchBodyCenterY - CROUCH_HEIGHT / 2;
const STAND_HEAD_Y = HITBOX.headCenterY - STAND_HEIGHT / 2;
const CROUCH_HEAD_Y = HITBOX.crouchHeadCenterY - CROUCH_HEIGHT / 2;

interface PosSample {
  t: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
}

function angleDelta(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function lerpAngle(a: number, b: number, f: number): number {
  return a + angleDelta(a, b) * f;
}

/**
 * Combatente remoto colado na pose do hitscan.
 *
 * Servidor: sampleHistory(now - (RTT/2 + interpDelayMs)).
 * Cliente (receive-time): sample(now - interpDelayMs + RTT/2).
 * Modelo e hitbox vermelha usam a mesma pose — o que você vê é o que conta.
 */
export class RemotePlayer {
  readonly id: string;

  private readonly root: Mesh;
  private readonly bodyMesh: Mesh;
  private readonly headMesh: Mesh;
  private readonly nameplate: Mesh;
  private readonly gun: Mesh;
  private readonly debugBodyHitbox: Mesh;
  private readonly debugHeadHitbox: Mesh;
  /** Esqueleto wireframe exibido através das paredes durante o wallhack. */
  private readonly skeletonBody: Mesh;
  private readonly skeletonHead: Mesh;

  private crouchT = 0;
  /** Crouch atual do servidor (hitscan usa o valor corrente, não o histórico). */
  private crouching = false;
  private invincible = false;
  private wallhack = false;
  public readonly visual: PlayerVisual;
  private aliveVisible = true;

  private velocityX = 0;
  private velocityY = 0;
  private velocityZ = 0;
  private lastServerX = 0;
  private lastServerY = 0;
  private lastServerZ = 0;
  private lastYaw = 0;
  private hasPatch = false;
  private wasAlive = true;
  private readonly history: PosSample[] = [];
  /** Pose visível (suaviza correções; o alvo continua sendo o sample do hitscan). */
  private visX = 0;
  private visY = 0;
  private visZ = 0;
  private visYaw = 0;
  private prevVisX = 0;
  private prevVisZ = 0;
  private hasVisual = false;
  private footstepAcc = 0;
  private movingOnGround = false;
  private running = false;

  constructor(scene: Scene, id: string, name: string) {
    this.id = id;

    this.root = MeshBuilder.CreateBox(
      `${id}_root`,
      { width: 0.9, height: STAND_HEIGHT, depth: 0.6 },
      scene
    );
    this.root.isVisible = false;
    this.root.checkCollisions = true;

    const bodyMat = new StandardMaterial(`${id}_bodyMat`, scene);
    bodyMat.diffuseColor = new Color3(0.75, 0.25, 0.2);
    const headMat = new StandardMaterial(`${id}_headMat`, scene);
    headMat.diffuseColor = new Color3(0.9, 0.75, 0.6);

    this.bodyMesh = MeshBuilder.CreateBox(
      `${id}_body`,
      {
        width: HITBOX.bodyHalf.x * 2,
        height: STAND_BODY_H,
        depth: HITBOX.bodyHalf.z * 2,
      },
      scene
    );
    this.bodyMesh.parent = this.root;
    this.bodyMesh.position.y = STAND_BODY_Y;
    this.bodyMesh.material = bodyMat;
    this.bodyMesh.metadata = { hitbox: { id, part: "body" } };
    this.bodyMesh.isVisible = false; // Substituído pelo Voxel

    this.headMesh = MeshBuilder.CreateSphere(
      `${id}_head`,
      { diameter: HITBOX.headRadius * 2, segments: 8 },
      scene
    );
    this.headMesh.parent = this.root;
    this.headMesh.position.y = STAND_HEAD_Y;
    this.headMesh.material = headMat;
    this.headMesh.metadata = { hitbox: { id, part: "head" } };
    this.headMesh.isVisible = false; // Substituído pelo Voxel

    // Componente visual do jogador 3D (Minecraft rig com todas animações)
    this.visual = new PlayerVisual(scene, `${id}_visual`, this.root);

    // AABB idêntico ao hitscan do servidor (sem yaw — o server usa AABB).
    const debugMat = new StandardMaterial(`${id}_debugHitboxMat`, scene);
    debugMat.diffuseColor = new Color3(1, 0, 0);
    debugMat.emissiveColor = new Color3(1, 0, 0);
    debugMat.wireframe = true;
    debugMat.alpha = 0.9;
    this.debugBodyHitbox = MeshBuilder.CreateBox(
      `${id}_debugBodyHitbox`,
      {
        width: HITBOX.bodyHalf.x * 2,
        height: HITBOX.bodyHalf.y * 2,
        depth: HITBOX.bodyHalf.z * 2,
      },
      scene
    );
    this.debugBodyHitbox.material = debugMat;
    this.debugBodyHitbox.isPickable = false;
    this.debugHeadHitbox = MeshBuilder.CreateSphere(
      `${id}_debugHeadHitbox`,
      { diameter: HITBOX.headRadius * 2, segments: 8 },
      scene
    );
    this.debugHeadHitbox.material = debugMat;
    this.debugHeadHitbox.isPickable = false;
    this.setDebugHitboxes(false);

    // Esqueleto do wallhack: wireframe no grupo 1 (limpa depth) — única
    // parte do inimigo que atravessa paredes. O modelo sólido fica no grupo 0.
    const skelMat = new StandardMaterial(`${id}_skelMat`, scene);
    skelMat.emissiveColor = new Color3(1, 0.2, 0.08);
    skelMat.disableLighting = true;
    skelMat.wireframe = true;

    this.skeletonBody = MeshBuilder.CreateBox(
      `${id}_skelBody`,
      {
        width: HITBOX.bodyHalf.x * 2,
        height: STAND_BODY_H,
        depth: HITBOX.bodyHalf.z * 2,
      },
      scene
    );
    this.skeletonBody.parent = this.root;
    this.skeletonBody.position.y = STAND_BODY_Y;
    this.skeletonBody.material = skelMat;
    this.skeletonBody.renderingGroupId = 1;
    this.skeletonBody.isPickable = false;

    this.skeletonHead = MeshBuilder.CreateSphere(
      `${id}_skelHead`,
      { diameter: HITBOX.headRadius * 2, segments: 8 },
      scene
    );
    this.skeletonHead.parent = this.root;
    this.skeletonHead.position.y = STAND_HEAD_Y;
    this.skeletonHead.material = skelMat;
    this.skeletonHead.renderingGroupId = 1;
    this.skeletonHead.isPickable = false;

    this.refreshSkeletonVisibility();

    this.gun = MeshBuilder.CreateBox(`${id}_gunRoot`, { size: 0.1 }, scene) as any;
    this.gun.isVisible = false;
    this.gun.parent = this.root;
    this.gun.position = new Vector3(0.32, 0.32, 0.3);

    this.nameplate = this.createNameplate(scene, name);
  }

  private createNameplate(scene: Scene, name: string): Mesh {
    const plane = MeshBuilder.CreatePlane(
      `${this.id}_name`,
      { width: 1.6, height: 0.4 },
      scene
    );
    plane.parent = this.root;
    plane.position.y = STAND_HEIGHT / 2 + 0.45;
    plane.billboardMode = 7;
    plane.isPickable = false;

    const texture = new DynamicTexture(
      `${this.id}_nameTex`,
      { width: 256, height: 64 },
      scene,
      false
    );
    texture.hasAlpha = true;
    texture.drawText(
      name,
      null,
      44,
      "bold 36px 'Segoe UI'",
      "white",
      "transparent",
      true
    );

    const mat = new StandardMaterial(`${this.id}_nameMat`, scene);
    mat.diffuseTexture = texture;
    mat.emissiveColor = new Color3(1, 1, 1);
    mat.disableLighting = true;
    mat.backFaceCulling = false;
    plane.material = mat;
    return plane;
  }

  setSkin(skinId: string): void {
    if (!skinId) return;
    this.visual.setSkin(skinId);
  }

  setWeapon(weaponId: string): void {
    if (!weaponId) return;
    this.visual.setWeapon(weaponId);
  }

  private height(): number {
    return STAND_HEIGHT + (CROUCH_HEIGHT - STAND_HEIGHT) * this.crouchT;
  }

  private eyeHeight(): number {
    return EYE_HEIGHT + (CROUCH_EYE_HEIGHT - EYE_HEIGHT) * this.crouchT;
  }

  private applyCrouchPose(): void {
    const t = this.crouchT;
    const h = this.height();
    const bodyH = STAND_BODY_H + (CROUCH_BODY_H - STAND_BODY_H) * t;

    this.bodyMesh.scaling.y = bodyH / STAND_BODY_H;
    this.bodyMesh.position.y = STAND_BODY_Y + (CROUCH_BODY_Y - STAND_BODY_Y) * t;
    this.headMesh.position.y = STAND_HEAD_Y + (CROUCH_HEAD_Y - STAND_HEAD_Y) * t;
    this.gun.position.y = 0.32 - 0.27 * t;
    this.nameplate.position.y = h / 2 + 0.45 - 0.2 * t;

    // Esqueleto espelha a pose do modelo (crouch).
    this.skeletonBody.scaling.y = this.bodyMesh.scaling.y;
    this.skeletonBody.position.y = this.bodyMesh.position.y;
    this.skeletonHead.position.y = this.headMesh.position.y;
  }

  /**
   * Mesma janela do `sampleHistory` do servidor:
   * rewindMs = RTT/2 + interpDelayMs → world ≈ T_click - interpDelay.
   * Com stamps de receive: targetRecv = now - interpDelay + RTT/2.
   */
  private sampleHitscanFeet(rttMs: number): PosSample {
    const now = performance.now();
    const oneWay = Math.max(0, rttMs) / 2;
    const targetT = now - CONFIG.interpDelayMs + oneWay;

    if (this.history.length === 0) {
      return {
        t: now,
        x: this.lastServerX,
        y: this.lastServerY,
        z: this.lastServerZ,
        yaw: this.lastYaw,
      };
    }

    const last = this.history[this.history.length - 1];
    if (targetT >= last.t) {
      const aheadMs = Math.min(EXTRAP_CAP_MS, targetT - last.t);
      const s = aheadMs / 1000;
      return {
        t: targetT,
        x: last.x + this.velocityX * s,
        y: last.y + this.velocityY * s,
        z: last.z + this.velocityZ * s,
        yaw: last.yaw,
      };
    }

    const first = this.history[0];
    if (targetT <= first.t) return { ...first };

    for (let i = this.history.length - 2; i >= 0; i--) {
      if (this.history[i].t <= targetT) {
        const a = this.history[i];
        const b = this.history[i + 1];
        const f = (targetT - a.t) / Math.max(1, b.t - a.t);
        return {
          t: targetT,
          x: a.x + (b.x - a.x) * f,
          y: a.y + (b.y - a.y) * f,
          z: a.z + (b.z - a.z) * f,
          yaw: lerpAngle(a.yaw, b.yaw, f),
        };
      }
    }

    return { ...last };
  }

  /**
   * Rajadas de patch (jitter) comprimiam 33ms de movimento em 2–5ms.
   * Espaça samples no mínimo ~meio tick.
   */
  private stampTime(now: number): number {
    const minGap = CONFIG.simulationIntervalMs * 0.5;
    if (this.history.length === 0) return now;
    const lastT = this.history[this.history.length - 1].t;
    if (now - lastT >= minGap) return now;
    return Math.min(lastT + CONFIG.simulationIntervalMs, now + minGap);
  }

  /** Velocidade média na janela recente — ignora dt minúsculo de rajadas. */
  private refreshKinematics(): void {
    const n = this.history.length;
    if (n < 2) {
      this.velocityX = 0;
      this.velocityY = 0;
      this.velocityZ = 0;
      return;
    }
    const last = this.history[n - 1];
    let i = n - 2;
    while (i > 0 && last.t - this.history[i].t < VEL_WINDOW_MS) i--;
    const a = this.history[i];
    const dt = (last.t - a.t) / 1000;
    if (dt < 0.02) return;
    const dx = last.x - a.x;
    const dy = last.y - a.y;
    const dz = last.z - a.z;
    if (Math.hypot(dx, dz) < REST_EPS && Math.abs(dy) < REST_EPS) {
      this.velocityX = 0;
      this.velocityY = 0;
      this.velocityZ = 0;
      return;
    }
    this.velocityX = dx / dt;
    this.velocityY = dy / dt;
    this.velocityZ = dz / dt;
    const speed = Math.hypot(this.velocityX, this.velocityY, this.velocityZ);
    if (speed > MAX_EXTRAP_SPEED) {
      const scale = MAX_EXTRAP_SPEED / speed;
      this.velocityX *= scale;
      this.velocityY *= scale;
      this.velocityZ *= scale;
    }
  }

  /** Aplica pés do hitscan no modelo + AABB debug (geometria do servidor). */
  private applyHitscanPose(feet: PosSample, dt = 0, snap = false): void {
    this.crouchT = this.crouching ? 1 : 0;
    this.applyCrouchPose();

    if (!this.hasVisual || snap) {
      this.visX = feet.x;
      this.visY = feet.y;
      this.visZ = feet.z;
      this.visYaw = feet.yaw;
      this.hasVisual = true;
    } else {
      const dx = feet.x - this.visX;
      const dy = feet.y - this.visY;
      const dz = feet.z - this.visZ;
      const err = Math.hypot(dx, dy, dz);
      if (err > TELEPORT_SNAP_DIST) {
        this.visX = feet.x;
        this.visY = feet.y;
        this.visZ = feet.z;
        this.visYaw = feet.yaw;
      } else {
        // Segue a pose interpolada 1:1; só limita o passo se houver um
        // snap residual (pacote atrasado / correção de extrapolação).
        const maxStep = (MAX_EXTRAP_SPEED + CORRECTION_SPEED) * Math.max(dt, 0) + 0.02;
        if (err > maxStep && dt > 0) {
          const k = maxStep / err;
          this.visX += dx * k;
          this.visY += dy * k;
          this.visZ += dz * k;
          this.visYaw = lerpAngle(this.visYaw, feet.yaw, k);
        } else {
          this.visX = feet.x;
          this.visY = feet.y;
          this.visZ = feet.z;
          this.visYaw = feet.yaw;
        }
      }
    }

    this.root.position.set(this.visX, this.visY + this.height() / 2, this.visZ);
    this.root.rotation.y = this.visYaw;

    // Atualiza pose e animações completas no PlayerVisual
    let realSpeed = 0;
    if (dt > 0.001) {
      const dX = this.visX - this.prevVisX;
      const dZ = this.visZ - this.prevVisZ;
      realSpeed = Math.hypot(dX, dZ) / dt;
    }
    const velocitySpeed = Math.hypot(this.velocityX, this.velocityZ);
    const effectiveSpeed = Math.max(realSpeed, velocitySpeed);
    const isMoving = effectiveSpeed > 0.25 && this.aliveVisible;
    this.movingOnGround =
      isMoving && Math.abs(this.velocityY) < 0.85;
    this.running = effectiveSpeed > 6.0;

    this.visual.setPose({
      isMoving,
      isCrouching: this.crouching,
      speedRatio: effectiveSpeed / 3.0,
      isAlive: this.aliveVisible,
    });

    this.prevVisX = this.visX;
    this.prevVisZ = this.visZ;

    const bodyCy = this.crouching
      ? HITBOX.crouchBodyCenterY
      : HITBOX.bodyCenterY;
    const bodyHalfY = this.crouching
      ? HITBOX.crouchBodyHalfY
      : HITBOX.bodyHalf.y;
    const headCy = this.crouching
      ? HITBOX.crouchHeadCenterY
      : HITBOX.headCenterY;

    this.debugBodyHitbox.scaling.y = bodyHalfY / HITBOX.bodyHalf.y;
    this.debugBodyHitbox.position.set(this.visX, this.visY + bodyCy, this.visZ);
    this.debugHeadHitbox.position.set(this.visX, this.visY + headCy, this.visZ);
  }

  applyState(
    x: number,
    y: number,
    z: number,
    yaw: number,
    alive: boolean,
    crouch = false
  ): void {
    const now = performance.now();
    const respawned = !this.wasAlive && alive;
    const died = this.wasAlive && !alive;
    const jumpDist = this.hasPatch
      ? Math.hypot(x - this.lastServerX, y - this.lastServerY, z - this.lastServerZ)
      : 0;
    const teleported = jumpDist > TELEPORT_SNAP_DIST;

    const samePose =
      this.hasPatch &&
      !respawned &&
      !teleported &&
      !died &&
      alive === this.wasAlive &&
      Math.hypot(x - this.lastServerX, y - this.lastServerY, z - this.lastServerZ) < REST_EPS &&
      Math.abs(angleDelta(this.lastYaw, yaw)) < 0.01;

    // Patch sem pose nova (vida/streaks): heartbeat no buffer e zera vel.
    if (samePose) {
      this.crouching = crouch;
      this.velocityX = 0;
      this.velocityY = 0;
      this.velocityZ = 0;
      if (alive) this.heartbeatRest(now, x, y, z, yaw);
      return;
    }

    // Respawn / teleporte: sem interpolar do ponto antigo até o novo.
    if (respawned || teleported || died) {
      this.history.length = 0;
      this.velocityX = 0;
      this.velocityY = 0;
      this.velocityZ = 0;
      this.hasVisual = false;
      this.prevVisX = x;
      this.prevVisZ = z;
    }

    this.hasPatch = true;
    this.lastServerX = x;
    this.lastServerY = y;
    this.lastServerZ = z;
    this.lastYaw = yaw;
    this.crouching = crouch;
    this.wasAlive = alive;

    // Morto: não alimenta o buffer — evita “deslizar” até o spawn.
    if (alive) {
      this.history.push({ t: this.stampTime(now), x, y, z, yaw });
      while (
        this.history.length > 0 &&
        now - this.history[0].t > HISTORY_MS
      ) {
        this.history.shift();
      }
      if (!respawned && !teleported) this.refreshKinematics();
    }

    this.setVisible(alive);

    if (alive && (respawned || teleported)) {
      this.snapToTarget();
    }
  }

  /**
   * Parado: o primeiro sample no sítio é a chegada (não estica o último passo).
   * Os seguintes só avançam o timestamp do hold.
   */
  private heartbeatRest(
    now: number,
    x: number,
    y: number,
    z: number,
    yaw: number
  ): void {
    const last = this.history[this.history.length - 1];
    if (!last) {
      this.history.push({ t: now, x, y, z, yaw });
      return;
    }
    const prev = this.history.length >= 2 ? this.history[this.history.length - 2] : null;
    const lastIsHold =
      prev !== null &&
      Math.hypot(prev.x - last.x, prev.y - last.y, prev.z - last.z) < REST_EPS;
    if (lastIsHold) {
      last.t = this.stampTime(now);
      last.yaw = yaw;
    } else {
      this.history.push({ t: this.stampTime(now), x, y, z, yaw });
    }
    while (this.history.length > 0 && now - this.history[0].t > HISTORY_MS) {
      this.history.shift();
    }
  }

  /**
   * Wallhack: só o esqueleto wireframe atravessa as paredes (grupo 1).
   * O modelo sólido fica sempre no grupo 0 — visível só em linha de visão.
   */
  setWallhack(enabled: boolean): void {
    if (this.wallhack === enabled) return;
    this.wallhack = enabled;
    this.refreshSkeletonVisibility();
  }

  private refreshSkeletonVisibility(): void {
    const show = this.wallhack && this.aliveVisible;
    this.skeletonBody.setEnabled(show);
    this.skeletonHead.setEnabled(show);
  }

  /** Invencível: ~60% de opacidade no modelo remoto (GLB incluso). */
  setInvincible(on: boolean): void {
    if (this.invincible === on) return;
    this.invincible = on;
    this.visual.setInvincible(on);
    this.applyInvincibilityAlpha();
  }

  private applyInvincibilityAlpha(): void {
    const alpha = this.invincible ? 0.6 : 1;
    const mode = this.invincible
      ? Material.MATERIAL_ALPHABLEND
      : Material.MATERIAL_OPAQUE;
    for (const mesh of [
      this.bodyMesh,
      this.headMesh,
      this.gun,
      ...this.gun.getChildMeshes(),
    ]) {
      const mat = mesh.material as StandardMaterial | null;
      if (!mat) continue;
      mat.alpha = alpha;
      mat.transparencyMode = mode;
    }
  }

  setDebugHitboxes(on: boolean): void {
    this.debugBodyHitbox.setEnabled(on);
    this.debugHeadHitbox.setEnabled(on);
  }

  /** `rttMs` = RTT autoritativo do servidor (mesmo do rewind). */
  update(dt: number, rttMs = 0): void {
    if (!this.hasPatch) return;
    this.visual.update(dt);
    this.applyHitscanPose(this.sampleHitscanFeet(rttMs), dt);
  }

  snapToTarget(): void {
    if (this.history.length === 0) return;
    const last = this.history[this.history.length - 1];
    this.velocityX = 0;
    this.velocityY = 0;
    this.velocityZ = 0;
    this.applyHitscanPose(last, 0, true);
  }

  getHead(): Vector3 {
    return this.root.position.add(
      new Vector3(0, this.eyeHeight() - this.height() / 2, 0)
    );
  }

  getFeet(): Vector3 {
    return new Vector3(this.visX, this.visY, this.visZ);
  }

  /** Retorna true quando um passo remoto deve tocar (som espacial no cliente). */
  tickFootstep(dt: number): boolean {
    if (!this.movingOnGround) {
      this.footstepAcc = 0;
      return false;
    }
    this.footstepAcc += dt;
    const interval = this.crouching ? 0.55 : this.running ? 0.3 : 0.42;
    if (this.footstepAcc >= interval) {
      this.footstepAcc = 0;
      return true;
    }
    return false;
  }

  private setVisible(on: boolean): void {
    this.aliveVisible = on;
    this.bodyMesh.setEnabled(on);
    this.headMesh.setEnabled(on);
    this.nameplate.setEnabled(on);
    this.gun.setEnabled(on);
    this.visual.setEnabled(on);
    this.root.checkCollisions = on;
    this.debugBodyHitbox.isVisible = on;
    this.debugHeadHitbox.isVisible = on;
    this.refreshSkeletonVisibility();
  }

  dispose(): void {
    this.visual.dispose();
    this.debugBodyHitbox.dispose();
    this.debugHeadHitbox.dispose();
    this.root.dispose(false, true);
  }
}
