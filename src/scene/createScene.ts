import { Scene } from "@babylonjs/core/scene";
import { Engine } from "@babylonjs/core/Engines/engine";
import { Vector3, Color3, Color4 } from "@babylonjs/core/Maths/math";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { GridMaterial } from "@babylonjs/materials/grid/gridMaterial";

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
  const grid = new GridMaterial("gridMat", scene);
  grid.majorUnitFrequency = 5;
  grid.minorUnitVisibility = 0.35;
  grid.gridRatio = 2;
  grid.mainColor = new Color3(0.16, 0.18, 0.22);
  grid.lineColor = new Color3(0.35, 0.4, 0.48);
  grid.opacity = 0.98;
  ground.material = grid;
  ground.checkCollisions = true;
  ground.metadata = { staticGeo: true };
}

function createMapBoxes(scene: Scene): void {
  const materials: Record<BoxDef["kind"], StandardMaterial> = {
    wall: new StandardMaterial("wallMat", scene),
    box: new StandardMaterial("boxMat", scene),
    platform: new StandardMaterial("rampMat", scene),
  };
  materials.wall.diffuseColor = new Color3(0.22, 0.25, 0.3);
  materials.wall.specularColor = new Color3(0.05, 0.05, 0.05);
  materials.box.diffuseColor = new Color3(0.75, 0.42, 0.2);
  materials.platform.diffuseColor = new Color3(0.35, 0.55, 0.4);

  MAP_BOXES.forEach((b, i) => {
    const mesh = MeshBuilder.CreateBox(
      `map_${b.kind}_${i}`,
      { width: b.w, height: b.h, depth: b.d },
      scene
    );
    mesh.position = new Vector3(b.x, b.y, b.z);
    mesh.material = materials[b.kind];
    mesh.checkCollisions = true;
    mesh.metadata = { staticGeo: true };
  });
}
