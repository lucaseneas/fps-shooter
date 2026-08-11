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
const MAX_EXTRAP_SPEED = 10;
const HISTORY_MS = 1000;
/** Teto ao prever além do último patch (equivale ao rewind com ping alto). */
const EXTRAP_CAP_MS = 350;

const STAND_BODY_H = 1.3;
const CROUCH_BODY_H = 0.85;

interface PosSample {
  t: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
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

  private crouchT = 0;
  /** Crouch atual do servidor (hitscan usa o valor corrente, não o histórico). */
  private crouching = false;

  private velocityX = 0;
  private velocityZ = 0;
  private lastServerX = 0;
  private lastServerZ = 0;
  private lastPatchTime = 0;
  private lastYaw = 0;
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
        y: 0,
        z: this.lastServerZ,
        yaw: this.lastYaw,
      };
    }

    const last = this.history[this.history.length - 1];
    if (targetT >= last.t) {
      // Ainda não chegou o patch desse instante — mesma ideia do
      // servidor quando o alvo está “à frente” do histórico: segura no
      // último ponto e projeta com a velocidade estimada.
      const aheadMs = Math.min(EXTRAP_CAP_MS, targetT - last.t);
      const s = aheadMs / 1000;
      return {
        t: targetT,
        x: last.x + this.velocityX * s,
        y: last.y,
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
          yaw: a.yaw,
        };
      }
    }

    return { ...last };
  }

  /** Aplica pés do hitscan no modelo + AABB debug (geometria do servidor). */
  private applyHitscanPose(feet: PosSample): void {
    this.crouchT = this.crouching ? 1 : 0;
    this.applyCrouchPose();

    this.root.position.set(feet.x, feet.y + this.height() / 2, feet.z);
    this.root.rotation.y = feet.yaw;

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
    this.debugBodyHitbox.position.set(feet.x, feet.y + bodyCy, feet.z);
    this.debugHeadHitbox.position.set(feet.x, feet.y + headCy, feet.z);
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

    if (this.hasPatch) {
      const dt = (now - this.lastPatchTime) / 1000;
      if (dt > 0.001 && dt < 0.5) {
        const dx = x - this.lastServerX;
        const dz = z - this.lastServerZ;
        if (Math.hypot(dx, dz) > 0.001) {
          this.velocityX = dx / dt;
          this.velocityZ = dz / dt;
          const speed = Math.hypot(this.velocityX, this.velocityZ);
          if (speed > MAX_EXTRAP_SPEED) {
            const scale = MAX_EXTRAP_SPEED / speed;
            this.velocityX *= scale;
            this.velocityZ *= scale;
          }
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
    this.lastYaw = yaw;
    this.crouching = crouch;

    this.history.push({ t: now, x, y, z, yaw });
    while (
      this.history.length > 0 &&
      now - this.history[0].t > HISTORY_MS
    ) {
      this.history.shift();
    }

    this.setVisible(alive);
  }

  setWallhack(enabled: boolean): void {
    // Group 1 + depth clear em main.ts → desenha por cima do cenário (através das paredes).
    const groupId = enabled ? 1 : 0;
    this.root.renderingGroupId = groupId;
    this.bodyMesh.renderingGroupId = groupId;
    this.headMesh.renderingGroupId = groupId;
    this.gun.renderingGroupId = groupId;
    for (const child of this.gun.getChildMeshes()) {
      child.renderingGroupId = groupId;
    }
    this.nameplate.renderingGroupId = groupId;

    this.bodyMesh.renderOutline = enabled;
    this.bodyMesh.outlineColor = new Color3(1, 0.15, 0.05);
    this.bodyMesh.outlineWidth = 0.04;

    this.headMesh.renderOutline = enabled;
    this.headMesh.outlineColor = new Color3(1, 0.15, 0.05);
    this.headMesh.outlineWidth = 0.04;

    const bodyMat = this.bodyMesh.material as StandardMaterial | null;
    const headMat = this.headMesh.material as StandardMaterial | null;
    if (bodyMat) {
      bodyMat.emissiveColor = enabled
        ? new Color3(0.85, 0.12, 0.05)
        : new Color3(0, 0, 0);
    }
    if (headMat) {
      headMat.emissiveColor = enabled
        ? new Color3(1, 0.18, 0.08)
        : new Color3(0, 0, 0);
    }
  }

  setDebugHitboxes(on: boolean): void {
    this.debugBodyHitbox.setEnabled(on);
    this.debugHeadHitbox.setEnabled(on);
  }

  /** `rttMs` = RTT autoritativo do servidor (mesmo do rewind). */
  update(_dt: number, rttMs = 0): void {
    if (!this.hasPatch) return;
    this.applyHitscanPose(this.sampleHitscanFeet(rttMs));
  }

  snapToTarget(): void {
    if (this.history.length === 0) return;
    const last = this.history[this.history.length - 1];
    this.velocityX = 0;
    this.velocityZ = 0;
    this.applyHitscanPose(last);
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
