import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { Vector3, Quaternion } from "@babylonjs/core/Maths/math.vector";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color4, Color3 } from "@babylonjs/core/Maths/math.color";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import "@babylonjs/loaders/glTF";

import {
  WEAPON_ASSETS,
  weaponModelTransform,
  weaponTint,
  applyWeaponTint,
} from "../player/ViewModel";
import {
  THIRD_PERSON_WEAPON_SCALE,
  THIRD_PERSON_GUN_ROOT,
  THIRD_PERSON_DUMMY_Y,
  THIRD_PERSON_CHARACTER_CENTER_Y,
  cleanThirdPersonAnimKey,
} from "../player/PlayerVisual";
import type { WeaponSkinDef } from "../../shared/weaponSkins";

export type PreviewMode = "character" | "weapon" | "loadout";

export class SkinPreview {
  private readonly canvas: HTMLCanvasElement;
  private engine: Engine;
  private scene: Scene;
  private camera: ArcRotateCamera;
  private dummyMesh: TransformNode | null = null;
  private characterRoot: TransformNode | null = null;
  private skinMat: PBRMaterial | StandardMaterial | null = null;
  private isRunning = false;
  private controlsAttached = false;
  private currentSkin = "skin_default";
  private mode: PreviewMode = "loadout";

  private gunRoot: TransformNode | null = null;
  private readonly animGroups = new Map<string, AnimationGroup>();
  private currentAnimKey = "";
  private readonly weaponNodes = new Map<string, TransformNode>();
  private readonly weaponModels = new Map<string, Mesh>();
  private readonly originalColors = new Map<string, Map<string, Color3>>();
  private readonly loadingWeapons = new Set<string>();
  private currentWeaponId: string | null = null;
  private pendingSkin: WeaponSkinDef | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    canvas.addEventListener("wheel", (e) => e.preventDefault(), { passive: false });
    this.engine = new Engine(canvas, true, { preserveDrawingBuffer: false, antialias: true });
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0, 0, 0, 0);

    this.camera = new ArcRotateCamera(
      "previewCamera",
      Math.PI / 2,
      Math.PI / 2.1,
      3.2,
      new Vector3(0, THIRD_PERSON_CHARACTER_CENTER_Y, 0),
      this.scene
    );
    this.camera.minZ = 0.01;
    this.camera.angularSensibilityX = 1000;
    this.camera.wheelPrecision = 50;

    const hemiLight = new HemisphericLight("previewHemi", new Vector3(0, 1, 0), this.scene);
    hemiLight.intensity = 1.2;
    hemiLight.groundColor = new Color3(0.3, 0.3, 0.35);

    const dirLight = new DirectionalLight("previewDir", new Vector3(-1, -2, 2), this.scene);
    dirLight.intensity = 0.8;

    this.applyCameraForMode();
    this.loadModel();
  }

  private applyCameraForMode(): void {
    if (this.mode === "weapon") {
      this.camera.setTarget(new Vector3(0, 0, 0));
      this.camera.radius = 1.15;
      this.camera.lowerRadiusLimit = 0.4;
      this.camera.upperRadiusLimit = 2.8;
      this.camera.lowerBetaLimit = 0.2;
      this.camera.upperBetaLimit = Math.PI - 0.2;
      this.camera.alpha = Math.PI / 2;
      this.camera.beta = Math.PI / 2.4;
    } else {
      this.camera.setTarget(new Vector3(0, THIRD_PERSON_CHARACTER_CENTER_Y, 0));
      this.camera.radius = 3.2;
      this.camera.lowerRadiusLimit = 2.0;
      this.camera.upperRadiusLimit = 4.5;
      this.camera.lowerBetaLimit = Math.PI / 2.5;
      this.camera.upperBetaLimit = Math.PI / 1.8;
      this.camera.alpha = Math.PI / 2;
      this.camera.beta = Math.PI / 2.1;
    }
  }

  private async loadModel() {
    try {
      const container = await SceneLoader.LoadAssetContainerAsync("", "/assets/player/player_dummy.glb", this.scene);
      const inst = container.instantiateModelsToScene();

      this.characterRoot = new TransformNode("previewCharacterRoot", this.scene);
      this.characterRoot.position.y = THIRD_PERSON_CHARACTER_CENTER_Y;

      this.dummyMesh = inst.rootNodes[0] as TransformNode;
      this.dummyMesh.parent = this.characterRoot;
      this.dummyMesh.position.y = THIRD_PERSON_DUMMY_Y;

      if (inst.animationGroups) {
        for (const ag of inst.animationGroups) {
          const key = cleanThirdPersonAnimKey(ag.name);
          this.animGroups.set(key, ag);
          this.animGroups.set(ag.name, ag);
          ag.stop();
        }
      }

      this.dummyMesh.getChildMeshes().forEach((m) => {
        if (m.material) {
          this.skinMat = m.material as PBRMaterial | StandardMaterial;
        }
      });

      this.gunRoot = new TransformNode("previewGunRoot", this.scene);
      this.placeGunRoot();
      for (const node of this.weaponNodes.values()) {
        node.parent = this.gunRoot;
      }

      this.setSkin(this.currentSkin);
      this.syncCharacterAnimation();
      this.updateVisible();
    } catch (e) {
      console.error("[SkinPreview] Falha ao carregar player_dummy.glb:", e);
    }
  }

  private syncCharacterAnimation(): void {
    if (this.mode === "weapon") {
      this.stopPreviewAnimations();
      return;
    }
    this.playPreviewAnimation("Idle");
  }

  private playPreviewAnimation(animName: string): void {
    if (this.animGroups.size === 0) return;

    const key = cleanThirdPersonAnimKey(animName);
    const targetAg = this.animGroups.get(key) || this.animGroups.get(animName);
    if (!targetAg) return;

    if (this.currentAnimKey === key && targetAg.isPlaying) return;

    for (const [k, ag] of this.animGroups.entries()) {
      if (k !== key && ag.isPlaying) ag.stop();
    }

    this.currentAnimKey = key;
    targetAg.speedRatio = 1;
    targetAg.start(true, 1, targetAg.from, targetAg.to, false);
  }

  private stopPreviewAnimations(): void {
    for (const ag of this.animGroups.values()) ag.stop();
    this.currentAnimKey = "";
  }

  private placeGunRoot(): void {
    if (!this.gunRoot) return;
    if (this.mode === "weapon") {
      this.gunRoot.parent = null;
      this.gunRoot.position.set(0, -0.05, 0);
      this.gunRoot.rotation.set(0, 0, 0);
    } else if (this.characterRoot) {
      // Mesma hierarquia do PlayerVisual: arma no root do personagem, não no dummy.
      this.gunRoot.parent = this.characterRoot;
      this.gunRoot.position.copyFrom(THIRD_PERSON_GUN_ROOT);
      this.gunRoot.rotation.set(0, 0, 0);
    }
  }

  public setMode(mode: PreviewMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.applyCameraForMode();
    this.placeGunRoot();
    this.syncCharacterAnimation();
    this.updateVisible();
  }

  public setSkin(skinId: string) {
    this.currentSkin = skinId;
    if (!this.skinMat) return;

    const tex = new Texture(`/assets/skins/${skinId}.png`, this.scene, true, false, Texture.NEAREST_SAMPLINGMODE);
    tex.hasAlpha = true;

    const mat = this.skinMat as any;
    if (mat.albedoTexture !== undefined) {
      mat.albedoTexture = tex;
    } else if (mat.diffuseTexture !== undefined) {
      mat.diffuseTexture = tex;
    }
  }

  /** Mostra uma arma (null = desarmado). */
  public setWeapon(weaponId: string | null) {
    this.currentWeaponId = weaponId;
    this.pendingSkin = null;
    if (weaponId && !this.weaponNodes.has(weaponId) && !this.loadingWeapons.has(weaponId)) {
      const url = WEAPON_ASSETS[weaponId];
      if (url) this.loadWeaponModel(weaponId, url);
    }
    this.updateVisible();
  }

  /** Aplica uma skin de arma no modelo atual (null = cores originais). */
  public setWeaponSkin(skin: WeaponSkinDef | null) {
    this.pendingSkin = skin;
    const id = this.currentWeaponId;
    if (!id) return;
    const model = this.weaponModels.get(id);
    if (!model) return;
    this.restoreOriginalColors(id);
    if (skin && skin.weaponId === id) {
      this.tintModelParts(model, skin.parts);
    } else {
      const tint = weaponTint(id);
      if (tint) applyWeaponTint(this.scene, model, tint);
    }
  }

  private loadWeaponModel(id: string, url: string) {
    this.loadingWeapons.add(id);

    SceneLoader.LoadAssetContainerAsync("", url, this.scene)
      .then((container) => {
        const inst = container.instantiateModelsToScene();
        const gunOffset = new TransformNode(`previewGunOffset_${id}`, this.scene);
        if (this.gunRoot) gunOffset.parent = this.gunRoot;

        const model = inst.rootNodes[0] as Mesh;
        const transform = weaponModelTransform(id, model);
        gunOffset.rotationQuaternion = Quaternion.FromEulerVector(transform.rotation);
        gunOffset.scaling.setAll(transform.scale * THIRD_PERSON_WEAPON_SCALE);

        model.parent = gunOffset;

        const originals = new Map<string, Color3>();
        for (const m of model.getChildMeshes()) {
          m.isPickable = false;
          if (m.material) {
            m.material = m.material.clone(`previewMat_${id}_${m.name}`);
          } else {
            const mat = new StandardMaterial(`previewMat_${id}_${m.name}`, this.scene);
            mat.diffuseColor = new Color3(0.55, 0.55, 0.58);
            mat.specularColor = new Color3(0.05, 0.05, 0.05);
            m.material = mat;
          }
          originals.set(m.name, this.readMeshColor(m).clone());
        }

        const tint = weaponTint(id);
        if (tint) applyWeaponTint(this.scene, model, tint);

        this.originalColors.set(id, originals);
        this.weaponNodes.set(id, gunOffset);
        this.weaponModels.set(id, model);
        this.loadingWeapons.delete(id);
        this.updateVisible();
        if (this.pendingSkin) this.setWeaponSkin(this.pendingSkin);
      })
      .catch((err) => {
        console.warn(`[SkinPreview] Falha ao carregar arma ${id}:`, err);
        this.loadingWeapons.delete(id);
      });
  }

  private readMeshColor(m: AbstractMesh): Color3 {
    const mat = m.material as unknown as {
      albedoColor?: Color3;
      diffuseColor?: Color3;
    } | null;
    return mat?.albedoColor?.clone() ?? mat?.diffuseColor?.clone() ?? new Color3(0.55, 0.55, 0.58);
  }

  private restoreOriginalColors(weaponId: string): void {
    const model = this.weaponModels.get(weaponId);
    const originals = this.originalColors.get(weaponId);
    if (!model || !originals) return;
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

  private tintModelParts(model: Mesh, parts: Record<string, [number, number, number]>): void {
    for (const m of model.getChildMeshes()) {
      const rgb = parts[m.name];
      if (!rgb) continue;
      const color = new Color3(rgb[0], rgb[1], rgb[2]);
      const mat = m.material as unknown as {
        albedoColor?: Color3;
        diffuseColor?: Color3;
      } | null;
      if (mat?.albedoColor !== undefined) mat.albedoColor = color;
      else if (mat?.diffuseColor !== undefined) mat.diffuseColor = color;
    }
  }

  private updateVisible() {
    if (this.dummyMesh) this.dummyMesh.setEnabled(this.mode !== "weapon");

    for (const [id, node] of this.weaponNodes) {
      node.setEnabled(this.mode !== "character" && id === this.currentWeaponId);
    }
    if (this.gunRoot) this.gunRoot.setEnabled(this.mode !== "character");
  }

  public start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.applyCameraForMode();
    this.syncCharacterAnimation();
    if (!this.controlsAttached) {
      this.camera.attachControl(this.canvas, false);
      this.controlsAttached = true;
    }
    this.engine.runRenderLoop(() => {
      this.scene.render();
    });
  }

  public stop() {
    if (!this.isRunning) return;
    this.isRunning = false;
    this.stopPreviewAnimations();
    this.engine.stopRenderLoop();
    if (this.controlsAttached) {
      this.camera.detachControl();
      this.controlsAttached = false;
    }
  }

  public resize() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w <= 0 || h <= 0) return;
    this.engine.resize();
  }
}
