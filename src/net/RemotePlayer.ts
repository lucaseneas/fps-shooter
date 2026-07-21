import { Scene } from "@babylonjs/core/scene";
import { Vector3, Color3 } from "@babylonjs/core/Maths/math";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";

const HEIGHT = 1.8;

/**
 * Representação visual de outro combatente da sala (humano ou bot — o
 * cliente não distingue). Posição interpolada entre patches do servidor.
 * Hitboxes de cabeça/corpo permitem o hitscan local do player.
 */
export class RemotePlayer {
  readonly id: string;

  private readonly root: Mesh;
  private readonly bodyMesh: Mesh;
  private readonly headMesh: Mesh;
  private readonly nameplate: Mesh;

  /** Alvo de interpolação (pés). */
  private targetPos = new Vector3(0, 0, 0);
  private targetYaw = 0;

  constructor(scene: Scene, id: string, name: string) {
    this.id = id;

    this.root = MeshBuilder.CreateBox(
      `${id}_root`,
      { width: 0.9, height: HEIGHT, depth: 0.6 },
      scene
    );
    this.root.isVisible = false;
    this.root.checkCollisions = true;

    const bodyMat = new StandardMaterial(`${id}_bodyMat`, scene);
    bodyMat.diffuseColor = new Color3(0.75, 0.25, 0.2);
    const headMat = new StandardMaterial(`${id}_headMat`, scene);
    headMat.diffuseColor = new Color3(0.9, 0.75, 0.6);

    this.bodyMesh = MeshBuilder.CreateBox(
      `${id}_body`,
      { width: 0.9, height: 1.3, depth: 0.6 },
      scene
    );
    this.bodyMesh.parent = this.root;
    this.bodyMesh.position.y = -0.15;
    this.bodyMesh.material = bodyMat;
    this.bodyMesh.metadata = { hitbox: { id, part: "body" } };

    this.headMesh = MeshBuilder.CreateSphere(
      `${id}_head`,
      { diameter: 0.45, segments: 8 },
      scene
    );
    this.headMesh.parent = this.root;
    this.headMesh.position.y = HEIGHT / 2 - 0.1;
    this.headMesh.material = headMat;
    this.headMesh.metadata = { hitbox: { id, part: "head" } };

    this.nameplate = this.createNameplate(scene, name);
  }

  private createNameplate(scene: Scene, name: string): Mesh {
    const plane = MeshBuilder.CreatePlane(
      `${this.id}_name`,
      { width: 1.6, height: 0.4 },
      scene
    );
    plane.parent = this.root;
    plane.position.y = HEIGHT / 2 + 0.45;
    plane.billboardMode = 7; // BILLBOARDMODE_ALL
    plane.isPickable = false;

    const texture = new DynamicTexture(
      `${this.id}_nameTex`,
      { width: 256, height: 64 },
      scene,
      false
    );
    texture.hasAlpha = true;
    texture.drawText(
      name,
      null,
      44,
      "bold 36px 'Segoe UI'",
      "white",
      "transparent",
      true
    );

    const mat = new StandardMaterial(`${this.id}_nameMat`, scene);
    mat.diffuseTexture = texture;
    mat.emissiveColor = new Color3(1, 1, 1);
    mat.disableLighting = true;
    mat.backFaceCulling = false;
    plane.material = mat;
    return plane;
  }

  /** Recebe o último estado do servidor (pés em y). */
  applyState(x: number, y: number, z: number, yaw: number, alive: boolean): void {
    this.targetPos.set(x, y + HEIGHT / 2, z);
    this.targetYaw = yaw;
    this.setVisible(alive);
  }

  /** Interpola em direção ao último estado (chamar a cada frame). */
  update(dt: number): void {
    const t = Math.min(1, dt * 12);
    Vector3.LerpToRef(this.root.position, this.targetPos, t, this.root.position);

    // Interpolação de yaw pelo caminho mais curto.
    let diff = this.targetYaw - this.root.rotation.y;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.root.rotation.y += diff * t;
  }

  /** Snap imediato (primeiro estado recebido). */
  snapToTarget(): void {
    this.root.position.copyFrom(this.targetPos);
    this.root.rotation.y = this.targetYaw;
  }

  /** Posição da cabeça — origem de tracers de tiros remotos. */
  getHead(): Vector3 {
    return this.root.position.add(new Vector3(0, HEIGHT / 2 - 0.1, 0));
  }

  private setVisible(on: boolean): void {
    this.bodyMesh.setEnabled(on);
    this.headMesh.setEnabled(on);
    this.nameplate.setEnabled(on);
    this.root.checkCollisions = on;
  }

  dispose(): void {
    this.root.dispose(false, true);
  }
}
