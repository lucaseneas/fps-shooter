import { Scene } from "@babylonjs/core/scene";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { Vector3, Color3, Quaternion } from "@babylonjs/core/Maths/math";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";

import { WeaponDef } from "../../shared/weapons";

function easeOutCubic(t: number): number {
  const u = 1 - t;
  return 1 - u * u * u;
}

/** Subida da arma ao iniciar a corrida (s) — mais rápida que a descida. */
const SPRINT_RAISE_DURATION = 0.22;
/**
 * Descida da arma ao parar de correr (s).
 * Exportada porque o WeaponSystem bloqueia o tiro durante esse mesmo tempo.
 */
export const SPRINT_LOWER_DURATION = 0.3;

interface WeaponViewModelConfig {
  offset: Vector3;
  muzzle: Vector3;
  sprintPitch: number;
  sprintPosOffset: Vector3;
  /**
   * Rotação (euler, rad) aplicada ao modelo GLB.
   * Padrão: -90° em X — os GLBs têm o eixo longo em Y e isso "deita"
   * o modelo apontando para frente (correto para armas de fogo).
   */
  rotation?: Vector3;
  /** Escala uniforme extra aplicada ao modelo GLB (padrão 1). Multiplica a auto-escala. */
  scale?: number;
  /**
   * Comprimento alvo do maior eixo do modelo (unidades do view model).
   * Se definido, o GLB é medido no carregamento e escalado automaticamente
   * para esse tamanho — permite usar GLBs de qualquer escala de origem.
   */
  targetLength?: number;
  /** Cor RGB (0–1) aplicada sobre os materiais do modelo (base para skins). */
  tint?: [number, number, number];
}

const DEFAULT_CONFIG: WeaponViewModelConfig = {
  offset: new Vector3(-0.1, 0.05, -0.35),
  muzzle: new Vector3(-0.1, 0.05, 0.45),
  sprintPitch: -0.85,
  sprintPosOffset: new Vector3(-0.1, -0.05, -0.12),
  // Armas novas sem config própria: normaliza para o tamanho de uma arma longa.
  targetLength: 0.7,
};

/** Rotação padrão dos GLBs: deita o eixo Y do modelo para a frente da câmera. */
const DEFAULT_MODEL_ROTATION = new Vector3(Math.PI / -2, 0, 0);

const WEAPON_CONFIGS: Record<string, WeaponViewModelConfig> = {
  rifle: {
    offset: new Vector3(-0.1, 0.05, -0.35),
    muzzle: new Vector3(-0.1, 0.05, 0.45),
    sprintPitch: -0.80,
    sprintPosOffset: new Vector3(-0.08, -0.04, -0.08),
  },
  ak47: {
    offset: new Vector3(-0.1, 0.05, -0.35),
    muzzle: new Vector3(-0.1, 0.05, 0.48),
    sprintPitch: -0.80,
    sprintPosOffset: new Vector3(-0.08, -0.04, -0.08),
  },
  mp5: {
    offset: new Vector3(-0.1, 0.05, -0.32),
    muzzle: new Vector3(-0.1, 0.05, 0.33),
    // Modelo centrado no pivô: o giro do sprint a derrubava na tela —
    // sobe a arma durante a corrida e inclina menos que as demais.
    sprintPitch: -0.6,
    sprintPosOffset: new Vector3(-0.08, 0.06, -0.02),
    // O GLB da MP5 tem o eixo longo em Z (~10 unidades) e já aponta para
    // frente como importado — sem rotação. O targetLength normaliza o
    // tamanho (SMG compacta, ~0.62).
    rotation: new Vector3(0, 0, 0),
    targetLength: 0.62,
  },
  sniper: {
    offset: new Vector3(-0.1, 0.05, -0.35),
    muzzle: new Vector3(-0.1, 0.05, 0.72),
    sprintPitch: -0.75,
    sprintPosOffset: new Vector3(-0.08, -0.04, -0.08),
  },
  shotgun: {
    offset: new Vector3(-0.1, 0.05, -0.35),
    muzzle: new Vector3(-0.1, 0.05, 0.42),
    sprintPitch: -0.75,
    sprintPosOffset: new Vector3(-0.08, -0.04, -0.08),
  },
  pistol: {
    // Pistola: trazida mais para a frente para não clipar na câmera
    offset: new Vector3(-0.07, 0.02, -0.18),
    muzzle: new Vector3(-0.07, 0.04, 0.18),
    sprintPitch: -0.45,
    sprintPosOffset: new Vector3(-0.04, -0.02, -0.03),
  },
  magnum: {
    // Magnum: ligeiramente mais à frente que armas longas
    offset: new Vector3(-0.07, 0.02, -0.18),
    muzzle: new Vector3(-0.07, 0.04, 0.22),
    sprintPitch: -0.45,
    sprintPosOffset: new Vector3(-0.04, -0.02, -0.03),
  },
  knife: {
    offset: new Vector3(-0.06, -0.1, -0.2),
    muzzle: new Vector3(0, 0, 0),
    sprintPitch: -0.35,
    sprintPosOffset: new Vector3(-0.03, -0.02, -0.03),
    // Faca: lâmina para cima (180° em X desfaz o "deitar" padrão das armas),
    // com leve inclinação lateral. O GLB tem só 12cm — escala maior para aparecer.
    rotation: new Vector3(Math.PI, 0, 0.35),
    scale: 1.3,
  },
};

/**
 * Rotação/escala do modelo GLB de uma arma (usado no ViewModel e no SkinPreview).
 * Se `model` for passado e a config tiver `targetLength`, mede o bounding box
 * do modelo (chame ANTES de parentar) e calcula a auto-escala.
 */
export function weaponModelTransform(
  id: string,
  model?: Mesh
): { rotation: Vector3; scale: number } {
  const cfg = WEAPON_CONFIGS[id] ?? DEFAULT_CONFIG;
  let scale = cfg.scale ?? 1;

  if (cfg.targetLength != null && model) {
    model.computeWorldMatrix(true);
    const { min, max } = model.getHierarchyBoundingVectors(true);
    const size = max.subtract(min);
    const current = Math.max(size.x, size.y, size.z);
    if (current > 1e-6) scale *= cfg.targetLength / current;
  }

  return { rotation: cfg.rotation ?? DEFAULT_MODEL_ROTATION, scale };
}

/** Cor de tingimento configurada para a arma (undefined = cor original do GLB). */
export function weaponTint(id: string): [number, number, number] | undefined {
  return (WEAPON_CONFIGS[id] ?? DEFAULT_CONFIG).tint;
}

/**
 * Tingi o modelo de uma arma com uma cor (base do sistema de skins).
 * Meshes com material PBR/Standard têm a cor ajustada mantendo o material;
 * meshes sem material (comum em GLBs simples como a MP5) recebem um
 * StandardMaterial compartilhado com a cor.
 */
export function applyWeaponTint(
  scene: Scene,
  model: Mesh,
  rgb: [number, number, number]
): void {
  applyWeaponSkinParts(scene, model, { "*": rgb });
}

/** Aplica cores por nome de mesh. Chave `"*"` pinta todas as partes. */
export function applyWeaponSkinParts(
  scene: Scene,
  model: Mesh,
  parts: Record<string, [number, number, number]>
): void {
  let fallbackMat: StandardMaterial | null = null;
  const tintMesh = (m: AbstractMesh, rgb: [number, number, number]) => {
    const color = new Color3(rgb[0], rgb[1], rgb[2]);
    const mat = m.material as unknown as {
      albedoColor?: Color3;
      diffuseColor?: Color3;
    } | null;
    if (mat && mat.albedoColor !== undefined) {
      mat.albedoColor = color;
    } else if (mat && mat.diffuseColor !== undefined) {
      mat.diffuseColor = color;
    } else {
      fallbackMat ??= new StandardMaterial(`vmTint_${model.name}`, scene);
      fallbackMat.diffuseColor = color;
      fallbackMat.specularColor = new Color3(0.05, 0.05, 0.05);
      m.material = fallbackMat;
    }
  };

  const wildcard = parts["*"];
  for (const m of model.getChildMeshes()) {
    const rgb = parts[m.name] ?? wildcard;
    if (rgb) tintMesh(m, rgb);
  }
}

export const WEAPON_ASSETS: Record<string, string> = {
  rifle: "/assets/rifle_v2.glb",
  ak47: "/assets/ak47.glb",
  mp5: "/assets/MP5.glb",
  pistol: "/assets/pistol.glb",
  magnum: "/assets/magnum.glb",
  shotgun: "/assets/shotgun.glb",
  sniper: "/assets/sniper.glb",
  knife: "/assets/knife.glb",
};

export class ViewModel {
  private readonly scene: Scene;
  private readonly root: TransformNode;
  private readonly fallbackRoot: TransformNode;
  private readonly modelsRoot: TransformNode;
  private readonly weaponNodes = new Map<string, TransformNode>();
  private readonly weaponModels = new Map<string, Mesh>();
  private readonly originalColors = new Map<string, Map<string, Color3>>();
  /** Skin equipada por arma (null = cores originais / tint padrão). */
  private readonly equippedParts = new Map<string, Record<string, [number, number, number]> | null>();
  private readonly loadingWeapons = new Set<string>();

  private readonly bodyMat: StandardMaterial;
  private readonly bodyMesh: Mesh;
  private readonly barrel: Mesh;
  private readonly flash: Mesh;
  private flashTimeout = 0;
  private melee = false;
  private currentWeaponId = "rifle";
  private isInvincible = false;

  private kick = 0;
  private reloadDip = 0;
  private reloading = false;

  private drawProgress = 1;
  private drawDuration = 0.7;

  /** Pose de corrida: 0 = arma normal, 1 = arma apontada para cima. */
  private sprinting = false;
  private sprintBlend = 0;

  private readonly basePos = new Vector3(0.28, -0.24, 0.65);

  constructor(scene: Scene, camera: UniversalCamera) {
    this.scene = scene;
    this.root = new TransformNode("vmRoot", scene);
    this.root.parent = camera;
    this.root.position = this.basePos.clone();

    this.fallbackRoot = new TransformNode("vmFallback", scene);
    this.fallbackRoot.parent = this.root;

    this.modelsRoot = new TransformNode("vmModelsRoot", scene);
    this.modelsRoot.parent = this.root;

    this.bodyMat = new StandardMaterial("vmMat", scene);
    this.bodyMat.specularColor = new Color3(0.08, 0.08, 0.08);

    this.bodyMesh = MeshBuilder.CreateBox(
      "vmBody",
      { width: 0.09, height: 0.14, depth: 0.42 },
      scene
    );
    this.bodyMesh.material = this.bodyMat;
    this.bodyMesh.parent = this.fallbackRoot;

    this.barrel = MeshBuilder.CreateCylinder(
      "vmBarrel",
      { height: 0.3, diameter: 0.045 },
      scene
    );
    this.barrel.rotation.x = Math.PI / 2;
    this.barrel.position = new Vector3(0, 0.03, 0.3);
    this.barrel.material = this.bodyMat;
    this.barrel.parent = this.fallbackRoot;

    const flashMat = new StandardMaterial("vmFlashMat", scene);
    flashMat.emissiveColor = new Color3(1, 0.85, 0.2);
    flashMat.disableLighting = true;
    this.flash = MeshBuilder.CreateSphere(
      "vmFlash",
      { diameter: 0.12, segments: 4 },
      scene
    );
    this.flash.material = flashMat;
    this.flash.position = new Vector3(0, 0.05, 0.6);
    this.flash.parent = this.root;
    this.flash.setEnabled(false);

    for (const m of [this.bodyMesh, this.barrel, this.flash]) {
      m.isPickable = false;
      m.renderingGroupId = 2;
    }

    // Preload de todas as armas
    for (const [id, url] of Object.entries(WEAPON_ASSETS)) {
      this.loadWeaponModel(id, url);
    }
  }

  private loadWeaponModel(id: string, url: string): void {
    if (this.weaponNodes.has(id) || this.loadingWeapons.has(id)) return;
    this.loadingWeapons.add(id);

    const cfg = WEAPON_CONFIGS[id] ?? DEFAULT_CONFIG;

    SceneLoader.LoadAssetContainerAsync("", url, this.scene)
      .then((container) => {
        const inst = container.instantiateModelsToScene();
        const gunOffset = new TransformNode(`vmGunOffset_${id}`, this.scene);
        gunOffset.parent = this.modelsRoot;

        const model = inst.rootNodes[0] as Mesh;
        // Mede o bounding box antes de parentar (espaço original do GLB).
        const transform = weaponModelTransform(id, model);

        // Posição, rotação e escala calibradas por arma
        gunOffset.position = cfg.offset.clone();
        gunOffset.rotationQuaternion = Quaternion.FromEulerVector(transform.rotation);
        gunOffset.scaling.setAll(transform.scale);

        model.parent = gunOffset;

        const originals = new Map<string, Color3>();
        for (const m of model.getChildMeshes()) {
          m.isPickable = false;
          m.renderingGroupId = 2;
          if (m.material) {
            m.material = m.material.clone(`vmMat_${id}_${m.name}`);
          } else {
            const mat = new StandardMaterial(`vmMat_${id}_${m.name}`, this.scene);
            mat.diffuseColor = new Color3(0.55, 0.55, 0.58);
            mat.specularColor = new Color3(0.05, 0.05, 0.05);
            m.material = mat;
          }
          originals.set(m.name, this.readMeshColor(m).clone());
          if (m.material && this.isInvincible) {
            m.material.alpha = 0.6;
          }
        }
        this.originalColors.set(id, originals);
        this.weaponModels.set(id, model);
        this.applyStoredSkin(id);

        this.weaponNodes.set(id, gunOffset);
        this.loadingWeapons.delete(id);

        if (this.currentWeaponId === id) {
          this.updateVisibleWeapon();
        } else {
          gunOffset.setEnabled(false);
        }
      })
      .catch((err) => {
        console.warn(`[ViewModel] Falha ao carregar modelo para ${id}:`, err);
        this.loadingWeapons.delete(id);
      });
  }

  private updateVisibleWeapon(): void {
    const activeNode = this.weaponNodes.get(this.currentWeaponId);
    if (activeNode) {
      this.fallbackRoot.setEnabled(false);
      for (const [id, node] of this.weaponNodes) {
        node.setEnabled(id === this.currentWeaponId);
      }
    } else {
      for (const node of this.weaponNodes.values()) {
        node.setEnabled(false);
      }
      this.fallbackRoot.setEnabled(true);
      if (this.melee) {
        this.fallbackRoot.scaling.set(0.45, 1.35, 0.55);
        this.barrel.setEnabled(false);
      } else {
        this.fallbackRoot.scaling.set(1, 1, 1);
        this.barrel.setEnabled(true);
        this.barrel.scaling.y =
          this.currentWeaponId === "pistol"
            ? 0.6
            : this.currentWeaponId === "magnum"
              ? 0.85
              : this.currentWeaponId === "sniper"
                ? 1.85
                : 1.2;
      }
    }
  }

  setWeapon(weapon: WeaponDef): void {
    this.currentWeaponId = weapon.id;
    const [r, g, b] = weapon.viewColor;
    this.bodyMat.diffuseColor = new Color3(r, g, b);
    this.melee = weapon.id === "knife";

    const assetUrl = WEAPON_ASSETS[weapon.id];
    if (assetUrl && !this.weaponNodes.has(weapon.id) && !this.loadingWeapons.has(weapon.id)) {
      this.loadWeaponModel(weapon.id, assetUrl);
    }

    this.updateVisibleWeapon();
    this.startDraw(weapon.drawTime);
    this.applyStoredSkin(weapon.id);
  }

  /**
   * Aplica (ou limpa) a skin de uma arma. Se o modelo ainda estiver a
   * carregar, a skin fica pendente e entra quando o GLB terminar.
   */
  setWeaponSkin(
    weaponId: string,
    parts: Record<string, [number, number, number]> | null
  ): void {
    this.equippedParts.set(weaponId, parts);
    this.applyStoredSkin(weaponId);
  }

  private applyStoredSkin(weaponId: string): void {
    const model = this.weaponModels.get(weaponId);
    if (!model) return;
    this.restoreOriginalColors(weaponId);
    const cfg = WEAPON_CONFIGS[weaponId] ?? DEFAULT_CONFIG;
    if (cfg.tint) applyWeaponTint(this.scene, model, cfg.tint);
    const parts = this.equippedParts.get(weaponId);
    if (parts) applyWeaponSkinParts(this.scene, model, parts);
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

  startDraw(duration: number): void {
    this.drawDuration = Math.max(0.05, duration);
    this.drawProgress = 0;
    this.kick = 0;
  }

  setVisible(on: boolean): void {
    if (this.root.isEnabled() === on) return;
    this.root.setEnabled(on);
  }

  setInvincible(on: boolean): void {
    this.isInvincible = on;
    const alpha = on ? 0.6 : 1;
    this.bodyMat.alpha = alpha;
    this.bodyMat.transparencyMode = on
      ? StandardMaterial.MATERIAL_ALPHABLEND
      : StandardMaterial.MATERIAL_OPAQUE;

    this.modelsRoot.getChildMeshes().forEach((m) => {
      if (m.material) {
        m.material.alpha = alpha;
      }
    });
  }

  triggerKick(strength = 1): void {
    this.kick = Math.min(1, this.kick + 0.55 * strength);

    if (this.melee) return;

    // Posiciona o muzzle flash exatamente na ponta do cano da arma atual
    const cfg = WEAPON_CONFIGS[this.currentWeaponId] ?? DEFAULT_CONFIG;
    this.flash.position.copyFrom(cfg.muzzle);

    this.flash.setEnabled(true);
    this.flash.scaling.setAll(0.7 + Math.random() * 0.4);
    window.clearTimeout(this.flashTimeout);
    this.flashTimeout = window.setTimeout(() => this.flash.setEnabled(false), 45);
  }

  setReloading(on: boolean): void {
    this.reloading = on;
  }

  /** Corrida levanta a arma; ao parar ela desce em SPRINT_LOWER_DURATION s. */
  setSprinting(on: boolean): void {
    this.sprinting = on;
  }

  update(dt: number): void {
    this.kick = Math.max(0, this.kick - dt * 6);
    const targetDip = this.reloading ? 1 : 0;
    this.reloadDip += (targetDip - this.reloadDip) * Math.min(1, dt * 8);

    if (this.sprinting) {
      this.sprintBlend = Math.min(1, this.sprintBlend + dt / SPRINT_RAISE_DURATION);
    } else {
      this.sprintBlend = Math.max(0, this.sprintBlend - dt / SPRINT_LOWER_DURATION);
    }
    const run = this.sprintBlend * this.sprintBlend * (3 - 2 * this.sprintBlend);

    if (this.drawProgress < 1) {
      this.drawProgress = Math.min(1, this.drawProgress + dt / this.drawDuration);
    }
    const holster = 1 - easeOutCubic(this.drawProgress);

    const cfg = WEAPON_CONFIGS[this.currentWeaponId] ?? DEFAULT_CONFIG;

    this.root.position.set(
      this.basePos.x + holster * 0.08 + cfg.sprintPosOffset.x * run,
      this.basePos.y - this.reloadDip * 0.18 - holster * 0.52 + cfg.sprintPosOffset.y * run,
      this.basePos.z - this.kick * 0.07 - holster * 0.22 + cfg.sprintPosOffset.z * run
    );

    // Rotação calibrada para a arma não sair do frustum da câmera ao correr
    this.root.rotation.set(
      -this.kick * 0.12 + this.reloadDip * 0.5 + holster * 1.15 + cfg.sprintPitch * run,
      (this.melee ? this.kick * 0.9 : 0) + holster * 0.25 + run * 0.2,
      (this.melee ? -this.kick * 0.55 : 0) - holster * 0.4 + run * 0.08
    );
  }

  /** Retorna a posição 3D no mundo da ponta do cano (muzzle) da arma atual */
  getMuzzleWorldPosition(): Vector3 {
    const cfg = WEAPON_CONFIGS[this.currentWeaponId] ?? DEFAULT_CONFIG;
    // Posição local do muzzle relativa ao vmRoot
    return Vector3.TransformCoordinates(cfg.muzzle, this.root.getWorldMatrix());
  }
}
