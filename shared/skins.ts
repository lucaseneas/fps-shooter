/** Catálogo de skins compartilhado entre cliente (loja/preview) e servidor (validação de prefs). */
export interface SkinDef {
  id: string;
  name: string;
  price: number;
  desc: string;
  isVip?: boolean;
}

export const DEFAULT_SKIN = "skin_default";

export const SKINS: SkinDef[] = [
  {
    id: "skin_default",
    name: "Padrão",
    price: 0,
    desc: "Visual clássico do combatente.",
  },
  {
    id: "skinvip1",
    name: "Homem Aracnídeo",
    price: 350,
    desc: "Traje inspirado no herói aracnídeo.",
  },
  {
    id: "skinbear",
    name: "Urso",
    price: 250,
    desc: "Visual feroz e estiloso de urso pardo.",
  },
  {
    id: "duckdoc",
    name: "Pato Doutor",
    price: 300,
    desc: "Um pato elegante pronto para o combate.",
  },
];

export function isValidSkin(id: string): boolean {
  return SKINS.some((s) => s.id === id);
}
