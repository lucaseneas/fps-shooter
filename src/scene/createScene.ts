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

import { MAP_BOXES, MAP_SIZE, type BoxDef } from "../../shared/mapData";
import { textureUrlFor } from "../../shared/customMap";

/**
 * Constrói a cena a partir de `shared/mapData` — a MESMA geometria que o
 * servidor usa para colisão e linha de visão dos bots.
 */
export function createScene(engine: Engine): Scene {
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.53, 0.68, 0.82, 1.0); // céu azulado
  scene.ambientColor = new Color3(0.3, 0.3, 0.35);

  scene.fogMode = Scene.FOGMODE_LINEAR;
  scene.fogColor = new Color3(0.53, 0.68, 0.82);
  scene.fogStart = 60;
  scene.fogEnd = 170;

  scene.collisionsEnabled = true;
  scene.gravity = new Vector3(0, -0.9, 0);

  setupLights(scene);
  applyBoxMap(scene, MAP_BOXES, MAP_SIZE);

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

function tagMap(obj: { metadata: unknown }): void {
  obj.metadata = { ...(obj.metadata as object | null), staticGeo: true, mapWorld: true };
}

function disposeMapWorld(scene: Scene): void {
  for (const mesh of scene.meshes.slice()) {
    if ((mesh.metadata as { mapWorld?: boolean } | null)?.mapWorld) {
      mesh.dispose();
    }
  }
  for (const mat of scene.materials.slice()) {
    if ((mat.metadata as { mapWorld?: boolean } | null)?.mapWorld) {
      mat.dispose(true, true);
    }
  }
}

/** Troca o chão e as caixas visíveis (mapa oficial ou custom). */
export function applyBoxMap(
  scene: Scene,
  boxes: readonly BoxDef[],
  mapSizeX: number,
  mapSizeZ: number = mapSizeX
): void {
  disposeMapWorld(scene);
  const fogSize = Math.max(mapSizeX, mapSizeZ);
  scene.fogStart = Math.max(20, fogSize * 0.75);
  scene.fogEnd = Math.max(60, fogSize * 2.1);
  createGround(scene, mapSizeX, mapSizeZ);
  createMapBoxes(scene, boxes);
}

function createGround(scene: Scene, mapSizeX: number, mapSizeZ: number): void {
  const ground = MeshBuilder.CreateGround(
    "ground",
    { width: mapSizeX, height: mapSizeZ },
    scene
  );
  const mat = new StandardMaterial("groundMat", scene);
  const floorTex = new Texture("/assets/textures/map/floor.png", scene);
  floorTex.uScale = mapSizeX / 4;
  floorTex.vScale = mapSizeZ / 4;
  mat.diffuseTexture = floorTex;
  mat.specularColor = new Color3(0.02, 0.02, 0.02);
  mat.freeze();
  tagMap(mat);
  ground.material = mat;
  ground.checkCollisions = false;
  tagMap(ground);
  ground.freezeWorldMatrix();
}

function hexToColor3(hex: string): Color3 | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const v = parseInt(m[1], 16);
  return new Color3(
    ((v >> 16) & 255) / 255,
    ((v >> 8) & 255) / 255,
    (v & 255) / 255
  );
}

function lookKey(b: BoxDef): string {
  return `${b.kind}|${b.texture ?? ""}|${b.color ?? ""}`;
}

function kindDefaultColor(kind: BoxDef["kind"]): Color3 {
  if (kind === "building") return new Color3(0.55, 0.48, 0.42);
  if (kind === "platform") return new Color3(0.35, 0.55, 0.4);
  if (kind === "pillar") return new Color3(0.6, 0.62, 0.68);
  return new Color3(1, 1, 1);
}

/**
 * Uma caixa por peça, depois MergeMeshes por aparência (kind + textura + cor).
 * Colisão do jogador usa as AABBs no sim compartilhado, não checkCollisions.
 */
function createMapBoxes(scene: Scene, boxes: readonly BoxDef[]): void {
  const textures = new Map<string, Texture>();
  const getTex = (url: string): Texture => {
    let t = textures.get(url);
    if (!t) {
      t = new Texture(url, scene);
      textures.set(url, t);
    }
    return t;
  };

  const materials = new Map<string, StandardMaterial>();
  const byLook = new Map<string, Mesh[]>();

  boxes.forEach((b, i) => {
    const key = lookKey(b);
    let mat = materials.get(key);
    if (!mat) {
      mat = new StandardMaterial(`mapMat_${key}`, scene);
      const url = textureUrlFor(b.kind, b.texture);
      mat.diffuseTexture = url ? getTex(url) : null;
      mat.diffuseColor = b.color ? hexToColor3(b.color) ?? kindDefaultColor(b.kind) : kindDefaultColor(b.kind);
      mat.specularColor = new Color3(0.05, 0.05, 0.05);
      mat.freeze();
      tagMap(mat);
      materials.set(key, mat);
    }

    let wUV = 1,
      hUV = 1,
      dUV = 1;
    if (b.kind !== "box") {
      const tileScale = 4;
      wUV = b.w / tileScale;
      hUV = b.h / tileScale;
      dUV = b.d / tileScale;
    }

    const faceUV = [
      new Vector4(0, 0, wUV, hUV),
      new Vector4(0, 0, wUV, hUV),
      new Vector4(0, 0, dUV, hUV),
      new Vector4(0, 0, dUV, hUV),
      new Vector4(0, 0, wUV, dUV),
      new Vector4(0, 0, wUV, dUV),
    ];

    const mesh = MeshBuilder.CreateBox(
      `map_${b.kind}_${i}`,
      { width: b.w, height: b.h, depth: b.d, faceUV, wrap: true },
      scene
    );
    mesh.position = new Vector3(b.x, b.y, b.z);
    mesh.material = mat;
    mesh.checkCollisions = false;
    tagMap(mesh);
    mesh.computeWorldMatrix(true);
    const list = byLook.get(key) ?? [];
    list.push(mesh);
    byLook.set(key, list);
  });

  let g = 0;
  for (const [key, meshes] of byLook) {
    if (meshes.length === 0) continue;
    const mat = materials.get(key);
    if (meshes.length === 1) {
      const only = meshes[0];
      only.name = `map_${g++}`;
      only.freezeWorldMatrix();
      continue;
    }
    const merged = Mesh.MergeMeshes(meshes, true, true);
    if (!merged) continue;
    merged.name = `map_${g++}`;
    if (mat) merged.material = mat;
    tagMap(merged);
    merged.checkCollisions = false;
    merged.isPickable = true;
    merged.freezeWorldMatrix();
  }
}
