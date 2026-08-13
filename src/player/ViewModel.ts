import { Scene } from "@babylonjs/core/scene";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { Vector3, Color3, Matrix, Quaternion } from "@babylonjs/core/Maths/math";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";

import { WeaponDef } from "../../shared/weapons";

function easeOutCubic(t: number): number {
  const u = 1 - t;
  return 1 - u * u * u;
}

export class ViewModel {
  private readonly root: TransformNode;
  private readonly fallbackRoot: TransformNode;
  private readonly rifleRoot: TransformNode;
  private readonly bodyMat: StandardMaterial;
  private readonly bodyMesh: Mesh;
  private readonly barrel: Mesh;
  private readonly flash: Mesh;
  private flashTimeout = 0;
  private melee = false;
  private currentWeaponId = "";

  private kick = 0;
  private reloadDip = 0;
  private reloading = false;

  private drawProgress = 1;
  private drawDuration = 0.7;

  private readonly basePos = new Vector3(0.28, -0.24, 0.65);

  constructor(scene: Scene, camera: UniversalCamera) {
    this.root = new TransformNode("vmRoot", scene);
    this.root.parent = camera;
    this.root.position = this.basePos.clone();

    this.fallbackRoot = new TransformNode("vmFallback", scene);
    this.fallbackRoot.parent = this.root;

    this.rifleRoot = new TransformNode("vmRifleRoot", scene);
    this.rifleRoot.parent = this.root;
    this.rifleRoot.setEnabled(false);

    // Carregar o modelo do rifle assincronamente
    SceneLoader.LoadAssetContainerAsync("", "/assets/rifle_v2.glb", scene).then((container) => {
      const inst = container.instantiateModelsToScene();
      const gunOffset = new TransformNode("gunOffset", scene);
      gunOffset.parent = this.rifleRoot;
      // Traz a arma mais para perto da câmera (-Z) e um pouco mais centralizada (-X) e pra cima (+Y)
      gunOffset.position = new Vector3(-0.1, 0.05, -0.35);

      gunOffset.rotationQuaternion = Quaternion.FromEulerAngles(
        Math.PI / -2,
        0,
        0
      );
      const model = inst.rootNodes[0] as Mesh;
      model.parent = gunOffset;

      for (const m of model.getChildMeshes()) {
        m.isPickable = false;
        m.renderingGroupId = 2; // Garantir que renderiza por cima de tudo na UI
      }
    });

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
    flashMat.emissiveColor = new Color3(1, 0.8, 0.35);
    flashMat.disableLighting = true;
    this.flash = MeshBuilder.CreateSphere(
      "vmFlash",
      { diameter: 0.14, segments: 4 },
      scene
    );
    this.flash.material = flashMat;
    // O flash fica na root agora para servir tanto pro modelo antigo quanto pro novo
    this.flash.position = new Vector3(0, 0.05, 0.6);
    this.flash.parent = this.root;
    this.flash.setEnabled(false);

    for (const m of [this.bodyMesh, this.barrel, this.flash]) {
      m.isPickable = false;
      m.renderingGroupId = 2;
    }
  }

  setWeapon(weapon: WeaponDef): void {
    this.currentWeaponId = weapon.id;
    const [r, g, b] = weapon.viewColor;
    this.bodyMat.diffuseColor = new Color3(r, g, b);
    this.melee = weapon.id === "knife";

    if (weapon.id === "rifle") {
      this.fallbackRoot.setEnabled(false);
      this.rifleRoot.setEnabled(true);
    } else {
      this.fallbackRoot.setEnabled(true);
      this.rifleRoot.setEnabled(false);
      if (this.melee) {
        this.fallbackRoot.scaling.set(0.45, 1.35, 0.55);
        this.barrel.setEnabled(false);
      } else {
        this.fallbackRoot.scaling.set(1, 1, 1);
        this.barrel.setEnabled(true);
        this.barrel.scaling.y =
          weapon.id === "pistol" ? 0.6 : weapon.id === "sniper" ? 1.85 : 1.2;
      }
    }

    this.startDraw(weapon.drawTime);
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
    const alpha = on ? 0.6 : 1;
    this.bodyMat.alpha = alpha;
    this.bodyMat.transparencyMode = on
      ? StandardMaterial.MATERIAL_ALPHABLEND
      : StandardMaterial.MATERIAL_OPAQUE;

    // Aplicar também ao modelo do rifle
    this.rifleRoot.getChildMeshes().forEach(m => {
      if (m.material) {
        m.material.alpha = alpha;
        // Se for PBRMaterial ou StandardMaterial, a propriedade de transparência pode variar, 
        // mas para view model invencível a gente só seta alpha por enquanto.
      }
    });
  }

  triggerKick(strength = 1): void {
    this.kick = Math.min(1, this.kick + 0.55 * strength);

    if (this.melee) return;

    this.flash.setEnabled(true);
    this.flash.scaling.setAll(0.8 + Math.random() * 0.5);
    window.clearTimeout(this.flashTimeout);
    this.flashTimeout = window.setTimeout(() => this.flash.setEnabled(false), 45);
  }

  setReloading(on: boolean): void {
    this.reloading = on;
  }

  update(dt: number): void {
    this.kick = Math.max(0, this.kick - dt * 6);
    const targetDip = this.reloading ? 1 : 0;
    this.reloadDip += (targetDip - this.reloadDip) * Math.min(1, dt * 8);

    if (this.drawProgress < 1) {
      this.drawProgress = Math.min(1, this.drawProgress + dt / this.drawDuration);
    }
    const holster = 1 - easeOutCubic(this.drawProgress);

    this.root.position.set(
      this.basePos.x + holster * 0.08,
      this.basePos.y - this.reloadDip * 0.18 - holster * 0.52,
      this.basePos.z - this.kick * 0.07 - holster * 0.22
    );

    this.root.rotation.set(
      -this.kick * 0.12 + this.reloadDip * 0.5 + holster * 1.15,
      (this.melee ? this.kick * 0.9 : 0) + holster * 0.25,
      (this.melee ? -this.kick * 0.55 : 0) - holster * 0.4
    );
  }
}

