import { MapEditor, type EditorTool } from "./MapEditor";
import {
  deleteCustomMap,
  listCustomMaps,
  refreshCustomMaps,
  saveCustomMap,
} from "./mapStorage";
import {
  KIND_DEFAULT_HEX,
  MAP_SIZE_OPTIONS,
  MAP_TEXTURES,
  MIN_MAP_AXIS,
  MAX_MAP_AXIS,
  clampMapAxis,
  duplicateCustomMap,
  makeEmptyMap,
  mapAxes,
  pracaToCustomMap,
  type CustomMapDef,
  type EditorPieceKind,
  type MapTextureId,
} from "../../shared/customMap";
import { PIECE_PRESETS } from "../../shared/customMap";

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} não encontrado`);
  return node as T;
}

const TOOLS: Array<{ id: EditorTool; label: string }> = [
  { id: "select", label: "Selecionar" },
];

const OBJECT_OPTIONS: Array<{ id: EditorPieceKind; label: string }> = [
  { id: "wall", label: "Parede" },
  { id: "box", label: "Caixa" },
  { id: "pillar", label: "Pilar" },
  { id: "platform", label: "Plataforma" },
  { id: "stair", label: "Escada" },
];

function isSpawnTool(tool: EditorTool): boolean {
  return tool === "spawn" || tool === "spawnAlpha" || tool === "spawnEcho";
}

function isObjectTool(tool: EditorTool): tool is EditorPieceKind {
  return OBJECT_OPTIONS.some((o) => o.id === tool);
}

const SPAWN_LABEL: Record<"ffa" | "alpha" | "echo", string> = {
  ffa: "FFA",
  alpha: "Alfa",
  echo: "Echo",
};

function shadeHex(hex: string, factor: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const v = parseInt(m[1], 16);
  const r = Math.round(Math.min(255, ((v >> 16) & 255) * factor));
  const g = Math.round(Math.min(255, ((v >> 8) & 255) * factor));
  const b = Math.round(Math.min(255, (v & 255) * factor));
  return `rgb(${r},${g},${b})`;
}

function drawIsoBox(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  w: number,
  d: number,
  h: number,
  hex: string
): void {
  const hw = w / 2;
  const hd = d / 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy - h - hd);
  ctx.lineTo(cx + hw, cy - h);
  ctx.lineTo(cx, cy - h + hd);
  ctx.lineTo(cx - hw, cy - h);
  ctx.closePath();
  ctx.fillStyle = shadeHex(hex, 1.18);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx - hw, cy - h);
  ctx.lineTo(cx, cy - h + hd);
  ctx.lineTo(cx, cy + hd);
  ctx.lineTo(cx - hw, cy);
  ctx.closePath();
  ctx.fillStyle = shadeHex(hex, 0.72);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx + hw, cy - h);
  ctx.lineTo(cx, cy - h + hd);
  ctx.lineTo(cx, cy + hd);
  ctx.lineTo(cx + hw, cy);
  ctx.closePath();
  ctx.fillStyle = shadeHex(hex, 0.9);
  ctx.fill();
}

function drawObjectPreview(canvas: HTMLCanvasElement, kind: EditorPieceKind | ""): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  if (!kind) {
    ctx.strokeStyle = "rgba(255,255,255,0.2)";
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(10, 10, w - 20, h - 20);
    ctx.setLineDash([]);
    return;
  }
  const hex = KIND_DEFAULT_HEX[kind];
  const cx = w / 2;
  const cy = h * 0.72;
  if (kind === "wall") drawIsoBox(ctx, cx, cy, 44, 10, 22, hex);
  else if (kind === "box") drawIsoBox(ctx, cx, cy, 22, 22, 18, hex);
  else if (kind === "pillar") drawIsoBox(ctx, cx, cy, 14, 14, 28, hex);
  else if (kind === "platform") drawIsoBox(ctx, cx, cy, 40, 28, 6, hex);
  else {
    drawIsoBox(ctx, cx + 8, cy, 26, 10, 8, hex);
    drawIsoBox(ctx, cx, cy - 5, 26, 10, 14, hex);
    drawIsoBox(ctx, cx - 8, cy - 10, 26, 10, 20, hex);
  }
}

/**
 * Página de criação de mapas: lista, tamanho, editor 3D e publicação no catálogo global.
 */
export class MapStudio {
  private readonly page: HTMLElement;
  private readonly hub: HTMLElement;
  private readonly sizePane: HTMLElement;
  private readonly editorPane: HTMLElement;
  private readonly listEl: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly nameInput: HTMLInputElement;
  private readonly selLabel: HTMLElement;
  private readonly wInput: HTMLInputElement;
  private readonly hInput: HTMLInputElement;
  private readonly dInput: HTMLInputElement;
  private readonly elevInput: HTMLInputElement;
  private readonly xInput: HTMLInputElement;
  private readonly zInput: HTMLInputElement;
  private readonly colorInput: HTMLInputElement;
  private readonly textureSelect: HTMLSelectElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly toastContainer: HTMLElement;
  private readonly objectSelect: HTMLSelectElement;
  private readonly spawnSelect: HTMLSelectElement;
  private readonly objectPreview: HTMLCanvasElement;
  private readonly spawnPreview: HTMLElement;
  private readonly sizePaneX: HTMLInputElement;
  private readonly sizePaneZ: HTMLInputElement;
  private readonly editorSizeX: HTMLInputElement;
  private readonly editorSizeZ: HTMLInputElement;
  private editor: MapEditor | null = null;
  private savedSnapshot = "";
  private onMapsChanged: (() => void) | null = null;

  constructor() {
    this.page = el("pageMaps");
    this.hub = el("mapStudioHub");
    this.sizePane = el("mapStudioSize");
    this.editorPane = el("mapStudioEditor");
    this.listEl = el("mapStudioList");
    this.statusEl = el("mapEditorStatus");
    this.nameInput = el("mapEditorName");
    this.selLabel = el("mapEditorSel");
    this.wInput = el("mapEditorW");
    this.hInput = el("mapEditorH");
    this.dInput = el("mapEditorD");
    this.elevInput = el("mapEditorElev");
    this.xInput = el("mapEditorX");
    this.zInput = el("mapEditorZ");
    this.colorInput = el("mapEditorColor");
    this.textureSelect = el("mapEditorTexture");
    this.canvas = el("mapEditorCanvas");
    this.toastContainer = el("mapStudioToastContainer");
    this.objectSelect = el("mapEditorObject");
    this.spawnSelect = el("mapEditorSpawn");
    this.objectPreview = el("mapEditorObjectPreview");
    this.spawnPreview = el("mapEditorSpawnPreview");
    this.sizePaneX = el("mapSizeX");
    this.sizePaneZ = el("mapSizeZ");
    this.editorSizeX = el("mapEditorSizeX");
    this.editorSizeZ = el("mapEditorSizeZ");

    el<HTMLButtonElement>("mapStudioBack").addEventListener("click", () => {
      this.requestLeaveHub();
    });
    el<HTMLButtonElement>("mapStudioNew").addEventListener("click", () => {
      this.showSize();
    });
    el<HTMLButtonElement>("mapStudioRefresh").addEventListener("click", () => {
      void this.refreshFromServer();
    });
    el<HTMLButtonElement>("mapSizeCancel").addEventListener("click", () => {
      this.showHub();
    });
    el<HTMLButtonElement>("mapSizeCreate").addEventListener("click", () => {
      this.openEditor(
        makeEmptyMap(
          "Mapa novo",
          clampMapAxis(Number(this.sizePaneX.value) || 80),
          clampMapAxis(Number(this.sizePaneZ.value) || 80)
        )
      );
    });
    el<HTMLButtonElement>("mapEditorClose").addEventListener("click", () => {
      this.requestLeaveEditor();
    });
    el<HTMLButtonElement>("mapEditorSave").addEventListener("click", () => {
      void this.save();
    });
    el<HTMLButtonElement>("mapEditorRotate").addEventListener("click", () => {
      this.editor?.rotateSelected();
    });
    el<HTMLButtonElement>("mapEditorDelete").addEventListener("click", () => {
      this.editor?.deleteSelected();
    });

    this.sizePane.querySelectorAll<HTMLButtonElement>("[data-map-size]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const size = Number(btn.dataset.mapSize);
        if (!MAP_SIZE_OPTIONS.includes(size as (typeof MAP_SIZE_OPTIONS)[number])) return;
        this.sizePaneX.value = String(size);
        this.sizePaneZ.value = String(size);
        this.openEditor(makeEmptyMap("Mapa novo", size, size));
      });
    });

    const tools = el("mapEditorTools");
    tools.replaceChildren();
    for (const t of TOOLS) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "map-tool";
      b.dataset.tool = t.id;
      b.textContent = t.label;
      b.addEventListener("click", () => {
        this.editor?.setTool(t.id);
        this.syncTools();
        this.syncInspector();
      });
      tools.appendChild(b);
    }

    this.objectSelect.replaceChildren();
    const noneObj = document.createElement("option");
    noneObj.value = "";
    noneObj.textContent = "Nenhum";
    this.objectSelect.appendChild(noneObj);
    for (const o of OBJECT_OPTIONS) {
      const opt = document.createElement("option");
      opt.value = o.id;
      opt.textContent = o.label;
      this.objectSelect.appendChild(opt);
    }
    this.objectSelect.addEventListener("change", () => {
      const kind = this.objectSelect.value;
      if (!kind) {
        this.editor?.setTool("select");
      } else {
        this.spawnSelect.value = "";
        this.editor?.setTool(kind as EditorTool);
      }
      this.syncTools();
      this.syncInspector();
    });
    this.spawnSelect.addEventListener("change", () => {
      const spawn = this.spawnSelect.value;
      if (!spawn) {
        this.editor?.setTool("select");
      } else {
        this.objectSelect.value = "";
        this.editor?.setTool(spawn as EditorTool);
      }
      this.syncTools();
      this.syncInspector();
    });
    drawObjectPreview(this.objectPreview, "");

    const applyEditorSize = () => {
      this.editor?.setMapSize(
        Number(this.editorSizeX.value) || 80,
        Number(this.editorSizeZ.value) || 80
      );
    };
    this.editorSizeX.addEventListener("change", applyEditorSize);
    this.editorSizeZ.addEventListener("change", applyEditorSize);

    this.nameInput.addEventListener("change", () => {
      this.editor?.setName(this.nameInput.value);
      this.editor?.commit();
    });
    const dimHandler = () => {
      this.editor?.setBrush(
        Number(this.wInput.value) || 1,
        Number(this.hInput.value) || 1,
        Number(this.dInput.value) || 1,
        Number(this.elevInput.value) || 0
      );
    };
    this.wInput.addEventListener("input", dimHandler);
    this.hInput.addEventListener("input", dimHandler);
    this.dInput.addEventListener("input", dimHandler);
    this.elevInput.addEventListener("input", dimHandler);
    this.wInput.addEventListener("change", () => this.editor?.commit());
    this.hInput.addEventListener("change", () => this.editor?.commit());
    this.dInput.addEventListener("change", () => this.editor?.commit());
    this.elevInput.addEventListener("change", () => this.editor?.commit());
    const posHandler = () => {
      this.editor?.setSelectedPosition(
        Number(this.xInput.value) || 0,
        Number(this.zInput.value) || 0
      );
    };
    this.xInput.addEventListener("change", posHandler);
    this.zInput.addEventListener("change", posHandler);

    this.textureSelect.replaceChildren();
    for (const t of MAP_TEXTURES) {
      const opt = document.createElement("option");
      opt.value = t.id;
      opt.textContent = t.label;
      this.textureSelect.appendChild(opt);
    }
    const applyLook = () => {
      this.editor?.setAppearance(
        this.colorInput.value,
        this.textureSelect.value as MapTextureId
      );
    };
    this.colorInput.addEventListener("input", applyLook);
    this.textureSelect.addEventListener("change", () => {
      applyLook();
      this.editor?.commit();
    });
    this.colorInput.addEventListener("change", () => this.editor?.commit());

    window.addEventListener("resize", () => this.editor?.resize());
  }

  setOnMapsChanged(fn: () => void): void {
    this.onMapsChanged = fn;
  }

  onBack: (() => void) | null = null;

  open(): void {
    this.showHub();
    this.renderList();
    void refreshCustomMaps().then(() => this.renderList());
  }

  /** Re-renderiza a lista do hub (ex.: depois do catálogo recarregar). */
  reloadList(): void {
    this.renderList();
  }

  private async refreshFromServer(): Promise<void> {
    const btn = el<HTMLButtonElement>("mapStudioRefresh");
    if (btn.disabled) return;
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Atualizando…";
    try {
      await refreshCustomMaps();
      this.renderList();
      this.onMapsChanged?.();
      this.showToast("Lista de mapas atualizada.");
    } catch {
      this.showToast("Falha ao atualizar os mapas.");
    } finally {
      btn.disabled = false;
      btn.textContent = label || "Atualizar";
    }
  }

  close(): void {
    this.editor?.stop();
    this.showHub();
  }

  isEditorOpen(): boolean {
    return !this.editorPane.classList.contains("hidden");
  }

  tryLeave(): boolean {
    if (!this.isEditorOpen()) return true;
    return this.requestLeaveEditor();
  }

  private requestLeaveHub(): void {
    this.onBack?.();
  }

  private requestLeaveEditor(): boolean {
    if (this.isDirty() && !window.confirm("Sair sem salvar o mapa?")) return false;
    this.editor?.stop();
    this.showHub();
    this.renderList();
    return true;
  }

  private isDirty(): boolean {
    const cur = this.editor?.current;
    if (!cur) return false;
    return JSON.stringify(cur) !== this.savedSnapshot;
  }

  private showHub(): void {
    this.hub.classList.remove("hidden");
    this.sizePane.classList.add("hidden");
    this.editorPane.classList.add("hidden");
    this.page.classList.remove("map-page-editor");
  }

  private showSize(): void {
    this.hub.classList.add("hidden");
    this.sizePane.classList.remove("hidden");
    this.editorPane.classList.add("hidden");
    this.page.classList.remove("map-page-editor");
    this.sizePaneX.value = "80";
    this.sizePaneZ.value = "80";
    this.sizePaneX.min = String(MIN_MAP_AXIS);
    this.sizePaneZ.min = String(MIN_MAP_AXIS);
    this.sizePaneX.max = String(MAX_MAP_AXIS);
    this.sizePaneZ.max = String(MAX_MAP_AXIS);
  }

  private openEditor(def: CustomMapDef): void {
    this.hub.classList.add("hidden");
    this.sizePane.classList.add("hidden");
    this.editorPane.classList.remove("hidden");
    this.page.classList.add("map-page-editor");
    if (!this.editor) {
      this.editor = new MapEditor(this.canvas);
      this.editor.onChange = () => this.syncStatus();
      this.editor.onSelect = () => this.syncInspector();
    }
    this.editor.start();
    this.editor.load(def);
    requestAnimationFrame(() => this.editor?.resize());
    this.savedSnapshot = JSON.stringify(this.editor.current);
    this.nameInput.value = def.name;
    const axes = mapAxes(def);
    this.editorSizeX.value = String(axes.sizeX);
    this.editorSizeZ.value = String(axes.sizeZ);
    this.syncTools();
    this.syncInspector();
    this.syncStatus();
  }

  private async save(): Promise<void> {
    const def = this.editor?.current;
    if (!def) return;
    this.editor?.setName(this.nameInput.value);
    const latest = this.editor?.current;
    if (!latest) return;
    if (latest.spawns.length < 1) {
      this.statusEl.textContent = "Defina pelo menos 1 spawn do Free-for-All.";
      return;
    }
    if (latest.spawnsAlpha.length < 1) {
      this.statusEl.textContent = "Defina pelo menos 1 spawn da Equipe Alfa (norte).";
      return;
    }
    if (latest.spawnsEcho.length < 1) {
      this.statusEl.textContent = "Defina pelo menos 1 spawn da Equipe Echo (sul).";
      return;
    }
    this.statusEl.textContent = "A gravar…";
    try {
      const result = await saveCustomMap(latest);
      if (!result.ok) {
        this.statusEl.textContent = result.error;
        this.showToast(result.error);
        return;
      }
      this.editor?.load(result.map);
      this.savedSnapshot = JSON.stringify(this.editor?.current);
      this.statusEl.textContent = "Mapa publicado. Todos os jogadores vêem na lista ao criar sala.";
      this.showToast("Mapa publicado para todos!");
      this.onMapsChanged?.();
    } catch (err) {
      this.statusEl.textContent =
        err instanceof Error ? err.message : "Falha ao salvar o mapa.";
    }
  }

  private showToast(message: string): void {
    for (const node of this.toastContainer.children) {
      if (node.textContent !== message) continue;
      const toast = node as HTMLElement & { _toastTimer?: number };
      if (toast._toastTimer) window.clearTimeout(toast._toastTimer);
      toast._toastTimer = window.setTimeout(() => toast.remove(), 4000);
      return;
    }
    const toast = document.createElement("div");
    toast.className = "map-studio-toast";
    toast.textContent = message;
    this.toastContainer.appendChild(toast);
    (toast as HTMLElement & { _toastTimer?: number })._toastTimer = window.setTimeout(
      () => toast.remove(),
      4000
    );
  }

  private renderList(): void {
    this.listEl.replaceChildren();

    const official = document.createElement("article");
    official.className = "map-card";
    official.innerHTML = `
      <h3>Praça</h3>
      <p>Mapa oficial 80×80.</p>
      <div class="map-card-actions">
        <button type="button" data-act="edit">Editar</button>
        <button type="button" class="secondary" data-act="dup">Duplicar</button>
      </div>`;
    official.querySelector("[data-act=edit]")?.addEventListener("click", () => {
      this.openEditor(pracaToCustomMap());
    });
    official.querySelector("[data-act=dup]")?.addEventListener("click", () => {
      void this.persistCopy(pracaToCustomMap());
    });
    this.listEl.appendChild(official);

    const maps = listCustomMaps();
    if (maps.length === 0) {
      const empty = document.createElement("p");
      empty.className = "map-empty";
      empty.textContent = "Nenhum mapa publicado ainda. Crie um novo para todos verem.";
      this.listEl.appendChild(empty);
      return;
    }
    for (const m of maps) {
      const card = document.createElement("article");
      card.className = "map-card";
      const when = new Date(m.updatedAt).toLocaleString("pt-BR");
      const axes = mapAxes(m);
      card.innerHTML = `
        <h3></h3>
        <p>${axes.sizeX}×${axes.sizeZ} · ${m.pieces.length} peças · ${m.spawns.length} FFA · ${m.spawnsAlpha.length} Alfa · ${m.spawnsEcho.length} Echo<br>${when}</p>
        <div class="map-card-actions">
          <button type="button" data-act="edit">Editar</button>
          <button type="button" class="secondary" data-act="dup">Duplicar</button>
          <button type="button" class="secondary" data-act="del">Excluir</button>
        </div>`;
      card.querySelector("h3")!.textContent = m.name;
      card.querySelector("[data-act=edit]")?.addEventListener("click", () => {
        this.openEditor(m);
      });
      card.querySelector("[data-act=dup]")?.addEventListener("click", () => {
        void this.persistCopy(duplicateCustomMap(m));
      });
      card.querySelector("[data-act=del]")?.addEventListener("click", () => {
        if (!window.confirm(`Excluir “${m.name}”?`)) return;
        void this.removeMap(m.id);
      });
      this.listEl.appendChild(card);
    }
  }

  private async persistCopy(copy: CustomMapDef): Promise<void> {
    const result = await saveCustomMap(copy);
    if (!result.ok) {
      this.showToast(result.error);
      return;
    }
    this.renderList();
    this.onMapsChanged?.();
    this.showToast("Cópia publicada para todos.");
  }

  private async removeMap(id: string): Promise<void> {
    const result = await deleteCustomMap(id);
    if (!result.ok) {
      this.showToast(result.error);
      return;
    }
    this.renderList();
    this.onMapsChanged?.();
  }

  private syncTools(): void {
    const tool = this.editor?.currentTool ?? "select";
    this.page.querySelectorAll<HTMLButtonElement>(".map-tool").forEach((b) => {
      b.classList.toggle("active", b.dataset.tool === tool);
    });
    this.objectSelect.value = isObjectTool(tool) ? tool : "";
    this.spawnSelect.value = isSpawnTool(tool) ? tool : "";
    this.spawnPreview.dataset.spawn = this.spawnSelect.value;
    drawObjectPreview(
      this.objectPreview,
      isObjectTool(tool) ? tool : ""
    );
  }

  private syncInspector(): void {
    const ed = this.editor;
    const sel = ed?.selected ?? null;
    const brush = ed?.brushSize ?? { ...PIECE_PRESETS.wall, elev: 0 };
    this.wInput.value = String(brush.w);
    this.hInput.value = String(brush.h);
    this.dInput.value = String(brush.d);
    this.elevInput.value = String(brush.elev);
    const def = ed?.current;
    const tool = ed?.currentTool ?? "select";
    const placing = isObjectTool(tool);
    if (sel?.type === "piece" && def) {
      const p = def.pieces.find((x) => x.id === sel.id);
      this.selLabel.textContent = p
        ? `${PIECE_PRESETS[p.kind].label} · R gira · Del apaga`
        : "Peça";
      this.xInput.value = p ? String(p.x) : "0";
      this.zInput.value = p ? String(p.z) : "0";
      this.xInput.disabled = !p;
      this.zInput.disabled = !p;
      this.setLookEnabled(
        Boolean(p),
        p?.color ?? (p ? KIND_DEFAULT_HEX[p.kind] : "#888888"),
        p?.texture ?? "default"
      );
    } else if (sel?.type === "spawn" && def) {
      const list =
        sel.list === "alpha"
          ? def.spawnsAlpha
          : sel.list === "echo"
            ? def.spawnsEcho
            : def.spawns;
      const s = list[sel.index];
      this.selLabel.textContent = `Spawn ${SPAWN_LABEL[sel.list]} ${sel.index + 1} · Del apaga`;
      this.xInput.value = s ? String(s.x) : "0";
      this.zInput.value = s ? String(s.z) : "0";
      this.xInput.disabled = !s;
      this.zInput.disabled = !s;
      this.setLookEnabled(false);
    } else {
      if (tool === "select") {
        this.selLabel.textContent = "Clique numa peça ou escolha um objeto / spawn";
      } else if (tool === "spawn") {
        this.selLabel.textContent = "Clique no chão para spawn Free-for-All (verde)";
      } else if (tool === "spawnAlpha") {
        this.selLabel.textContent = "Clique no chão para spawn da Equipe Alfa (azul, norte)";
      } else if (tool === "spawnEcho") {
        this.selLabel.textContent = "Clique no chão para spawn da Equipe Echo (vermelho, sul)";
      } else if (isObjectTool(tool)) {
        this.selLabel.textContent = `Clique no chão para colocar ${PIECE_PRESETS[tool].label.toLowerCase()}`;
      } else {
        this.selLabel.textContent = "Clique numa peça ou escolha um objeto / spawn";
      }
      this.xInput.value = "";
      this.zInput.value = "";
      this.xInput.disabled = true;
      this.zInput.disabled = true;
      this.setLookEnabled(
        placing,
        placing ? KIND_DEFAULT_HEX[tool] : "#888888",
        "default"
      );
    }
  }

  private setLookEnabled(
    on: boolean,
    color?: string,
    texture?: MapTextureId
  ): void {
    this.colorInput.disabled = !on;
    this.textureSelect.disabled = !on;
    if (color) this.colorInput.value = color;
    if (texture) this.textureSelect.value = texture;
  }

  private syncStatus(): void {
    const def = this.editor?.current;
    if (!def) {
      this.statusEl.textContent = "";
      return;
    }
    const dirty = this.isDirty() ? " · não salvo" : " · salvo";
    const axes = mapAxes(def);
    this.statusEl.textContent = `${axes.sizeX}×${axes.sizeZ} · ${def.pieces.length} peças · ${def.spawns.length} FFA · ${def.spawnsAlpha.length} Alfa · ${def.spawnsEcho.length} Echo${dirty}`;
    this.editorSizeX.value = String(axes.sizeX);
    this.editorSizeZ.value = String(axes.sizeZ);
  }
}
