import { Scene } from "@babylonjs/core/scene";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { Vector3 } from "@babylonjs/core/Maths/math";
import { Ray } from "@babylonjs/core/Culling/ray";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";

import { WEAPONS, WeaponDef, damageFalloff } from "../../shared/weapons";
import { EffectsManager } from "./effects";

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

interface AmmoState {
  mag: number;
  reserve: number;
}

const MAX_RANGE = 200;

/**
 * Sistema de armas do player local (Fase 2, sem rede).
 * Hitscan por raycast a partir do centro da câmera, com spread em cone.
 *
 * Na fase de rede, o disparo vira um comando enviado ao servidor;
 * este módulo continua responsável pela parte visual/preditiva.
 */
export class WeaponSystem {
  private readonly scene: Scene;
  private readonly camera: UniversalCamera;
  private readonly effects: EffectsManager;

  private currentIndex = 0;
  private readonly ammo = new Map<string, AmmoState>();

  private triggerHeld = false;
  private cooldown = 0;
  private reloadRemaining = 0;
  /** Trava o gatilho de armas semi-auto até soltar o botão. */
  private semiAutoLock = false;
  private enabled = true;

  /** Chamado a cada disparo — o servidor decide o dano (lag comp). */
  onFire: ((data: FireData) => void) | null = null;
  /** Chamado quando o recoil deve ser aplicado (pitch em radianos). */
  onRecoil: ((pitchKick: number) => void) | null = null;
  /** Notifica HUD (troca de arma, munição, reload). */
  onStateChanged: (() => void) | null = null;

  constructor(
    scene: Scene,
    camera: UniversalCamera,
    effects: EffectsManager,
    private readonly ownerId: string
  ) {
    this.scene = scene;
    this.camera = camera;
    this.effects = effects;

    for (const w of WEAPONS) {
      this.ammo.set(w.id, { mag: w.magSize, reserve: w.reserveAmmo });
    }
  }

  get weapon(): WeaponDef {
    return WEAPONS[this.currentIndex];
  }

  get weaponIndex(): number {
    return this.currentIndex;
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

  /** Habilita/desabilita o disparo (morte, fim de partida, overlay). */
  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.triggerHeld = false;
  }

  setTrigger(held: boolean): void {
    this.triggerHeld = held;
    if (!held) this.semiAutoLock = false;
  }

  switchWeapon(index: number): void {
    if (index < 0 || index >= WEAPONS.length || index === this.currentIndex) {
      return;
    }
    this.currentIndex = index;
    this.reloadRemaining = 0;
    this.cooldown = Math.max(this.cooldown, 0.25); // tempo de "sacar"
    this.semiAutoLock = false;
    this.onStateChanged?.();
  }

  cycleWeapon(direction: 1 | -1): void {
    const next =
      (this.currentIndex + direction + WEAPONS.length) % WEAPONS.length;
    this.switchWeapon(next);
  }

  startReload(): void {
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

  /** Restaura munição de todas as armas (usado no respawn). */
  refillAll(): void {
    for (const w of WEAPONS) {
      this.ammo.set(w.id, { mag: w.magSize, reserve: w.reserveAmmo });
    }
    this.reloadRemaining = 0;
    this.onStateChanged?.();
  }

  update(dt: number): void {
    this.cooldown = Math.max(0, this.cooldown - dt);

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
      return; // não atira durante reload
    }

    if (!this.enabled || !this.triggerHeld || this.cooldown > 0) return;
    if (!this.weapon.auto && this.semiAutoLock) return;

    this.fire();
  }

  private fire(): void {
    const state = this.ammo.get(this.weapon.id)!;
    if (state.mag <= 0) {
      this.startReload();
      this.semiAutoLock = true;
      return;
    }

    state.mag--;
    this.cooldown = this.weapon.fireInterval;
    if (!this.weapon.auto) this.semiAutoLock = true;

    const origin = this.camera.globalPosition.clone();
    const baseDir = this.camera.getDirection(Vector3.Forward());

    const hits: HitInfo[] = [];
    const dirs: Vector3[] = [];
    for (let i = 0; i < this.weapon.pellets; i++) {
      const dir = this.applySpread(baseDir, this.weapon.spreadDeg);
      dirs.push(dir);
      const result = this.raycast(origin, dir);
      if (result.info) hits.push(result.info);
    }

    this.onFire?.({ origin, dirs, localHits: hits });
    this.onRecoil?.(this.weapon.recoilPitch);
    this.onStateChanged?.();
  }

  /** Desvia a direção num cone aleatório de meio-ângulo `spreadDeg`. */
  private applySpread(dir: Vector3, spreadDeg: number): Vector3 {
    if (spreadDeg <= 0) return dir.clone();
    const spreadRad = (spreadDeg * Math.PI) / 180;

    // Base ortonormal em torno da direção.
    const up = Math.abs(dir.y) > 0.99 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
    const right = Vector3.Cross(dir, up).normalize();
    const realUp = Vector3.Cross(right, dir).normalize();

    const angle = Math.random() * Math.PI * 2;
    const radius = Math.random() * spreadRad;
    return dir
      .add(right.scale(Math.cos(angle) * radius))
      .add(realUp.scale(Math.sin(angle) * radius))
      .normalize();
  }

  private raycast(
    origin: Vector3,
    dir: Vector3
  ): { info: HitInfo | null; end: Vector3 } {
    const ray = new Ray(origin, dir, MAX_RANGE);
    const pick = this.scene.pickWithRay(ray, (mesh: AbstractMesh) => {
      const meta = mesh.metadata;
      if (meta?.hitbox?.id === this.ownerId) return false;
      return Boolean(meta?.staticGeo || meta?.hitbox);
    });

    const end =
      pick?.hit && pick.pickedPoint
        ? pick.pickedPoint
        : origin.add(dir.scale(MAX_RANGE));

    // Tracer sai levemente abaixo/direita da câmera (posição do "cano").
    const muzzle = origin
      .add(this.camera.getDirection(Vector3.Right()).scale(0.25))
      .add(new Vector3(0, -0.2, 0))
      .add(dir.scale(0.6));
    this.effects.spawnTracer(muzzle, end);

    if (!pick?.hit || !pick.pickedMesh || !pick.pickedPoint) {
      return { info: null, end };
    }

    const meta = pick.pickedMesh.metadata;
    if (meta?.hitbox) {
      this.effects.spawnImpact(pick.pickedPoint, true);
      const distance = Vector3.Distance(origin, pick.pickedPoint);
      const part: "head" | "body" = meta.hitbox.part;
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

    this.effects.spawnImpact(pick.pickedPoint, false);
    return { info: null, end };
  }
}
