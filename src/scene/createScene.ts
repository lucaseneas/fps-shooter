import { Scene } from "@babylonjs/core/scene";
import { Engine } from "@babylonjs/core/Engines/engine";
import { Vector3, Color3, Color4, Vector4 } from "@babylonjs/core/Maths/math";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";

import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";

import "@babylonjs/core/Materials/standardMaterial";
import "@babylonjs/core/Collisions/collisionCoordinator";

import "@babylonjs/loaders/glTF";

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
  const floorTex = new Texture("/assets/textures/texture_floor.png", scene);
  floorTex.uScale = MAP_SIZE / 4;
  floorTex.vScale = MAP_SIZE / 4;
  mat.diffuseTexture = floorTex;
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
    border: new StandardMaterial("borderMat", scene),
    wall: new StandardMaterial("wallMat", scene),
    building: new StandardMaterial("buildingMat", scene),
    box: new StandardMaterial("boxMat", scene),
    platform: new StandardMaterial("rampMat", scene),
    pillar: new StandardMaterial("pillarMat", scene),
  };
  const wallTex = new Texture("/assets/textures/texture_wall.png", scene);
  const platformTex = new Texture("/assets/textures/texture_floor.png", scene);
  const bgWallTex = new Texture("/assets/textures/texture_bg_wall.png", scene);
  const postTex = new Texture("/assets/textures/texture_post.png", scene);
  const boxTex = new Texture("/assets/textures/texture_crate.png", scene);
  
  materials.border.diffuseTexture = bgWallTex;
  materials.wall.diffuseTexture = wallTex;
  materials.building.diffuseColor = new Color3(0.55, 0.48, 0.42);
  materials.box.diffuseTexture = boxTex;
  materials.platform.diffuseTexture = platformTex;
  materials.platform.diffuseColor = new Color3(0.35, 0.55, 0.4);
  materials.pillar.diffuseTexture = postTex;
  materials.pillar.diffuseColor = new Color3(0.6, 0.62, 0.68);

  for (const mat of Object.values(materials)) {
    mat.specularColor = new Color3(0.05, 0.05, 0.05);
    mat.freeze();
  }

  const byKind: Record<BoxDef["kind"], Mesh[]> = {
    border: [],
    wall: [],
    building: [],
    box: [],
    platform: [],
    pillar: [],
  };

  MAP_BOXES.forEach((b, i) => {
    let wUV = 1, hUV = 1, dUV = 1;
    if (b.kind !== "box") {
      const tileScale = 4;
      wUV = b.w / tileScale;
      hUV = b.h / tileScale;
      dUV = b.d / tileScale;
    }
    
    const faceUV = [
      new Vector4(0, 0, wUV, hUV), // back
      new Vector4(0, 0, wUV, hUV), // front
      new Vector4(0, 0, dUV, hUV), // right
      new Vector4(0, 0, dUV, hUV), // left
      new Vector4(0, 0, wUV, dUV), // top
      new Vector4(0, 0, wUV, dUV)  // bottom
    ];

    const mesh = MeshBuilder.CreateBox(
      `map_${b.kind}_${i}`,
      { width: b.w, height: b.h, depth: b.d, faceUV: faceUV, wrap: true },
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
