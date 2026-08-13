import { Scene } from "@babylonjs/core/scene";
import { Vector3, Color3, Quaternion } from "@babylonjs/core/Maths/math";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Material } from "@babylonjs/core/Materials/material";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";

import { CONFIG } from "../../shared/config";
import { HITBOX } from "../../shared/hitboxes";
import { CROUCH_EYE_HEIGHT, EYE_HEIGHT } from "../../shared/movement";

const STAND_HEIGHT = 1.8;
const CROUCH_HEIGHT = 1.15;
const MAX_EXTRAP_SPEED = 10;
const HISTORY_MS = 1000;
/** Teto ao prever além do último patch (equivale ao rewind com ping alto). */
const EXTRAP_CAP_MS = 350;
/** Salto acima disso = teleporte/respawn: limpa histórico em vez de interpolar. */
const TELEPORT_SNAP_DIST = 4;

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
  private dummyMesh: TransformNode | null = null;
  private skinMat: PBRMaterial | StandardMaterial | null = null;
  private skinTexture: Texture | null = null;
  private appliedSkinId: string | null = null;
  private currentSkinId = "skin_default";
  private aliveVisible = true;

  private velocityX = 0;
  private velocityZ = 0;
  private lastServerX = 0;
  private lastServerZ = 0;
  private lastPatchTime = 0;
  private lastYaw = 0;
  private hasPatch = false;
  private wasAlive = true;
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

    // Carregar o modelo voxel
    SceneLoader.LoadAssetContainerAsync("", "/assets/player_dummy.glb", scene).then((container) => {
      const inst = container.instantiateModelsToScene();
      this.dummyMesh = inst.rootNodes[0] as TransformNode;
      this.dummyMesh.parent = this.root;
      this.dummyMesh.position.y = -0.9; // Base no chão do root
      // Pode ter morrido enquanto o GLB baixava — respeita o estado atual.
      this.dummyMesh.setEnabled(this.aliveVisible);

      this.dummyMesh.getChildMeshes().forEach(m => {
        m.isPickable = false; // Hitbox é que recebe o raycast
        if (m.material) {
          this.skinMat = m.material as PBRMaterial | StandardMaterial;
        }
      });

      this.setSkin(this.currentSkinId);
      this.applyInvincibilityAlpha();
    }).catch(console.error);

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
    this.skeletonBody.isPickable = false;
    this.skeletonBody.renderingGroupId = 1;

    this.skeletonHead = MeshBuilder.CreateSphere(
      `${id}_skelHead`,
      { diameter: HITBOX.headRadius * 2, segments: 8 },
      scene
    );
    this.skeletonHead.parent = this.root;
    this.skeletonHead.position.y = STAND_HEAD_Y;
    this.skeletonHead.material = skelMat;
    this.skeletonHead.isPickable = false;
    this.skeletonHead.renderingGroupId = 1;
    this.refreshSkeletonVisibility();

    const gunMat = new StandardMaterial(`${id}_gunMat`, scene);
    gunMat.diffuseColor = new Color3(0.15, 0.15, 0.17);
    gunMat.specularColor = new Color3(0.05, 0.05, 0.05);

    this.gun = MeshBuilder.CreateBox(`${id}_gunRoot`, { size: 0.1 }, scene) as any;
    this.gun.isVisible = false;
    this.gun.parent = this.root;
    this.gun.position = new Vector3(0.32, 0.32, 0.3);

    const fallbackGun = MeshBuilder.CreateBox(
      `${id}_fallbackGun`,
      { width: 0.09, height: 0.12, depth: 0.55 },
      scene
    );
    fallbackGun.parent = this.gun;
    fallbackGun.material = gunMat;
    fallbackGun.isPickable = false;

    const gunBarrel = MeshBuilder.CreateCylinder(
      `${id}_gunBarrel`,
      { height: 0.25, diameter: 0.05 },
      scene
    );
    gunBarrel.parent = fallbackGun;
    gunBarrel.rotation.x = Math.PI / 2;
    gunBarrel.position = new Vector3(0, 0.02, 0.38);
    gunBarrel.material = gunMat;
    gunBarrel.isPickable = false;

    // Carregar o modelo do rifle
    SceneLoader.LoadAssetContainerAsync("", "/assets/rifle_v2.glb", scene).then((container) => {
      const inst = container.instantiateModelsToScene();
      const gunOffset = new TransformNode(`${this.id}_gunOffset`, scene);
      gunOffset.parent = this.gun;
      
      gunOffset.rotationQuaternion = Quaternion.FromEulerAngles(
        Math.PI / -2,
        0,
        0
      );

      const model = inst.rootNodes[0] as Mesh;
      model.parent = gunOffset;
      
      fallbackGun.setEnabled(false);
      
      model.getChildMeshes(false).forEach(m => {
        m.isPickable = false;
        // Ajuste no material pode ser necessário se quisermos wallhack/invincibility perfeitos
      });
    }).catch(console.error);

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
    this.currentSkinId = skinId;
    // Sem material (GLB ainda não carregou) ou skin já aplicada: não recria textura.
    if (!this.skinMat || this.appliedSkinId === skinId) return;
    this.appliedSkinId = skinId;

    const scene = this.root.getScene();
    const tex = new Texture(`/assets/${skinId}.png`, scene, true, false, Texture.NEAREST_SAMPLINGMODE);
    tex.hasAlpha = true;

    const mat = this.skinMat as any;
    if (mat.albedoTexture !== undefined) {
      mat.albedoTexture = tex;
    } else if (mat.diffuseTexture !== undefined) {
      mat.diffuseTexture = tex;
    }

    this.skinTexture?.dispose();
    this.skinTexture = tex;
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

    if (this.dummyMesh) {
      this.dummyMesh.scaling.y = this.bodyMesh.scaling.y;
      // O GLB tem a base na origem do nó: -height/2 mantém os pés no chão
      // em pé ou agachado (a fórmula antiga afundava o modelo ao agachar).
      this.dummyMesh.position.y = -h / 2;
    }
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
    const respawned = !this.wasAlive && alive;
    const died = this.wasAlive && !alive;
    const jumpDist = this.hasPatch
      ? Math.hypot(x - this.lastServerX, z - this.lastServerZ)
      : 0;
    const teleported = jumpDist > TELEPORT_SNAP_DIST;

    // Respawn / teleporte: sem interpolar do ponto antigo até o novo.
    if (respawned || teleported || died) {
      this.history.length = 0;
      this.velocityX = 0;
      this.velocityZ = 0;
    } else if (this.hasPatch) {
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
      this.velocityX = 0;
      this.velocityZ = 0;
    }

    this.hasPatch = true;
    this.lastServerX = x;
    this.lastServerZ = z;
    this.lastPatchTime = now;
    this.lastYaw = yaw;
    this.crouching = crouch;
    this.wasAlive = alive;

    // Morto: não alimenta o buffer — evita “deslizar” até o spawn.
    if (alive) {
      this.history.push({ t: now, x, y, z, yaw });
      while (
        this.history.length > 0 &&
        now - this.history[0].t > HISTORY_MS
      ) {
        this.history.shift();
      }
    }

    this.setVisible(alive);

    if (alive && (respawned || teleported)) {
      this.snapToTarget();
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
    // O modelo GLB é o que aparece em tela — sem isso a invencibilidade
    // não tinha feedback visual nenhum.
    if (this.skinMat) {
      this.skinMat.alpha = alpha;
      this.skinMat.transparencyMode = mode;
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
    this.aliveVisible = on;
    this.bodyMesh.setEnabled(on);
    this.headMesh.setEnabled(on);
    this.nameplate.setEnabled(on);
    this.gun.setEnabled(on);
    this.dummyMesh?.setEnabled(on); // Sem isso o cadáver ficava visível até o respawn
    this.root.checkCollisions = on;
    this.debugBodyHitbox.isVisible = on;
    this.debugHeadHitbox.isVisible = on;
    this.refreshSkeletonVisibility();
  }

  dispose(): void {
    this.debugBodyHitbox.dispose();
    this.debugHeadHitbox.dispose();
    this.root.dispose(false, true);
  }
}
