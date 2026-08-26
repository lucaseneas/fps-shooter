import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { ArcRotateCameraPointersInput } from "@babylonjs/core/Cameras/Inputs/arcRotateCameraPointersInput";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { Vector3, Color3, Color4, Vector4, Matrix } from "@babylonjs/core/Maths/math";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { GridMaterial } from "@babylonjs/materials/grid/gridMaterial";
import { PointerEventTypes } from "@babylonjs/core/Events/pointerEvents";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";

import {
  KIND_DEFAULT_HEX,
  MAX_MAP_PIECES,
  PIECE_PRESETS,
  aabbAfterYaw,
  applyPieceElev,
  borderBoxes,
  centerYFromElev,
  clampElev,
  clampMapAxis,
  cloneCustomMap,
  mapAxes,
  newPieceId,
  pieceElev,
  resolveBorderLook,
  resolveGroundLook,
  snapTo,
  stairToBoxes,
  textureUrlFor,
  yawTo45,
  type CustomMapDef,
  type EditorPiece,
  type EditorPieceKind,
  type MapTextureId,
} from "../../shared/customMap";
import { spawnFeetY, type SpawnPoint } from "../../shared/mapData";

export type EditorTool =
  | "select"
  | "wall"
  | "box"
  | "pillar"
  | "platform"
  | "stair"
  | "spawn"
  | "spawnAlpha"
  | "spawnEcho";

export type SpawnListId = "ffa" | "alpha" | "echo";

export type EditorSelection =
  | { type: "piece"; id: string }
  | { type: "spawn"; list: SpawnListId; index: number }
  | { type: "ground" }
  | { type: "border" }
  | null;

const SPAWN_MARKER_H = 1.2;

function spawnMarkerY(s: Pick<SpawnPoint, "y">): number {
  return spawnFeetY(s) + SPAWN_MARKER_H / 2;
}

const KIND_COLOR: Record<
  EditorPieceKind | "border" | "spawn" | "spawnAlpha" | "spawnEcho",
  Color3
> = {
  wall: new Color3(0.32, 0.38, 0.46),
  box: new Color3(0.69, 0.42, 0.21),
  pillar: new Color3(0.62, 0.64, 0.7),
  platform: new Color3(0.35, 0.55, 0.4),
  stair: new Color3(0.62, 0.58, 0.5),
  border: new Color3(0.22, 0.24, 0.28),
  spawn: new Color3(0.25, 0.85, 0.42),
  spawnAlpha: new Color3(0.3, 0.55, 1),
  spawnEcho: new Color3(0.88, 0.33, 0.27),
};

function isSpawnTool(tool: EditorTool): tool is "spawn" | "spawnAlpha" | "spawnEcho" {
  return tool === "spawn" || tool === "spawnAlpha" || tool === "spawnEcho";
}

function toolToSpawnList(tool: "spawn" | "spawnAlpha" | "spawnEcho"): SpawnListId {
  if (tool === "spawnAlpha") return "alpha";
  if (tool === "spawnEcho") return "echo";
  return "ffa";
}

function hexToColor3(hex: string): Color3 {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return new Color3(1, 1, 1);
  const v = parseInt(m[1], 16);
  return new Color3(
    ((v >> 16) & 255) / 255,
    ((v >> 8) & 255) / 255,
    (v & 255) / 255
  );
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

/**
 * Editor top-down 3D: clica para colocar peças, arrasta para mover,
 * R gira, Delete apaga, Ctrl+Z desfaz.
 */
export class MapEditor {
  private readonly engine: Engine;
  private readonly scene: Scene;
  private readonly camera: ArcRotateCamera;

  private def: CustomMapDef | null = null;
  private tool: EditorTool = "select";
  private selection: EditorSelection = null;
  private brush: { w: number; h: number; d: number; elev: number } = {
    ...PIECE_PRESETS.wall,
    elev: 0,
  };
  private brushColor: string | undefined;
  private brushTexture: MapTextureId = "default";
  private readonly textures = new Map<string, Texture>();
  private grid = 1;
  private running = false;
  private dragging = false;
  private dragMoved = false;
  private dragOffset = { x: 0, z: 0 };
  private history: string[] = [];
  private historyIndex = -1;
  private pieceMeshes = new Map<string, Mesh[]>();
  private spawnMeshes: Mesh[] = [];
  private ghost: Mesh | null = null;
  private selectBox: Mesh | null = null;
  private ground: Mesh | null = null;
  private gridOverlay: Mesh | null = null;
  private borderMeshes: Mesh[] = [];
  private readonly mats = new Map<string, StandardMaterial>();

  onChange: (() => void) | null = null;
  onSelect: ((sel: EditorSelection) => void) | null = null;
  onGizmoMove: ((pos: { x: number; y: number } | null) => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas, true, { antialias: true });
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.08, 0.1, 0.14, 1);
    this.scene.pointerMovePredicate = () => true;

    this.camera = new ArcRotateCamera(
      "mapCam",
      -Math.PI / 2,
      0.22,
      70,
      Vector3.Zero(),
      this.scene
    );
    this.camera.lowerBetaLimit = 0.05;
    this.camera.upperBetaLimit = Math.PI / 2.4;
    this.camera.lowerRadiusLimit = 10;
    this.camera.upperRadiusLimit = 400;
    this.camera.panningSensibility = 80;
    this.camera.wheelPrecision = 4;
    this.camera.fov = 0.7;
    this.camera.attachControl(canvas, true);
    const pointers = this.camera.inputs.attached.pointers;
    if (pointers instanceof ArcRotateCameraPointersInput) {
      pointers.buttons = [1, 2];
    }

    const hemi = new HemisphericLight("he", new Vector3(0, 1, 0), this.scene);
    hemi.intensity = 0.85;
    const sun = new DirectionalLight("sun", new Vector3(-0.4, -1, -0.3), this.scene);
    sun.intensity = 0.7;

    this.scene.onPointerObservable.add((info) => {
      if (!this.running || !this.def) return;
      if (info.type === PointerEventTypes.POINTERMOVE) this.onPointerMove();
      if (info.type === PointerEventTypes.POINTERDOWN && info.event.button === 0) {
        this.onPointerDown();
      }
      if (info.type === PointerEventTypes.POINTERUP && info.event.button === 0) {
        if (this.dragging && this.dragMoved) this.markDirty();
        this.dragging = false;
        this.dragMoved = false;
      }
    });

    this.onKey = this.onKey.bind(this);
  }

  get current(): CustomMapDef | null {
    return this.def ? cloneCustomMap(this.def) : null;
  }

  get selected(): EditorSelection {
    return this.selection;
  }

  get currentTool(): EditorTool {
    return this.tool;
  }

  get brushSize(): { w: number; h: number; d: number; elev: number } {
    return { ...this.brush };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    window.addEventListener("keydown", this.onKey);
    this.engine.runRenderLoop(() => {
      this.scene.render();
      this.syncGizmo();
    });
  }

  stop(): void {
    this.running = false;
    window.removeEventListener("keydown", this.onKey);
    this.engine.stopRenderLoop();
    this.onGizmoMove?.(null);
  }

  dispose(): void {
    this.stop();
    this.engine.dispose();
  }

  resize(): void {
    this.engine.resize();
  }

  load(def: CustomMapDef): void {
    this.def = cloneCustomMap(def);
    this.selection = null;
    this.history = [JSON.stringify(this.def)];
    this.historyIndex = 0;
    this.rebuildWorld();
    this.fitCamera();
    requestAnimationFrame(() => {
      this.engine.resize();
      this.fitCamera();
    });
    this.emitSelect();
    this.emitChange();
  }

  setTool(tool: EditorTool): void {
    this.tool = tool;
    if (tool !== "select") this.selection = null;
    if (tool !== "select" && !isSpawnTool(tool)) {
      const p = PIECE_PRESETS[tool];
      this.brush = { w: p.w, h: p.h, d: p.d, elev: this.brush.elev };
    }
    this.emitSelect();
    this.updateGhost();
  }

  setBrush(w: number, h: number, d: number, elev: number = this.brush.elev): void {
    this.brush = {
      w: Math.max(0.4, w),
      h: Math.max(0.2, h),
      d: Math.max(0.4, d),
      elev: clampElev(elev),
    };
    const piece = this.selectedPiece();
    if (piece) {
      piece.w = this.brush.w;
      piece.h = this.brush.h;
      piece.d = this.brush.d;
      applyPieceElev(piece, this.brush.elev);
      this.rebuildPieces();
      this.emitChange();
    } else if (this.selection?.type === "spawn") {
      const s = this.spawnArray(this.selection.list)[this.selection.index];
      if (s) {
        s.y = this.brush.elev;
        this.clampSpawn(s);
        this.rebuildSpawns();
        this.updateSelectBox();
        this.emitChange();
      }
    }
    this.updateGhost();
  }

  setAppearance(color: string, texture: MapTextureId): void {
    if (!this.def) return;
    if (this.selection?.type === "ground") {
      this.def.groundColor = color;
      this.def.groundTexture = texture;
      this.rebuildGround();
      this.emitChange();
      return;
    }
    if (this.selection?.type === "border") {
      this.def.borderColor = color;
      this.def.borderTexture = texture;
      this.rebuildBorders();
      this.emitChange();
      return;
    }
    this.brushColor = color;
    this.brushTexture = texture;
    const piece = this.selectedPiece();
    if (!piece) return;
    piece.color = color;
    piece.texture = texture;
    this.rebuildPieces();
    this.emitChange();
  }

  selectSurface(type: "ground" | "border"): void {
    const wasBorder = this.selection?.type === "border";
    this.tool = "select";
    this.selection = { type };
    this.emitSelect();
    this.updateSelectBox();
    this.updateGhost();
    if (wasBorder || type === "border") this.rebuildBorders();
  }

  commit(): void {
    this.markDirty();
  }

  setName(name: string): void {
    if (!this.def) return;
    this.def.name = name.trim().slice(0, 32) || this.def.name;
  }

  setMapSize(sizeX: number, sizeZ: number): void {
    if (!this.def) return;
    const nextX = clampMapAxis(sizeX);
    const nextZ = clampMapAxis(sizeZ);
    const { sizeX: curX, sizeZ: curZ } = mapAxes(this.def);
    if (nextX === curX && nextZ === curZ) return;
    this.def.sizeX = nextX;
    this.def.sizeZ = nextZ;
    this.def.size = Math.max(nextX, nextZ);
    for (const p of this.def.pieces) this.clampPiece(p);
    for (const s of this.def.spawns) this.clampSpawn(s);
    for (const s of this.def.spawnsAlpha ?? []) this.clampSpawn(s);
    for (const s of this.def.spawnsEcho ?? []) this.clampSpawn(s);
    this.rebuildWorld();
    this.fitCamera();
    this.markDirty();
  }

  setSelectedPosition(x: number, z: number): void {
    if (!this.def) return;
    if (this.selection?.type === "piece") {
      const p = this.selectedPiece();
      if (!p) return;
      p.x = snapTo(x, this.grid);
      p.z = snapTo(z, this.grid);
      this.clampPiece(p);
      this.rebuildPieces();
      this.markDirty();
    } else if (this.selection?.type === "spawn") {
      const s = this.spawnArray(this.selection.list)[this.selection.index];
      if (!s) return;
      s.x = snapTo(x, this.grid);
      s.z = snapTo(z, this.grid);
      this.clampSpawn(s);
      this.rebuildSpawns();
      this.markDirty();
    }
    this.updateSelectBox();
  }

  rotateSelected(): void {
    const p = this.selectedPiece();
    if (!p) return;
    p.yawDeg = yawTo45(p.yawDeg - 45);
    this.rebuildPieces();
    this.markDirty();
    this.updateSelectBox();
  }

  duplicateSelected(): void {
    if (!this.def) return;
    const src = this.selectedPiece();
    if (!src) return;
    if (this.def.pieces.length >= MAX_MAP_PIECES) return;
    const copy: EditorPiece = {
      id: newPieceId(),
      kind: src.kind,
      x: snapTo(src.x + 2, this.grid),
      y: src.y,
      z: src.z,
      w: src.w,
      h: src.h,
      d: src.d,
      elev: src.elev,
      yawDeg: src.yawDeg,
      color: src.color,
      texture: src.texture,
    };
    this.clampPiece(copy);
    if (copy.x === src.x && copy.z === src.z) {
      copy.z = snapTo(src.z + 2, this.grid);
      this.clampPiece(copy);
    }
    this.def.pieces.push(copy);
    this.spawnPieceMeshes(copy);
    this.selection = { type: "piece", id: copy.id };
    this.markDirty();
    this.emitSelect();
    this.updateSelectBox();
  }

  deleteSelected(): void {
    if (!this.def || !this.selection) return;
    const sel = this.selection;
    if (sel.type === "piece") {
      this.def.pieces = this.def.pieces.filter((p) => p.id !== sel.id);
    } else if (sel.type === "spawn") {
      const list = this.spawnArray(sel.list);
      if (sel.list === "ffa" && list.length <= 1) return;
      list.splice(sel.index, 1);
    } else {
      return;
    }
    this.selection = null;
    this.rebuildPieces();
    this.rebuildSpawns();
    this.markDirty();
    this.emitSelect();
    this.updateSelectBox();
  }

  undo(): void {
    if (this.historyIndex <= 0) return;
    this.historyIndex -= 1;
    this.applyHistory();
  }

  redo(): void {
    if (this.historyIndex >= this.history.length - 1) return;
    this.historyIndex += 1;
    this.applyHistory();
  }

  private applyHistory(): void {
    const raw = this.history[this.historyIndex];
    if (!raw) return;
    const parsed = JSON.parse(raw) as CustomMapDef;
    this.def = cloneCustomMap(parsed);
    this.selection = null;
    this.rebuildWorld();
    this.emitSelect();
    this.emitChange();
  }

  private markDirty(): void {
    if (!this.def) return;
    this.def.updatedAt = Date.now();
    const snap = JSON.stringify(this.def);
    this.history = this.history.slice(0, this.historyIndex + 1);
    this.history.push(snap);
    if (this.history.length > 60) this.history.shift();
    this.historyIndex = this.history.length - 1;
    this.emitChange();
  }

  private spawnArray(list: SpawnListId): SpawnPoint[] {
    if (!this.def) return [];
    if (list === "alpha") {
      if (!this.def.spawnsAlpha) this.def.spawnsAlpha = [];
      return this.def.spawnsAlpha;
    }
    if (list === "echo") {
      if (!this.def.spawnsEcho) this.def.spawnsEcho = [];
      return this.def.spawnsEcho;
    }
    return this.def.spawns;
  }

  private spawnColorKey(list: SpawnListId): "spawn" | "spawnAlpha" | "spawnEcho" {
    if (list === "alpha") return "spawnAlpha";
    if (list === "echo") return "spawnEcho";
    return "spawn";
  }

  private selectedPiece(): EditorPiece | null {
    const sel = this.selection;
    if (!this.def || sel?.type !== "piece") return null;
    return this.def.pieces.find((p) => p.id === sel.id) ?? null;
  }

  private fitCamera(): void {
    const { sizeX, sizeZ } = this.def ? mapAxes(this.def) : { sizeX: 80, sizeZ: 80 };
    this.camera.alpha = -Math.PI / 2;
    this.camera.beta = 0.18;
    this.camera.setTarget(new Vector3(0, 0, 0));
    const fov = this.camera.fov;
    const height = Math.max(1, this.engine.getRenderHeight());
    const width = Math.max(1, this.engine.getRenderWidth());
    const aspect = width / height;
    const pad = 1.12;
    const radiusV = ((sizeZ / 2) * pad) / Math.tan(fov / 2);
    const radiusH = ((sizeX / 2) * pad) / (Math.tan(fov / 2) * aspect);
    this.camera.radius = Math.max(radiusV, radiusH);
    const span = Math.max(sizeX, sizeZ);
    this.camera.lowerRadiusLimit = span * 0.2;
    this.camera.upperRadiusLimit = span * 4;
  }

  private rebuildWorld(): void {
    this.clearMeshes();
    if (!this.def) return;
    this.buildGround();
    this.buildBorders();
    this.rebuildPieces();
    this.rebuildSpawns();
    this.updateSelectBox();
    this.updateGhost();
  }

  private clearMeshes(): void {
    for (const list of this.pieceMeshes.values()) {
      for (const m of list) m.dispose();
    }
    this.pieceMeshes.clear();
    for (const m of this.spawnMeshes) m.dispose();
    this.spawnMeshes = [];
    this.ground?.dispose();
    this.ground = null;
    this.gridOverlay?.dispose();
    this.gridOverlay = null;
    for (const m of this.borderMeshes) m.dispose();
    this.borderMeshes = [];
    this.ghost?.dispose();
    this.ghost = null;
    this.selectBox?.dispose();
    this.selectBox = null;
    const leftovers = this.scene.meshes.filter((m) => m.name.startsWith("ed_"));
    for (const m of leftovers) m.dispose();
  }

  private mat(key: string, color: Color3, alpha = 1, texUrl: string | null = null): StandardMaterial {
    const cacheKey = `${key}:${texUrl ?? ""}:${alpha}`;
    const cached = this.mats.get(cacheKey);
    if (cached) return cached;
    const mat = new StandardMaterial(`edmat_${cacheKey}`, this.scene);
    mat.diffuseColor = color;
    mat.specularColor = new Color3(0.04, 0.04, 0.04);
    mat.alpha = alpha;
    if (alpha < 1) mat.transparencyMode = StandardMaterial.MATERIAL_ALPHABLEND;
    if (texUrl) mat.diffuseTexture = this.getTex(texUrl);
    this.mats.set(cacheKey, mat);
    return mat;
  }

  private getTex(url: string): Texture {
    let t = this.textures.get(url);
    if (!t) {
      t = new Texture(url, this.scene);
      this.textures.set(url, t);
    }
    return t;
  }

  private getTexScaled(url: string, uScale: number, vScale: number): Texture {
    const key = `${url}@${uScale}x${vScale}`;
    let t = this.textures.get(key);
    if (!t) {
      t = new Texture(url, this.scene);
      t.wrapU = Texture.WRAP_ADDRESSMODE;
      t.wrapV = Texture.WRAP_ADDRESSMODE;
      t.uScale = uScale;
      t.vScale = vScale;
      this.textures.set(key, t);
    }
    return t;
  }

  private pieceMat(p: EditorPiece): StandardMaterial {
    const hex = p.color ?? KIND_DEFAULT_HEX[p.kind];
    const url = textureUrlFor(p.kind, p.texture);
    return this.mat(`piece:${p.kind}:${p.texture ?? "default"}:${hex}`, hexToColor3(hex), 1, url);
  }

  private rebuildGround(): void {
    this.ground?.dispose();
    this.ground = null;
    this.gridOverlay?.dispose();
    this.gridOverlay = null;
    this.buildGround();
  }

  private rebuildBorders(): void {
    for (const m of this.borderMeshes) m.dispose();
    this.borderMeshes = [];
    this.buildBorders();
  }

  private buildGround(): void {
    if (!this.def) return;
    const { sizeX, sizeZ } = mapAxes(this.def);
    const look = resolveGroundLook(this.def);
    const ground = MeshBuilder.CreateGround(
      "ed_ground",
      { width: sizeX, height: sizeZ },
      this.scene
    );
    const url = textureUrlFor("ground", look.texture);
    const mat = new StandardMaterial("ed_ground_mat", this.scene);
    mat.diffuseColor = hexToColor3(look.color);
    mat.specularColor = new Color3(0.03, 0.03, 0.03);
    if (url) {
      mat.diffuseTexture = this.getTexScaled(url, sizeX / 4, sizeZ / 4);
    }
    ground.material = mat;
    ground.isPickable = true;
    ground.metadata = { editor: "ground" };
    this.ground = ground;

    const gridMesh = MeshBuilder.CreateGround(
      "ed_grid",
      { width: sizeX, height: sizeZ },
      this.scene
    );
    gridMesh.position.y = 0.02;
    const grid = new GridMaterial("ed_grid_mat", this.scene);
    grid.majorUnitFrequency = 5;
    grid.minorUnitVisibility = 0.35;
    grid.gridRatio = 1;
    grid.mainColor = new Color3(0.16, 0.18, 0.22);
    grid.lineColor = new Color3(0.42, 0.48, 0.55);
    grid.opacity = 0.22;
    gridMesh.material = grid;
    gridMesh.isPickable = false;
    gridMesh.metadata = { editor: "grid" };
    this.gridOverlay = gridMesh;
  }

  private buildBorders(): void {
    if (!this.def) return;
    const { sizeX, sizeZ } = mapAxes(this.def);
    const look = resolveBorderLook(this.def);
    const url = textureUrlFor("border", look.texture);
    const selected = this.selection?.type === "border";
    const tileScale = 4;
    for (const b of borderBoxes(sizeX, sizeZ)) {
      const wUV = b.w / tileScale;
      const hUV = b.h / tileScale;
      const dUV = b.d / tileScale;
      const faceUV = [
        new Vector4(0, 0, wUV, hUV),
        new Vector4(0, 0, wUV, hUV),
        new Vector4(0, 0, dUV, hUV),
        new Vector4(0, 0, dUV, hUV),
        new Vector4(0, 0, wUV, dUV),
        new Vector4(0, 0, wUV, dUV),
      ];
      const mesh = MeshBuilder.CreateBox(
        "ed_border",
        { width: b.w, height: b.h, depth: b.d, faceUV, wrap: true },
        this.scene
      );
      mesh.position = new Vector3(b.x, b.y, b.z);
      const mat = this.mat(
        `border:${look.texture}:${look.color}:${selected ? "sel" : ""}`,
        hexToColor3(look.color),
        1,
        url
      );
      if (selected) mat.emissiveColor = new Color3(0.18, 0.1, 0.04);
      mesh.material = mat;
      mesh.isPickable = true;
      mesh.metadata = { editor: "border" };
      this.borderMeshes.push(mesh);
    }
  }

  private rebuildPieces(): void {
    for (const list of this.pieceMeshes.values()) {
      for (const m of list) m.dispose();
    }
    this.pieceMeshes.clear();
    if (!this.def) return;
    for (const p of this.def.pieces) this.spawnPieceMeshes(p);
    this.updateSelectBox();
  }

  private spawnPieceMeshes(p: EditorPiece): void {
    const boxes =
      p.kind === "stair"
        ? stairToBoxes(p)
        : [
            {
              x: p.x,
              y: p.y,
              z: p.z,
              w: p.w,
              h: p.h,
              d: p.d,
              yaw: p.yawDeg,
            },
          ];
    const meshes: Mesh[] = [];
    for (const b of boxes) {
      const mesh = MeshBuilder.CreateBox(
        `ed_piece_${p.id}`,
        { width: b.w, height: b.h, depth: b.d },
        this.scene
      );
      mesh.position = new Vector3(b.x, b.y, b.z);
      mesh.rotation.y = (((b.yaw ?? 0) * Math.PI) / 180);
      mesh.material = this.pieceMat(p);
      mesh.isPickable = true;
      mesh.metadata = { editor: "piece", id: p.id };
      meshes.push(mesh);
    }
    this.pieceMeshes.set(p.id, meshes);
  }

  private rebuildSpawns(): void {
    for (const m of this.spawnMeshes) m.dispose();
    this.spawnMeshes = [];
    if (!this.def) return;
    this.def.spawns.forEach((s, i) => this.addSpawnMesh(s, "ffa", i));
    (this.def.spawnsAlpha ?? []).forEach((s, i) => this.addSpawnMesh(s, "alpha", i));
    (this.def.spawnsEcho ?? []).forEach((s, i) => this.addSpawnMesh(s, "echo", i));
  }

  private addSpawnMesh(s: SpawnPoint, list: SpawnListId, i: number): void {
    const key = this.spawnColorKey(list);
    const mesh = MeshBuilder.CreateCylinder(
      `ed_spawn_${list}_${i}`,
      { height: SPAWN_MARKER_H, diameter: 1.1, tessellation: 10 },
      this.scene
    );
    mesh.position = new Vector3(s.x, spawnMarkerY(s), s.z);
    mesh.material = this.mat(key, KIND_COLOR[key]);
    mesh.isPickable = true;
    mesh.metadata = { editor: "spawn", list, index: i };
    this.spawnMeshes.push(mesh);
  }

  private groundHit(): Vector3 | null {
    const pick = this.scene.pick(
      this.scene.pointerX,
      this.scene.pointerY,
      (m) => m === this.ground
    );
    if (pick?.hit && pick.pickedPoint) return pick.pickedPoint;
    const ray = this.scene.createPickingRay(
      this.scene.pointerX,
      this.scene.pointerY,
      null,
      this.camera
    );
    if (Math.abs(ray.direction.y) < 1e-6) return null;
    const t = -ray.origin.y / ray.direction.y;
    if (t < 0) return null;
    return ray.origin.add(ray.direction.scale(t));
  }

  private pickEditor(): AbstractMesh | null {
    const pick = this.scene.pick(
      this.scene.pointerX,
      this.scene.pointerY,
      (m) => {
        const meta = m.metadata as { editor?: string } | null;
        return meta?.editor === "piece" || meta?.editor === "spawn";
      }
    );
    if (pick?.hit && pick.pickedMesh) return pick.pickedMesh;
    const surface = this.scene.pick(
      this.scene.pointerX,
      this.scene.pointerY,
      (m) => {
        const meta = m.metadata as { editor?: string } | null;
        return meta?.editor === "border" || meta?.editor === "ground";
      }
    );
    return surface?.hit ? surface.pickedMesh : null;
  }

  private onPointerDown(): void {
    if (!this.def) return;
    const picked = this.pickEditor();
    if (this.tool === "select") {
      if (!picked) {
        this.selection = null;
        this.emitSelect();
        this.updateSelectBox();
        this.rebuildBorders();
        return;
      }
      const meta = picked.metadata as {
        editor?: string;
        id?: string;
        index?: number;
        list?: SpawnListId;
      };
      const wasBorder = this.selection?.type === "border";
      if (meta.editor === "piece" && meta.id) {
        this.selection = { type: "piece", id: meta.id };
        const p = this.selectedPiece();
        const hit = this.groundHit();
        if (p && hit) {
          this.dragging = true;
          this.dragMoved = false;
          this.dragOffset = { x: p.x - hit.x, z: p.z - hit.z };
        }
      } else if (meta.editor === "spawn" && typeof meta.index === "number") {
        const list: SpawnListId = meta.list ?? "ffa";
        this.selection = { type: "spawn", list, index: meta.index };
        const s = this.spawnArray(list)[meta.index];
        const hit = this.groundHit();
        if (s && hit) {
          this.dragging = true;
          this.dragMoved = false;
          this.dragOffset = { x: s.x - hit.x, z: s.z - hit.z };
        }
      } else if (meta.editor === "ground") {
        this.selection = { type: "ground" };
      } else if (meta.editor === "border") {
        this.selection = { type: "border" };
      }
      this.emitSelect();
      this.updateSelectBox();
      if (wasBorder || this.selection?.type === "border") this.rebuildBorders();
      return;
    }

    const hit = this.groundHit();
    if (!hit) return;
    const x = snapTo(hit.x, this.grid);
    const z = snapTo(hit.z, this.grid);
    if (isSpawnTool(this.tool)) {
      const list = toolToSpawnList(this.tool);
      const arr = this.spawnArray(list);
      if (arr.length >= 24) return;
      arr.push({ x, z, y: clampElev(this.brush.elev) });
      this.clampSpawn(arr[arr.length - 1]);
      this.rebuildSpawns();
      this.markDirty();
      return;
    }
    this.placePiece(this.tool, x, z);
  }

  private onPointerMove(): void {
    if (this.dragging && this.def && this.tool === "select") {
      const hit = this.groundHit();
      if (!hit) return;
      const x = snapTo(hit.x + this.dragOffset.x, this.grid);
      const z = snapTo(hit.z + this.dragOffset.z, this.grid);
      if (this.selection?.type === "piece") {
        const p = this.selectedPiece();
        if (p) {
          p.x = x;
          p.z = z;
          this.clampPiece(p);
          this.dragMoved = true;
          this.rebuildPieces();
        }
      } else if (this.selection?.type === "spawn") {
        const s = this.spawnArray(this.selection.list)[this.selection.index];
        if (s) {
          s.x = x;
          s.z = z;
          this.clampSpawn(s);
          this.dragMoved = true;
          this.rebuildSpawns();
        }
      }
      this.updateSelectBox();
      return;
    }
    this.updateGhost();
  }

  private placePiece(kind: EditorPieceKind, x: number, z: number): void {
    if (!this.def) return;
    if (this.def.pieces.length >= MAX_MAP_PIECES) return;
    const preset = PIECE_PRESETS[kind];
    const piece: EditorPiece = {
      id: newPieceId(),
      kind,
      x,
      y: centerYFromElev(this.brush.h || preset.h, this.brush.elev),
      z,
      w: this.brush.w || preset.w,
      h: this.brush.h || preset.h,
      d: this.brush.d || preset.d,
      elev: this.brush.elev,
      yawDeg: 0,
      color: this.brushColor,
      texture: this.brushTexture,
    };
    this.clampPiece(piece);
    this.def.pieces.push(piece);
    this.spawnPieceMeshes(piece);
    this.selection = { type: "piece", id: piece.id };
    this.markDirty();
    this.emitSelect();
    this.updateSelectBox();
  }

  private clampPiece(p: EditorPiece): void {
    if (!this.def) return;
    const { sizeX, sizeZ } = mapAxes(this.def);
    const dim = aabbAfterYaw(p.w, p.d, p.yawDeg);
    const limitX = Math.max(0, sizeX / 2 - dim.w / 2 - 1);
    const limitZ = Math.max(0, sizeZ / 2 - dim.d / 2 - 1);
    p.x = Math.max(-limitX, Math.min(limitX, p.x));
    p.z = Math.max(-limitZ, Math.min(limitZ, p.z));
  }

  private clampSpawn(s: SpawnPoint): void {
    if (!this.def) return;
    const { sizeX, sizeZ } = mapAxes(this.def);
    const boundX = Math.max(0, sizeX / 2 - 3);
    const boundZ = Math.max(0, sizeZ / 2 - 3);
    s.x = Math.max(-boundX, Math.min(boundX, s.x));
    s.z = Math.max(-boundZ, Math.min(boundZ, s.z));
    const y = clampElev(s.y ?? 0);
    if (y > 0) s.y = y;
    else delete s.y;
  }

  private updateGhost(): void {
    this.ghost?.dispose();
    this.ghost = null;
    if (!this.def || this.tool === "select" || this.dragging) return;
    const hit = this.groundHit();
    if (!hit) return;
    const x = snapTo(hit.x, this.grid);
    const z = snapTo(hit.z, this.grid);
    if (isSpawnTool(this.tool)) {
      const key = this.spawnColorKey(toolToSpawnList(this.tool));
      const mesh = MeshBuilder.CreateCylinder(
        "ed_ghost",
        { height: SPAWN_MARKER_H, diameter: 1.1, tessellation: 10 },
        this.scene
      );
      mesh.position = new Vector3(x, spawnMarkerY({ y: this.brush.elev }), z);
      mesh.material = this.mat(`ghost_${key}`, KIND_COLOR[key], 0.4);
      mesh.isPickable = false;
      this.ghost = mesh;
      return;
    }
    const mesh = MeshBuilder.CreateBox(
      "ed_ghost",
      { width: this.brush.w, height: this.brush.h, depth: this.brush.d },
      this.scene
    );
    mesh.position = new Vector3(x, centerYFromElev(this.brush.h, this.brush.elev), z);
    mesh.material = this.mat(`ghost_${this.tool}`, KIND_COLOR[this.tool], 0.35);
    mesh.isPickable = false;
    this.ghost = mesh;
  }

  private updateSelectBox(): void {
    this.selectBox?.dispose();
    this.selectBox = null;
    if (!this.def || !this.selection) return;
    let x = 0;
    let y = 0.6;
    let z = 0;
    let w = 1.2;
    let h = 1.4;
    let d = 1.2;
    let yaw = 0;
    if (this.selection.type === "piece") {
      const p = this.selectedPiece();
      if (!p) return;
      x = p.x;
      y = p.y;
      z = p.z;
      w = p.w + 0.12;
      h = p.h + 0.12;
      d = p.d + 0.12;
      yaw = p.yawDeg;
      if (p.kind === "stair") {
        y = centerYFromElev(p.h, pieceElev(p));
      }
    } else if (this.selection.type === "spawn") {
      const s = this.spawnArray(this.selection.list)[this.selection.index];
      if (!s) return;
      x = s.x;
      z = s.z;
      y = spawnMarkerY(s);
    } else if (this.selection.type === "ground") {
      const { sizeX, sizeZ } = mapAxes(this.def);
      y = 0.04;
      h = 0.08;
      w = sizeX;
      d = sizeZ;
    } else if (this.selection.type === "border") {
      const { sizeX, sizeZ } = mapAxes(this.def);
      y = 3;
      h = 6.2;
      w = sizeX + 1.2;
      d = sizeZ + 1.2;
    } else {
      return;
    }
    const box = MeshBuilder.CreateBox("ed_select", { width: w, height: h, depth: d }, this.scene);
    box.position = new Vector3(x, y, z);
    box.rotation.y = (yaw * Math.PI) / 180;
    const mat = this.mat("select", new Color3(1, 0.62, 0.18), 0.22);
    mat.wireframe = true;
    box.material = mat;
    box.isPickable = false;
    this.selectBox = box;
  }

  private onKey(ev: KeyboardEvent): void {
    if (!this.running) return;
    if (isTypingTarget(ev.target)) return;
    if (ev.ctrlKey && ev.key.toLowerCase() === "z") {
      ev.preventDefault();
      if (ev.shiftKey) this.redo();
      else this.undo();
      return;
    }
    if (ev.ctrlKey && ev.key.toLowerCase() === "y") {
      ev.preventDefault();
      this.redo();
      return;
    }
    if (ev.key === "Delete" || ev.key === "Backspace") {
      ev.preventDefault();
      this.deleteSelected();
      return;
    }
    if (ev.key.toLowerCase() === "r") {
      ev.preventDefault();
      this.rotateSelected();
    }
  }

  private emitChange(): void {
    this.onChange?.();
  }

  private emitSelect(): void {
    const p = this.selectedPiece();
    if (p) {
      this.brush = { w: p.w, h: p.h, d: p.d, elev: pieceElev(p) };
      this.brushColor = p.color;
      this.brushTexture = p.texture ?? "default";
    } else if (this.selection?.type === "spawn") {
      const s = this.spawnArray(this.selection.list)[this.selection.index];
      if (s) this.brush.elev = spawnFeetY(s);
    }
    this.onSelect?.(this.selection);
  }

  private projectToView(world: Vector3): { x: number; y: number } | null {
    const rw = this.engine.getRenderWidth();
    const rh = this.engine.getRenderHeight();
    if (rw < 1 || rh < 1) return null;
    const canvas = this.engine.getRenderingCanvas();
    const rect = canvas?.getBoundingClientRect();
    const projected = Vector3.Project(
      world,
      Matrix.Identity(),
      this.scene.getTransformMatrix(),
      this.camera.viewport.toGlobal(rw, rh)
    );
    if (projected.z < 0 || projected.z > 1) return null;
    const sx = rect ? rect.width / rw : 1;
    const sy = rect ? rect.height / rh : 1;
    const x = projected.x * sx;
    const y = projected.y * sy;
    const vw = rect?.width ?? rw;
    const vh = rect?.height ?? rh;
    if (x < -48 || y < -48 || x > vw + 48 || y > vh + 48) return null;
    return { x, y };
  }

  private syncGizmo(): void {
    const p = this.selectedPiece();
    if (!p) {
      this.onGizmoMove?.(null);
      return;
    }
    const world = new Vector3(p.x, p.y + p.h / 2 + 0.55, p.z);
    this.onGizmoMove?.(this.projectToView(world));
  }
}

