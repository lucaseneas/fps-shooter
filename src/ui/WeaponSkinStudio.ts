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

import { WEAPON_ASSETS, weaponModelTransform, applyWeaponAppearance, applyWeaponMeshTexture } from "../player/ViewModel";
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
  /** Nome do mesh → mesh (partes selecionáveis). */
  private readonly partMeshes = new Map<string, AbstractMesh>();
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

  constructor(canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas, true, { antialias: true });
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.07, 0.08, 0.11, 1);

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
      this.selectPart(mesh && this.partMeshes.has(mesh.name) ? mesh.name : null);
    });
  }

  get selectedPartName(): string | null {
    return this.selectedPart;
  }

  /** Troca a arma exibida. Reseta seleção e partes pintadas. */
  async setWeapon(id: WeaponId): Promise<void> {
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

      const gunOffset = new TransformNode("studioGunOffset", this.scene);
      const model = inst.rootNodes[0] as Mesh;
      // Mede antes de parentar (mesma auto-escala/rotação do jogo).
      const t = weaponModelTransform(id, model);
      gunOffset.rotationQuaternion = Quaternion.FromEulerVector(t.rotation);
      gunOffset.scaling.setAll(t.scale);
      model.parent = gunOffset;

      for (const m of model.getChildMeshes()) {
        m.isPickable = true;
        this.preparePartMesh(m);
      }
      applyWeaponAppearance(this.scene, model, id, null);
      for (const m of model.getChildMeshes()) {
        this.originalColors.set(m.name, this.readMeshColor(m));
      }
      this.modelRoot = gunOffset;
    } catch (err) {
      console.warn(`[SkinStudio] Falha ao carregar ${id}:`, err);
    }
  }

  /** Dá um material exclusivo ao mesh e guarda a cor original dele. */
  private preparePartMesh(m: AbstractMesh): void {
    const original = m.material;
    let color: RgbColor = [0.55, 0.55, 0.58];

    if (original) {
      const cloned = original.clone(`studioMat_${m.name}`);
      m.material = cloned;
      const anyMat = cloned as unknown as {
        albedoColor?: Color3;
        diffuseColor?: Color3;
      };
      const c = anyMat.albedoColor ?? anyMat.diffuseColor;
      if (c) color = [c.r, c.g, c.b];
    } else {
      const mat = new StandardMaterial(`studioMat_${m.name}`, this.scene);
      mat.diffuseColor = new Color3(color[0], color[1], color[2]);
      mat.specularColor = new Color3(0.08, 0.08, 0.08);
      m.material = mat;
    }

    this.partMeshes.set(m.name, m);
    this.originalColors.set(m.name, color);
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
    if (this.selectedPart === name) return;

    if (this.selectedPart) {
      const prev = this.partMeshes.get(this.selectedPart);
      if (prev) prev.renderOutline = false;
    }
    this.selectedPart = name;
    if (name) {
      const mesh = this.partMeshes.get(name);
      if (mesh) {
        mesh.renderOutline = true;
        mesh.outlineColor = new Color3(1, 0.6, 0.1);
        mesh.outlineWidth = 0.06;
      }
    }
    this.onPartSelected?.(name);
  }

  /** Pinta uma parte e registra na skin em edição. */
  setPartColor(name: string, color: RgbColor): void {
    const mesh = this.partMeshes.get(name);
    if (!mesh?.material) return;
    const mat = mesh.material as unknown as {
      albedoColor?: Color3;
      diffuseColor?: Color3;
    };
    const c = new Color3(color[0], color[1], color[2]);
    if (mat.albedoColor !== undefined) mat.albedoColor = c;
    else if (mat.diffuseColor !== undefined) mat.diffuseColor = c;
    this.parts.set(name, color);
  }

  setPartTexture(name: string, textureId: string | null): void {
    const mesh = this.partMeshes.get(name);
    if (!mesh) return;
    if (!textureId || textureId === "none") {
      this.partTextures.delete(name);
      applyWeaponMeshTexture(this.scene, mesh, null);
      return;
    }
    if (!this.parts.has(name)) this.setPartColor(name, [1, 1, 1]);
    this.partTextures.set(name, textureId);
    applyWeaponMeshTexture(this.scene, mesh, textureId);
  }

  getPartTexture(name: string): string | null {
    return this.partTextures.get(name) ?? null;
  }

  /** Volta a parte à cor original do modelo. */
  clearPart(name: string): void {
    const mesh = this.partMeshes.get(name);
    const original = this.originalColors.get(name);
    if (!mesh?.material || !original) return;
    const mat = mesh.material as unknown as {
      albedoColor?: Color3;
      diffuseColor?: Color3;
    };
    const c = new Color3(original[0], original[1], original[2]);
    if (mat.albedoColor !== undefined) mat.albedoColor = c;
    else if (mat.diffuseColor !== undefined) mat.diffuseColor = c;
    applyWeaponMeshTexture(this.scene, mesh, null);
    this.parts.delete(name);
    this.partTextures.delete(name);
  }

  clearAllParts(): void {
    for (const name of [...this.parts.keys()]) this.clearPart(name);
  }

  /** Partes pintadas no formato da skin (meshName → RGB). */
  getParts(): Record<string, RgbColor> {
    const parts = Object.fromEntries(this.parts);
    for (const mesh of this.partTextures.keys()) {
      if (!parts[mesh]) parts[mesh] = [1, 1, 1];
    }
    return parts;
  }

  getTextures(): Record<string, string> {
    return Object.fromEntries(this.partTextures);
  }

  /** Cor atual de uma parte (pintada ou original) — para o color picker. */
  getPartColor(name: string): RgbColor {
    return (
      this.parts.get(name) ??
      this.originalColors.get(name) ?? [0.55, 0.55, 0.58]
    );
  }

  get paintedCount(): number {
    const keys = new Set([...this.parts.keys(), ...this.partTextures.keys()]);
    return keys.size;
  }

  private clearModel(): void {
    if (this.modelRoot) {
      this.modelRoot.dispose(false, true);
      this.modelRoot = null;
    }
    this.partMeshes.clear();
    this.originalColors.clear();
    this.partTextures.clear();
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
