import { Scene } from "@babylonjs/core/scene";
import { Engine } from "@babylonjs/core/Engines/engine";
import { Vector3, Color3, Color4 } from "@babylonjs/core/Maths/math";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";

import "@babylonjs/core/Materials/standardMaterial";
import "@babylonjs/core/Collisions/collisionCoordinator";

import { MAP_BOXES, MAP_SIZE, BoxDef } from "../../shared/mapData";

/**
 * Constrói a cena a partir de `shared/mapData` — a MESMA geometria que o
 * servidor usa para colisão e linha de visão dos bots.
 */
export function createScene(engine: Engine): Scene {
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.53, 0.68, 0.82, 1.0); // céu azulado
  scene.ambientColor = new Color3(0.3, 0.3, 0.35);

  // Névoa leve para dar profundidade sem custo.
  scene.fogMode = Scene.FOGMODE_LINEAR;
  scene.fogColor = new Color3(0.53, 0.68, 0.82);
  scene.fogStart = 60;
  scene.fogEnd = 170;

  scene.collisionsEnabled = true;
  scene.gravity = new Vector3(0, -0.9, 0);

  setupLights(scene);
  createGround(scene);
  createMapBoxes(scene);

  return scene;
}

function setupLights(scene: Scene): void {
  const hemi = new HemisphericLight("hemi", new Vector3(0, 1, 0), scene);
  hemi.intensity = 0.75;
  hemi.groundColor = new Color3(0.35, 0.35, 0.4);

  const sun = new DirectionalLight("sun", new Vector3(-0.5, -1, -0.6), scene);
  sun.position = new Vector3(30, 50, 30);
  sun.intensity = 1.1;
}

function createGround(scene: Scene): void {
  const ground = MeshBuilder.CreateGround(
    "ground",
    { width: MAP_SIZE, height: MAP_SIZE },
    scene
  );
  // Sólido barato (sem GridMaterial). Mais escuro/quente que as paredes (0.22, 0.25, 0.3).
  const mat = new StandardMaterial("groundMat", scene);
  mat.diffuseColor = new Color3(0.12, 0.14, 0.11);
  mat.specularColor = new Color3(0.02, 0.02, 0.02);
  mat.freeze();
  ground.material = mat;
  ground.checkCollisions = false;
  ground.metadata = { staticGeo: true };
  ground.freezeWorldMatrix();
}

/**
 * Uma caixa por peça no mapData, depois MergeMeshes por `kind`.
 * ~35 draw calls → ~5; matrizes congeladas (mapa estático).
 * Colisão do jogador usa MAP_BOXES no sim compartilhado, não checkCollisions.
 */
function createMapBoxes(scene: Scene): void {
  const materials: Record<BoxDef["kind"], StandardMaterial> = {
    wall: new StandardMaterial("wallMat", scene),
    building: new StandardMaterial("buildingMat", scene),
    box: new StandardMaterial("boxMat", scene),
    platform: new StandardMaterial("rampMat", scene),
    pillar: new StandardMaterial("pillarMat", scene),
  };
  materials.wall.diffuseColor = new Color3(0.22, 0.25, 0.3);
  materials.building.diffuseColor = new Color3(0.55, 0.48, 0.42);
  materials.box.diffuseColor = new Color3(0.75, 0.42, 0.2);
  materials.platform.diffuseColor = new Color3(0.35, 0.55, 0.4);
  materials.pillar.diffuseColor = new Color3(0.6, 0.62, 0.68);

  for (const mat of Object.values(materials)) {
    mat.specularColor = new Color3(0.05, 0.05, 0.05);
    mat.freeze();
  }

  const byKind: Record<BoxDef["kind"], Mesh[]> = {
    wall: [],
    building: [],
    box: [],
    platform: [],
    pillar: [],
  };

  MAP_BOXES.forEach((b, i) => {
    const mesh = MeshBuilder.CreateBox(
      `map_${b.kind}_${i}`,
      { width: b.w, height: b.h, depth: b.d },
      scene
    );
    mesh.position = new Vector3(b.x, b.y, b.z);
    mesh.material = materials[b.kind];
    mesh.checkCollisions = false;
    mesh.metadata = { staticGeo: true };
    mesh.computeWorldMatrix(true);
    byKind[b.kind].push(mesh);
  });

  for (const kind of Object.keys(byKind) as BoxDef["kind"][]) {
    const meshes = byKind[kind];
    if (meshes.length === 0) continue;

    if (meshes.length === 1) {
      const only = meshes[0];
      only.name = `map_${kind}`;
      only.freezeWorldMatrix();
      continue;
    }

    const merged = Mesh.MergeMeshes(meshes, true, true);
    if (!merged) continue;
    merged.name = `map_${kind}`;
    merged.material = materials[kind];
    merged.metadata = { staticGeo: true };
    merged.checkCollisions = false;
    merged.isPickable = true;
    merged.freezeWorldMatrix();
  }
}
