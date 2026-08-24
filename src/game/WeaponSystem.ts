import { Scene } from "@babylonjs/core/scene";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { Vector3 } from "@babylonjs/core/Maths/math";
import { Ray } from "@babylonjs/core/Culling/ray";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";

import {
  DEFAULT_LOADOUT,
  LoadoutSlots,
  WEAPONS,
  WeaponDef,
  WeaponId,
  damageFalloff,
  getWeapon,
  isMeleeWeapon,
  sprayBloom,
  weaponMaxRange,
} from "../../shared/weapons";
import { EffectsManager } from "./effects";
import { SPRINT_LOWER_DURATION } from "../player/ViewModel";

import "@babylonjs/core/Culling/ray";

export interface HitInfo {
  targetId: string;
  part: "head" | "body";
  damage: number;
}

/** Dados de um disparo completo (todos os pellets) para envio ao servidor. */
export interface FireData {
  origin: Vector3;
  dirs: Vector3[];
  /** Acertos detectados localmente — apenas para hitmarker otimista. */
  localHits: HitInfo[];
}

export interface AimSample {
  origin: Vector3;
  baseDir: Vector3;
}

interface AmmoState {
  mag: number;
  reserve: number;
}

const SLOT_COUNT = 3;

/**
 * Sistema de armas do player local.
 * Inventário = 3 slots do loadout (principal / secundária / melee).
 * Hitscan por raycast a partir do centro da câmera, com spread em cone.
 * Melee (faca) usa o mesmo hitscan com alcance curto e sem munição.
 */
export class WeaponSystem {
  private readonly scene: Scene;
  private readonly camera: UniversalCamera;
  private readonly effects: EffectsManager;

  /** Slot ativo: 0 principal, 1 secundária, 2 melee. */
  private currentSlot = 0;
  private slotIds: [WeaponId, WeaponId, WeaponId] = ["m4a1", "usp", "knife"];
  private readonly ammo = new Map<string, AmmoState>();

  private triggerHeld = false;
  private cooldown = 0;
  private reloadRemaining = 0;
  /** Trava o gatilho de armas semi-auto até soltar o botão. */
  private semiAutoLock = false;
  private enabled = true;
  private infiniteAmmo = false;
  /** Kill streak No Recoil: zera recoil e spread em todas as armas. */
  private noRecoilActive = false;
  /** Arma forçada por kill streak (Predator minigun). */
  private streakWeaponId: WeaponId | null = null;
  private crouching = false;
  private airborne = false;
  private moving = false;
  private running = false;
  /** Correndo de verdade (shift + movimento): arma levantada, tiro bloqueado. */
  private sprinting = false;
  /** Tiro bloqueado enquanto a arma desce após parar de correr. */
  private sprintBlockRemaining = 0;
  /** Mira com scope (sniper) — reduz/zera o espalhamento. */
  private aiming = false;
  private readonly recoilShots = new Map<string, number>();
  private readonly lastShotAt = new Map<string, number>();
  /** Contagem de tiros da rajada por arma (para o bloom progressivo). */
  private readonly sprayShots = new Map<string, number>();
  private readonly sprayLastShotAt = new Map<string, number>();

  /** Chamado a cada disparo — o servidor decide o dano (lag comp). */
  onFire: ((data: FireData) => void) | null = null;
  /** Chamado quando o recoil deve ser aplicado (pitch em radianos). */
  onRecoil: ((pitchKick: number, yawKick: number) => void) | null = null;
  /** Notifica HUD (troca de arma, munição, reload). */
  onStateChanged: (() => void) | null = null;

  constructor(
    scene: Scene,
    camera: UniversalCamera,
    effects: EffectsManager,
    private readonly ownerId: string,
    private readonly muzzlePosProvider?: () => Vector3,
    private readonly aimProvider?: () => AimSample
  ) {
    this.scene = scene;
    this.camera = camera;
    this.effects = effects;

    for (const w of WEAPONS) {
      this.ammo.set(w.id, { mag: w.magSize, reserve: w.reserveAmmo });
    }

    this.applyLoadout(DEFAULT_LOADOUT, false);
  }

  /** Loadout atual (uma arma por slot). */
  get loadout(): LoadoutSlots {
    return {
      primary: this.slotIds[0],
      secondary: this.slotIds[1],
      melee: this.slotIds[2],
    };
  }

  /** Armas dos 3 slots na ordem das teclas 1–3. */
  get loadoutWeapons(): WeaponDef[] {
    return this.slotIds.map((id) => getWeapon(id)!);
  }

  get weapon(): WeaponDef {
    if (this.streakWeaponId) return getWeapon(this.streakWeaponId)!;
    return getWeapon(this.slotIds[this.currentSlot])!;
  }

  get currentSpread(): number {
    if (isMeleeWeapon(this.weapon) || this.noRecoilActive) return 0;
    const spreadMultiplier = this.spreadMultiplier();

    let maxPatternOffset = 0;
    for (const [yaw, pitch] of this.weapon.pelletPattern) {
      const dist = Math.sqrt(yaw * yaw + pitch * pitch);
      if (dist > maxPatternOffset) {
        maxPatternOffset = dist;
      }
    }

    return maxPatternOffset * spreadMultiplier + this.randomSpread(this.peekSprayShot());
  }

  /**
   * Spread aleatório (graus) do tiro `sprayShot` da rajada.
   * Parado: só o bloom da rajada — 1º tiro é sempre 0 (reto).
   * AWP sem mira: hipfire impreciso mesmo parado.
   * Em movimento: spread base por postura + bloom da rajada.
   */
  private randomSpread(sprayShot: number): number {
    const bloom = sprayBloom(this.weapon, sprayShot);
    const sniperHipfire = this.weapon.id === "awp" && !this.aiming;
    if (this.weapon.id === "minigun") {
      return this.weapon.baseSpread + bloom;
    }
    if (!this.moving && !this.running && !this.airborne && !sniperHipfire) return bloom;
    return this.weapon.baseSpread * this.spreadMultiplier() + bloom;
  }

  /** Janela sem disparo para o spread da rajada resetar a zero. */
  private static readonly SPRAY_RESET_MS = 200;

  /** Índice do próximo tiro na rajada (0 = primeiro tiro). */
  private peekSprayShot(): number {
    const id = this.weapon.id;
    const prev = this.sprayLastShotAt.get(id) ?? -Infinity;
    if (performance.now() - prev > WeaponSystem.SPRAY_RESET_MS) return 0;
    return this.sprayShots.get(id) ?? 0;
  }

  /**
   * Multiplicador de espalhamento por postura/movimento.
   * Sniper: preciso só parado (ADS); andando/pulando = spread alto.
   */
  private spreadMultiplier(): number {
    const id = this.weapon.id;
    const isRifle = id === "m4a1" || id === "ak47" || id === "scarh";
    const isSniper = id === "awp";
    const isMagnum = id === "magnum";

    if (isSniper && this.aiming) {
      if (this.airborne) return 5.5;
      if (this.running) return 3.8;
      if (this.moving) return 3.2;
      if (this.crouching) return 0;
      return 0;
    }

    if (this.airborne) {
      if (isSniper) return 9.0;
      if (isRifle) return 18.0;
      // Escopeta: mesmo spread de correndo (não punir o pulo)
      if (id === "shotgun") return 2.38;
      return 7.0;
    }
    if (this.running) {
      if (isSniper) return 4.5;
      if (isMagnum) return 4.0;
      if (id === "shotgun") return 2.38;
      return isRifle ? 12.0 : 2.8;
    }
    // Agachado andando = mesmo spread de andando em pé.
    if (this.moving) {
      if (isSniper) return 3.5;
      // Magnum: revólver pesado, instável andando
      if (isMagnum) return 3.0;
      if (id === "shotgun") return 0.94;
      return isRifle ? 7.0 : 1.8;
    }
    // Escopeta: agachado = parado (sem bônus de precisão)
    if (this.crouching) {
      if (isSniper) return 1.8;
      return id === "shotgun" ? 0.85 : 0.5;
    }
    // Magnum parado: mais preciso que as demais armas
    if (isMagnum) return 0.6;
    // AWP hipfire parado: cone largo — só a mira telescópica é precisa
    if (isSniper) return 2.4;
    if (id === "shotgun") return 0.85;
    return 1.0;
  }

  /** Índice do slot ativo (0–2), não o índice no catálogo WEAPONS. */
  get weaponIndex(): number {
    return this.currentSlot;
  }

  get magAmmo(): number {
    return this.ammo.get(this.weapon.id)!.mag;
  }

  get reserveAmmo(): number {
    return this.ammo.get(this.weapon.id)!.reserve;
  }

  get isReloading(): boolean {
    return this.reloadRemaining > 0;
  }

  /** True enquanto o gatilho está pressionado e ainda pode disparar. */
  get isShooting(): boolean {
    if (!this.enabled || !this.triggerHeld || this.reloadRemaining > 0) return false;
    if (this.sprinting || this.sprintBlockRemaining > 0) return false;
    if (isMeleeWeapon(this.weapon)) return true;
    return this.ammo.get(this.weapon.id)!.mag > 0;
  }

  /** Aplica um loadout; por padrão equipa a arma principal e recarrega munição. */
  applyLoadout(slots: LoadoutSlots, refill = true): void {
    this.slotIds = [slots.primary, slots.secondary, slots.melee];
    this.currentSlot = 0;
    this.reloadRemaining = 0;
    this.semiAutoLock = false;
    this.cooldown = Math.max(this.cooldown, this.weapon.drawTime);
    if (refill) this.refillAll();
    else this.onStateChanged?.();
  }

  /** Habilita/desabilita o disparo (morte, fim de partida, overlay). */
  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.triggerHeld = false;
  }

  /** No modo debug, mantém todas as armas carregadas sem alterar a cadência. */
  setInfiniteAmmo(on: boolean): void {
    this.infiniteAmmo = on;
    if (on) this.refillAll();
    else this.onStateChanged?.();
  }

  /** Kill streak No Recoil: sem recoil visual e sem spread nos tiros. */
  setNoRecoil(on: boolean): void {
    this.noRecoilActive = on;
  }

  /** Equipa (ou solta) uma arma de kill streak, ignorando o loadout. */
  setStreakWeapon(id: WeaponId | null): void {
    if (this.streakWeaponId === id) return;
    this.streakWeaponId = id;
    this.reloadRemaining = 0;
    this.semiAutoLock = false;
    this.sprayShots.clear();
    this.sprayLastShotAt.clear();
    if (id) {
      this.ammo.set(id, { mag: getWeapon(id)?.magSize ?? 999, reserve: 0 });
      this.cooldown = Math.min(this.cooldown, 0.25);
    }
    this.onStateChanged?.();
  }

  get isStreakWeaponActive(): boolean {
    return this.streakWeaponId !== null;
  }

  setTrigger(held: boolean): void {
    this.triggerHeld = held;
    if (!held) {
      this.semiAutoLock = false;
      return;
    }
    // Clique com o pente vazio: recarrega na hora, sem esperar pelo cooldown.
    if (
      this.enabled &&
      !isMeleeWeapon(this.weapon) &&
      this.ammo.get(this.weapon.id)!.mag <= 0
    ) {
      this.startReload();
    }
  }

  setCrouching(on: boolean): void {
    this.crouching = on;
  }

  setAirborne(on: boolean): void {
    this.airborne = on;
  }

  setMoving(on: boolean): void {
    this.moving = on;
  }

  setRunning(on: boolean): void {
    this.running = on;
  }

  /**
   * Sprint real (correndo): bloqueia o disparo na hora e mantém o bloqueio
   * durante a descida da arma (SPRINT_LOWER_DURATION) ao parar de correr.
   */
  setSprinting(on: boolean): void {
    if (on === this.sprinting) return;
    this.sprinting = on;
    if (!on) this.sprintBlockRemaining = SPRINT_LOWER_DURATION;
  }

  setAiming(on: boolean): void {
    this.aiming = on;
  }

  get isAiming(): boolean {
    return this.aiming;
  }

  /** Troca para o slot 0–2 (teclas 1 / 2 / 3). */
  switchWeapon(slot: number): void {
    if (this.streakWeaponId) return;
    if (slot < 0 || slot >= SLOT_COUNT || slot === this.currentSlot) {
      return;
    }
    this.currentSlot = slot;
    this.reloadRemaining = 0;
    this.cooldown = Math.max(this.cooldown, this.weapon.drawTime);
    this.semiAutoLock = false;
    this.sprayShots.clear();
    this.sprayLastShotAt.clear();
    this.onStateChanged?.();
  }

  cycleWeapon(direction: 1 | -1): void {
    const next = (this.currentSlot + direction + SLOT_COUNT) % SLOT_COUNT;
    this.switchWeapon(next);
  }

  startReload(): void {
    if (this.streakWeaponId) return;
    if (isMeleeWeapon(this.weapon)) return;
    const state = this.ammo.get(this.weapon.id)!;
    if (
      this.isReloading ||
      state.mag >= this.weapon.magSize ||
      state.reserve <= 0
    ) {
      return;
    }
    this.reloadRemaining = this.weapon.reloadTime;
    this.onStateChanged?.();
  }

  refillAll(): void {
    for (const w of WEAPONS) {
      this.ammo.set(w.id, { mag: w.magSize, reserve: w.reserveAmmo });
    }
    this.reloadRemaining = 0;
    this.onStateChanged?.();
  }

  update(dt: number): void {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.sprintBlockRemaining = Math.max(0, this.sprintBlockRemaining - dt);

    if (this.reloadRemaining > 0) {
      this.reloadRemaining -= dt;
      if (this.reloadRemaining <= 0) {
        this.reloadRemaining = 0;
        const state = this.ammo.get(this.weapon.id)!;
        const need = this.weapon.magSize - state.mag;
        const taken = Math.min(need, state.reserve);
        state.mag += taken;
        state.reserve -= taken;
        this.onStateChanged?.();
      }
      return;
    }

    if (!this.enabled || !this.triggerHeld || this.cooldown > 0) return;
    if (this.sprinting || this.sprintBlockRemaining > 0) return;
    if (!this.weapon.auto && this.semiAutoLock) return;

    this.fire();
  }

  private fire(): void {
    const melee = isMeleeWeapon(this.weapon);
    if (!melee) {
      const state = this.ammo.get(this.weapon.id)!;
      if (state.mag <= 0) {
        this.startReload();
        this.semiAutoLock = true;
        return;
      }
      if (!this.infiniteAmmo && !this.streakWeaponId) state.mag--;
    }

    this.cooldown = this.weapon.fireInterval;
    if (!this.weapon.auto) this.semiAutoLock = true;

    const aim =
      this.aimProvider?.() ?? {
        origin: this.camera.globalPosition.clone(),
        baseDir: this.camera.getDirection(Vector3.Forward()),
      };
    const origin = aim.origin;
    const baseDir = aim.baseDir;

    const hits: HitInfo[] = [];
    const dirs: Vector3[] = [];
    const noRecoil = this.noRecoilActive;
    const recoilMultiplier = noRecoil ? 0 : this.crouching ? 0.7 : 1.0;

    const spreadMultiplier = melee || noRecoil ? 0 : this.spreadMultiplier();
    const range = weaponMaxRange(this.weapon);

    const sprayShot = this.peekSprayShot();
    this.sprayShots.set(this.weapon.id, sprayShot + 1);
    this.sprayLastShotAt.set(this.weapon.id, performance.now());
    const maxSpread = melee || noRecoil ? 0 : this.randomSpread(sprayShot);

    for (let i = 0; i < this.weapon.pellets; i++) {
      // No Recoil: tiros perfeitos no centro (ignora padrão de pellets e spread).
      const [yaw, pitch] = noRecoil ? [0, 0] : (this.weapon.pelletPattern[i] ?? [0, 0]);

      const angle = Math.random() * Math.PI * 2;
      const randRadius = Math.random() * maxSpread;
      const randYaw = randRadius * Math.cos(angle);
      const randPitch = randRadius * Math.sin(angle);

      const totalYaw = yaw * spreadMultiplier + randYaw;
      const totalPitch = pitch * spreadMultiplier + randPitch;

      const dir = this.applyFixedOffset(baseDir, totalYaw, totalPitch);
      dirs.push(dir);
      const result = this.raycast(origin, dir, range, !melee);
      if (result.info) hits.push(result.info);
    }

    this.onFire?.({ origin, dirs, localHits: hits });
    if (!noRecoil) {
      const recoil = this.nextRecoil();
      this.onRecoil?.(recoil.pitch * recoilMultiplier, recoil.yaw * recoilMultiplier);
    }
    this.onStateChanged?.();
  }

  private applyFixedOffset(dir: Vector3, yawDeg: number, pitchDeg: number): Vector3 {
    if (yawDeg === 0 && pitchDeg === 0) return dir.clone();

    const up = Math.abs(dir.y) > 0.99 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
    const right = Vector3.Cross(dir, up).normalize();
    const realUp = Vector3.Cross(right, dir).normalize();

    return dir
      .add(right.scale((yawDeg * Math.PI) / 180))
      .add(realUp.scale((pitchDeg * Math.PI) / 180))
      .normalize();
  }

  private nextRecoil(): { yaw: number; pitch: number } {
    const now = performance.now();
    const id = this.weapon.id;
    const previous = this.lastShotAt.get(id) ?? -Infinity;
    const shot = now - previous > 250 ? 0 : this.recoilShots.get(id) ?? 0;
    const [yawDeg, pitchDeg] =
      this.weapon.recoilPattern[Math.min(shot, this.weapon.recoilPattern.length - 1)];
    this.recoilShots.set(id, shot + 1);
    this.lastShotAt.set(id, now);
    return { yaw: (yawDeg * Math.PI) / 180, pitch: (pitchDeg * Math.PI) / 180 };
  }

  private raycast(
    origin: Vector3,
    dir: Vector3,
    range: number,
    withTracer: boolean
  ): { info: HitInfo | null; end: Vector3 } {
    const ray = new Ray(origin, dir, range);
    const pick = this.scene.pickWithRay(ray, (mesh: AbstractMesh) => {
      const meta = mesh.metadata;
      if (meta?.hitbox?.id === this.ownerId) return false;
      return Boolean(meta?.staticGeo || meta?.hitbox);
    });

    const end =
      pick?.hit && pick.pickedPoint
        ? pick.pickedPoint
        : origin.add(dir.scale(range));

    let travelMs = 0;

    if (withTracer) {
      const muzzle = this.muzzlePosProvider
        ? this.muzzlePosProvider()
        : origin
            .add(this.camera.getDirection(Vector3.Right()).scale(0.25))
            .add(new Vector3(0, -0.2, 0))
            .add(dir.scale(0.6));
      travelMs = this.effects.spawnTracer(muzzle, end, this.weapon.id === "minigun");
    }

    if (!pick?.hit || !pick.pickedMesh || !pick.pickedPoint) {
      return { info: null, end };
    }

    const hitNormal = pick.getNormal(true, true);
    const meta = pick.pickedMesh.metadata;
    if (meta?.hitbox) {
      const part: "head" | "body" = meta.hitbox.part;
      this.effects.spawnImpact(pick.pickedPoint, true, dir, hitNormal, travelMs, part === "head");
      const distance = Vector3.Distance(origin, pick.pickedPoint);
      const base =
        part === "head" ? this.weapon.damageHead : this.weapon.damageBody;
      return {
        info: {
          targetId: meta.hitbox.id,
          part,
          damage: base * damageFalloff(distance, this.weapon),
        },
        end,
      };
    }

    this.effects.spawnImpact(pick.pickedPoint, false, dir, hitNormal, travelMs);
    return { info: null, end };
  }
}
