import { Scene } from "@babylonjs/core/scene";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { Vector3, Color3 } from "@babylonjs/core/Maths/math";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";

import { WeaponDef } from "../../shared/weapons";

/**
 * "Arma na mão" em primeira pessoa: geometria simples (corpo + cano)
 * parentada à câmera, com kick ao atirar e abaixada durante o reload.
 */
export class ViewModel {
  private readonly root: Mesh;
  private readonly bodyMat: StandardMaterial;
  private readonly barrel: Mesh;

  private kick = 0;
  private reloadDip = 0;
  private reloading = false;

  private readonly basePos = new Vector3(0.28, -0.24, 0.65);

  constructor(scene: Scene, camera: UniversalCamera) {
    this.bodyMat = new StandardMaterial("vmMat", scene);
    this.bodyMat.specularColor = new Color3(0.08, 0.08, 0.08);

    this.root = MeshBuilder.CreateBox(
      "vmBody",
      { width: 0.09, height: 0.14, depth: 0.42 },
      scene
    );
    this.root.material = this.bodyMat;

    this.barrel = MeshBuilder.CreateCylinder(
      "vmBarrel",
      { height: 0.3, diameter: 0.045 },
      scene
    );
    this.barrel.rotation.x = Math.PI / 2;
    this.barrel.position = new Vector3(0, 0.03, 0.3);
    this.barrel.material = this.bodyMat;
    this.barrel.parent = this.root;

    this.root.parent = camera;
    this.root.position = this.basePos.clone();

    // View model não participa de colisão nem de raycast de tiro.
    for (const m of [this.root, this.barrel]) {
      m.isPickable = false;
      m.renderingGroupId = 1; // renderiza por cima do cenário
    }
  }

  setWeapon(weapon: WeaponDef): void {
    const [r, g, b] = weapon.viewColor;
    this.bodyMat.diffuseColor = new Color3(r, g, b);
    // Escopeta/rifle com cano mais longo que pistola.
    this.barrel.scaling.y = weapon.id === "pistol" ? 0.6 : 1.2;
    this.kick = 0.4; // pequeno movimento de "sacar"
  }

  triggerKick(strength = 1): void {
    this.kick = Math.min(1, this.kick + 0.55 * strength);
  }

  setReloading(on: boolean): void {
    this.reloading = on;
  }

  update(dt: number): void {
    this.kick = Math.max(0, this.kick - dt * 6);
    const targetDip = this.reloading ? 1 : 0;
    this.reloadDip += (targetDip - this.reloadDip) * Math.min(1, dt * 8);

    this.root.position.set(
      this.basePos.x,
      this.basePos.y - this.reloadDip * 0.18,
      this.basePos.z - this.kick * 0.07
    );
    this.root.rotation.set(
      -this.kick * 0.12 + this.reloadDip * 0.5,
      0,
      0
    );
  }
}
