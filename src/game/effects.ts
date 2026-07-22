import { Scene } from "@babylonjs/core/scene";
import { Vector3, Color3 } from "@babylonjs/core/Maths/math";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";

/**
 * Efeitos visuais simples e baratos: tracer do tiro e faísca de impacto.
 * Meshes temporários com fade-out — sem sistema de partículas por enquanto.
 */
export class EffectsManager {
  private readonly scene: Scene;
  private readonly tracerMat: StandardMaterial;
  private readonly debugTracerMat: StandardMaterial;
  private readonly impactMat: StandardMaterial;
  private readonly bloodMat: StandardMaterial;

  constructor(scene: Scene) {
    this.scene = scene;

    this.tracerMat = new StandardMaterial("tracerMat", scene);
    this.tracerMat.emissiveColor = new Color3(1, 0.85, 0.4);
    this.tracerMat.disableLighting = true;

    this.debugTracerMat = new StandardMaterial("debugTracerMat", scene);
    this.debugTracerMat.emissiveColor = new Color3(0.15, 0.55, 1);
    this.debugTracerMat.disableLighting = true;

    this.impactMat = new StandardMaterial("impactMat", scene);
    this.impactMat.emissiveColor = new Color3(1, 0.7, 0.3);
    this.impactMat.disableLighting = true;

    this.bloodMat = new StandardMaterial("bloodMat", scene);
    this.bloodMat.emissiveColor = new Color3(0.75, 0.1, 0.1);
    this.bloodMat.disableLighting = true;
  }

  /** Linha fina do cano até o ponto de impacto, some em ~60ms. */
  spawnTracer(from: Vector3, to: Vector3): void {
    this.spawnLine(from, to, this.tracerMat, 60, 0.015);
  }

  /** Trajetória autoritativa enviada pelo servidor no modo debug. */
  spawnDebugTracer(from: Vector3, to: Vector3): void {
    this.spawnLine(from, to, this.debugTracerMat, 180, 0.028);
  }

  private spawnLine(
    from: Vector3,
    to: Vector3,
    material: StandardMaterial,
    durationMs: number,
    diameter: number
  ): void {
    const dir = to.subtract(from);
    const length = dir.length();
    if (length < 0.5) return;

    const tracer = MeshBuilder.CreateCylinder(
      "tracer",
      { height: length, diameter, tessellation: 3 },
      this.scene
    );
    tracer.material = material;
    tracer.isPickable = false;
    tracer.position = from.add(dir.scale(0.5));

    // Alinha o cilindro (eixo Y) com a direção do tiro.
    const up = new Vector3(0, 1, 0);
    const axis = Vector3.Cross(up, dir.normalize());
    const angle = Math.acos(Vector3.Dot(up, dir.normalize()));
    if (axis.lengthSquared() > 0.0001) {
      tracer.rotate(axis.normalize(), angle);
    }

    this.fadeAndDispose(tracer, durationMs);
  }

  /** Faísca no ponto de impacto (parede/chão). */
  spawnImpact(at: Vector3, onFlesh: boolean): void {
    const spark = MeshBuilder.CreateSphere(
      "impact",
      { diameter: onFlesh ? 0.22 : 0.12, segments: 4 },
      this.scene
    );
    spark.material = onFlesh ? this.bloodMat : this.impactMat;
    spark.isPickable = false;
    spark.position = at;
    this.fadeAndDispose(spark, 140);
  }

  private fadeAndDispose(mesh: import("@babylonjs/core/Meshes/mesh").Mesh, ms: number): void {
    const start = performance.now();
    const observer = this.scene.onBeforeRenderObservable.add(() => {
      const t = (performance.now() - start) / ms;
      if (t >= 1) {
        this.scene.onBeforeRenderObservable.remove(observer);
        mesh.dispose();
        return;
      }
      mesh.visibility = 1 - t;
    });
  }
}
