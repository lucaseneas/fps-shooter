import { Scene } from "@babylonjs/core/scene";
import { Vector3, Color3 } from "@babylonjs/core/Maths/math";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";

import { CONFIG } from "../../shared/config";
import { HITBOX } from "../../shared/hitboxes";
import { CROUCH_EYE_HEIGHT, EYE_HEIGHT } from "../../shared/movement";

const STAND_HEIGHT = 1.8;
const CROUCH_HEIGHT = 1.15;
/** Velocidade de transição visual ao agachar/levantar. */
const CROUCH_LERP = 12;
/** Limite de velocidade para extrapolação (evita spikes entre patches). */
const MAX_EXTRAP_SPEED = 10;

const STAND_BODY_H = 1.3;
const CROUCH_BODY_H = 0.85;

/** Histórico local para amostrar a mesma janela do rewind do servidor. */
const HISTORY_MS = 1000;
/** Teto de extrapolação da hitbox de debug (ms). */
const DEBUG_EXTRAP_CAP_MS = 250;

interface PosSample {
  t: number;
  x: number;
  y: number;
  z: number;
}

/**
 * Representação visual de outro combatente da sala (humano ou bot — o
 * cliente não distingue). Interpolação rápida + extrapolação curta entre
 * patches do servidor. A hitbox de debug mostra a pose de lag compensation
 * (onde o hitscan do servidor realmente testa o tiro).
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

  /** Centro do corpo no último patch (alvo base). */
  private readonly targetPos = new Vector3(0, 0, 0);
  /** Posição renderizada após extrapolação (reutilizada a cada frame). */
  private readonly renderPos = new Vector3(0, 0, 0);
  private targetYaw = 0;

  private feetX = 0;
  private feetY = 0;
  private feetZ = 0;
  private crouching = false;
  /** 0 = em pé, 1 = agachado (interpolado). */
  private crouchT = 0;

  private lastServerX = 0;
  private lastServerZ = 0;
  private velocityX = 0;
  private velocityZ = 0;
  private lastPatchTime = 0;
  private hasPatch = false;
  private readonly history: PosSample[] = [];

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
      { width: 0.9, height: STAND_BODY_H, depth: 0.6 },
      scene
    );
    this.bodyMesh.parent = this.root;
    this.bodyMesh.position.y = -0.15;
    this.bodyMesh.material = bodyMat;
    this.bodyMesh.metadata = { hitbox: { id, part: "body" } };

    this.headMesh = MeshBuilder.CreateSphere(
      `${id}_head`,
      { diameter: 0.45, segments: 8 },
      scene
    );
    this.headMesh.parent = this.root;
    this.headMesh.position.y = STAND_HEIGHT / 2 - 0.1;
    this.headMesh.material = headMat;
    this.headMesh.metadata = { hitbox: { id, part: "head" } };

    // AABB do hitscan autoritativo (lag-compensated), sem yaw — igual ao servidor.
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

    const gunMat = new StandardMaterial(`${id}_gunMat`, scene);
    gunMat.diffuseColor = new Color3(0.15, 0.15, 0.17);
    gunMat.specularColor = new Color3(0.05, 0.05, 0.05);

    this.gun = MeshBuilder.CreateBox(
      `${id}_gun`,
      { width: 0.09, height: 0.12, depth: 0.55 },
      scene
    );
    this.gun.parent = this.root;
    this.gun.position = new Vector3(0.32, 0.32, 0.3);
    this.gun.material = gunMat;
    this.gun.isPickable = false;

    const gunBarrel = MeshBuilder.CreateCylinder(
      `${id}_gunBarrel`,
      { height: 0.25, diameter: 0.05 },
      scene
    );
    gunBarrel.parent = this.gun;
    gunBarrel.rotation.x = Math.PI / 2;
    gunBarrel.position = new Vector3(0, 0.02, 0.38);
    gunBarrel.material = gunMat;
    gunBarrel.isPickable = false;

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

  private height(): number {
    return STAND_HEIGHT + (CROUCH_HEIGHT - STAND_HEIGHT) * this.crouchT;
  }

  private eyeHeight(): number {
    return EYE_HEIGHT + (CROUCH_EYE_HEIGHT - EYE_HEIGHT) * this.crouchT;
  }

  private applyCrouchPose(): void {
    const t = this.crouchT;
    const h = this.height();
    const eye = this.eyeHeight();
    const bodyH = STAND_BODY_H + (CROUCH_BODY_H - STAND_BODY_H) * t;

    this.bodyMesh.scaling.y = bodyH / STAND_BODY_H;
    this.bodyMesh.position.y = -0.15 - 0.05 * t;
    this.headMesh.position.y = eye - h / 2;
    this.gun.position.y = 0.32 - 0.27 * t;
    this.nameplate.position.y = h / 2 + 0.45 - 0.2 * t;
  }

  /**
   * Amostra a pose que o servidor usaria no hitscan para o nosso RTT:
   * rewind = RTT/2 + interpDelayMs. O histórico é stampado no receive time;
   * targetRecvT = now - interpDelay + RTT/2 alinha com esse rewind.
   */
  private sampleLagCompFeet(rttMs: number): PosSample {
    const now = performance.now();
    const oneWay = Math.max(0, rttMs) / 2;
    const targetRecvT = now - CONFIG.interpDelayMs + oneWay;

    if (this.history.length === 0) {
      return { t: now, x: this.feetX, y: this.feetY, z: this.feetZ };
    }

    const last = this.history[this.history.length - 1];
    if (targetRecvT >= last.t) {
      const aheadMs = Math.min(DEBUG_EXTRAP_CAP_MS, targetRecvT - last.t);
      const aheadSec = aheadMs / 1000;
      return {
        t: targetRecvT,
        x: last.x + this.velocityX * aheadSec,
        y: last.y,
        z: last.z + this.velocityZ * aheadSec,
      };
    }

    const first = this.history[0];
    if (targetRecvT <= first.t) {
      return { t: first.t, x: first.x, y: first.y, z: first.z };
    }

    for (let i = this.history.length - 2; i >= 0; i--) {
      if (this.history[i].t <= targetRecvT) {
        const a = this.history[i];
        const b = this.history[i + 1];
        const f = (targetRecvT - a.t) / Math.max(1, b.t - a.t);
        return {
          t: targetRecvT,
          x: a.x + (b.x - a.x) * f,
          y: a.y + (b.y - a.y) * f,
          z: a.z + (b.z - a.z) * f,
        };
      }
    }

    return { t: last.t, x: last.x, y: last.y, z: last.z };
  }

  /** Posiciona a hitbox vermelha no volume que o servidor testa no tiro. */
  private updateDebugHitboxes(rttMs: number): void {
    const feet = this.sampleLagCompFeet(rttMs);
    const crouched = this.crouching;
    const bodyCy = crouched ? HITBOX.crouchBodyCenterY : HITBOX.bodyCenterY;
    const bodyHalfY = crouched ? HITBOX.crouchBodyHalfY : HITBOX.bodyHalf.y;
    const headCy = crouched ? HITBOX.crouchHeadCenterY : HITBOX.headCenterY;

    this.debugBodyHitbox.scaling.y = bodyHalfY / HITBOX.bodyHalf.y;
    this.debugBodyHitbox.position.set(feet.x, feet.y + bodyCy, feet.z);
    this.debugHeadHitbox.position.set(feet.x, feet.y + headCy, feet.z);
  }

  /** Recebe o último estado do servidor (pés em y). */
  applyState(
    x: number,
    y: number,
    z: number,
    yaw: number,
    alive: boolean,
    crouch = false
  ): void {
    const now = performance.now();

    if (this.hasPatch) {
      const dt = (now - this.lastPatchTime) / 1000;
      if (dt > 0.001 && dt < 0.5) {
        this.velocityX = (x - this.lastServerX) / dt;
        this.velocityZ = (z - this.lastServerZ) / dt;
        const speed = Math.hypot(this.velocityX, this.velocityZ);
        if (speed > MAX_EXTRAP_SPEED) {
          const scale = MAX_EXTRAP_SPEED / speed;
          this.velocityX *= scale;
          this.velocityZ *= scale;
        }
      }
    } else {
      this.hasPatch = true;
      this.velocityX = 0;
      this.velocityZ = 0;
    }

    this.lastServerX = x;
    this.lastServerZ = z;
    this.lastPatchTime = now;

    this.feetX = x;
    this.feetY = y;
    this.feetZ = z;
    this.crouching = crouch;
    this.targetPos.set(x, y + this.height() / 2, z);
    this.targetYaw = yaw;

    this.history.push({ t: now, x, y, z });
    while (
      this.history.length > 0 &&
      now - this.history[0].t > HISTORY_MS
    ) {
      this.history.shift();
    }

    this.applyCrouchPose();
    this.setVisible(alive);
  }

  setDebugHitboxes(on: boolean): void {
    this.debugBodyHitbox.setEnabled(on);
    this.debugHeadHitbox.setEnabled(on);
  }

  /**
   * Interpola + extrapola o modelo; atualiza a hitbox de debug na pose
   * de lag compensation (chamar a cada frame).
   */
  update(dt: number, rttMs = 0): void {
    const crouchTarget = this.crouching ? 1 : 0;
    this.crouchT +=
      (crouchTarget - this.crouchT) * Math.min(1, dt * CROUCH_LERP);
    this.applyCrouchPose();
    this.targetPos.y = this.feetY + this.height() / 2;

    const sincePatchSec =
      (performance.now() - this.lastPatchTime) / 1000;
    const extrapSec = Math.min(
      sincePatchSec,
      CONFIG.remoteExtrapolationMs / 1000
    );

    this.renderPos.set(
      this.targetPos.x + this.velocityX * extrapSec,
      this.targetPos.y,
      this.targetPos.z + this.velocityZ * extrapSec
    );

    const t = Math.min(1, dt * CONFIG.remoteInterpSpeed);
    Vector3.LerpToRef(this.root.position, this.renderPos, t, this.root.position);

    let diff = this.targetYaw - this.root.rotation.y;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.root.rotation.y += diff * t;

    this.updateDebugHitboxes(rttMs);
  }

  snapToTarget(): void {
    this.crouchT = this.crouching ? 1 : 0;
    this.applyCrouchPose();
    this.targetPos.y = this.feetY + this.height() / 2;
    this.root.position.copyFrom(this.targetPos);
    this.root.rotation.y = this.targetYaw;
    this.velocityX = 0;
    this.velocityZ = 0;
    this.renderPos.copyFrom(this.targetPos);
  }

  getHead(): Vector3 {
    return this.root.position.add(
      new Vector3(0, this.eyeHeight() - this.height() / 2, 0)
    );
  }

  private setVisible(on: boolean): void {
    this.bodyMesh.setEnabled(on);
    this.headMesh.setEnabled(on);
    this.nameplate.setEnabled(on);
    this.gun.setEnabled(on);
    this.root.checkCollisions = on;
    this.debugBodyHitbox.isVisible = on;
    this.debugHeadHitbox.isVisible = on;
  }

  dispose(): void {
    this.debugBodyHitbox.dispose();
    this.debugHeadHitbox.dispose();
    this.root.dispose(false, true);
  }
}
