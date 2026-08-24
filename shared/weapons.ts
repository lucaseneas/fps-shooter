export type WeaponId =
  | "usp"
  | "magnum"
  | "m4a1"
  | "ak47"
  | "scarh"
  | "mp5"
  | "vector"
  | "shotgun"
  | "awp"
  | "knife"
  | "minigun";

/** Ids antigos → ids atuais (loadouts/inventários persistidos). */
const LEGACY_WEAPON_IDS: Record<string, WeaponId> = {
  pistol: "usp",
  rifle: "m4a1",
  sniper: "awp",
};

/** Slot de equipamento no loadout (teclas 1 / 2 / 3). */
export type WeaponCategory = "primary" | "secondary" | "melee";

/** Loadout personalizado: uma arma escolhida por slot. */
export interface LoadoutSlots {
  primary: WeaponId;
  secondary: WeaponId;
  melee: WeaponId;
}

export const DEFAULT_LOADOUT: LoadoutSlots = {
  primary: "m4a1",
  secondary: "usp",
  melee: "knife",
};

export interface WeaponDef {
  id: WeaponId;
  name: string;
  /** Descrição curta mostrada na seleção de loadout. */
  desc: string;
  /** Caminho da imagem da arma (ex.: "/weapons/rifle.png"). Opcional — a UI usa um placeholder se ausente. */
  image?: string;
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
  /** Espalhamento base em graus (em movimento; parado o 1º tiro é sempre reto). */
  baseSpread: number;
  /** Spread máximo (graus) atingido ao segurar o gatilho em rajada. */
  sprayBloomMax: number;
  /** Tiros após o 3º até o bloom chegar ao máximo. */
  sprayBloomRamp: number;
  /** Tempo para sacar a arma e poder atirar (segundos). */
  drawTime: number;
  /** Alcance do golpe melee (metros). Se definido, a arma não gasta munição. */
  meleeRange?: number;
  /** Multiplicador de velocidade de movimento com esta arma equipada. */
  moveSpeedMult?: number;
}

/** Teto do multiplicador de velocidade (faca) — servidor/cliente limitam aqui. */
export const MAX_MOVE_SPEED_MULT = 1.3;
/** Piso do multiplicador (armas pesadas). Margem abaixo da AWP (0.95). */
export const MIN_MOVE_SPEED_MULT = 0.8;

/** Categoria da arma no inventário do loadout. */
export function weaponCategory(id: WeaponId): WeaponCategory {
  if (id === "knife") return "melee";
  if (id === "usp" || id === "magnum") return "secondary";
  return "primary";
}

/** Armas de kill streak — não entram no loadout. */
export function isStreakWeapon(id: string): boolean {
  return id === "minigun";
}

/** Armas disponíveis para um slot do loadout (dropdowns da seleção). */
export function weaponsForCategory(category: WeaponCategory): WeaponDef[] {
  return WEAPONS.filter(
    (w) => weaponCategory(w.id) === category && !isStreakWeapon(w.id)
  );
}

/** Catálogo de armas (defs). O inventário do jogador vem do loadout. */
export const WEAPONS: WeaponDef[] = [
  {
    id: "usp",
    name: "USP",
    desc: "Secundária fiável, saque rápido.",
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
    sprayBloomMax: 0.7,
    sprayBloomRamp: 4,
    drawTime: 0.7,
    moveSpeedMult: 1.2,
  },
  {
    id: "magnum",
    name: "Magnum .357",
    desc: "Revólver pesado: headshot letal a qualquer distância. Preciso parado, impreciso andando.",
    auto: false,
    fireInterval: 0.95,
    damageBody: 35,
    damageHead: 100,
    pellets: 1,
    pelletPattern: [[0, 0]],
    magSize: 7,
    reserveAmmo: 21,
    reloadTime: 2.4,
    recoilPattern: [[0.35, 2.0], [-0.3, 2.2], [0.25, 2.4]],
    falloffStart: 25,
    falloffEnd: 55,
    falloffMin: 1, // sem perda de dano — headshot é sempre 100 (letal)
    viewColor: [0.42, 0.42, 0.46],
    baseSpread: 0.5,
    sprayBloomMax: 2.2,
    sprayBloomRamp: 3,
    drawTime: 0.8,
    moveSpeedMult: 1.2,
  },
  {
    id: "m4a1",
    name: "M4A1",
    desc: "Automático equilibrado para qualquer distância.",
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
    sprayBloomMax: 1.5,
    sprayBloomRamp: 6,
    drawTime: 0.7,
  },
  {
    id: "ak47",
    name: "AK-47",
    desc: "Dano pesado e recoil bruto — recompensa quem controla o spray.",
    auto: true,
    fireInterval: 0.105,
    damageBody: 30,
    damageHead: 80,
    pellets: 1,
    pelletPattern: [[0, 0]],
    magSize: 30,
    reserveAmmo: 90,
    reloadTime: 2.5,
    recoilPattern: [[0.24, 0.52], [-0.32, 0.66], [0.4, 0.78], [-0.48, 0.9], [0.38, 1.0], [-0.3, 1.08], [0.22, 1.14], [-0.38, 1.18], [0.44, 1.22], [-0.22, 1.25]],
    falloffStart: 22,
    falloffEnd: 55,
    falloffMin: 0.65,
    viewColor: [0.45, 0.3, 0.16],
    baseSpread: 0.45,
    sprayBloomMax: 2.2,
    sprayBloomRamp: 7,
    drawTime: 0.75,
  },
  {
    id: "scarh",
    name: "SCAR-H",
    desc: "Rifle pesado: dano sólido e recuo controlável, mas você se move mais devagar.",
    auto: true,
    fireInterval: 0.105,
    damageBody: 27,
    damageHead: 70,
    pellets: 1,
    pelletPattern: [[0, 0]],
    magSize: 20,
    reserveAmmo: 60,
    reloadTime: 2.35,
    recoilPattern: [[0.21, 0.42], [-0.27, 0.52], [0.34, 0.61], [-0.4, 0.7], [0.3, 0.78], [-0.23, 0.85], [0.17, 0.91], [-0.35, 0.95]],
    falloffStart: 24,
    falloffEnd: 58,
    falloffMin: 0.68,
    viewColor: [0.38, 0.32, 0.22],
    baseSpread: 0.42,
    sprayBloomMax: 1.85,
    sprayBloomRamp: 6,
    drawTime: 0.78,
    moveSpeedMult: 0.92,
  },
  {
    id: "mp5",
    name: "MP5",
    desc: "Submetralhadora: cadência altíssima e recuo suave, mas dano baixo e spread alto. Pente de 45.",
    auto: true,
    fireInterval: 0.08,
    damageBody: 13,
    damageHead: 30,
    pellets: 1,
    pelletPattern: [[0, 0]],
    magSize: 45,
    reserveAmmo: 135,
    reloadTime: 2.0,
    recoilPattern: [[0.1, 0.2], [-0.12, 0.24], [0.14, 0.27], [-0.16, 0.3], [0.12, 0.32], [-0.1, 0.34]],
    falloffStart: 12,
    falloffEnd: 35,
    falloffMin: 0.45,
    viewColor: [0.2, 0.21, 0.23],
    baseSpread: 1.4,
    sprayBloomMax: 1.8,
    sprayBloomRamp: 5,
    drawTime: 0.6,
    moveSpeedMult: 1.15,
  },
  {
    id: "vector",
    name: "Vector .45",
    desc: "Cadência extrema e mobilidade alta: derruba rápido, mas o recuo sobe forte e o pente esvazia num instante.",
    auto: true,
    fireInterval: 0.055,
    damageBody: 14,
    damageHead: 34,
    pellets: 1,
    pelletPattern: [[0, 0]],
    magSize: 30,
    reserveAmmo: 90,
    reloadTime: 1.85,
    recoilPattern: [[0.18, 0.58], [-0.24, 0.72], [0.3, 0.88], [-0.36, 1.02], [0.28, 1.12], [-0.22, 1.2], [0.16, 1.26], [-0.3, 1.3]],
    falloffStart: 14,
    falloffEnd: 38,
    falloffMin: 0.5,
    viewColor: [0.24, 0.24, 0.26],
    baseSpread: 0.85,
    sprayBloomMax: 2.1,
    sprayBloomRamp: 4,
    drawTime: 0.55,
    moveSpeedMult: 1.25,
  },
  {
    id: "shotgun",
    name: "Calibre .12",
    desc: "Devastadora de perto — 9 projéteis por disparo.",
    auto: false,
    fireInterval: 0.9,
    damageBody: 24, // por pellet (9 pellets = até 216 de perto)
    damageHead: 24, // sem multiplicador de headshot (GDD)
    pellets: 9,
    pelletPattern: [[0, 0], [2.21, 0], [-2.21, 0], [0, 2.21], [0, -2.21], [1.62, 1.62], [-1.62, 1.62], [1.62, -1.62], [-1.62, -1.62]],
    magSize: 6,
    reserveAmmo: 24,
    reloadTime: 2.6,
    recoilPattern: [[0.45, 1.3], [-0.28, 1.5]],
    falloffStart: 8,
    falloffEnd: 22,
    falloffMin: 0.2,
    viewColor: [0.5, 0.32, 0.18],
    baseSpread: 1.02,
    sprayBloomMax: 0.68,
    sprayBloomRamp: 2,
    drawTime: 0.7,
    moveSpeedMult: 1.1,
  },
  {
    id: "awp",
    name: "AWP",
    desc: "Um tiro, uma kill. Mira telescópica precisa.",
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
    baseSpread: 6.5, // hipfire impreciso (parado sem mira ainda erra); ADS parado = 0
    sprayBloomMax: 0.6,
    sprayBloomRamp: 3,
    drawTime: 0.7,
    moveSpeedMult: 0.95,
  },
  {
    id: "knife",
    name: "Faca",
    desc: "Golpe rápido e silencioso. Corres mais rápido com ela.",
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
    sprayBloomMax: 0,
    sprayBloomRamp: 1,
    drawTime: 0.7,
    meleeRange: 2.2,
    moveSpeedMult: MAX_MOVE_SPEED_MULT,
  },
  {
    id: "minigun",
    name: "Minigun",
    desc: "Canhão giratório do Predator: cadência alta, dano pesado e spread baixo.",
    auto: true,
    fireInterval: 0.07,
    damageBody: 52,
    damageHead: 68,
    pellets: 1,
    pelletPattern: [[0, 0]],
    magSize: 999,
    reserveAmmo: 0,
    reloadTime: 0,
    recoilPattern: [
      [0.12, 0.22],
      [-0.1, 0.24],
      [0.14, 0.26],
      [-0.12, 0.28],
    ],
    falloffStart: 48,
    falloffEnd: 95,
    falloffMin: 0.72,
    viewColor: [0.22, 0.24, 0.2],
    baseSpread: 1.05,
    sprayBloomMax: 1.35,
    sprayBloomRamp: 10,
    drawTime: 0.25,
  },
];

export function resolveWeaponId(id: string): WeaponId | undefined {
  if (WEAPONS.some((w) => w.id === id)) return id as WeaponId;
  return LEGACY_WEAPON_IDS[id];
}

export function getWeapon(id: string): WeaponDef | undefined {
  const resolved = resolveWeaponId(id);
  return resolved ? WEAPONS.find((w) => w.id === resolved) : undefined;
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

/**
 * Spread extra (graus) do tiro `shot` de uma rajada (0 = primeiro tiro).
 * 1º tiro: 0 — parado, sai sempre reto. 2º/3º: aumento bem pequeno;
 * do 3º em diante cresce gradualmente até `sprayBloomMax`.
 */
export function sprayBloom(weapon: WeaponDef, shot: number): number {
  const max = weapon.sprayBloomMax;
  if (shot <= 0 || max <= 0) return 0;
  if (shot === 1) return max * 0.08;
  if (shot === 2) return max * 0.18;
  const t = Math.min(1, (shot - 2) / Math.max(1, weapon.sprayBloomRamp));
  return max * (0.18 + 0.82 * t);
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
