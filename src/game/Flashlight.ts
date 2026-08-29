import { Scene } from "@babylonjs/core/scene";
import { Vector3, Color3 } from "@babylonjs/core/Maths/math";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { SpotLight } from "@babylonjs/core/Lights/spotLight";
import { Light } from "@babylonjs/core/Lights/light";

/**
 * Cone largo com penumbra grande: o núcleo fica na mira, a luz some
 * aos poucos nas bordas — sem disco duro projetado na tela.
 */
const OUTER_ANGLE = (58 * Math.PI) / 180;
const INNER_ANGLE = (14 * Math.PI) / 180;
const RANGE = 42;
const BASE_INTENSITY = 6.2;
/** Quanto o feixe demora para alcançar a mira — dá o balanço de mão. */
const AIM_LAG = 13;
const FADE_SPEED = 9;
const CAM_FORWARD = new Vector3(0, 0, 1);

/**
 * Sempre habilitada com intensidade 0: os materiais do mapa ficam congelados
 * e não recompilam o shader ao ligar/desligar — o toggle anima só a intensidade.
 */
function createSpot(scene: Scene, name: string): SpotLight {
  const light = new SpotLight(
    name,
    Vector3.Zero(),
    new Vector3(0, 0, 1),
    OUTER_ANGLE,
    2.2,
    scene
  );
  light.innerAngle = INNER_ANGLE;
  light.diffuse = new Color3(1, 0.94, 0.82);
  light.specular = new Color3(0.22, 0.18, 0.1);
  light.intensity = 0;
  light.range = RANGE;
  light.falloffType = Light.FALLOFF_STANDARD;
  light.shadowEnabled = false;
  return light;
}

function fadeStep(current: number, target: number, dt: number): number {
  const f = 1 - Math.exp(-FADE_SPEED * dt);
  const next = current + (target - current) * f;
  return target === 0 && next < 0.01 ? 0 : next;
}

/**
 * Lanterna da câmera no modo Zombies.
 * Só o SpotLight no mundo — sem cone 3D nem vinheta 2D (viram um círculo na tela).
 */
export class Flashlight {
  private readonly light: SpotLight;
  private readonly tmpDir = new Vector3();
  private readonly dir = new Vector3(0, 0, 1);
  private dirReady = false;
  private matchActive = false;
  private on = true;
  private intensity = 0;
  private time = 0;

  constructor(scene: Scene, private readonly camera: UniversalCamera) {
    this.light = createSpot(scene, "flashlight");
  }

  /** Liga a lanterna no modo Zombies (começa acesa). Apaga ao sair da partida. */
  setMatchEnabled(active: boolean): void {
    this.matchActive = active;
    this.on = true;
    this.dirReady = false;
    if (!active) {
      this.intensity = 0;
      this.light.intensity = 0;
    }
  }

  isMatchEnabled(): boolean {
    return this.matchActive;
  }

  isOn(): boolean {
    return this.matchActive && this.on;
  }

  toggle(): boolean {
    if (!this.matchActive) return false;
    this.on = !this.on;
    return this.on;
  }

  update(dt: number): void {
    this.time += dt;
    this.camera.getDirectionToRef(CAM_FORWARD, this.tmpDir);
    if (!this.dirReady) {
      this.dir.copyFrom(this.tmpDir);
      this.dirReady = true;
    } else {
      const k = 1 - Math.exp(-AIM_LAG * dt);
      this.dir.x += (this.tmpDir.x - this.dir.x) * k;
      this.dir.y += (this.tmpDir.y - this.dir.y) * k;
      this.dir.z += (this.tmpDir.z - this.dir.z) * k;
      this.dir.normalize();
    }

    // Origem um palmo à frente na direção suavizada: ao girar rápido, a luz
    // varre de leve para o lado, como uma lanterna segurada na mão.
    const p = this.camera.globalPosition;
    this.light.position.set(
      p.x + this.dir.x * 0.12,
      p.y + this.dir.y * 0.12,
      p.z + this.dir.z * 0.12
    );
    this.light.direction.copyFrom(this.dir);

    const flicker =
      1 +
      Math.sin(this.time * 31.7) * 0.01 +
      Math.sin(this.time * 6.2) * 0.008 +
      Math.sin(this.time * 2.3) * 0.005;
    const target = this.matchActive && this.on ? BASE_INTENSITY * flicker : 0;
    this.intensity = fadeStep(this.intensity, target, dt);
    this.light.intensity = this.intensity;
  }
}

/**
 * Lanterna de um aliado (modo Zombies): spot na cabeça do boneco remoto,
 * seguindo a mira sincronizada pela rede. Vem de um pool fixo (3 vagas).
 */
export class RemoteFlashlight {
  private readonly light: SpotLight;
  private on = false;
  private intensity = 0;
  private time = Math.random() * 10;

  constructor(scene: Scene, name: string) {
    this.light = createSpot(scene, name);
  }

  setOn(on: boolean): void {
    this.on = on;
  }

  isOn(): boolean {
    return this.on;
  }

  setPose(pos: Vector3, dir: Vector3): void {
    this.light.position.set(
      pos.x + dir.x * 0.15,
      pos.y + dir.y * 0.15 - 0.06,
      pos.z + dir.z * 0.15
    );
    this.light.direction.copyFrom(dir);
  }

  update(dt: number): void {
    this.time += dt;
    const flicker =
      1 + Math.sin(this.time * 29.3) * 0.012 + Math.sin(this.time * 5.1) * 0.008;
    const target = this.on ? BASE_INTENSITY * 0.9 * flicker : 0;
    this.intensity = fadeStep(this.intensity, target, dt);
    this.light.intensity = this.intensity;
  }
}
