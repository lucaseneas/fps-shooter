import { Scene } from "@babylonjs/core/scene";
import { Color3, Vector3 } from "@babylonjs/core/Maths/math";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";

/**
 * Paraquedas procedural — copa acima dos pés do jogador (origem = pés).
 */
export class ParachuteVisual {
  private readonly root: TransformNode;
  private readonly canopy: TransformNode;
  private readonly meshes: Mesh[] = [];
  private enabled = true;
  private t = 0;

  constructor(scene: Scene, id: string) {
    this.root = new TransformNode(`${id}_chute`, scene);
    this.canopy = new TransformNode(`${id}_chuteCanopy`, scene);
    this.canopy.parent = this.root;
    this.canopy.position.y = 2.92;

    const cloth = mat(`${id}_chuteCloth`, scene, new Color3(0.42, 0.48, 0.28));
    const dark = mat(`${id}_chuteDark`, scene, new Color3(0.22, 0.26, 0.14));
    const cordMat = mat(`${id}_chuteCord`, scene, new Color3(0.72, 0.68, 0.52));
    const harnessMat = mat(`${id}_chuteHarness`, scene, new Color3(0.18, 0.16, 0.12));

    const dome = MeshBuilder.CreateSphere(
      `${id}_chuteDome`,
      { diameter: 3.7, segments: 12 },
      scene
    );
    dome.scaling.y = 0.34;
    dome.material = cloth;
    dome.parent = this.canopy;
    dome.isPickable = false;
    this.meshes.push(dome);

    const rim = MeshBuilder.CreateTorus(
      `${id}_chuteRim`,
      { diameter: 3.55, thickness: 0.08, tessellation: 20 },
      scene
    );
    rim.position.y = -0.18;
    rim.material = dark;
    rim.parent = this.canopy;
    rim.isPickable = false;
    this.meshes.push(rim);

    const apex = MeshBuilder.CreateSphere(
      `${id}_chuteApex`,
      { diameter: 0.28, segments: 6 },
      scene
    );
    apex.position.y = 0.52;
    apex.material = dark;
    apex.parent = this.canopy;
    apex.isPickable = false;
    this.meshes.push(apex);

    const harness = MeshBuilder.CreateBox(
      `${id}_chutePack`,
      { width: 0.38, height: 0.28, depth: 0.22 },
      scene
    );
    harness.position.set(0, 1.22, -0.18);
    harness.material = harnessMat;
    harness.parent = this.root;
    harness.isPickable = false;
    this.meshes.push(harness);

    const attach = new Vector3(0, 1.28, 0);
    const cordCount = 8;
    for (let i = 0; i < cordCount; i++) {
      const a = (Math.PI * 2 * i) / cordCount;
      const rimPos = new Vector3(Math.sin(a) * 1.72, 2.72, Math.cos(a) * 1.72);
      const mid = rimPos.add(attach).scale(0.5);
      const delta = rimPos.subtract(attach);
      const len = delta.length();
      const cord = MeshBuilder.CreateCylinder(
        `${id}_chuteCord${i}`,
        { height: len, diameter: 0.025, tessellation: 4 },
        scene
      );
      cord.position.copyFrom(mid);
      const yaw = Math.atan2(delta.x, delta.z);
      const pitch = Math.acos(delta.y / Math.max(len, 1e-6)) - Math.PI / 2;
      cord.rotation.set(pitch, yaw, 0);
      cord.material = cordMat;
      cord.parent = this.root;
      cord.isPickable = false;
      this.meshes.push(cord);
    }
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
    this.t += dt;
    this.canopy.rotation.z = Math.sin(this.t * 1.15) * 0.06;
    this.canopy.rotation.x = Math.cos(this.t * 0.85) * 0.045;
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
  m.specularColor = new Color3(0.08, 0.08, 0.08);
  m.alpha = alpha;
  if (alpha < 1) m.transparencyMode = StandardMaterial.MATERIAL_ALPHABLEND;
  return m;
}
