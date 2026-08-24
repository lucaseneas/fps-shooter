import { Scene } from "@babylonjs/core/scene";
import { Vector3, Color3, Quaternion } from "@babylonjs/core/Maths/math";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Constants } from "@babylonjs/core/Engines/constants";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { PointLight } from "@babylonjs/core/Lights/pointLight";

const X_AXIS = new Vector3(1, 0, 0);
const Y_AXIS = new Vector3(0, 1, 0);
const Z_AXIS = new Vector3(0, 0, 1);
const TMP_A = new Vector3();
const TMP_B = new Vector3();
const TMP_DIR = new Vector3();
const TMP_N = new Vector3();
const TMP_RIGHT = new Vector3();
const TMP_UP = new Vector3();
const TMP_CONE = new Vector3();

/** Velocidade visual do rastro (m/s). Alta de propósito: o jogo é hitscan. */
const TRACER_SPEED = 3600;
const TRACER_STREAK = 3.4;
const SPARK_GRAVITY = 38;

type FxKind = "tracer" | "debug" | "spark" | "puff" | "flash" | "drop";

interface LiveFx {
  kind: FxKind;
  mesh: Mesh;
  head?: Mesh;
  born: number;
  life: number;
  from: Vector3;
  to: Vector3;
  vel: Vector3;
  pathLen: number;
  streakLen: number;
  scale0: number;
  scale1: number;
  gravity: number;
}

interface PendingImpact {
  at: Vector3;
  onFlesh: boolean;
  headshot: boolean;
  incoming: Vector3;
  normal: Vector3 | null;
  when: number;
}

let glowTex: DynamicTexture | null = null;

function fxGlowTexture(scene: Scene): DynamicTexture {
  if (glowTex) return glowTex;
  const size = 64;
  const tex = new DynamicTexture("fxGlowTex", size, scene, false);
  const ctx = tex.getContext();
  const g = ctx.createRadialGradient(32, 32, 1, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.22, "rgba(255,230,170,0.95)");
  g.addColorStop(0.55, "rgba(255,140,40,0.45)");
  g.addColorStop(1, "rgba(255,80,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  tex.hasAlpha = true;
  tex.update();
  glowTex = tex;
  return tex;
}

function additiveMat(
  name: string,
  scene: Scene,
  color: Color3,
  withGlow = false
): StandardMaterial {
  const mat = new StandardMaterial(name, scene);
  mat.disableLighting = true;
  mat.emissiveColor = color;
  mat.diffuseColor = Color3.Black();
  mat.specularColor = Color3.Black();
  mat.alphaMode = Constants.ALPHA_ADD;
  mat.backFaceCulling = false;
  mat.disableDepthWrite = true;
  mat.transparencyMode = 2;
  if (withGlow) {
    const tex = fxGlowTexture(scene);
    mat.diffuseTexture = tex;
    mat.emissiveTexture = tex;
    mat.opacityTexture = tex;
    mat.useAlphaFromDiffuseTexture = true;
  }
  return mat;
}

function blendMat(
  name: string,
  scene: Scene,
  color: Color3,
  withGlow = false
): StandardMaterial {
  const mat = new StandardMaterial(name, scene);
  mat.disableLighting = true;
  mat.emissiveColor = color;
  mat.diffuseColor = Color3.Black();
  mat.alphaMode = Constants.ALPHA_COMBINE;
  mat.backFaceCulling = false;
  mat.disableDepthWrite = true;
  mat.transparencyMode = 2;
  if (withGlow) {
    const tex = fxGlowTexture(scene);
    mat.diffuseTexture = tex;
    mat.emissiveTexture = tex;
    mat.opacityTexture = tex;
    mat.useAlphaFromDiffuseTexture = true;
  }
  return mat;
}

function rand(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

function orientAlong(mesh: Mesh, axis: Vector3, dir: Vector3): void {
  const lenSq = dir.lengthSquared();
  if (lenSq < 1e-12) return;
  TMP_DIR.copyFrom(dir).scaleInPlace(1 / Math.sqrt(lenSq));
  if (!mesh.rotationQuaternion) mesh.rotationQuaternion = new Quaternion();
  Quaternion.FromUnitVectorsToRef(axis, TMP_DIR, mesh.rotationQuaternion);
}

function coneDir(normal: Vector3, spreadRad: number): Vector3 {
  TMP_CONE.copyFrom(normal);
  if (TMP_CONE.lengthSquared() < 1e-8) TMP_CONE.set(0, 1, 0);
  TMP_CONE.normalize();
  const tmpUp = Math.abs(TMP_CONE.y) > 0.92 ? X_AXIS : Y_AXIS;
  Vector3.CrossToRef(TMP_CONE, tmpUp, TMP_RIGHT);
  TMP_RIGHT.normalize();
  Vector3.CrossToRef(TMP_RIGHT, TMP_CONE, TMP_UP);
  TMP_UP.normalize();
  const theta = Math.random() * Math.PI * 2;
  const r = Math.tan(spreadRad * Math.random());
  return TMP_CONE.add(TMP_RIGHT.scale(Math.cos(theta) * r))
    .add(TMP_UP.scale(Math.sin(theta) * r))
    .normalize();
}

/**
 * Flash de cano: núcleo + cruz de flares aditivos e, opcionalmente, um point light.
 */
export class MuzzleFlash {
  readonly root: TransformNode;
  private readonly light: PointLight | null;
  private readonly meshes: Mesh[];
  private age = 1;
  private life = 0.055;
  private shotScale = 1;
  private readonly baseSize: number;

  constructor(
    scene: Scene,
    parent: TransformNode,
    opts: { withLight?: boolean; renderingGroupId?: number; size?: number } = {}
  ) {
    this.baseSize = opts.size ?? 0.2;
    this.root = new TransformNode("muzzleFlash", scene);
    this.root.parent = parent;
    this.root.setEnabled(false);

    const coreMat = additiveMat("muzzleCoreMat", scene, new Color3(1, 0.95, 0.75), true);
    const flareMat = additiveMat("muzzleFlareMat", scene, new Color3(1, 0.55, 0.12), true);

    const core = MeshBuilder.CreatePlane("muzzleCore", { size: this.baseSize * 0.7 }, scene);
    core.billboardMode = Mesh.BILLBOARDMODE_ALL;
    core.material = coreMat;
    core.parent = this.root;

    const flareZ = MeshBuilder.CreateDisc("muzzleFlareZ", { radius: this.baseSize, tessellation: 12 }, scene);
    flareZ.material = flareMat;
    flareZ.parent = this.root;
    const flareY = flareZ.clone("muzzleFlareY")!;
    flareY.rotationQuaternion = Quaternion.RotationAxis(X_AXIS, Math.PI / 2);
    const flareX = flareZ.clone("muzzleFlareX")!;
    flareX.rotationQuaternion = Quaternion.RotationAxis(Y_AXIS, Math.PI / 2);

    this.meshes = [core, flareZ, flareY, flareX];
    for (const m of this.meshes) {
      m.parent = this.root;
      m.isPickable = false;
      m.applyFog = false;
      if (opts.renderingGroupId !== undefined) m.renderingGroupId = opts.renderingGroupId;
    }

    if (opts.withLight) {
      this.light = new PointLight("muzzleLight", Vector3.Zero(), scene);
      this.light.parent = this.root;
      this.light.diffuse = new Color3(1, 0.62, 0.22);
      this.light.specular = new Color3(0.35, 0.18, 0.04);
      this.light.intensity = 0;
      this.light.range = 6.5;
    } else {
      this.light = null;
    }
  }

  setLocalPosition(p: Vector3): void {
    this.root.position.copyFrom(p);
  }

  trigger(sizeMult = 1): void {
    this.age = 0;
    this.life = rand(0.042, 0.058);
    this.shotScale = sizeMult * rand(0.85, 1.25);
    this.root.rotation.z = Math.random() * Math.PI;
    this.root.scaling.setAll(this.shotScale);
    this.root.setEnabled(true);
    if (this.light) this.light.intensity = 3.6 * sizeMult;
  }

  update(dt: number): void {
    if (this.age >= this.life) return;
    this.age += dt;
    const t = Math.min(1, this.age / this.life);
    if (t >= 1) {
      this.root.setEnabled(false);
      if (this.light) this.light.intensity = 0;
      return;
    }
    const fade = 1 - t * t;
    this.root.scaling.setAll(this.shotScale * (1 + t * 0.45));
    for (const m of this.meshes) m.visibility = fade;
    if (this.light) this.light.intensity = 3.8 * fade * fade;
  }

  dispose(): void {
    this.light?.dispose();
    for (const m of this.meshes) m.dispose();
    this.root.dispose();
  }
}

/**
 * Rastros viajando, faíscas de impacto e puffs — meshes em pool, um único tick.
 */
export class EffectsManager {
  private readonly scene: Scene;
  private readonly tracerMat: StandardMaterial;
  private readonly debugMat: StandardMaterial;
  private readonly sparkMat: StandardMaterial;
  private readonly puffMat: StandardMaterial;
  private readonly flashMat: StandardMaterial;
  private readonly bloodMat: StandardMaterial;
  private readonly dropMat: StandardMaterial;

  private readonly tracerPool: Mesh[] = [];
  private readonly headPool: Mesh[] = [];
  private readonly sparkPool: Mesh[] = [];
  private readonly billboardPool: Mesh[] = [];
  private readonly dropPool: Mesh[] = [];

  private readonly live: LiveFx[] = [];
  private readonly pending: PendingImpact[] = [];

  constructor(scene: Scene) {
    this.scene = scene;

    this.tracerMat = additiveMat("tracerMat", scene, new Color3(1, 0.72, 0.28));
    this.debugMat = additiveMat("debugTracerMat", scene, new Color3(0.2, 0.65, 1));
    this.sparkMat = additiveMat("sparkMat", scene, new Color3(1, 0.78, 0.35));
    this.puffMat = additiveMat("puffMat", scene, new Color3(0.55, 0.5, 0.42), true);
    this.flashMat = additiveMat("impactFlashMat", scene, new Color3(1, 0.82, 0.45), true);
    this.bloodMat = blendMat("bloodMistMat", scene, new Color3(0.42, 0.03, 0.03), true);
    this.dropMat = blendMat("bloodDropMat", scene, new Color3(0.38, 0.02, 0.02));

    scene.onBeforeRenderObservable.add(() => this.tick());
  }

  /** Rastro curto que viaja do cano até o impacto. Devolve o tempo de voo (ms). */
  spawnTracer(from: Vector3, to: Vector3): number {
    const dir = to.subtract(from);
    const pathLen = dir.length();
    if (pathLen < 0.8) return 0;

    dir.scaleInPlace(1 / pathLen);
    const start = from.add(dir.scale(Math.min(0.22, pathLen * 0.06)));
    const remain = Vector3.Distance(start, to);
    const travelMs = (remain / TRACER_SPEED) * 1000;
    const streakLen = Math.min(TRACER_STREAK, remain * 0.45);

    const mesh = this.take(this.tracerPool, () => this.makeTracer());
    mesh.material = this.tracerMat;
    mesh.setEnabled(true);
    mesh.visibility = 1;

    const head = this.take(this.headPool, () => this.makeHead());
    head.setEnabled(true);
    head.visibility = 1;

    const tip = start.add(dir.scale(Math.min(0.35, remain * 0.12)));
    this.placeStreak(mesh, start, tip);
    head.position.copyFrom(tip);
    head.scaling.setAll(0.16);

    this.live.push({
      kind: "tracer",
      mesh,
      head,
      born: performance.now(),
      life: travelMs + 28,
      from: start,
      to: to.clone(),
      vel: dir,
      pathLen: remain,
      streakLen,
      scale0: 1,
      scale1: 1,
      gravity: 0,
    });
    return travelMs;
  }

  spawnDebugTracer(from: Vector3, to: Vector3): void {
    const pathLen = Vector3.Distance(from, to);
    if (pathLen < 0.4) return;
    const mesh = this.take(this.tracerPool, () => this.makeTracer());
    mesh.material = this.debugMat;
    mesh.setEnabled(true);
    mesh.visibility = 0.85;
    this.placeStreak(mesh, from, to);
    this.live.push({
      kind: "debug",
      mesh,
      born: performance.now(),
      life: 180,
      from: from.clone(),
      to: to.clone(),
      vel: Vector3.Zero(),
      pathLen,
      streakLen: pathLen,
      scale0: 1,
      scale1: 1,
      gravity: 0,
    });
  }

  spawnImpact(
    at: Vector3,
    onFlesh: boolean,
    incoming?: Vector3,
    normal?: Vector3 | null,
    delayMs = 0,
    headshot = false
  ): void {
    const dir = incoming && incoming.lengthSquared() > 1e-8 ? incoming.clone() : new Vector3(0, 0, 1);
    if (delayMs > 20) {
      this.pending.push({
        at: at.clone(),
        onFlesh,
        headshot,
        incoming: dir,
        normal: normal ? normal.clone() : null,
        when: performance.now() + delayMs,
      });
      return;
    }
    this.emitImpact(at, onFlesh, dir, normal ?? null, headshot);
  }

  /** Explosão do helicóptero Predator. */
  spawnExplosion(at: Vector3): void {
    const up = new Vector3(0, 1, 0);
    this.spawnFlash(at);
    for (let i = 0; i < 18; i++) this.spawnSpark(at, up);
    for (let i = 0; i < 10; i++) this.spawnPuff(at, up, false, 2.4);
    for (let i = 0; i < 6; i++) {
      const offset = at.add(
        new Vector3((Math.random() - 0.5) * 2.2, Math.random() * 1.6, (Math.random() - 0.5) * 2.2)
      );
      this.spawnFlash(offset);
    }
  }

  private emitImpact(
    at: Vector3,
    onFlesh: boolean,
    incoming: Vector3,
    normal: Vector3 | null,
    headshot: boolean
  ): void {
    TMP_N.copyFrom(normal && normal.lengthSquared() > 1e-6 ? normal : incoming.scale(-1));
    if (TMP_N.lengthSquared() < 1e-8) TMP_N.set(0, 1, 0);
    TMP_N.normalize();

    const pos = at.add(TMP_N.scale(0.04));
    const power = headshot ? 1.85 : 1;

    if (onFlesh) {
      const drops = Math.floor(rand(7, 12) * power);
      for (let i = 0; i < drops; i++) this.spawnDrop(pos, TMP_N, power);
      const streaks = Math.floor(rand(4, 7) * power);
      for (let i = 0; i < streaks; i++) this.spawnBloodStreak(pos, TMP_N, power);
      const puffs = headshot ? 4 : 2;
      for (let i = 0; i < puffs; i++) this.spawnPuff(pos, TMP_N, true, power);
      return;
    }

    this.spawnFlash(pos);
    const sparks = Math.floor(rand(3, 5));
    for (let i = 0; i < sparks; i++) this.spawnSpark(pos, TMP_N);
    this.spawnPuff(pos, TMP_N, false);
  }

  private spawnFlash(at: Vector3): void {
    const mesh = this.take(this.billboardPool, () => this.makeBillboard());
    mesh.material = this.flashMat;
    mesh.position.copyFrom(at);
    mesh.setEnabled(true);
    mesh.visibility = 0.72;
    const s0 = 0.13;
    mesh.scaling.setAll(s0);
    this.live.push({
      kind: "flash",
      mesh,
      born: performance.now(),
      life: 48,
      from: at.clone(),
      to: at.clone(),
      vel: Vector3.Zero(),
      pathLen: 0,
      streakLen: 0,
      scale0: s0,
      scale1: s0 * 1.7,
      gravity: 0,
    });
  }

  private spawnSpark(at: Vector3, normal: Vector3): void {
    const dir = coneDir(normal, 0.85);
    const speed = rand(5, 11);
    const mesh = this.take(this.sparkPool, () => this.makeSpark());
    mesh.material = this.sparkMat;
    mesh.position.copyFrom(at);
    mesh.setEnabled(true);
    mesh.visibility = 1;
    orientAlong(mesh, Z_AXIS, dir);
    const len = rand(0.5, 1.0);
    mesh.scaling.set(1, 1, len);
    this.live.push({
      kind: "spark",
      mesh,
      born: performance.now(),
      life: rand(90, 180),
      from: at.clone(),
      to: at.clone(),
      vel: dir.scale(speed),
      pathLen: 0,
      streakLen: 0,
      scale0: len,
      scale1: 0.15,
      gravity: SPARK_GRAVITY,
    });
  }

  private spawnBloodStreak(at: Vector3, normal: Vector3, power = 1): void {
    const dir = coneDir(normal, 1.05);
    dir.y += rand(0.05, 0.35);
    dir.normalize();
    const mesh = this.take(this.sparkPool, () => this.makeSpark());
    mesh.material = this.dropMat;
    mesh.position.copyFrom(at);
    mesh.setEnabled(true);
    mesh.visibility = 0.95;
    orientAlong(mesh, Z_AXIS, dir);
    const len = rand(0.55, 1.15) * power;
    mesh.scaling.set(0.85 * power, 0.85 * power, len);
    this.live.push({
      kind: "spark",
      mesh,
      born: performance.now(),
      life: rand(110, 200) * (0.85 + 0.25 * power),
      from: at.clone(),
      to: at.clone(),
      vel: dir.scale(rand(4.5, 9.5) * power),
      pathLen: 0,
      streakLen: 0,
      scale0: len,
      scale1: 0.12,
      gravity: 26,
    });
  }

  private spawnDrop(at: Vector3, normal: Vector3, power = 1): void {
    const dir = coneDir(normal, 1.1);
    dir.y += rand(0.15, 0.55);
    dir.normalize();
    const mesh = this.take(this.dropPool, () => this.makeDrop());
    mesh.position.copyFrom(at);
    mesh.setEnabled(true);
    mesh.visibility = 1;
    mesh.scaling.setAll(rand(0.6, 1.2) * power);
    this.live.push({
      kind: "drop",
      mesh,
      born: performance.now(),
      life: rand(140, 260) * (0.85 + 0.25 * power),
      from: at.clone(),
      to: at.clone(),
      vel: dir.scale(rand(3.2, 7.5) * power),
      pathLen: 0,
      streakLen: 0,
      scale0: mesh.scaling.x,
      scale1: 0.2,
      gravity: 22,
    });
  }

  private spawnPuff(at: Vector3, normal: Vector3, blood: boolean, power = 1): void {
    const mesh = this.take(this.billboardPool, () => this.makeBillboard());
    mesh.material = blood ? this.bloodMat : this.puffMat;
    mesh.position.copyFrom(at.add(normal.scale(0.05)));
    mesh.setEnabled(true);
    mesh.visibility = blood ? 0.55 : 0.5;
    const s0 = (blood ? 0.1 : 0.11) * power;
    mesh.scaling.setAll(s0);
    this.live.push({
      kind: "puff",
      mesh,
      born: performance.now(),
      life: (blood ? 180 : 160) * (0.9 + 0.2 * power),
      from: mesh.position.clone(),
      to: mesh.position.clone(),
      vel: normal.scale(rand(0.4, 1.1) * power).add(new Vector3(0, rand(0.2, 0.7), 0)),
      pathLen: 0,
      streakLen: 0,
      scale0: s0,
      scale1: s0 * (blood ? 1.7 : 2.2),
      gravity: -1.2,
    });
  }

  private tick(): void {
    const now = performance.now();
    const dt = this.scene.getEngine().getDeltaTime() / 1000;

    for (let i = this.pending.length - 1; i >= 0; i--) {
      if (now >= this.pending[i].when) {
        const p = this.pending[i];
        this.emitImpact(p.at, p.onFlesh, p.incoming, p.normal, p.headshot);
        this.pending.splice(i, 1);
      }
    }

    for (let i = this.live.length - 1; i >= 0; i--) {
      if (!this.step(this.live[i], now, dt)) {
        this.release(this.live[i]);
        this.live.splice(i, 1);
      }
    }
  }

  private step(fx: LiveFx, now: number, dt: number): boolean {
    const elapsed = now - fx.born;
    if (elapsed >= fx.life) return false;
    const t = elapsed / fx.life;

    switch (fx.kind) {
      case "tracer": {
        const travel = (elapsed / 1000) * TRACER_SPEED;
        const headDist = Math.min(fx.pathLen, travel);
        const tailDist = Math.max(0, headDist - fx.streakLen);
        Vector3.LerpToRef(fx.from, fx.to, tailDist / fx.pathLen, TMP_A);
        Vector3.LerpToRef(fx.from, fx.to, headDist / fx.pathLen, TMP_B);
        this.placeStreak(fx.mesh, TMP_A, TMP_B);
        if (fx.head) {
          fx.head.position.copyFrom(TMP_B);
          const pulse = 0.16 + Math.sin(elapsed * 0.08) * 0.02;
          fx.head.scaling.setAll(pulse);
        }
        const fade = headDist >= fx.pathLen ? 1 - Math.min(1, (travel - fx.pathLen) / (TRACER_SPEED * 0.045)) : 1;
        fx.mesh.visibility = fade;
        if (fx.head) fx.head.visibility = fade;
        break;
      }
      case "debug":
        fx.mesh.visibility = 1 - t;
        break;
      case "spark":
      case "drop":
      case "puff": {
        fx.vel.y -= fx.gravity * dt;
        fx.mesh.position.addInPlace(fx.vel.scale(dt));
        const s = fx.scale0 + (fx.scale1 - fx.scale0) * t;
        if (fx.kind === "spark") {
          fx.mesh.scaling.set(1 - t * 0.4, 1 - t * 0.4, s);
          orientAlong(fx.mesh, Z_AXIS, fx.vel);
        } else {
          fx.mesh.scaling.setAll(s);
        }
        fx.mesh.visibility = 1 - t * t;
        break;
      }
      case "flash": {
        const s = fx.scale0 + (fx.scale1 - fx.scale0) * t;
        fx.mesh.scaling.setAll(s);
        fx.mesh.visibility = (1 - t) * 0.7;
        break;
      }
    }
    return true;
  }

  private placeStreak(mesh: Mesh, from: Vector3, to: Vector3): void {
    TMP_DIR.copyFrom(to).subtractInPlace(from);
    const len = TMP_DIR.length();
    if (len < 0.02) {
      mesh.setEnabled(false);
      return;
    }
    mesh.setEnabled(true);
    mesh.position.copyFrom(from).addInPlace(TMP_DIR.scale(0.5));
    mesh.scaling.y = len;
    orientAlong(mesh, Y_AXIS, TMP_DIR);
  }

  private makeTracer(): Mesh {
    const m = MeshBuilder.CreateCylinder(
      "tracer",
      { height: 1, diameterTop: 0.034, diameterBottom: 0.007, tessellation: 6 },
      this.scene
    );
    m.material = this.tracerMat;
    m.isPickable = false;
    m.applyFog = false;
    return m;
  }

  private makeHead(): Mesh {
    const m = MeshBuilder.CreatePlane("tracerHead", { size: 1 }, this.scene);
    m.billboardMode = Mesh.BILLBOARDMODE_ALL;
    m.material = this.flashMat;
    m.isPickable = false;
    m.applyFog = false;
    return m;
  }

  private makeSpark(): Mesh {
    const m = MeshBuilder.CreateBox("spark", { width: 0.012, height: 0.012, depth: 0.16 }, this.scene);
    m.material = this.sparkMat;
    m.isPickable = false;
    m.applyFog = false;
    return m;
  }

  private makeBillboard(): Mesh {
    const m = MeshBuilder.CreatePlane("fxBillboard", { size: 1 }, this.scene);
    m.billboardMode = Mesh.BILLBOARDMODE_ALL;
    m.isPickable = false;
    m.applyFog = false;
    return m;
  }

  private makeDrop(): Mesh {
    const m = MeshBuilder.CreateSphere("bloodDrop", { diameter: 0.045, segments: 4 }, this.scene);
    m.material = this.dropMat;
    m.isPickable = false;
    m.applyFog = false;
    return m;
  }

  private take(pool: Mesh[], create: () => Mesh): Mesh {
    const m = pool.pop() ?? create();
    m.setEnabled(true);
    m.visibility = 1;
    m.scaling.set(1, 1, 1);
    return m;
  }

  private release(fx: LiveFx): void {
    fx.mesh.setEnabled(false);
    if (fx.kind === "tracer" || fx.kind === "debug") this.tracerPool.push(fx.mesh);
    else if (fx.kind === "spark") this.sparkPool.push(fx.mesh);
    else if (fx.kind === "drop") this.dropPool.push(fx.mesh);
    else this.billboardPool.push(fx.mesh);
    if (fx.head) {
      fx.head.setEnabled(false);
      this.headPool.push(fx.head);
    }
  }
}
