/**
 * Catálogo único de texturas. Ficheiros vivem em pastas por categoria
 * (`map/` e `weapons/`), mas o criador de mapas e o estúdio de skins
 * podem aplicar qualquer uma nas peças ou nas armas.
 */
export type TextureCategory = "map" | "weapon";

export interface GameTextureDef {
  id: string;
  label: string;
  category: TextureCategory;
  url: string;
  /** Escala UV ao aplicar em armas (mapas usam UV da mesh). */
  uvScale?: number;
}

export const TEXTURE_CATEGORIES: ReadonlyArray<{
  id: TextureCategory;
  label: string;
}> = [
  { id: "map", label: "Mapa" },
  { id: "weapon", label: "Armamento" },
];

export const GAME_TEXTURES: readonly GameTextureDef[] = [
  {
    id: "wall",
    label: "Tijolo",
    category: "map",
    url: "/assets/textures/map/wall.png",
  },
  {
    id: "bg_wall",
    label: "Concreto escuro",
    category: "map",
    url: "/assets/textures/map/bg_wall.png",
  },
  {
    id: "floor",
    label: "Chão pedra",
    category: "map",
    url: "/assets/textures/map/floor.png",
  },
  {
    id: "crate",
    label: "Metal industrial",
    category: "map",
    url: "/assets/textures/map/crate.png",
  },
  {
    id: "post",
    label: "Pilar",
    category: "map",
    url: "/assets/textures/map/post.png",
  },
  {
    id: "concrete",
    label: "Concreto",
    category: "map",
    url: "/assets/textures/map/concrete.png",
  },
  {
    id: "cobble",
    label: "Paralelepípedo",
    category: "map",
    url: "/assets/textures/map/cobble.png",
  },
  {
    id: "wood",
    label: "Madeira",
    category: "map",
    url: "/assets/textures/map/wood.png",
  },
  {
    id: "grass",
    label: "Grama",
    category: "map",
    url: "/assets/textures/map/grass.png",
  },
  {
    id: "tiles",
    label: "Azulejo",
    category: "map",
    url: "/assets/textures/map/tiles.png",
  },
  {
    id: "asphalt",
    label: "Asfalto",
    category: "map",
    url: "/assets/textures/map/asphalt.png",
  },
  {
    id: "rust",
    label: "Ferrugem",
    category: "map",
    url: "/assets/textures/map/rust.png",
  },
  {
    id: "carbon",
    label: "Carbono",
    category: "weapon",
    url: "/assets/textures/weapons/carbon.png",
    uvScale: 4,
  },
  {
    id: "camo_woodland",
    label: "Camo floresta",
    category: "weapon",
    url: "/assets/textures/weapons/camo_woodland.png",
    uvScale: 2,
  },
  {
    id: "camo_desert",
    label: "Camo deserto",
    category: "weapon",
    url: "/assets/textures/weapons/camo_desert.png",
    uvScale: 2,
  },
  {
    id: "digital",
    label: "Camo digital",
    category: "weapon",
    url: "/assets/textures/weapons/digital.png",
    uvScale: 2,
  },
  {
    id: "gold",
    label: "Ouro",
    category: "weapon",
    url: "/assets/textures/weapons/gold.png",
    uvScale: 2,
  },
  {
    id: "steel",
    label: "Aço",
    category: "weapon",
    url: "/assets/textures/weapons/steel.png",
    uvScale: 2,
  },
  {
    id: "anodized",
    label: "Azul anodizado",
    category: "weapon",
    url: "/assets/textures/weapons/anodized.png",
    uvScale: 2,
  },
  {
    id: "hex",
    label: "Colmeia",
    category: "weapon",
    url: "/assets/textures/weapons/hex.png",
    uvScale: 3,
  },
  {
    id: "leather",
    label: "Couro",
    category: "weapon",
    url: "/assets/textures/weapons/leather.png",
    uvScale: 2,
  },
  {
    id: "circuit",
    label: "Circuito",
    category: "weapon",
    url: "/assets/textures/weapons/circuit.png",
    uvScale: 2,
  },
];

const BY_ID = new Map(GAME_TEXTURES.map((t) => [t.id, t]));

export function getGameTexture(id: string): GameTextureDef | undefined {
  return BY_ID.get(id);
}

export function isGameTextureId(id: string): boolean {
  return BY_ID.has(id);
}

export function textureUrlById(id: string | undefined | null): string | null {
  if (!id) return null;
  return BY_ID.get(id)?.url ?? null;
}

export function texturesByCategory(category: TextureCategory): GameTextureDef[] {
  return GAME_TEXTURES.filter((t) => t.category === category);
}

export function sanitizeGameTextureId(v: unknown): string | undefined {
  return typeof v === "string" && BY_ID.has(v) ? v : undefined;
}
