import { Scene } from "@babylonjs/core/scene";
import { Vector3, Quaternion, Color3 } from "@babylonjs/core/Maths/math";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Material } from "@babylonjs/core/Materials/material";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";

import { WEAPON_ASSETS, weaponModelTransform, applyWeaponAppearance } from "./ViewModel";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { getWeaponSkin } from "../../shared/weaponSkins";
import { MuzzleFlash } from "../game/effects";

/** Escala extra na visão em terceira pessoa — evita o braço cobrir a arma. */
export const THIRD_PERSON_WEAPON_SCALE = 1.24;
/** Posição da arma no root do jogador (x=direita, y=altura, z=frente). */
export const THIRD_PERSON_GUN_ROOT = new Vector3(0.36, 0.60, 0.60);
export const THIRD_PERSON_GUN_CROUCH_Y = 0.44;
/** Offset Y do dummy em relação ao root (pés no chão). */
export const THIRD_PERSON_DUMMY_Y = -0.9;
/** Centro do personagem em pé (altura do root / alvo da câmera no preview). */
export const THIRD_PERSON_CHARACTER_CENTER_Y = 0.9;

export function cleanThirdPersonAnimKey(name: string): string {
  let s = name.trim().toLowerCase();
  if (s.startsWith("clone of ")) s = s.substring(9).trim();
  if (s.includes("|")) s = s.split("|").pop()!.trim();
  s = s.replace(/^(playerrig_|armature_|player_|rig_)/, "");
  return s.replace(/[^a-z0-9]/g, "");
}

const GUN_ROOT_STAND = THIRD_PERSON_GUN_ROOT;
const GUN_ROOT_CROUCH_Y = THIRD_PERSON_GUN_CROUCH_Y;

export interface PlayerVisualPose {
  isMoving: boolean;
  isCrouching: boolean;
  speedRatio?: number;
  isAlive?: boolean;
}

function cleanAnimKey(name: string): string {
  return cleanThirdPersonAnimKey(name);
}

export class PlayerVisual {
  public readonly root: TransformNode;
  private dummyMesh: TransformNode | null = null;
  private skinMat: PBRMaterial | StandardMaterial | null = null;
  private skinTexture: Texture | null = null;
  private currentSkinId = "skin_default";
  private appliedSkinId: string | null = null;

  private animGroups = new Map<string, AnimationGroup>();
  private currentAnimKey = "";

  private gunRoot: TransformNode;
  private currentWeaponModel: Mesh | null = null;
  private currentWeaponId = "m4a1";
  private loadedWeaponId = "";
  private currentWeaponSkinId = "";
  private pendingWeaponSkinId = "";
  private pendingWeaponSkinParts: Record<string, [number, number, number]> | null = null;
  private loadingWeaponId = "";
  private originalColors = new Map<string, Map<string, Color3>>();

  private muzzleFlash: MuzzleFlash;
  private recoilKick = 0;

  private invincible = false;
  private alive = true;
  private lastPose: PlayerVisualPose = {
    isMoving: false,
    isCrouching: false,
    speedRatio: 1.0,
    isAlive: true,
  };

  constructor(scene: Scene, name = "PlayerVisual", parent?: TransformNode) {
    this.root = new TransformNode(name, scene);
    if (parent) this.root.parent = parent;

    // Ponto de encaixe da arma (sempre apontada para a frente)
    this.gunRoot = new TransformNode(`${name}_gunRoot`, scene);
    this.gunRoot.parent = this.root;
    this.gunRoot.position.copyFrom(GUN_ROOT_STAND);

    this.muzzleFlash = new MuzzleFlash(scene, this.gunRoot, { size: 0.32 });
    this.muzzleFlash.setLocalPosition(new Vector3(0, 0.02, 0.65));

    // Carregar modelo base Minecraft
    SceneLoader.LoadAssetContainerAsync("", "/assets/player/player_dummy.glb", scene).then((container) => {
      const inst = container.instantiateModelsToScene();
      this.dummyMesh = inst.rootNodes[0] as TransformNode;
      this.dummyMesh.parent = this.root;
      this.dummyMesh.position.y = THIRD_PERSON_DUMMY_Y; // Base no chão (origem = pés)
      this.dummyMesh.setEnabled(this.alive);

      // Indexar todos os grupos de animação
      if (inst.animationGroups) {
        for (const ag of inst.animationGroups) {
          const key = cleanAnimKey(ag.name);
          this.animGroups.set(key, ag);
          this.animGroups.set(ag.name, ag);
          ag.stop();
        }
      }

      this.dummyMesh.getChildMeshes().forEach((m) => {
        m.isPickable = false;
        if (m.material) {
          this.skinMat = m.material as PBRMaterial | StandardMaterial;
        }
      });

      this.setSkin(this.currentSkinId);
      this.applyInvincibilityAlpha();
      this.setPose(this.lastPose);
    }).catch(console.error);

    this.setWeapon(this.currentWeaponId);
  }

  setSkin(skinId: string): void {
    if (!skinId) return;
    this.currentSkinId = skinId;
    if (!this.skinMat || this.appliedSkinId === skinId) return;
    this.appliedSkinId = skinId;

    const scene = this.root.getScene();
    const tex = new Texture(
      `/assets/skins/${skinId}.png`,
      scene,
      true,
      false,
      Texture.NEAREST_SAMPLINGMODE
    );
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

  setWeapon(weaponId: string): void {
    if (!weaponId) return;
    const weaponChanged = weaponId !== this.currentWeaponId;
    this.currentWeaponId = weaponId;
    if (weaponChanged) this.pendingWeaponSkinId = this.currentWeaponSkinId;
    if (weaponId === this.loadedWeaponId) {
      this.applyStoredWeaponSkin();
      return;
    }
    if (this.loadingWeaponId === weaponId) return;

    this.loadingWeaponId = weaponId;
    const assetUrl = WEAPON_ASSETS[weaponId] || WEAPON_ASSETS.m4a1;
    const scene = this.root.getScene();

    SceneLoader.LoadAssetContainerAsync("", assetUrl, scene).then((container) => {
      if (weaponId !== this.currentWeaponId) {
        if (this.loadingWeaponId === weaponId) this.loadingWeaponId = "";
        return;
      }

      if (this.currentWeaponModel) {
        this.currentWeaponModel.dispose(false, true);
        this.currentWeaponModel = null;
      }

      const inst = container.instantiateModelsToScene();
      const model = inst.rootNodes[0] as Mesh;
      const transform = weaponModelTransform(weaponId, model);

      const offsetNode = new TransformNode(`gunOffset_${weaponId}`, scene);
      offsetNode.parent = this.gunRoot;
      offsetNode.rotationQuaternion = Quaternion.FromEulerVector(transform.rotation);
      offsetNode.scaling.setAll(transform.scale * THIRD_PERSON_WEAPON_SCALE);

      model.parent = offsetNode;
      this.currentWeaponModel = model;

      const originals = new Map<string, Color3>();
      model.getChildMeshes(false).forEach((m) => {
        m.isPickable = false;
        if (m.material) {
          m.material = m.material.clone(`pvMat_${weaponId}_${m.name}`);
        } else {
          const mat = new StandardMaterial(`pvMat_${weaponId}_${m.name}`, scene);
          mat.diffuseColor = new Color3(0.55, 0.55, 0.58);
          mat.specularColor = new Color3(0.05, 0.05, 0.05);
          m.material = mat;
        }
        originals.set(m.name, this.readMeshColor(m).clone());
      });
      this.originalColors.set(weaponId, originals);

      const length = weaponId === "knife" ? 0.2 : weaponId === "awp" ? 0.9 : 0.65;
      this.muzzleFlash.setLocalPosition(new Vector3(0, 0.02, length));
      this.loadedWeaponId = weaponId;
      this.loadingWeaponId = "";
      this.applyStoredWeaponSkin();
    }).catch((err) => {
      if (this.loadingWeaponId === weaponId) this.loadingWeaponId = "";
      console.error(err);
    });
  }

  /**
   * Id da skin (vazio = padrão). `parts` vem da rede para não depender
   * do catálogo local do observador.
   */
  setWeaponSkin(
    skinId: string,
    parts?: Record<string, [number, number, number]> | null
  ): void {
    const next = skinId || "";
    const nextParts = parts === undefined ? this.pendingWeaponSkinParts : parts;
    if (next === this.currentWeaponSkinId && nextParts === this.pendingWeaponSkinParts) {
      this.applyStoredWeaponSkin();
      return;
    }
    this.currentWeaponSkinId = next;
    this.pendingWeaponSkinId = next;
    this.pendingWeaponSkinParts = nextParts;
    this.applyStoredWeaponSkin();
  }

  private readMeshColor(m: AbstractMesh): Color3 {
    const mat = m.material as unknown as {
      albedoColor?: Color3;
      diffuseColor?: Color3;
    } | null;
    return mat?.albedoColor?.clone() ?? mat?.diffuseColor?.clone() ?? new Color3(0.55, 0.55, 0.58);
  }

  private restoreOriginalColors(weaponId: string): void {
    const model = this.currentWeaponModel;
    const originals = this.originalColors.get(weaponId);
    if (!model || !originals || weaponId !== this.currentWeaponId) return;
    for (const m of model.getChildMeshes()) {
      const c = originals.get(m.name);
      if (!c) continue;
      const mat = m.material as unknown as {
        albedoColor?: Color3;
        diffuseColor?: Color3;
      } | null;
      if (mat?.albedoColor !== undefined) mat.albedoColor = c.clone();
      else if (mat?.diffuseColor !== undefined) mat.diffuseColor = c.clone();
    }
  }

  private applyStoredWeaponSkin(): void {
    const weaponId = this.currentWeaponId;
    const model = this.currentWeaponModel;
    if (!model || this.loadedWeaponId !== weaponId) return;

    this.restoreOriginalColors(weaponId);
    const skinId = this.pendingWeaponSkinId;
    const fromNet = this.pendingWeaponSkinParts;
    const skin = !fromNet && skinId ? getWeaponSkin(skinId) : undefined;
    const overlay =
      fromNet ??
      (skin && skin.weaponId === weaponId ? skin.parts : null);
    applyWeaponAppearance(this.root.getScene(), model, weaponId, overlay);
  }

  triggerShoot(): void {
    this.recoilKick = 0.35;

    if (this.currentWeaponId !== "knife") {
      const heavy =
        this.currentWeaponId === "shotgun" ||
        this.currentWeaponId === "magnum" ||
        this.currentWeaponId === "awp";
      this.muzzleFlash.trigger(heavy ? 1.4 : 1);
    }
  }

  update(dt: number): void {
    this.muzzleFlash.update(dt);
    if (this.recoilKick > 0) {
      this.recoilKick = Math.max(0, this.recoilKick - dt * 10.0);
    }

    const isCrouching = this.lastPose.isCrouching;
    const targetGunY = (isCrouching ? GUN_ROOT_CROUCH_Y : GUN_ROOT_STAND.y) + this.recoilKick * 0.08;
    const targetGunZ = GUN_ROOT_STAND.z - this.recoilKick * 0.12;
    const targetGunPitch = -this.recoilKick * 0.6;

    this.gunRoot.position.set(GUN_ROOT_STAND.x, targetGunY, targetGunZ);
    this.gunRoot.rotation.set(targetGunPitch, 0, 0);
  }

  setPose(pose: PlayerVisualPose): void {
    this.lastPose = pose;
    const isAlive = pose.isAlive ?? this.alive;
    this.alive = isAlive;

    if (!isAlive) {
      this.stopAllAnimations();
      return;
    }

    let targetAnim = "Idle";
    if (pose.isCrouching) {
      targetAnim = pose.isMoving ? "Crouch_Walk" : "Crouch_Idle";
    } else {
      targetAnim = pose.isMoving ? "Walk" : "Idle";
    }

    const speedRatio = pose.isMoving ? Math.max(0.8, Math.min(2.0, pose.speedRatio ?? 1.0)) : 1.0;
    this.playAnimation(targetAnim, speedRatio);
  }

  private playAnimation(animName: string, speedRatio = 1.0): void {
    if (this.animGroups.size === 0) return;

    const key = cleanAnimKey(animName);
    const targetAg = this.animGroups.get(key) || this.animGroups.get(animName);
    if (!targetAg) return;

    if (this.currentAnimKey === key && targetAg.isPlaying) {
      targetAg.speedRatio = speedRatio;
      return;
    }

    for (const [k, ag] of this.animGroups.entries()) {
      if (k !== key && ag.isPlaying) {
        ag.stop();
      }
    }

    this.currentAnimKey = key;
    targetAg.speedRatio = speedRatio;
    targetAg.start(true, speedRatio, targetAg.from, targetAg.to, false);
  }

  private stopAllAnimations(): void {
    for (const ag of this.animGroups.values()) {
      ag.stop();
    }
    this.currentAnimKey = "";
  }

  setEnabled(enabled: boolean): void {
    this.alive = enabled;
    this.root.setEnabled(enabled);
    this.dummyMesh?.setEnabled(enabled);
    this.gunRoot.setEnabled(enabled);
    if (!enabled) {
      this.stopAllAnimations();
    }
  }

  setInvincible(on: boolean): void {
    if (this.invincible === on) return;
    this.invincible = on;
    this.applyInvincibilityAlpha();
  }

  private applyInvincibilityAlpha(): void {
    const alpha = this.invincible ? 0.6 : 1.0;
    const mode = this.invincible ? Material.MATERIAL_ALPHABLEND : Material.MATERIAL_OPAQUE;

    if (this.skinMat) {
      this.skinMat.alpha = alpha;
      this.skinMat.transparencyMode = mode;
    }
  }

  dispose(): void {
    for (const ag of this.animGroups.values()) {
      ag.dispose();
    }
    this.animGroups.clear();
    this.skinTexture?.dispose();
    this.currentWeaponModel?.dispose(false, true);
    this.muzzleFlash.dispose();
    this.root.dispose(false, true);
  }
}
