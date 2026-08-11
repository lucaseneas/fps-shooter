import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader.js";
import "@babylonjs/loaders/glTF/index.js";

const engine = new NullEngine();
const scene = new Scene(engine);

SceneLoader.LoadAssetContainerAsync("", "public/assets/Caixote_Madeira.glb", scene).then((container) => {
    const inst = container.instantiateModelsToScene();
    const root = inst.rootNodes[0];
    
    root.getChildMeshes(false).forEach(m => m.computeWorldMatrix(true));
    root.computeWorldMatrix(true);
    
    const boundingInfo = root.getHierarchyBoundingVectors();
    console.log("ORIGINAL BOUNDING BOX:");
    console.log("Min:", boundingInfo.min.toString());
    console.log("Max:", boundingInfo.max.toString());
    
    root.normalizeToUnitCube();
    
    root.getChildMeshes(false).forEach(m => m.computeWorldMatrix(true));
    root.computeWorldMatrix(true);
    
    const newBoundingInfo = root.getHierarchyBoundingVectors();
    console.log("NORMALIZED BOUNDING BOX:");
    console.log("Min:", newBoundingInfo.min.toString());
    console.log("Max:", newBoundingInfo.max.toString());
    
    console.log("ROOT LOCAL POSITION:", root.position.toString());
    console.log("ROOT LOCAL SCALING:", root.scaling.toString());
}).catch(console.error);
