import {
  TEXTURE_CATEGORIES,
  getGameTexture,
  texturesByCategory,
  type TextureCategory,
} from "../../shared/textures";

export interface TexturePickerOptions {
  includeDefault?: boolean;
  includeNone?: boolean;
  defaultLabel?: string;
  noneLabel?: string;
  onChange?: (id: string) => void;
}

interface SwatchItem {
  id: string;
  label: string;
  url: string | null;
}

/**
 * Grelha de texturas por categoria (Mapa / Armamento).
 * Usada no criador de mapas e no estúdio de skins — o catálogo é o mesmo.
 */
export class TexturePicker {
  private readonly root: HTMLElement;
  private readonly opts: TexturePickerOptions;
  private readonly tabs: HTMLElement;
  private readonly grid: HTMLElement;
  private category: TextureCategory = "map";
  private value = "none";
  private disabled = false;

  constructor(root: HTMLElement, opts: TexturePickerOptions = {}) {
    this.root = root;
    this.opts = opts;
    this.root.classList.add("tex-picker");

    this.tabs = document.createElement("div");
    this.tabs.className = "tex-picker-tabs";
    for (const cat of TEXTURE_CATEGORIES) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tex-picker-tab";
      btn.dataset.cat = cat.id;
      btn.textContent = cat.label;
      btn.addEventListener("click", () => {
        if (this.disabled) return;
        this.category = cat.id;
        this.renderGrid();
      });
      this.tabs.appendChild(btn);
    }

    this.grid = document.createElement("div");
    this.grid.className = "tex-picker-grid";
    this.root.replaceChildren(this.tabs, this.grid);
    this.renderGrid();
  }

  getValue(): string {
    return this.value;
  }

  setValue(id: string, emit = false): void {
    const tex = getGameTexture(id);
    if (tex) this.category = tex.category;
    this.value = id;
    this.renderGrid();
    if (emit) this.opts.onChange?.(id);
  }

  setDisabled(on: boolean): void {
    this.disabled = on;
    this.root.classList.toggle("is-disabled", on);
    for (const btn of this.root.querySelectorAll("button")) {
      btn.disabled = on;
    }
  }

  private specials(): SwatchItem[] {
    const items: SwatchItem[] = [];
    if (this.opts.includeDefault) {
      items.push({
        id: "default",
        label: this.opts.defaultLabel ?? "Padrão",
        url: null,
      });
    }
    if (this.opts.includeNone) {
      items.push({
        id: "none",
        label: this.opts.noneLabel ?? "Só cor",
        url: null,
      });
    }
    return items;
  }

  private renderGrid(): void {
    for (const btn of this.tabs.querySelectorAll<HTMLButtonElement>(".tex-picker-tab")) {
      btn.classList.toggle("active", btn.dataset.cat === this.category);
    }

    const items: SwatchItem[] = [
      ...this.specials(),
      ...texturesByCategory(this.category).map((t) => ({
        id: t.id,
        label: t.label,
        url: t.url,
      })),
    ];

    this.grid.replaceChildren();
    for (const item of items) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tex-swatch";
      if (!item.url) btn.classList.add("tex-swatch-empty");
      btn.dataset.id = item.id;
      btn.title = item.label;
      btn.disabled = this.disabled;
      if (item.url) btn.style.backgroundImage = `url("${item.url}")`;
      const cap = document.createElement("span");
      cap.className = "tex-swatch-label";
      cap.textContent = item.label;
      btn.appendChild(cap);
      btn.addEventListener("click", () => {
        if (this.disabled) return;
        this.setValue(item.id, true);
      });
      this.grid.appendChild(btn);
    }
    this.syncSelected();
  }

  private syncSelected(): void {
    for (const btn of this.grid.querySelectorAll<HTMLButtonElement>(".tex-swatch")) {
      btn.classList.toggle("selected", btn.dataset.id === this.value);
    }
  }
}
