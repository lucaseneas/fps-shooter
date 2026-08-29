import { Scene } from "@babylonjs/core/scene";
import { Vector3, Color3 } from "@babylonjs/core/Maths/math";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { SpotLight } from "@babylonjs/core/Lights/spotLight";
import { Light } from "@babylonjs/core/Lights/light";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";

/**
 * Cone largo com falloff quase plano + textura de projeção ("cookie"):
 * é a textura que desenha o feixe — centro quente, borda irregular e
 * cauda longa — então a luz morre aos poucos num contorno orgânico,
 * sem o disco redondo e duro de um spot puro.
 */
const OUTER_ANGLE = (58 * Math.PI) / 180;
/**
 * O falloff STANDARD do Babylon é pow(cos, exponent) com corte seco na borda
 * do cone (innerAngle só existe no modo GLTF). Expoente baixo deixa a curva
 * quase plana e o cookie assume a forma — o corte seco acontece onde a
 * textura já está preta, então ele nunca aparece.
 */
const SPOT_EXPONENT = 1.2;
const RANGE = 42;
const BASE_INTENSITY = 6.2;
/** Quanto o feixe demora para alcançar a mira — dá o balanço de mão. */
const AIM_LAG = 13;
const FADE_SPEED = 9;
const CAM_FORWARD = new Vector3(0, 0, 1);

let cookieTex: DynamicTexture | null = null;

/**
 * Máscara projetada pelo spot. O feixe chega a zero bem antes da borda do
 * cone, com o contorno ondulado, o anel de refletor e o grão de uma lente
 * real — nada de círculo perfeito.
 */
function flashlightCookie(scene: Scene): DynamicTexture {
  if (cookieTex) return cookieTex;
  const size = 256;
  const tex = new DynamicTexture("flashlightCookie", size, scene, true);
  tex.wrapU = Texture.CLAMP_ADDRESSMODE;
  tex.wrapV = Texture.CLAMP_ADDRESSMODE;
  const ctx = tex.getContext();
  const img = ctx.getImageData(0, 0, size, size);
  const px = img.data;
  // Hotspot levemente fora do eixo: feixe de lanterna real não é simétrico.
  const cx = 0.025;
  const cy = -0.02;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = ((x + 0.5) / size) * 2 - 1 - cx;
      const ny = ((y + 0.5) / size) * 2 - 1 - cy;
      const r = Math.sqrt(nx * nx + ny * ny);
      const th = Math.atan2(ny, nx);
      // A borda ondula de leve com o ângulo: quase redonda, sem ser perfeita.
      const wobble =
        1 +
        0.028 * Math.sin(3 * th + 1.7) +
        0.02 * Math.sin(7 * th + 4.2) +
        0.012 * Math.sin(11 * th + 2.9);
      const rr = r / (0.86 * wobble);
      const t = Math.min(1, Math.max(0, (1 - rr) / 0.6));
      let v = t * t * (3 - 2 * t); // smoothstep: encosta no zero sem degrau
      v = Math.pow(v, 1.15); // cauda um pouco mais longa
      v *= 1 + 0.3 * Math.exp(-(r * r) / 0.03); // centro quente
      v *= 1 - 0.1 * Math.exp(-((r - 0.45) * (r - 0.45)) / 0.012); // anel do refletor
      const h = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
      v *= 0.94 + 0.08 * (h - Math.floor(h)); // grão sutil da lente
      const c = Math.max(0, Math.min(255, Math.round(v * 255)));
      const i = (y * size + x) * 4;
      px[i] = c;
      px[i + 1] = c;
      px[i + 2] = c;
      px[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  tex.update();
  cookieTex = tex;
  return tex;
}

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
    SPOT_EXPONENT,
    scene
  );
  light.diffuse = new Color3(1, 0.94, 0.82);
  light.specular = new Color3(0.22, 0.18, 0.1);
  light.intensity = 0;
  light.range = RANGE;
  light.falloffType = Light.FALLOFF_STANDARD;
  light.shadowEnabled = false;
  light.projectionTexture = flashlightCookie(scene);
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
  private readonly tmpPos = new Vector3();
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
    this.tmpPos.set(
      p.x + this.dir.x * 0.12,
      p.y + this.dir.y * 0.12,
      p.z + this.dir.z * 0.12
    );
    // Atribuir (não mutar in-place) dispara o setter do SpotLight, que marca
    // a matriz da textura projetada como suja. Com .set()/.copyFrom() o feixe
    // ficava travado na pose do primeiro frame.
    this.light.position = this.tmpPos;
    this.light.direction = this.dir;

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
  private readonly tmpPos = new Vector3();
  private readonly tmpDir = new Vector3();
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
    this.tmpPos.set(
      pos.x + dir.x * 0.15,
      pos.y + dir.y * 0.15 - 0.06,
      pos.z + dir.z * 0.15
    );
    // Atribuir (não mutar) dispara o setter do SpotLight e atualiza a matriz
    // da textura projetada — ver Flashlight.update.
    this.light.position = this.tmpPos;
    this.light.direction = this.tmpDir.copyFrom(dir);
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
