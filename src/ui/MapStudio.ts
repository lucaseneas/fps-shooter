import { MapEditor, type EditorTool } from "./MapEditor";
import {
  deleteCustomMap,
  listCustomMaps,
  saveCustomMap,
} from "./mapStorage";
import {
  MAP_SIZE_OPTIONS,
  makeEmptyMap,
  pracaToCustomMap,
  type CustomMapDef,
} from "../../shared/customMap";
import { PIECE_PRESETS } from "../../shared/customMap";

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} não encontrado`);
  return node as T;
}

const TOOLS: Array<{ id: EditorTool; label: string }> = [
  { id: "select", label: "Selecionar" },
  { id: "wall", label: "Parede" },
  { id: "box", label: "Caixa" },
  { id: "pillar", label: "Pilar" },
  { id: "platform", label: "Plataforma" },
  { id: "stair", label: "Escada" },
  { id: "spawn", label: "Spawn" },
];

/**
 * Página de criação de mapas: lista, tamanho, editor 3D e gravação local.
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
  private readonly xInput: HTMLInputElement;
  private readonly zInput: HTMLInputElement;
  private readonly canvas: HTMLCanvasElement;
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
    this.xInput = el("mapEditorX");
    this.zInput = el("mapEditorZ");
    this.canvas = el("mapEditorCanvas");

    el<HTMLButtonElement>("mapStudioBack").addEventListener("click", () => {
      this.requestLeaveHub();
    });
    el<HTMLButtonElement>("mapStudioNew").addEventListener("click", () => {
      this.showSize();
    });
    el<HTMLButtonElement>("mapSizeCancel").addEventListener("click", () => {
      this.showHub();
    });
    el<HTMLButtonElement>("mapEditorClose").addEventListener("click", () => {
      this.requestLeaveEditor();
    });
    el<HTMLButtonElement>("mapEditorSave").addEventListener("click", () => {
      this.save();
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
        this.openEditor(makeEmptyMap("Mapa novo", size));
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

    this.nameInput.addEventListener("change", () => {
      this.editor?.setName(this.nameInput.value);
      this.editor?.commit();
    });
    const dimHandler = () => {
      this.editor?.setBrush(
        Number(this.wInput.value) || 1,
        Number(this.hInput.value) || 1,
        Number(this.dInput.value) || 1
      );
    };
    this.wInput.addEventListener("input", dimHandler);
    this.hInput.addEventListener("input", dimHandler);
    this.dInput.addEventListener("input", dimHandler);
    this.wInput.addEventListener("change", () => this.editor?.commit());
    this.hInput.addEventListener("change", () => this.editor?.commit());
    this.dInput.addEventListener("change", () => this.editor?.commit());
    const posHandler = () => {
      this.editor?.setSelectedPosition(
        Number(this.xInput.value) || 0,
        Number(this.zInput.value) || 0
      );
    };
    this.xInput.addEventListener("change", posHandler);
    this.zInput.addEventListener("change", posHandler);

    window.addEventListener("resize", () => this.editor?.resize());
  }

  setOnMapsChanged(fn: () => void): void {
    this.onMapsChanged = fn;
  }

  onBack: (() => void) | null = null;

  open(): void {
    this.showHub();
    this.renderList();
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
    this.syncTools();
    this.syncInspector();
    this.syncStatus();
  }

  private save(): void {
    const def = this.editor?.current;
    if (!def) return;
    this.editor?.setName(this.nameInput.value);
    const latest = this.editor?.current;
    if (!latest) return;
    if (latest.spawns.length < 1) {
      this.statusEl.textContent = "Defina pelo menos 1 spawn.";
      return;
    }
    const saved = saveCustomMap(latest);
    this.editor?.load(saved);
    this.savedSnapshot = JSON.stringify(this.editor?.current);
    this.statusEl.textContent = "Mapa salvo. Aparece na lista ao criar sala.";
    this.onMapsChanged?.();
  }

  private renderList(): void {
    this.listEl.replaceChildren();

    const official = document.createElement("article");
    official.className = "map-card";
    official.innerHTML = `
      <h3>Praça</h3>
      <p>Mapa oficial 80×80. Editar cria uma cópia sua.</p>
      <div class="map-card-actions">
        <button type="button" data-act="copy">Editar cópia</button>
      </div>`;
    official.querySelector("button")?.addEventListener("click", () => {
      this.openEditor(pracaToCustomMap());
    });
    this.listEl.appendChild(official);

    const maps = listCustomMaps();
    if (maps.length === 0) {
      const empty = document.createElement("p");
      empty.className = "map-empty";
      empty.textContent = "Nenhum mapa custom ainda. Crie um novo para começar.";
      this.listEl.appendChild(empty);
      return;
    }
    for (const m of maps) {
      const card = document.createElement("article");
      card.className = "map-card";
      const when = new Date(m.updatedAt).toLocaleString("pt-BR");
      card.innerHTML = `
        <h3></h3>
        <p>${m.size}×${m.size} · ${m.pieces.length} peças · ${m.spawns.length} spawns<br>${when}</p>
        <div class="map-card-actions">
          <button type="button" data-act="edit">Editar</button>
          <button type="button" class="secondary" data-act="del">Excluir</button>
        </div>`;
      card.querySelector("h3")!.textContent = m.name;
      card.querySelector("[data-act=edit]")?.addEventListener("click", () => {
        this.openEditor(m);
      });
      card.querySelector("[data-act=del]")?.addEventListener("click", () => {
        if (!window.confirm(`Excluir “${m.name}”?`)) return;
        deleteCustomMap(m.id);
        this.renderList();
        this.onMapsChanged?.();
      });
      this.listEl.appendChild(card);
    }
  }

  private syncTools(): void {
    const tool = this.editor?.currentTool ?? "select";
    this.page.querySelectorAll<HTMLButtonElement>(".map-tool").forEach((b) => {
      b.classList.toggle("active", b.dataset.tool === tool);
    });
  }

  private syncInspector(): void {
    const ed = this.editor;
    const sel = ed?.selected ?? null;
    const brush = ed?.brushSize ?? PIECE_PRESETS.wall;
    this.wInput.value = String(brush.w);
    this.hInput.value = String(brush.h);
    this.dInput.value = String(brush.d);
    const def = ed?.current;
    if (sel?.type === "piece" && def) {
      const p = def.pieces.find((x) => x.id === sel.id);
      this.selLabel.textContent = p
        ? `${PIECE_PRESETS[p.kind].label} · R gira · Del apaga`
        : "Peça";
      this.xInput.value = p ? String(p.x) : "0";
      this.zInput.value = p ? String(p.z) : "0";
      this.xInput.disabled = !p;
      this.zInput.disabled = !p;
    } else if (sel?.type === "spawn" && def) {
      const s = def.spawns[sel.index];
      this.selLabel.textContent = `Spawn ${sel.index + 1} · Del apaga`;
      this.xInput.value = s ? String(s.x) : "0";
      this.zInput.value = s ? String(s.z) : "0";
      this.xInput.disabled = !s;
      this.zInput.disabled = !s;
    } else {
      const tool = ed?.currentTool ?? "select";
      if (tool === "select") {
        this.selLabel.textContent = "Clique numa peça ou escolha uma ferramenta";
      } else if (tool === "spawn") {
        this.selLabel.textContent = "Clique no chão para colocar spawn";
      } else {
        this.selLabel.textContent = `Clique no chão para colocar ${PIECE_PRESETS[tool].label.toLowerCase()}`;
      }
      this.xInput.value = "";
      this.zInput.value = "";
      this.xInput.disabled = true;
      this.zInput.disabled = true;
    }
  }

  private syncStatus(): void {
    const def = this.editor?.current;
    if (!def) {
      this.statusEl.textContent = "";
      return;
    }
    const dirty = this.isDirty() ? " · não salvo" : " · salvo";
    this.statusEl.textContent = `${def.size}×${def.size} · ${def.pieces.length} peças · ${def.spawns.length} spawns${dirty}`;
  }
}
