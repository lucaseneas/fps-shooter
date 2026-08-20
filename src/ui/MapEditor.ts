import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { ArcRotateCameraPointersInput } from "@babylonjs/core/Cameras/Inputs/arcRotateCameraPointersInput";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { Vector3, Color3, Color4 } from "@babylonjs/core/Maths/math";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { GridMaterial } from "@babylonjs/materials/grid/gridMaterial";
import { PointerEventTypes } from "@babylonjs/core/Events/pointerEvents";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";

import {
  PIECE_PRESETS,
  aabbAfterYaw,
  borderBoxes,
  cloneCustomMap,
  newPieceId,
  snapTo,
  stairToBoxes,
  yawTo90,
  type CustomMapDef,
  type EditorPiece,
  type EditorPieceKind,
} from "../../shared/customMap";
import type { SpawnPoint } from "../../shared/mapData";

export type EditorTool =
  | "select"
  | "wall"
  | "box"
  | "pillar"
  | "platform"
  | "stair"
  | "spawn";

export type EditorSelection =
  | { type: "piece"; id: string }
  | { type: "spawn"; index: number }
  | null;

const KIND_COLOR: Record<EditorPieceKind | "border" | "spawn", Color3> = {
  wall: new Color3(0.32, 0.38, 0.46),
  box: new Color3(0.69, 0.42, 0.21),
  pillar: new Color3(0.62, 0.64, 0.7),
  platform: new Color3(0.35, 0.55, 0.4),
  stair: new Color3(0.62, 0.58, 0.5),
  border: new Color3(0.22, 0.24, 0.28),
  spawn: new Color3(0.25, 0.85, 0.42),
};

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
  private brush: { w: number; h: number; d: number } = { ...PIECE_PRESETS.wall };
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
  private readonly mats = new Map<string, StandardMaterial>();

  onChange: (() => void) | null = null;
  onSelect: ((sel: EditorSelection) => void) | null = null;

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

  get brushSize(): { w: number; h: number; d: number } {
    return { ...this.brush };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    window.addEventListener("keydown", this.onKey);
    this.engine.runRenderLoop(() => this.scene.render());
  }

  stop(): void {
    this.running = false;
    window.removeEventListener("keydown", this.onKey);
    this.engine.stopRenderLoop();
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
    if (tool !== "select" && tool !== "spawn") {
      const p = PIECE_PRESETS[tool];
      this.brush = { w: p.w, h: p.h, d: p.d };
    }
    this.emitSelect();
    this.updateGhost();
  }

  setBrush(w: number, h: number, d: number): void {
    this.brush = {
      w: Math.max(0.4, w),
      h: Math.max(0.2, h),
      d: Math.max(0.4, d),
    };
    const piece = this.selectedPiece();
    if (piece) {
      piece.w = this.brush.w;
      piece.h = this.brush.h;
      piece.d = this.brush.d;
      piece.y = piece.kind === "stair" ? this.brush.h : this.brush.h / 2;
      this.rebuildPieces();
      this.emitChange();
    }
    this.updateGhost();
  }

  commit(): void {
    this.markDirty();
  }

  setName(name: string): void {
    if (!this.def) return;
    this.def.name = name.trim().slice(0, 32) || this.def.name;
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
      const s = this.def.spawns[this.selection.index];
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
    p.yawDeg = yawTo90(p.yawDeg + 90);
    this.rebuildPieces();
    this.markDirty();
    this.updateSelectBox();
  }

  deleteSelected(): void {
    if (!this.def || !this.selection) return;
    const sel = this.selection;
    if (sel.type === "piece") {
      this.def.pieces = this.def.pieces.filter((p) => p.id !== sel.id);
    } else if (this.def.spawns.length > 1) {
      this.def.spawns.splice(sel.index, 1);
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

  private selectedPiece(): EditorPiece | null {
    const sel = this.selection;
    if (!this.def || sel?.type !== "piece") return null;
    return this.def.pieces.find((p) => p.id === sel.id) ?? null;
  }

  private fitCamera(): void {
    const size = this.def?.size ?? 80;
    this.camera.alpha = -Math.PI / 2;
    this.camera.beta = 0.18;
    this.camera.setTarget(new Vector3(0, 0, 0));
    const fov = this.camera.fov;
    const height = Math.max(1, this.engine.getRenderHeight());
    const width = Math.max(1, this.engine.getRenderWidth());
    const aspect = width / height;
    const half = size / 2;
    const pad = 1.12;
    const radiusV = (half * pad) / Math.tan(fov / 2);
    const radiusH = (half * pad) / (Math.tan(fov / 2) * aspect);
    this.camera.radius = Math.max(radiusV, radiusH);
    this.camera.lowerRadiusLimit = size * 0.2;
    this.camera.upperRadiusLimit = size * 4;
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
    this.ghost?.dispose();
    this.ghost = null;
    this.selectBox?.dispose();
    this.selectBox = null;
    const leftovers = this.scene.meshes.filter((m) => m.name.startsWith("ed_"));
    for (const m of leftovers) m.dispose();
  }

  private mat(key: string, color: Color3, alpha = 1): StandardMaterial {
    const cached = this.mats.get(key);
    if (cached) return cached;
    const mat = new StandardMaterial(`edmat_${key}`, this.scene);
    mat.diffuseColor = color;
    mat.specularColor = new Color3(0.04, 0.04, 0.04);
    mat.alpha = alpha;
    if (alpha < 1) mat.transparencyMode = StandardMaterial.MATERIAL_ALPHABLEND;
    this.mats.set(key, mat);
    return mat;
  }

  private buildGround(): void {
    if (!this.def) return;
    const size = this.def.size;
    const ground = MeshBuilder.CreateGround("ed_ground", { width: size, height: size }, this.scene);
    const grid = new GridMaterial("ed_grid", this.scene);
    grid.majorUnitFrequency = 5;
    grid.minorUnitVisibility = 0.45;
    grid.gridRatio = 1;
    grid.mainColor = new Color3(0.16, 0.18, 0.22);
    grid.lineColor = new Color3(0.32, 0.36, 0.42);
    grid.opacity = 0.95;
    ground.material = grid;
    ground.isPickable = true;
    ground.metadata = { editor: "ground" };
    this.ground = ground;
  }

  private buildBorders(): void {
    if (!this.def) return;
    for (const b of borderBoxes(this.def.size)) {
      const mesh = MeshBuilder.CreateBox(
        "ed_border",
        { width: b.w, height: b.h, depth: b.d },
        this.scene
      );
      mesh.position = new Vector3(b.x, b.y, b.z);
      mesh.material = this.mat("border", KIND_COLOR.border);
      mesh.isPickable = false;
      mesh.metadata = { editor: "border" };
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
              ...aabbAfterYaw(p.w, p.d, p.yawDeg),
              h: p.h,
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
      mesh.material = this.mat(p.kind, KIND_COLOR[p.kind]);
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
    this.def.spawns.forEach((s, i) => {
      const mesh = MeshBuilder.CreateCylinder(
        `ed_spawn_${i}`,
        { height: 1.2, diameter: 1.1, tessellation: 10 },
        this.scene
      );
      mesh.position = new Vector3(s.x, 0.6, s.z);
      mesh.material = this.mat("spawn", KIND_COLOR.spawn);
      mesh.isPickable = true;
      mesh.metadata = { editor: "spawn", index: i };
      this.spawnMeshes.push(mesh);
    });
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
    return pick?.hit ? pick.pickedMesh : null;
  }

  private onPointerDown(): void {
    if (!this.def) return;
    const picked = this.pickEditor();
    if (this.tool === "select") {
      if (!picked) {
        this.selection = null;
        this.emitSelect();
        this.updateSelectBox();
        return;
      }
      const meta = picked.metadata as { editor?: string; id?: string; index?: number };
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
        this.selection = { type: "spawn", index: meta.index };
        const s = this.def.spawns[meta.index];
        const hit = this.groundHit();
        if (s && hit) {
          this.dragging = true;
          this.dragMoved = false;
          this.dragOffset = { x: s.x - hit.x, z: s.z - hit.z };
        }
      }
      this.emitSelect();
      this.updateSelectBox();
      return;
    }

    const hit = this.groundHit();
    if (!hit) return;
    const x = snapTo(hit.x, this.grid);
    const z = snapTo(hit.z, this.grid);
    if (this.tool === "spawn") {
      if (this.def.spawns.length >= 24) return;
      this.def.spawns.push({ x, z });
      this.clampSpawn(this.def.spawns[this.def.spawns.length - 1]);
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
        const s = this.def.spawns[this.selection.index];
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
    if (this.def.pieces.length >= 250) return;
    const preset = PIECE_PRESETS[kind];
    const piece: EditorPiece = {
      id: newPieceId(),
      kind,
      x,
      y: kind === "stair" ? this.brush.h : this.brush.h / 2,
      z,
      w: this.brush.w || preset.w,
      h: this.brush.h || preset.h,
      d: this.brush.d || preset.d,
      yawDeg: 0,
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
    const dim = aabbAfterYaw(p.w, p.d, p.yawDeg);
    const limitX = this.def.size / 2 - dim.w / 2 - 1;
    const limitZ = this.def.size / 2 - dim.d / 2 - 1;
    p.x = Math.max(-limitX, Math.min(limitX, p.x));
    p.z = Math.max(-limitZ, Math.min(limitZ, p.z));
  }

  private clampSpawn(s: SpawnPoint): void {
    if (!this.def) return;
    const bound = this.def.size / 2 - 3;
    s.x = Math.max(-bound, Math.min(bound, s.x));
    s.z = Math.max(-bound, Math.min(bound, s.z));
  }

  private updateGhost(): void {
    this.ghost?.dispose();
    this.ghost = null;
    if (!this.def || this.tool === "select" || this.dragging) return;
    const hit = this.groundHit();
    if (!hit) return;
    const x = snapTo(hit.x, this.grid);
    const z = snapTo(hit.z, this.grid);
    if (this.tool === "spawn") {
      const mesh = MeshBuilder.CreateCylinder(
        "ed_ghost",
        { height: 1.2, diameter: 1.1, tessellation: 10 },
        this.scene
      );
      mesh.position = new Vector3(x, 0.6, z);
      mesh.material = this.mat("ghost_spawn", KIND_COLOR.spawn, 0.4);
      mesh.isPickable = false;
      this.ghost = mesh;
      return;
    }
    const mesh = MeshBuilder.CreateBox(
      "ed_ghost",
      { width: this.brush.w, height: this.brush.h, depth: this.brush.d },
      this.scene
    );
    mesh.position = new Vector3(x, this.brush.h / 2, z);
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
    if (this.selection.type === "piece") {
      const p = this.selectedPiece();
      if (!p) return;
      const dim = aabbAfterYaw(p.w, p.d, p.yawDeg);
      x = p.x;
      y = p.y;
      z = p.z;
      w = dim.w + 0.12;
      h = p.h + 0.12;
      d = dim.d + 0.12;
      if (p.kind === "stair") {
        y = p.h / 2;
        h = p.h + 0.12;
        d = p.d + 0.12;
        w = p.w + 0.12;
      }
    } else {
      const s = this.def.spawns[this.selection.index];
      if (!s) return;
      x = s.x;
      z = s.z;
    }
    const box = MeshBuilder.CreateBox("ed_select", { width: w, height: h, depth: d }, this.scene);
    box.position = new Vector3(x, y, z);
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
    if (p) this.brush = { w: p.w, h: p.h, d: p.d };
    this.onSelect?.(this.selection);
  }
}

