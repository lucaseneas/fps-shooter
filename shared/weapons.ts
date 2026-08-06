export type WeaponId = "pistol" | "rifle" | "shotgun" | "sniper" | "knife";

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
  /** Desvios fixos (yaw, pitch em graus) para os pellets do disparo. */
  pelletPattern: ReadonlyArray<readonly [number, number]>;
  magSize: number;
  reserveAmmo: number;
  reloadTime: number;
  /** Sequência fixa de recoil (yaw, pitch em graus), após cada tiro. */
  recoilPattern: ReadonlyArray<readonly [number, number]>;
  /** Distância até onde o dano é 100%. */
  falloffStart: number;
  /** Distância onde o dano chega ao mínimo. */
  falloffEnd: number;
  /** Multiplicador mínimo de dano no fim do falloff. */
  falloffMin: number;
  /** Cor do view model (RGB 0–1). */
  viewColor: [number, number, number];
  /** Espalhamento base em graus. */
  baseSpread: number;
  /** Tempo para sacar a arma e poder atirar (segundos). */
  drawTime: number;
  /** Alcance do golpe melee (metros). Se definido, a arma não gasta munição. */
  meleeRange?: number;
  /** Multiplicador de velocidade de movimento com esta arma equipada. */
  moveSpeedMult?: number;
}

/** Teto do multiplicador de velocidade (faca) — servidor/cliente limitam aqui. */
export const MAX_MOVE_SPEED_MULT = 1.2;

/** Kit fixo — todo mundo nasce com as 5 armas. */
export const WEAPONS: WeaponDef[] = [
  {
    id: "pistol",
    name: "Pistola",
    auto: false,
    fireInterval: 0.28,
    damageBody: 20,
    damageHead: 50,
    pellets: 1,
    pelletPattern: [[0, 0]],
    magSize: 12,
    reserveAmmo: 48,
    reloadTime: 1.4,
    recoilPattern: [[0.1, 0.35], [-0.14, 0.42], [0.18, 0.5]],
    falloffStart: 20,
    falloffEnd: 50,
    falloffMin: 0.6,
    viewColor: [0.55, 0.57, 0.6],
    baseSpread: 0.4,
    drawTime: 0.7,
  },
  {
    id: "rifle",
    name: "Rifle",
    auto: true,
    fireInterval: 0.1,
    damageBody: 25,
    damageHead: 60,
    pellets: 1,
    pelletPattern: [[0, 0]],
    magSize: 30,
    reserveAmmo: 90,
    reloadTime: 2.2,
    recoilPattern: [[0.18, 0.32], [-0.22, 0.38], [0.28, 0.44], [-0.32, 0.5], [0.22, 0.56], [-0.16, 0.62], [0.12, 0.68], [-0.08, 0.72]],
    falloffStart: 25,
    falloffEnd: 60,
    falloffMin: 0.7,
    viewColor: [0.3, 0.35, 0.28],
    baseSpread: 0.4,
    drawTime: 0.7,
  },
  {
    id: "shotgun",
    name: "Escopeta",
    auto: false,
    fireInterval: 0.9,
    damageBody: 8, // por pellet (9 pellets = até 72 de perto)
    damageHead: 8, // sem multiplicador de headshot (GDD)
    pellets: 9,
    pelletPattern: [[0, 0], [2.6, 0], [-2.6, 0], [0, 2.6], [0, -2.6], [1.9, 1.9], [-1.9, 1.9], [1.9, -1.9], [-1.9, -1.9]],
    magSize: 6,
    reserveAmmo: 24,
    reloadTime: 2.6,
    recoilPattern: [[0.45, 1.3], [-0.28, 1.5]],
    falloffStart: 8,
    falloffEnd: 22,
    falloffMin: 0.2,
    viewColor: [0.5, 0.32, 0.18],
    baseSpread: 1.2,
    drawTime: 0.7,
  },
  {
    id: "sniper",
    name: "Sniper",
    auto: false,
    fireInterval: 1.45,
    damageBody: 75,
    damageHead: 100, // headshot = kill (HP máximo 100; falloffMin 1)
    pellets: 1,
    pelletPattern: [[0, 0]],
    magSize: 5,
    reserveAmmo: 20,
    reloadTime: 2.8,
    recoilPattern: [[0.15, 2.2]],
    falloffStart: 80,
    falloffEnd: 120,
    falloffMin: 1,
    viewColor: [0.18, 0.2, 0.24],
    baseSpread: 2.2, // imprecisa no hipfire; ADS zera o spread
    drawTime: 0.7,
  },
  {
    id: "knife",
    name: "Faca",
    auto: false,
    fireInterval: 0.55,
    damageBody: 55,
    damageHead: 100,
    pellets: 1,
    pelletPattern: [[0, 0]],
    magSize: 1,
    reserveAmmo: 0,
    reloadTime: 0,
    recoilPattern: [[0.35, 0.6]],
    falloffStart: 2.0,
    falloffEnd: 2.3,
    falloffMin: 0,
    viewColor: [0.72, 0.74, 0.78],
    baseSpread: 0,
    drawTime: 0.7,
    meleeRange: 2.2,
    moveSpeedMult: MAX_MOVE_SPEED_MULT,
  },
];

export function getWeapon(id: string): WeaponDef | undefined {
  return WEAPONS.find((w) => w.id === id);
}

export function isMeleeWeapon(weapon: WeaponDef): boolean {
  return weapon.meleeRange != null;
}

export function weaponMaxRange(weapon: WeaponDef): number {
  return weapon.meleeRange ?? 200;
}

export function weaponMoveSpeedMult(weapon: WeaponDef): number {
  return weapon.moveSpeedMult ?? 1;
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
