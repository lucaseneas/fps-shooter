export type WeaponId = "pistol" | "rifle" | "shotgun";

export interface WeaponDef {
  id: WeaponId;
  name: string;
  /** Se segura o botão continua atirando. */
  auto: boolean;
  /** Intervalo entre tiros (segundos). */
  fireInterval: number;
  damageBody: number;
  damageHead: number;
  /** Balas por disparo (escopeta > 1). */
  pellets: number;
  /** Meio-ângulo do cone de spread (graus). */
  spreadDeg: number;
  magSize: number;
  reserveAmmo: number;
  reloadTime: number;
  /** Chute vertical de recoil por tiro (radianos). */
  recoilPitch: number;
  /** Distância até onde o dano é 100%. */
  falloffStart: number;
  /** Distância onde o dano chega ao mínimo. */
  falloffEnd: number;
  /** Multiplicador mínimo de dano no fim do falloff. */
  falloffMin: number;
  /** Cor do view model (RGB 0–1). */
  viewColor: [number, number, number];
}

/** Kit fixo — todo mundo nasce com as 3 armas (decisão do GDD). */
export const WEAPONS: WeaponDef[] = [
  {
    id: "pistol",
    name: "Pistola",
    auto: false,
    fireInterval: 0.28,
    damageBody: 20,
    damageHead: 50,
    pellets: 1,
    spreadDeg: 0.7,
    magSize: 12,
    reserveAmmo: 48,
    reloadTime: 1.4,
    recoilPitch: 0.006,
    falloffStart: 20,
    falloffEnd: 50,
    falloffMin: 0.6,
    viewColor: [0.55, 0.57, 0.6],
  },
  {
    id: "rifle",
    name: "Rifle",
    auto: true,
    fireInterval: 0.1,
    damageBody: 25,
    damageHead: 60,
    pellets: 1,
    spreadDeg: 1.1,
    magSize: 30,
    reserveAmmo: 90,
    reloadTime: 2.2,
    recoilPitch: 0.0085,
    falloffStart: 25,
    falloffEnd: 60,
    falloffMin: 0.7,
    viewColor: [0.3, 0.35, 0.28],
  },
  {
    id: "shotgun",
    name: "Escopeta",
    auto: false,
    fireInterval: 0.9,
    damageBody: 8, // por pellet (9 pellets = até 72 de perto)
    damageHead: 8, // sem multiplicador de headshot (GDD)
    pellets: 9,
    spreadDeg: 5.5,
    magSize: 6,
    reserveAmmo: 24,
    reloadTime: 2.6,
    recoilPitch: 0.02,
    falloffStart: 8,
    falloffEnd: 25,
    falloffMin: 0.2,
    viewColor: [0.5, 0.32, 0.18],
  },
];

export function getWeapon(id: string): WeaponDef | undefined {
  return WEAPONS.find((w) => w.id === id);
}

/** Multiplicador de dano pela distância (linear entre start e end). */
export function damageFalloff(distance: number, weapon: WeaponDef): number {
  if (distance <= weapon.falloffStart) return 1;
  if (distance >= weapon.falloffEnd) return weapon.falloffMin;
  const t =
    (distance - weapon.falloffStart) /
    (weapon.falloffEnd - weapon.falloffStart);
  return 1 - t * (1 - weapon.falloffMin);
}
