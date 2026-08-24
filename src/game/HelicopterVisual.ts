import { Scene } from "@babylonjs/core/scene";
import { Color3 } from "@babylonjs/core/Maths/math";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";

/**
 * Helicóptero procedural do kill streak Predator.
 * Centro = fuselagem (mesma origem da hitbox no servidor).
 */
export class HelicopterVisual {
  private readonly root: TransformNode;
  private readonly rotor: TransformNode;
  private readonly tailRotor: TransformNode;
  private readonly meshes: Mesh[] = [];
  private rotorSpin = 0;
  private enabled = true;

  constructor(scene: Scene, id: string) {
    this.root = new TransformNode(`${id}_heli`, scene);

    const bodyMat = mat(`${id}_heliBody`, scene, new Color3(0.18, 0.22, 0.16));
    const darkMat = mat(`${id}_heliDark`, scene, new Color3(0.08, 0.09, 0.08));
    const metalMat = mat(`${id}_heliMetal`, scene, new Color3(0.28, 0.3, 0.32));
    const glassMat = mat(`${id}_heliGlass`, scene, new Color3(0.25, 0.55, 0.62), 0.55);
    const gunMat = mat(`${id}_heliGun`, scene, new Color3(0.12, 0.13, 0.12));
    const bladeMat = mat(`${id}_heliBlade`, scene, new Color3(0.1, 0.1, 0.1));

    const fuselage = MeshBuilder.CreateBox(
      `${id}_fuselage`,
      { width: 1.55, height: 1.15, depth: 5.2 },
      scene
    );
    fuselage.position.z = 0.15;
    this.attach(fuselage, bodyMat);

    const nose = MeshBuilder.CreateBox(
      `${id}_nose`,
      { width: 1.15, height: 0.72, depth: 1.35 },
      scene
    );
    nose.position.set(0, -0.08, 3.05);
    this.attach(nose, bodyMat);

    const cockpit = MeshBuilder.CreateBox(
      `${id}_cockpit`,
      { width: 1.05, height: 0.55, depth: 1.4 },
      scene
    );
    cockpit.position.set(0, 0.55, 1.85);
    this.attach(cockpit, glassMat);

    const tail = MeshBuilder.CreateBox(
      `${id}_tail`,
      { width: 0.38, height: 0.38, depth: 3.4 },
      scene
    );
    tail.position.set(0, 0.12, -4.0);
    this.attach(tail, bodyMat);

    const fin = MeshBuilder.CreateBox(
      `${id}_fin`,
      { width: 0.12, height: 1.15, depth: 0.7 },
      scene
    );
    fin.position.set(0, 0.72, -5.45);
    this.attach(fin, darkMat);

    const stabilizer = MeshBuilder.CreateBox(
      `${id}_stab`,
      { width: 1.35, height: 0.1, depth: 0.45 },
      scene
    );
    stabilizer.position.set(0, 0.18, -5.35);
    this.attach(stabilizer, darkMat);

    const hub = MeshBuilder.CreateCylinder(
      `${id}_hub`,
      { height: 0.28, diameter: 0.55 },
      scene
    );
    hub.position.y = 0.85;
    this.attach(hub, metalMat);

    this.rotor = new TransformNode(`${id}_rotor`, scene);
    this.rotor.parent = this.root;
    this.rotor.position.y = 1.02;
    for (let i = 0; i < 4; i++) {
      const blade = MeshBuilder.CreateBox(
        `${id}_blade${i}`,
        { width: 0.22, height: 0.05, depth: 7.4 },
        scene
      );
      blade.rotation.y = (Math.PI / 2) * i;
      blade.material = bladeMat;
      blade.parent = this.rotor;
      blade.isPickable = false;
      this.meshes.push(blade);
    }

    this.tailRotor = new TransformNode(`${id}_tailRotor`, scene);
    this.tailRotor.parent = this.root;
    this.tailRotor.position.set(0.28, 0.85, -5.55);
    for (let i = 0; i < 2; i++) {
      const blade = MeshBuilder.CreateBox(
        `${id}_tailBlade${i}`,
        { width: 0.08, height: 1.35, depth: 0.06 },
        scene
      );
      blade.rotation.z = (Math.PI / 2) * i;
      blade.material = bladeMat;
      blade.parent = this.tailRotor;
      blade.isPickable = false;
      this.meshes.push(blade);
    }

    const skidL = MeshBuilder.CreateBox(
      `${id}_skidL`,
      { width: 0.1, height: 0.08, depth: 4.2 },
      scene
    );
    skidL.position.set(-0.72, -0.95, 0.2);
    this.attach(skidL, metalMat);
    const skidR = skidL.clone(`${id}_skidR`)!;
    skidR.position.x = 0.72;
    skidR.material = metalMat;
    skidR.parent = this.root;
    skidR.isPickable = false;
    this.meshes.push(skidR);

    const strutL = MeshBuilder.CreateBox(
      `${id}_strutL`,
      { width: 0.08, height: 0.7, depth: 0.08 },
      scene
    );
    strutL.position.set(-0.55, -0.55, 0.6);
    this.attach(strutL, metalMat);
    const strutR = strutL.clone(`${id}_strutR`)!;
    strutR.position.x = 0.55;
    strutR.material = metalMat;
    strutR.parent = this.root;
    strutR.isPickable = false;
    this.meshes.push(strutR);

    const gunMount = MeshBuilder.CreateBox(
      `${id}_gunMount`,
      { width: 0.45, height: 0.35, depth: 0.55 },
      scene
    );
    gunMount.position.set(0, -0.85, 2.35);
    this.attach(gunMount, gunMat);

    const barrel = MeshBuilder.CreateCylinder(
      `${id}_minigun`,
      { height: 1.35, diameter: 0.22 },
      scene
    );
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, -1.05, 3.05);
    this.attach(barrel, gunMat);
  }

  private attach(mesh: Mesh, material: StandardMaterial): void {
    mesh.material = material;
    mesh.parent = this.root;
    mesh.isPickable = false;
    this.meshes.push(mesh);
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.root.setEnabled(on);
  }

  setPose(x: number, y: number, z: number, yaw: number): void {
    this.root.position.set(x, y, z);
    this.root.rotation.y = yaw;
  }

  update(dt: number): void {
    if (!this.enabled) return;
    this.rotorSpin += dt * 28;
    this.rotor.rotation.y = this.rotorSpin;
    this.tailRotor.rotation.x = this.rotorSpin * 1.6;
  }

  dispose(): void {
    this.root.dispose(false, true);
  }
}

function mat(
  name: string,
  scene: Scene,
  color: Color3,
  alpha = 1
): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = color;
  m.specularColor = new Color3(0.12, 0.12, 0.12);
  m.alpha = alpha;
  if (alpha < 1) m.transparencyMode = StandardMaterial.MATERIAL_ALPHABLEND;
  return m;
}
