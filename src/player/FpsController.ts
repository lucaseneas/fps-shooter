import { Scene } from "@babylonjs/core/scene";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Vector3 } from "@babylonjs/core/Maths/math";
import { Scalar } from "@babylonjs/core/Maths/math.scalar";

import {
  BodyState,
  PlayerInput,
  createBody,
  copyBody,
  stepPlayer,
  EYE_HEIGHT,
  FIXED_DT,
} from "../../shared/movement";

const BASE_SENSITIVITY = 0.0022;

/** Estado autoritativo recebido do servidor para reconciliação. */
export interface ServerBodyState {
  x: number;
  y: number;
  z: number;
  vy: number;
  grounded: boolean;
  lastSeq: number;
}

/**
 * Controlador FPS com client-side prediction (Fase 4).
 *
 * O movimento roda em timestep fixo (60Hz) usando a MESMA simulação do
 * servidor (`shared/movement.ts`). Cada passo gera um input numerado que é
 * aplicado localmente (prediction) e enviado ao servidor. Quando o estado
 * autoritativo chega, os inputs já reconhecidos são descartados e os
 * pendentes são re-simulados a partir dele (reconciliação).
 */
export class FpsController {
  readonly camera: UniversalCamera;

  /** Mesh invisível que ancora hitboxes e posição visual do player. */
  private readonly body: Mesh;
  private readonly canvas: HTMLCanvasElement;

  /** Estado físico previsto (posição = pés). */
  private readonly sim: BodyState;
  private readonly pendingInputs: PlayerInput[] = [];
  private inputSeq = 0;
  private accumulator = 0;

  /** Callback para enviar cada input ao servidor. */
  onInput: ((input: PlayerInput) => void) | null = null;

  // Estado de input
  private readonly keys = new Set<string>();
  private yaw = 0;
  private pitch = 0;
  private pointerLocked = false;
  private movementEnabled = true;

  private sensitivityMultiplier = 1;
  private readonly maxPitch = Math.PI / 2 - 0.02;

  constructor(
    scene: Scene,
    canvas: HTMLCanvasElement,
    options: { spawnPosition?: Vector3 } = {}
  ) {
    this.canvas = canvas;

    const spawn = options.spawnPosition ?? new Vector3(0, 0, -18);
    this.sim = createBody(spawn.x, spawn.z);

    this.body = MeshBuilder.CreateBox(
      "playerBody",
      { width: 1, height: EYE_HEIGHT, depth: 1 },
      scene
    );
    this.body.position = new Vector3(spawn.x, spawn.y, spawn.z);
    this.body.isVisible = false;
    this.body.isPickable = false;

    this.camera = new UniversalCamera(
      "fpsCamera",
      new Vector3(spawn.x, spawn.y + EYE_HEIGHT, spawn.z),
      scene
    );
    this.camera.minZ = 0.1;
    this.camera.fov = 1.15; // ~66°
    this.camera.inertia = 0;
    this.camera.inputs.clear(); // input próprio

    this.registerInput();
  }

  /**
   * Cria hitboxes invisíveis (corpo + cabeça) — usadas apenas pelo raycast
   * local para efeitos visuais; o dano real é decidido no servidor.
   */
  setupHitboxes(combatantId: string): void {
    const scene = this.body.getScene();

    const bodyHitbox = MeshBuilder.CreateBox(
      "playerHitboxBody",
      { width: 0.9, height: 1.3, depth: 0.6 },
      scene
    );
    bodyHitbox.parent = this.body;
    bodyHitbox.position = new Vector3(0, 0.75, 0);
    bodyHitbox.visibility = 0;
    bodyHitbox.metadata = { hitbox: { id: combatantId, part: "body" } };

    const headHitbox = MeshBuilder.CreateSphere(
      "playerHitboxHead",
      { diameter: 0.45, segments: 6 },
      scene
    );
    headHitbox.parent = this.body;
    headHitbox.position = new Vector3(0, EYE_HEIGHT, 0);
    headHitbox.visibility = 0;
    headHitbox.metadata = { hitbox: { id: combatantId, part: "head" } };
  }

  private registerInput(): void {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    document.addEventListener("pointerlockchange", this.onPointerLockChange);
    document.addEventListener("mousemove", this.onMouseMove);
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    document.removeEventListener("pointerlockchange", this.onPointerLockChange);
    document.removeEventListener("mousemove", this.onMouseMove);
    this.body.dispose();
  }

  /** Solicita o travamento do ponteiro (chamado ao clicar em "jogar"). */
  requestPointerLock(): void {
    this.canvas.requestPointerLock();
  }

  get isPointerLocked(): boolean {
    return this.pointerLocked;
  }

  /** Multiplicador de sensibilidade do mouse (menu de configurações). */
  setSensitivity(multiplier: number): void {
    this.sensitivityMultiplier = Scalar.Clamp(multiplier, 0.05, 5);
  }

  getSensitivity(): number {
    return this.sensitivityMultiplier;
  }

  /** Congela o input de movimento (morte / fim de partida). */
  setMovementEnabled(on: boolean): void {
    this.movementEnabled = on;
    if (!on) this.keys.clear();
  }

  /** Chute de recoil: levanta a mira. */
  applyRecoil(pitchKick: number): void {
    this.pitch = Scalar.Clamp(
      this.pitch - pitchKick,
      -this.maxPitch,
      this.maxPitch
    );
  }

  /** Teleporta (respawn): adota a posição e descarta inputs pendentes. */
  teleport(feetPosition: Vector3): void {
    this.sim.x = feetPosition.x;
    this.sim.y = feetPosition.y;
    this.sim.z = feetPosition.z;
    this.sim.vy = 0;
    this.sim.grounded = true;
    this.pendingInputs.length = 0;
    this.syncVisual();
  }

  /**
   * Reconciliação: parte do estado autoritativo do servidor e re-simula os
   * inputs ainda não reconhecidos. Com a física determinística compartilhada,
   * o resultado normalmente é idêntico ao previsto (correção invisível).
   */
  reconcile(server: ServerBodyState): void {
    // Descarta inputs que o servidor já processou.
    while (
      this.pendingInputs.length > 0 &&
      this.pendingInputs[0].seq <= server.lastSeq
    ) {
      this.pendingInputs.shift();
    }

    const replayed: BodyState = {
      x: server.x,
      y: server.y,
      z: server.z,
      vy: server.vy,
      grounded: server.grounded,
    };
    for (const input of this.pendingInputs) {
      stepPlayer(replayed, input);
    }
    copyBody(replayed, this.sim);
    this.syncVisual();
  }

  /** Posição dos pés. */
  getFeet(): Vector3 {
    return new Vector3(this.sim.x, this.sim.y, this.sim.z);
  }

  /** Posição do olho (origem do hitscan). */
  getHead(): Vector3 {
    return new Vector3(this.sim.x, this.sim.y + EYE_HEIGHT, this.sim.z);
  }

  private onPointerLockChange = (): void => {
    this.pointerLocked = document.pointerLockElement === this.canvas;
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    this.keys.add(e.code);
    if (e.code === "Space") e.preventDefault();
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.pointerLocked) return;
    const sens = BASE_SENSITIVITY * this.sensitivityMultiplier;
    this.yaw += e.movementX * sens;
    this.pitch += e.movementY * sens;
    this.pitch = Scalar.Clamp(this.pitch, -this.maxPitch, this.maxPitch);
  };

  /** Deve ser chamado a cada frame do render loop. */
  update(deltaSeconds: number): void {
    // Clampa dt para evitar rajada de passos após perda de foco/aba.
    const dt = Math.min(deltaSeconds, 0.1);

    if (this.movementEnabled) {
      this.accumulator += dt;
      while (this.accumulator >= FIXED_DT) {
        this.accumulator -= FIXED_DT;
        this.stepOnce();
      }
    }

    this.syncVisual();
  }

  /** Um passo fixo: monta o input, aplica localmente e envia ao servidor. */
  private stepOnce(): void {
    let forward = 0;
    let strafe = 0;
    if (this.keys.has("KeyW")) forward += 1;
    if (this.keys.has("KeyS")) forward -= 1;
    if (this.keys.has("KeyD")) strafe += 1;
    if (this.keys.has("KeyA")) strafe -= 1;

    const input: PlayerInput = {
      seq: ++this.inputSeq,
      forward,
      strafe,
      yaw: this.yaw,
      jump: this.keys.has("Space"),
      run: this.keys.has("ShiftLeft") || this.keys.has("ShiftRight"),
    };

    stepPlayer(this.sim, input);
    this.pendingInputs.push(input);
    if (this.pendingInputs.length > 120) this.pendingInputs.shift();
    this.onInput?.(input);
  }

  private syncVisual(): void {
    this.body.position.set(this.sim.x, this.sim.y, this.sim.z);
    this.camera.position.set(
      this.sim.x,
      this.sim.y + EYE_HEIGHT,
      this.sim.z
    );
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }

  /** Info de debug para o HUD. */
  getDebugInfo(): string {
    return [
      `pos  x:${this.sim.x.toFixed(1)} y:${this.sim.y.toFixed(1)} z:${this.sim.z.toFixed(1)}`,
      `grounded: ${this.sim.grounded}  vVel: ${this.sim.vy.toFixed(2)}`,
      `pending inputs: ${this.pendingInputs.length}`,
    ].join("\n");
  }
}
