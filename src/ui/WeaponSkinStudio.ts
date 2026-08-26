import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { Vector3, Color3, Color4, Quaternion } from "@babylonjs/core/Maths/math";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { PointerEventTypes } from "@babylonjs/core/Events/pointerEvents";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import "@babylonjs/loaders/glTF";

import {
  WEAPON_ASSETS,
  weaponModelTransform,
  applyWeaponAppearance,
  applyWeaponMeshTexture,
  disposeWeaponModelKeepTextures,
} from "../player/ViewModel";
import type { WeaponId } from "../../shared/weapons";

export type RgbColor = [number, number, number];

/** "#rrggbb" → [r, g, b] 0–1 (formato salvo na skin). */
export function hexToRgb(hex: string): RgbColor {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [1, 1, 1];
  const v = parseInt(m[1], 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

/** [r, g, b] 0–1 → "#rrggbb" (para o input color). */
export function rgbToHex([r, g, b]: RgbColor): string {
  const c = (v: number) =>
    Math.round(Math.max(0, Math.min(1, v)) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Nome estável da parte: tira o prefixo do instantiateModelsToScene. */
function canonicalPartName(name: string): string {
  return name.replace(/^Clone of /i, "").trim();
}

/**
 * Estúdio de criação de skins de arma: mostra o modelo GLB sozinho com a
 * mesma rotação/escala do jogo; clique numa parte (mesh) seleciona, e a cor
 * escolhida é aplicada só nela. Cada mesh recebe material exclusivo no
 * carregamento para permitir tingimento individual.
 */
export class WeaponSkinStudio {
  private readonly engine: Engine;
  private readonly scene: Scene;
  private readonly camera: ArcRotateCamera;

  private modelRoot: TransformNode | null = null;
  private weaponModel: Mesh | null = null;
  private loadedContainer: { dispose: () => void } | null = null;
  /** Meshes pintáveis (vários podem partilhar o mesmo nome). */
  private readonly allPartMeshes: AbstractMesh[] = [];
  /** Cor original de cada mesh (para "limpar parte"). */
  private readonly originalColors = new Map<string, RgbColor>();
  /** Partes pintadas nesta sessão: meshName → cor. */
  private readonly parts = new Map<string, RgbColor>();
  /** Textura por parte (id do catálogo). */
  private readonly partTextures = new Map<string, string>();
  private selectedPart: string | null = null;
  private isRunning = false;
  private loadToken = 0;

  /** Notifica a UI quando a seleção muda (null = nada selecionado). */
  onPartSelected: ((part: string | null) => void) | null = null;
  /** Modelo carregado — a UI pode atualizar o dropdown de partes. */
  onModelReady: (() => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas, true, { antialias: true });
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.055, 0.06, 0.045, 1);

    this.camera = new ArcRotateCamera(
      "studioCamera",
      Math.PI / 2,
      Math.PI / 2.3,
      1.4,
      Vector3.Zero(),
      this.scene
    );
    this.camera.minZ = 0.01;
    this.camera.lowerRadiusLimit = 0.4;
    this.camera.upperRadiusLimit = 4;
    this.camera.wheelPrecision = 30;
    this.camera.attachControl(canvas, true);

    const hemi = new HemisphericLight("studioHemi", new Vector3(0, 1, 0), this.scene);
    hemi.intensity = 1.15;
    hemi.groundColor = new Color3(0.35, 0.35, 0.4);
    const dir = new DirectionalLight("studioDir", new Vector3(-1, -2, 2), this.scene);
    dir.intensity = 0.9;

    this.scene.onPointerObservable.add((pi) => {
      if (pi.type !== PointerEventTypes.POINTERPICK) return;
      const mesh = pi.pickInfo?.pickedMesh;
      const name = mesh && this.meshesNamed(mesh.name).length > 0 ? mesh.name : null;
      this.selectPart(name);
    });
  }

  get selectedPartName(): string | null {
    return this.selectedPart;
  }

  /** Troca a arma exibida. Reseta seleção e partes pintadas. */
  async setWeapon(
    id: WeaponId,
    looks?: {
      parts: Record<string, RgbColor>;
      textures?: Record<string, string>;
    } | null
  ): Promise<void> {
    const url = WEAPON_ASSETS[id];
    if (!url) return;

    const token = ++this.loadToken;
    this.clearModel();
    this.parts.clear();
    this.partTextures.clear();
    this.selectPart(null);

    try {
      const container = await SceneLoader.LoadAssetContainerAsync("", url, this.scene);
      if (token !== this.loadToken) {
        container.dispose();
        return;
      }
      const inst = container.instantiateModelsToScene();
      this.loadedContainer = container;

      const gunOffset = new TransformNode("studioGunOffset", this.scene);
      const model = inst.rootNodes[0] as Mesh;
      const t = weaponModelTransform(id, model);
      gunOffset.rotationQuaternion = Quaternion.FromEulerVector(t.rotation);
      gunOffset.scaling.setAll(t.scale);
      model.parent = gunOffset;

      this.weaponModel = model;
      this.modelRoot = gunOffset;

      for (const m of this.collectPartMeshes(model)) {
        m.isPickable = true;
        this.preparePartMesh(m);
      }
      applyWeaponAppearance(this.scene, model, id, null);
      for (const m of this.allPartMeshes) {
        this.originalColors.set(canonicalPartName(m.name), this.readMeshColor(m));
      }
      if (looks) this.applyLooks(looks.parts, looks.textures);
      if (token === this.loadToken) this.onModelReady?.();
    } catch (err) {
      console.warn(`[SkinStudio] Falha ao carregar ${id}:`, err);
    }
  }

  /** Nomes estáveis das partes (sem "Clone of ") para o dropdown. */
  getPartNames(): string[] {
    const names = new Set(this.allPartMeshes.map((m) => canonicalPartName(m.name)));
    return [...names].sort((a, b) => a.localeCompare(b, "pt", { sensitivity: "base" }));
  }

  /** Aplica uma skin já publicada — mesmos nomes que o jogo (`Cube` ↔ `Clone of Cube`). */
  applyLooks(
    parts: Record<string, RgbColor>,
    textures?: Record<string, string>
  ): void {
    const names = this.getPartNames();
    if (parts["*"]) {
      for (const name of names) this.setPartColor(name, parts["*"]);
    }
    for (const [key, color] of Object.entries(parts)) {
      if (key === "*") continue;
      this.setPartColor(key, color);
    }
    if (!textures) return;
    if (textures["*"]) {
      for (const name of names) this.setPartTexture(name, textures["*"]);
    }
    for (const [key, tex] of Object.entries(textures)) {
      if (key === "*") continue;
      this.setPartTexture(key, tex);
    }
  }

  private collectPartMeshes(model: AbstractMesh): AbstractMesh[] {
    const out: AbstractMesh[] = [];
    if (model.getTotalVertices() > 0) out.push(model);
    for (const m of model.getChildMeshes()) {
      if (m.getTotalVertices() > 0) out.push(m);
    }
    return out;
  }

  private meshesNamed(name: string): AbstractMesh[] {
    const want = canonicalPartName(name).toLowerCase();
    return this.allPartMeshes.filter(
      (m) => canonicalPartName(m.name).toLowerCase() === want
    );
  }

  private tintMesh(m: AbstractMesh, color: RgbColor): void {
    const c = new Color3(color[0], color[1], color[2]);
    const mat = m.material as unknown as {
      albedoColor?: Color3;
      diffuseColor?: Color3;
      metallic?: number;
      roughness?: number;
      specularColor?: Color3;
    } | null;
    if (mat && mat.albedoColor !== undefined) mat.albedoColor = c;
    else if (mat && mat.diffuseColor !== undefined) mat.diffuseColor = c;
    else {
      const fallback = new StandardMaterial(`studioTint_${m.name}`, this.scene);
      fallback.diffuseColor = c;
      fallback.specularColor = new Color3(0.08, 0.08, 0.08);
      m.material = fallback;
    }
    if (mat?.metallic !== undefined) {
      mat.metallic = Math.min(mat.metallic, 0.35);
      if (mat.roughness !== undefined) mat.roughness = Math.max(mat.roughness, 0.4);
    }
  }

  /** Dá um material exclusivo ao mesh e guarda a cor original dele. */
  private preparePartMesh(m: AbstractMesh): void {
    const original = m.material;
    let color: RgbColor = [0.55, 0.55, 0.58];

    if (original) {
      const cloned = original.clone(`studioMat_${m.name}_${this.allPartMeshes.length}`);
      m.material = cloned;
      const anyMat = cloned as unknown as {
        albedoColor?: Color3;
        diffuseColor?: Color3;
      };
      const c = anyMat.albedoColor ?? anyMat.diffuseColor;
      if (c) color = [c.r, c.g, c.b];
    } else {
      const mat = new StandardMaterial(`studioMat_${m.name}_${this.allPartMeshes.length}`, this.scene);
      mat.diffuseColor = new Color3(color[0], color[1], color[2]);
      mat.specularColor = new Color3(0.08, 0.08, 0.08);
      m.material = mat;
    }

    this.allPartMeshes.push(m);
    this.originalColors.set(canonicalPartName(m.name), color);
  }

  private readMeshColor(m: AbstractMesh): RgbColor {
    const mat = m.material as unknown as {
      albedoColor?: Color3;
      diffuseColor?: Color3;
    } | null;
    const c = mat?.albedoColor ?? mat?.diffuseColor;
    return c ? [c.r, c.g, c.b] : [0.55, 0.55, 0.58];
  }

  selectPart(name: string | null): void {
    const meshes = name ? this.meshesNamed(name) : [];
    const next = meshes.length > 0 ? canonicalPartName(meshes[0].name) : null;
    if (this.selectedPart === next) return;

    if (this.selectedPart) {
      for (const prev of this.meshesNamed(this.selectedPart)) {
        prev.renderOutline = false;
      }
    }
    this.selectedPart = next;
    if (next) {
      for (const mesh of this.meshesNamed(next)) {
        mesh.renderOutline = true;
        mesh.outlineColor = new Color3(0.79, 0.7, 0.42);
        mesh.outlineWidth = 0.06;
      }
    }
    this.onPartSelected?.(next);
  }

  /** Pinta uma parte e registra na skin em edição. */
  setPartColor(name: string, color: RgbColor): void {
    const meshes = this.meshesNamed(name);
    if (meshes.length === 0) return;
    for (const mesh of meshes) this.tintMesh(mesh, color);
    this.parts.set(canonicalPartName(meshes[0].name), color);
  }

  setPartTexture(name: string, textureId: string | null): void {
    const meshes = this.meshesNamed(name);
    if (meshes.length === 0) return;
    const key = canonicalPartName(meshes[0].name);
    if (!textureId || textureId === "none") {
      this.partTextures.delete(key);
      for (const mesh of meshes) applyWeaponMeshTexture(this.scene, mesh, null);
      return;
    }
    if (!this.parts.has(key)) this.setPartColor(name, [1, 1, 1]);
    this.partTextures.set(key, textureId);
    for (const mesh of meshes) applyWeaponMeshTexture(this.scene, mesh, textureId);
  }

  getPartTexture(name: string): string | null {
    return this.partTextures.get(canonicalPartName(name)) ?? null;
  }

  /** Volta a parte à cor original do modelo. */
  clearPart(name: string): void {
    const meshes = this.meshesNamed(name);
    if (meshes.length === 0) return;
    const key = canonicalPartName(meshes[0].name);
    const original = this.originalColors.get(key);
    if (!original) return;
    for (const mesh of meshes) {
      this.tintMesh(mesh, original);
      applyWeaponMeshTexture(this.scene, mesh, null);
    }
    this.parts.delete(key);
    this.partTextures.delete(key);
  }

  clearAllParts(): void {
    for (const name of [...this.parts.keys()]) this.clearPart(name);
    for (const name of [...this.partTextures.keys()]) this.clearPart(name);
  }

  /** Partes pintadas no formato da skin (nome canónico → RGB). */
  getParts(): Record<string, RgbColor> {
    const parts: Record<string, RgbColor> = {};
    for (const [name, color] of this.parts) {
      parts[canonicalPartName(name)] = color;
    }
    for (const mesh of this.partTextures.keys()) {
      const key = canonicalPartName(mesh);
      if (!parts[key]) parts[key] = [1, 1, 1];
    }
    return parts;
  }

  getTextures(): Record<string, string> {
    const textures: Record<string, string> = {};
    for (const [name, id] of this.partTextures) {
      textures[canonicalPartName(name)] = id;
    }
    return textures;
  }

  /** Cor atual de uma parte (pintada ou original) — para o color picker. */
  getPartColor(name: string): RgbColor {
    const key = canonicalPartName(name);
    return this.parts.get(key) ?? this.originalColors.get(key) ?? [0.55, 0.55, 0.58];
  }

  get paintedCount(): number {
    const keys = new Set([
      ...[...this.parts.keys()].map(canonicalPartName),
      ...[...this.partTextures.keys()].map(canonicalPartName),
    ]);
    return keys.size;
  }

  private clearModel(): void {
    if (this.weaponModel) {
      disposeWeaponModelKeepTextures(this.weaponModel);
      this.weaponModel = null;
    }
    if (this.modelRoot && !this.modelRoot.isDisposed()) {
      this.modelRoot.dispose(false, false);
    }
    this.modelRoot = null;
    this.allPartMeshes.length = 0;
    this.originalColors.clear();
    this.partTextures.clear();
    this.loadedContainer?.dispose();
    this.loadedContainer = null;
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.engine.resize();
    this.engine.runRenderLoop(() => this.scene.render());
  }

  stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;
    this.engine.stopRenderLoop();
  }

  resize(): void {
    this.engine.resize();
  }
}
