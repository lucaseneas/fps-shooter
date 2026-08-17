import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color4, Color3 } from "@babylonjs/core/Maths/math.color";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import "@babylonjs/loaders/glTF";

export class SkinPreview {
  private engine: Engine;
  private scene: Scene;
  private camera: ArcRotateCamera;
  private dummyMesh: TransformNode | null = null;
  private skinMat: PBRMaterial | StandardMaterial | null = null;
  private isRunning = false;
  private currentSkin = "skin_default";

  constructor(canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas, true, { preserveDrawingBuffer: false, antialias: true });
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0, 0, 0, 0);

    // Câmera orbital interativa 360 padrão
    this.camera = new ArcRotateCamera(
      "previewCamera",
      Math.PI / 2,
      Math.PI / 2.1,
      3.2,
      new Vector3(0, 0.9, 0),
      this.scene
    );
    this.camera.minZ = 0.1;
    this.camera.lowerRadiusLimit = 2.0;
    this.camera.upperRadiusLimit = 4.5;
    this.camera.lowerBetaLimit = Math.PI / 2.5;
    this.camera.upperBetaLimit = Math.PI / 1.8;
    this.camera.angularSensibilityX = 1000;
    this.camera.wheelPrecision = 50;

    this.camera.attachControl(canvas, true);

    // Iluminação
    const hemiLight = new HemisphericLight("previewHemi", new Vector3(0, 1, 0), this.scene);
    hemiLight.intensity = 1.2;
    hemiLight.groundColor = new Color3(0.3, 0.3, 0.35);

    const dirLight = new DirectionalLight("previewDir", new Vector3(-1, -2, 2), this.scene);
    dirLight.intensity = 0.8;

    this.loadModel();
  }

  private async loadModel() {
    try {
      const container = await SceneLoader.LoadAssetContainerAsync("", "/assets/player_dummy.glb", this.scene);
      const inst = container.instantiateModelsToScene();
      this.dummyMesh = inst.rootNodes[0] as TransformNode;
      this.dummyMesh.position.y = 0; 
      
      this.dummyMesh.getChildMeshes().forEach(m => {
        if (m.material) {
          this.skinMat = m.material as PBRMaterial | StandardMaterial;
        }
      });
      
      this.setSkin(this.currentSkin);
    } catch (e) {
      console.error("[SkinPreview] Falha ao carregar player_dummy.glb:", e);
    }
  }

  public setSkin(skinId: string) {
    this.currentSkin = skinId;
    if (!this.skinMat) return;
    
    // As skins clássicas (Minecraft / Blocky) usam invertY = false para bater perfeitamente com a UV do player_dummy.glb
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
    this.camera.alpha = Math.PI / 2;
    this.engine.resize();
    this.engine.runRenderLoop(() => {
      this.scene.render();
    });
  }

  public stop() {
    if (!this.isRunning) return;
    this.isRunning = false;
    this.engine.stopRenderLoop();
  }

  public resize() {
    this.engine.resize();
  }
}
