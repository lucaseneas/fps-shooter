import { Scene } from "@babylonjs/core/scene";
import { Vector3, Color3 } from "@babylonjs/core/Maths/math";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";

import { CONFIG } from "../../shared/config";
import { CROUCH_EYE_HEIGHT, EYE_HEIGHT } from "../../shared/movement";

const STAND_HEIGHT = 1.8;
const CROUCH_HEIGHT = 1.15;
/** Velocidade de transição visual ao agachar/levantar. */
const CROUCH_LERP = 12;
/** Limite de velocidade para extrapolação (evita spikes entre patches). */
const MAX_EXTRAP_SPEED = 10;

const STAND_BODY_H = 1.3;
const CROUCH_BODY_H = 0.85;

/**
 * Representação visual de outro combatente da sala (humano ou bot — o
 * cliente não distingue). Interpolação rápida + extrapolação curta entre
 * patches do servidor para reduzir o gap visual vs hitbox autoritativa.
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

    // Contornos na última posição autoritativa recebida, sem interpolação.
    const debugMat = new StandardMaterial(`${id}_debugHitboxMat`, scene);
    debugMat.diffuseColor = new Color3(1, 0, 0);
    debugMat.emissiveColor = new Color3(1, 0, 0);
    debugMat.wireframe = true;
    debugMat.alpha = 0.9;
    this.debugBodyHitbox = MeshBuilder.CreateBox(
      `${id}_debugBodyHitbox`,
      { width: 0.9, height: STAND_BODY_H, depth: 0.6 },
      scene
    );
    this.debugBodyHitbox.material = debugMat;
    this.debugBodyHitbox.isPickable = false;
    this.debugHeadHitbox = MeshBuilder.CreateSphere(
      `${id}_debugHeadHitbox`,
      { diameter: 0.45, segments: 8 },
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

    this.debugBodyHitbox.scaling.y = bodyH / STAND_BODY_H;
    this.debugBodyHitbox.position.set(
      this.feetX,
      this.feetY + bodyH / 2,
      this.feetZ
    );
    this.debugHeadHitbox.position.set(
      this.feetX,
      this.feetY + eye,
      this.feetZ
    );
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
    this.debugBodyHitbox.rotation.y = yaw;
    this.applyCrouchPose();
    this.setVisible(alive);
  }

  setDebugHitboxes(on: boolean): void {
    this.debugBodyHitbox.setEnabled(on);
    this.debugHeadHitbox.setEnabled(on);
  }

  /** Interpola + extrapola em direção ao estado estimado (chamar a cada frame). */
  update(dt: number): void {
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
    this.root.dispose(false, true);
  }
}
