import { Scene } from "@babylonjs/core/scene";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { Vector3, Color3, Quaternion } from "@babylonjs/core/Maths/math";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";

import { resolveWeaponId, WeaponDef } from "../../shared/weapons";
import { defaultWeaponSkinParts } from "../../shared/weaponSkins";
import { getGameTexture, textureUrlById } from "../../shared/textures";
import { MuzzleFlash } from "../game/effects";

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
  m4a1: {
    offset: new Vector3(-0.15, 0.08, -0.32),
    muzzle: new Vector3(-0.15, 0.08, 0.43),
    sprintPitch: -0.6,
    sprintPosOffset: new Vector3(-0.08, 0.06, -0.02),
    rotation: new Vector3(0, 0, 0),
    targetLength: 0.82,
  },
  ak47: {
    offset: new Vector3(-0.15, 0.08, -0.32),
    muzzle: new Vector3(-0.15, 0.08, 0.43),
    // Modelo novo (ak47_v1): eixo longo em Z e centrado no pivô, como a MP5.
    sprintPitch: -0.6,
    sprintPosOffset: new Vector3(-0.08, 0.06, -0.02),
    rotation: new Vector3(0, Math.PI, 0),
    targetLength: 0.82,
  },
  scarh: {
    offset: new Vector3(-0.15, 0.08, -0.32),
    muzzle: new Vector3(-0.15, 0.08, 0.43),
    sprintPitch: -0.6,
    sprintPosOffset: new Vector3(-0.08, 0.06, -0.02),
    rotation: new Vector3(0, 0, 0),
    targetLength: 0.82,
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
  vector: {
    offset: new Vector3(-0.1, 0.05, -0.32),
    muzzle: new Vector3(-0.1, 0.05, 0.33),
    sprintPitch: -0.6,
    sprintPosOffset: new Vector3(-0.08, 0.06, -0.02),
    rotation: new Vector3(0, Math.PI, 0),
    targetLength: 0.58,
  },
  awp: {
    offset: new Vector3(-0.15, 0.10, -0.32),
    muzzle: new Vector3(-0.15, 0.10, 0.58),
    sprintPitch: -0.6,
    sprintPosOffset: new Vector3(-0.08, 0.06, -0.02),
    rotation: new Vector3(0, 0, 0),
    targetLength: 1.02,
  },
  shotgun: {
    offset: new Vector3(-0.1, 0.05, -0.32),
    muzzle: new Vector3(-0.1, 0.05, 0.36),
    sprintPitch: -0.6,
    sprintPosOffset: new Vector3(-0.08, 0.06, -0.02),
    rotation: new Vector3(0, 0, 0),
    targetLength: 0.68,
  },
  usp: {
    offset: new Vector3(-0.07, 0.02, -0.18),
    muzzle: new Vector3(-0.07, 0.04, 0.16),
    sprintPitch: -0.45,
    sprintPosOffset: new Vector3(-0.04, 0.04, -0.02),
    rotation: new Vector3(0, Math.PI, 0),
    targetLength: 0.32,
  },
  magnum: {
    offset: new Vector3(-0.07, -0.03, -0.18),
    muzzle: new Vector3(-0.07, -0.01, 0.22),
    sprintPitch: -0.45,
    sprintPosOffset: new Vector3(-0.04, 0.04, -0.02),
    rotation: new Vector3(0, 0, 0),
    targetLength: 0.38,
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
  minigun: {
    offset: new Vector3(0, 0, 0),
    muzzle: new Vector3(0, 0.02, 0.98),
    sprintPitch: 0,
    sprintPosOffset: new Vector3(0, 0, 0),
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

function resolvePartKey<T>(meshName: string, map: Record<string, T>): T | undefined {
  const direct = map[meshName];
  if (direct !== undefined) return direct;
  const stripped = meshName.replace(/^Clone of /i, "");
  if (stripped !== meshName && map[stripped] !== undefined) return map[stripped];
  const prefixed = map[`Clone of ${stripped}`];
  if (prefixed !== undefined) return prefixed;
  return map["*"];
}

function resolvePartColor(
  meshName: string,
  parts: Record<string, [number, number, number]>
): [number, number, number] | undefined {
  return resolvePartKey(meshName, parts);
}

const sceneTexCache = new WeakMap<Scene, Map<string, Texture>>();

function cachedTexture(scene: Scene, url: string, scale: number): Texture {
  let map = sceneTexCache.get(scene);
  if (!map) {
    map = new Map();
    sceneTexCache.set(scene, map);
  }
  const key = `${url}@${scale}`;
  let tex = map.get(key);
  if (!tex) {
    tex = new Texture(url, scene);
    tex.wrapU = Texture.WRAP_ADDRESSMODE;
    tex.wrapV = Texture.WRAP_ADDRESSMODE;
    tex.uScale = scale;
    tex.vScale = scale;
    map.set(key, tex);
  }
  return tex;
}

type TintMat = {
  albedoColor?: Color3;
  diffuseColor?: Color3;
  albedoTexture?: Texture | null;
  diffuseTexture?: Texture | null;
  metallic?: number;
  roughness?: number;
  specularColor?: Color3;
};

function uvsAreUsable(uvs: ArrayLike<number> | null | undefined): boolean {
  if (!uvs || uvs.length < 2) return false;
  let minU = Infinity,
    maxU = -Infinity,
    minV = Infinity,
    maxV = -Infinity;
  for (let i = 0; i < uvs.length; i += 2) {
    minU = Math.min(minU, uvs[i]);
    maxU = Math.max(maxU, uvs[i]);
    minV = Math.min(minV, uvs[i + 1]);
    maxV = Math.max(maxV, uvs[i + 1]);
  }
  return maxU - minU > 0.05 || maxV - minV > 0.05;
}

/**
 * A maior parte dos GLBs de arma (_v1) só tem POSITION/NORMAL — sem UV.
 * Sem UV a textura amostra um único pixel e parece uma cor sólida.
 * Gera UV por projeção em caixa no espaço local da mesh.
 */
export function ensureWeaponMeshUVs(mesh: AbstractMesh): void {
  if (mesh.metadata?.weaponBoxUv) return;
  if (uvsAreUsable(mesh.getVerticesData(VertexBuffer.UVKind))) return;

  const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
  if (!positions || positions.length < 3) return;

  try {
    const asMesh = mesh as Mesh;
    if (typeof asMesh.makeGeometryUnique === "function") asMesh.makeGeometryUnique();
  } catch {
    /* geometria já única */
  }

  const normals = mesh.getVerticesData(VertexBuffer.NormalKind);
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    minX = Math.min(minX, positions[i]);
    maxX = Math.max(maxX, positions[i]);
    minY = Math.min(minY, positions[i + 1]);
    maxY = Math.max(maxY, positions[i + 1]);
    minZ = Math.min(minZ, positions[i + 2]);
    maxZ = Math.max(maxZ, positions[i + 2]);
  }
  const dx = Math.max(1e-4, maxX - minX);
  const dy = Math.max(1e-4, maxY - minY);
  const dz = Math.max(1e-4, maxZ - minZ);
  const s = 1 / Math.max(dx, dy, dz);
  const cx = (minX + maxX) * 0.5;
  const cy = (minY + maxY) * 0.5;
  const cz = (minZ + maxZ) * 0.5;

  const uvs = new Float32Array((positions.length / 3) * 2);
  for (let i = 0, v = 0; i < positions.length; i += 3, v += 2) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];
    let ax: number;
    let ay: number;
    let az: number;
    if (normals) {
      ax = Math.abs(normals[i]);
      ay = Math.abs(normals[i + 1]);
      az = Math.abs(normals[i + 2]);
    } else {
      ax = Math.abs(x - cx);
      ay = Math.abs(y - cy);
      az = Math.abs(z - cz);
    }
    if (az >= ax && az >= ay) {
      uvs[v] = (x - minX) * s;
      uvs[v + 1] = (y - minY) * s;
    } else if (ax >= ay) {
      uvs[v] = (z - minZ) * s;
      uvs[v + 1] = (y - minY) * s;
    } else {
      uvs[v] = (x - minX) * s;
      uvs[v + 1] = (z - minZ) * s;
    }
  }
  mesh.setVerticesData(VertexBuffer.UVKind, uvs, true);
  mesh.metadata = { ...mesh.metadata, weaponBoxUv: true };
}

function bindMeshTexture(mat: TintMat, tex: Texture | null): void {
  if ("albedoTexture" in mat) mat.albedoTexture = tex;
  if ("diffuseTexture" in mat) mat.diffuseTexture = tex;
}

export function clearMeshGameTexture(m: AbstractMesh): void {
  const mat = m.material as unknown as TintMat | null;
  if (!mat) return;
  bindMeshTexture(mat, null);
}

/** Aplica (ou limpa) uma textura do catálogo numa parte da arma. */
export function applyWeaponMeshTexture(
  scene: Scene,
  m: AbstractMesh,
  textureId: string | null | undefined
): void {
  const mat = m.material as unknown as TintMat | null;
  if (!mat) return;
  const url = textureId ? textureUrlById(textureId) : null;
  if (!url) {
    clearMeshGameTexture(m);
    return;
  }
  ensureWeaponMeshUVs(m);
  const scale = getGameTexture(textureId!)?.uvScale ?? 2;
  const tex = cachedTexture(scene, url, scale);
  bindMeshTexture(mat, tex);
  if (mat.metallic !== undefined) {
    mat.metallic = Math.min(mat.metallic, 0.35);
    if (mat.roughness !== undefined) mat.roughness = Math.max(mat.roughness, 0.4);
  }
  if (mat.specularColor) mat.specularColor = new Color3(0.08, 0.08, 0.08);
}

function applyMeshGameTexture(
  scene: Scene,
  m: AbstractMesh,
  textureId: string | undefined
): void {
  applyWeaponMeshTexture(scene, m, textureId);
}

/** Aplica cores por nome de mesh. Chave `"*"` pinta todas as partes. */
export function applyWeaponSkinParts(
  scene: Scene,
  model: Mesh,
  parts: Record<string, [number, number, number]>,
  textures?: Record<string, string> | null
): void {
  const tintMesh = (m: AbstractMesh, rgb: [number, number, number]) => {
    const color = new Color3(rgb[0], rgb[1], rgb[2]);
    const mat = m.material as unknown as TintMat | null;
    if (mat && mat.albedoColor !== undefined) {
      mat.albedoColor = color;
    } else if (mat && mat.diffuseColor !== undefined) {
      mat.diffuseColor = color;
    } else {
      const fallback = new StandardMaterial(`vmTint_${model.name}_${m.name}`, scene);
      fallback.diffuseColor = color;
      fallback.specularColor = new Color3(0.05, 0.05, 0.05);
      m.material = fallback;
    }
  };

  for (const m of model.getChildMeshes()) {
    const rgb = resolvePartColor(m.name, parts);
    if (rgb) tintMesh(m, rgb);
    if (textures) {
      const texId = resolvePartKey(m.name, textures);
      if (texId) applyMeshGameTexture(scene, m, texId);
    }
  }
}

/**
 * Aparência da arma: sempre a skin padrão (cores reais), depois a skin
 * custom por cima se houver. Sem isto os GLBs ficam cinza sem material.
 */
export function applyWeaponAppearance(
  scene: Scene,
  model: Mesh,
  weaponId: string,
  overlay: Record<string, [number, number, number]> | null | undefined,
  overlayTextures?: Record<string, string> | null
): void {
  const id = resolveWeaponId(weaponId);
  if (id) applyWeaponSkinParts(scene, model, defaultWeaponSkinParts(id));
  if (overlay) applyWeaponSkinParts(scene, model, overlay, overlayTextures);
}

export const WEAPON_ASSETS: Record<string, string> = {
  m4a1: "/assets/weapons/m4a1_v1.glb",
  ak47: "/assets/weapons/ak47_v1.glb",
  scarh: "/assets/weapons/scar-h_v1.glb",
  mp5: "/assets/weapons/MP5.glb",
  vector: "/assets/weapons/vector_v1.glb",
  usp: "/assets/weapons/usp_v1.glb",
  magnum: "/assets/weapons/magnum357_v1.glb",
  shotgun: "/assets/weapons/pump-shotgun_v1.glb",
  awp: "/assets/weapons/awp_v1.glb",
  knife: "/assets/weapons/knife.glb",
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
  private readonly equippedTextures = new Map<string, Record<string, string> | null>();
  private readonly loadingWeapons = new Set<string>();

  private readonly bodyMat: StandardMaterial;
  private readonly bodyMesh: Mesh;
  private readonly barrel: Mesh;
  private readonly minigunRoot: TransformNode;
  private readonly minigunHub: TransformNode;
  private readonly muzzleFlash: MuzzleFlash;
  private melee = false;
  private currentWeaponId = "m4a1";
  private isInvincible = false;
  private minigunSpin = 0;

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

    this.muzzleFlash = new MuzzleFlash(scene, this.root, {
      withLight: true,
      renderingGroupId: 2,
      size: 0.13,
    });
    this.muzzleFlash.setLocalPosition(new Vector3(0, 0.05, 0.6));

    const minigun = this.buildMinigunView();
    this.minigunRoot = minigun.root;
    this.minigunHub = minigun.hub;

    for (const m of [this.bodyMesh, this.barrel]) {
      m.isPickable = false;
      m.renderingGroupId = 2;
    }

    // Preload de todas as armas
    for (const [id, url] of Object.entries(WEAPON_ASSETS)) {
      this.loadWeaponModel(id, url);
    }
  }

  /** Minigun em primeira pessoa, centrada na mira (assento do artilheiro). */
  private buildMinigunView(): { root: TransformNode; hub: TransformNode } {
    const root = new TransformNode("vmMinigun", this.scene);
    root.parent = this.root;
    root.setEnabled(false);

    const gunMat = new StandardMaterial("vmMinigunMat", this.scene);
    gunMat.diffuseColor = new Color3(0.14, 0.15, 0.13);
    gunMat.specularColor = new Color3(0.22, 0.22, 0.2);
    gunMat.emissiveColor = new Color3(0.04, 0.04, 0.035);

    const metalMat = new StandardMaterial("vmMinigunMetal", this.scene);
    metalMat.diffuseColor = new Color3(0.22, 0.2, 0.16);
    metalMat.specularColor = new Color3(0.28, 0.24, 0.14);
    metalMat.emissiveColor = new Color3(0.05, 0.045, 0.03);

    const attach = (mesh: Mesh, mat: StandardMaterial, parent: TransformNode) => {
      mesh.material = mat;
      mesh.parent = parent;
      mesh.isPickable = false;
      mesh.renderingGroupId = 2;
    };

    const housing = MeshBuilder.CreateBox(
      "vmMinigunBody",
      { width: 0.22, height: 0.18, depth: 0.32 },
      this.scene
    );
    housing.position.set(0, -0.02, 0.04);
    attach(housing, gunMat, root);

    const cradle = MeshBuilder.CreateBox(
      "vmMinigunCradle",
      { width: 0.28, height: 0.08, depth: 0.18 },
      this.scene
    );
    cradle.position.set(0, -0.12, 0.02);
    attach(cradle, metalMat, root);

    const hub = new TransformNode("vmMinigunHub", this.scene);
    hub.parent = root;
    hub.position.set(0, 0.01, 0.22);

    const ring = MeshBuilder.CreateCylinder(
      "vmMinigunRing",
      { height: 0.08, diameter: 0.12, tessellation: 10 },
      this.scene
    );
    ring.rotation.x = Math.PI / 2;
    attach(ring, metalMat, hub);

    const radius = 0.042;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const tube = MeshBuilder.CreateCylinder(
        `vmMinigunBarrel${i}`,
        { height: 0.78, diameter: 0.03, tessellation: 7 },
        this.scene
      );
      tube.rotation.x = Math.PI / 2;
      tube.position.set(Math.cos(a) * radius, Math.sin(a) * radius, 0.4);
      attach(tube, gunMat, hub);
    }

    const shroud = MeshBuilder.CreateCylinder(
      "vmMinigunShroud",
      { height: 0.2, diameter: 0.14, tessellation: 10 },
      this.scene
    );
    shroud.rotation.x = Math.PI / 2;
    shroud.position.z = 0.18;
    attach(shroud, metalMat, hub);

    return { root, hub };
  }

  private isCenteredMinigun(): boolean {
    return this.currentWeaponId === "minigun";
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
    const showMinigun = this.isCenteredMinigun();
    this.minigunRoot.setEnabled(showMinigun);
    if (showMinigun) {
      this.fallbackRoot.setEnabled(false);
      for (const node of this.weaponNodes.values()) node.setEnabled(false);
      return;
    }

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
          this.currentWeaponId === "usp"
            ? 0.6
            : this.currentWeaponId === "magnum"
              ? 0.85
              : this.currentWeaponId === "awp"
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
    if (this.isCenteredMinigun()) {
      this.drawProgress = 1;
    } else {
      this.startDraw(weapon.drawTime);
    }
    this.applyStoredSkin(weapon.id);
  }

  /**
   * Aplica (ou limpa) a skin de uma arma. Se o modelo ainda estiver a
   * carregar, a skin fica pendente e entra quando o GLB terminar.
   */
  setWeaponSkin(
    weaponId: string,
    parts: Record<string, [number, number, number]> | null,
    textures?: Record<string, string> | null
  ): void {
    this.equippedParts.set(weaponId, parts);
    this.equippedTextures.set(weaponId, textures ?? null);
    this.applyStoredSkin(weaponId);
  }

  private applyStoredSkin(weaponId: string): void {
    const model = this.weaponModels.get(weaponId);
    if (!model) return;
    this.restoreOriginalColors(weaponId);
    applyWeaponAppearance(
      this.scene,
      model,
      weaponId,
      this.equippedParts.get(weaponId),
      this.equippedTextures.get(weaponId)
    );
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
      clearMeshGameTexture(m);
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

    const cfg = WEAPON_CONFIGS[this.currentWeaponId] ?? DEFAULT_CONFIG;
    this.muzzleFlash.setLocalPosition(cfg.muzzle);
    const id = this.currentWeaponId;
    const heavy = id === "shotgun" || id === "magnum" || id === "awp";
    this.muzzleFlash.trigger(id === "minigun" ? 2.4 : heavy ? 1.45 : 1);
  }

  setReloading(on: boolean): void {
    this.reloading = on;
  }

  /** Corrida levanta a arma; ao parar ela desce em SPRINT_LOWER_DURATION s. */
  setSprinting(on: boolean): void {
    this.sprinting = on;
  }

  update(dt: number): void {
    this.muzzleFlash.update(dt);
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

    if (this.isCenteredMinigun()) {
      this.root.position.set(0, -0.12 - this.kick * 0.03, 0.48 - this.kick * 0.06);
      this.root.rotation.set(-this.kick * 0.045, 0, 0);
      this.minigunSpin += dt * (this.kick > 0.05 ? 48 : 10);
      this.minigunHub.rotation.z = this.minigunSpin;
      return;
    }

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
