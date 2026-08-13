import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import "@babylonjs/loaders/glTF";

export class SkinPreview {
  private engine: Engine;
  private scene: Scene;
  private dummyMesh: TransformNode | null = null;
  private skinMat: PBRMaterial | StandardMaterial | null = null;
  private isRunning = false;
  private currentSkin = "skin_default";

  constructor(canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas, true);
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0, 0, 0, 0);

    const camera = new ArcRotateCamera(
      "previewCamera",
      Math.PI / 2,
      Math.PI / 2.2,
      3.5,
      new Vector3(0, 0.9, 0),
      this.scene
    );
    camera.minZ = 0.1;

    const light = new HemisphericLight("previewLight", new Vector3(0, 1, 0), this.scene);
    light.intensity = 1.2;

    this.scene.onBeforeRenderObservable.add(() => {
      if (this.dummyMesh) {
        this.dummyMesh.rotation.y += 0.015;
      }
    });

    this.loadModel();
  }

  private async loadModel() {
    try {
      const container = await SceneLoader.LoadAssetContainerAsync("", "/assets/player_dummy.glb", this.scene);
      const inst = container.instantiateModelsToScene();
      this.dummyMesh = inst.rootNodes[0] as TransformNode;
      // Ajustar se a origem for nos pés
      this.dummyMesh.position.y = 0; 
      
      this.dummyMesh.getChildMeshes().forEach(m => {
        if (m.material) {
          // Salva a referência de todos os materiais encontrados no boneco
          // O GLTF loader às vezes muda o nome (ex: adiciona sufixos)
          this.skinMat = m.material as PBRMaterial | StandardMaterial;
        }
      });
      
      this.setSkin(this.currentSkin);
    } catch (e) {
      console.error("Failed to load preview dummy", e);
    }
  }

  public setSkin(skinId: string) {
    this.currentSkin = skinId;
    if (!this.skinMat) return;
    
    const tex = new Texture(`/assets/${skinId}.png`, this.scene, true, false, Texture.NEAREST_SAMPLINGMODE);
    tex.hasAlpha = true;
    
    const mat = this.skinMat as any;
    if (mat.albedoTexture !== undefined) {
      mat.albedoTexture = tex;
    } else if (mat.diffuseTexture !== undefined) {
      mat.diffuseTexture = tex;
    }
  }

  public start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.engine.runRenderLoop(() => {
      this.scene.render();
    });
  }

  public stop() {
    if (!this.isRunning) return;
    this.isRunning = false;
    this.engine.stopRenderLoop();
  }
}
