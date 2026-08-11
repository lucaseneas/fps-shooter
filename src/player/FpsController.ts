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
  CROUCH_EYE_HEIGHT,
  FIXED_DT,
} from "../../shared/movement";

const BASE_SENSITIVITY = 0.0022;
/** Velocidade de transição da câmera ao agachar/levantar. */
const CROUCH_CAM_SPEED = 12;
/**
 * Erro de predição acima disso (m) é dessincronia real (perda de input,
 * respawn) e vira snap seco, sem suavização.
 */
const RECONCILE_SNAP_DIST = 0.35;
/** Velocidade com que a correção visual da reconciliação decai até zero. */
const RECONCILE_SMOOTH_SPEED = 14;
/** Teto da correção visual acumulada — acima disso, snap seco. */
const RECONCILE_SMOOTH_CAP = 0.6;
/**
 * Delta por evento acima disso é lixo puro (descarte imediato). Inalcançável
 * por humanos em qualquer hardware: 4000 counts/evento = ~8 m/s de mão
 * mesmo num mouse de 125Hz a 800 DPI.
 */
const MOUSE_SPIKE_ABS = 4000;
/**
 * Evento fora desta razão vs. o movimento recente é SUSPEITO (possível
 * spike de warp do pointer lock): fica segurado por 1 evento até a
 * continuidade confirmar se era flick legítimo ou lixo. Como a suspeita só
 * atrasa (nunca descarta), os valores servem para qualquer DPI/polling.
 */
const MOUSE_SPIKE_RATIO = 4;
const MOUSE_SPIKE_FLOOR = 150;
/** Suspeito sem evento seguinte neste tempo (ms) era legítimo: aplica. */
const MOUSE_HOLD_MS = 32;

/**
 * Teclas capturadas pelo Keyboard Lock (bloqueia atalhos do Chrome).
 * Escape propositalmente fora da lista para o ESC soltar o mouse.
 */
const LOCKED_KEYS = [
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "KeyR",
  "KeyQ",
  "KeyT",
  "KeyN",
  "KeyP",
  "KeyF",
  "KeyG",
  "KeyH",
  "KeyJ",
  "KeyL",
  "KeyO",
  "KeyU",
  "KeyE",
  "KeyI",
  "KeyC",
  "KeyV",
  "KeyX",
  "KeyZ",
  "KeyY",
  "Digit1",
  "Digit2",
  "Digit3",
  "Digit4",
  "Digit5",
  "Digit6",
  "Digit7",
  "Digit8",
  "Digit9",
  "Digit0",
  "F5",
  "Tab",
  "Space",
  "ControlLeft",
  "ControlRight",
  "ShiftLeft",
  "ShiftRight",
  "AltLeft",
  "AltRight",
  "MetaLeft",
  "MetaRight",
];

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
 *
 * A câmera renderiza a posição INTERPOLADA entre os dois últimos passos
 * fixos (suavidade em qualquer refresh rate), e as micro-correções da
 * reconciliação são aplicadas por um offset visual que decai — a simulação
 * em si permanece determinística.
 */
export class FpsController {
  readonly camera: UniversalCamera;

  /** Mesh invisível que ancora hitboxes e posição visual do player. */
  private readonly body: Mesh;
  private readonly canvas: HTMLCanvasElement;

  /** Estado físico previsto (posição = pés). */
  private readonly sim: BodyState;
  /** Estado do passo fixo anterior — base da interpolação de render. */
  private readonly prevSim: BodyState;
  private readonly pendingInputs: PlayerInput[] = [];
  private inputSeq = 0;
  private accumulator = 0;
  /** Correção visual da reconciliação — decai no update, nunca toca a sim. */
  private smoothX = 0;
  private smoothY = 0;
  private smoothZ = 0;
  /** Último seq reconhecido já re-simulado (evita replay redundante). */
  private lastReconciledSeq = -1;

  /** Callback para enviar cada input ao servidor. */
  onInput: ((input: PlayerInput) => void) | null = null;

  // Estado de input
  private readonly keys = new Set<string>();
  private yaw = 0;
  /** Mira real (só o mouse altera). */
  private basePitch = 0;
  /** Recoil visual temporário — some ao parar de atirar. */
  private recoilOffset = 0;
  private recoilYawOffset = 0;
  private pointerLocked = false;
  private movementEnabled = true;
  private lookEnabled = true;

  private sensitivityMultiplier = 1;
  /** Multiplicador de velocidade da arma equipada (ex.: faca = 1.2). */
  private speedMult = 1;
  /** Magnitudes recentes de delta APLICADO — base da suspeita de spike. */
  private readonly recentDeltas: number[] = [];
  /** Evento suspeito aguardando o próximo para confirmar continuidade. */
  private heldMouse: { dx: number; dy: number; at: number } | null = null;
  private spikesHeld = 0;
  private spikesDropped = 0;
  private maxSpikeDropped = 0;
  /** True quando o pointer lock está em raw input (unadjustedMovement). */
  private rawInput = false;
  /** Telemetria: taxa de eventos de mouse (janela de 1s). */
  private mouseEventCount = 0;
  private mouseHz = 0;
  private mouseHzWindowStart = 0;
  private readonly maxPitch = Math.PI / 2 - 0.02;
  /** Velocidade de retorno da mira após soltar o gatilho. */
  private readonly recoilRecoverySpeed = 16;
  /** Altura atual dos olhos (interpolada entre em pé e agachado). */
  private eyeY = EYE_HEIGHT;
  /** fps = jogando · overview = topo pré-spawn · freefly = espectador livre. */
  private cameraMode: "fps" | "overview" | "freefly" = "fps";

  constructor(
    scene: Scene,
    canvas: HTMLCanvasElement,
    options: { spawnPosition?: Vector3 } = {}
  ) {
    this.canvas = canvas;

    const spawn = options.spawnPosition ?? new Vector3(0, 0, -18);
    this.sim = createBody(spawn.x, spawn.z);
    this.prevSim = createBody(spawn.x, spawn.z);

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
    window.addEventListener("keydown", this.onKeyDown, true);
    window.addEventListener("keyup", this.onKeyUp, true);
    document.addEventListener("pointerlockchange", this.onPointerLockChange);
    document.addEventListener("mousemove", this.onMouseMove);
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown, true);
    window.removeEventListener("keyup", this.onKeyUp, true);
    document.removeEventListener("pointerlockchange", this.onPointerLockChange);
    document.removeEventListener("mousemove", this.onMouseMove);
    this.body.dispose();
  }

  /** Solicita o travamento do ponteiro (chamado ao clicar em "jogar"). */
  requestPointerLock(): void {
    void this.enterImmersive();
  }

  /**
   * Fullscreen + pointer lock + Keyboard Lock.
   * Sem fullscreen o Chrome ignora preventDefault em Ctrl+R / Ctrl+W.
   * Não trava Escape — assim ESC continua soltando o mouse.
   */
  private async enterImmersive(): Promise<void> {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      /* gesto inválido ou política do browser */
    }

    if (document.pointerLockElement !== this.canvas) {
      this.requestLockRaw();
    }

    try {
      await navigator.keyboard?.lock?.(LOCKED_KEYS);
    } catch {
      /* API indisponível ou sem fullscreen */
    }
  }

  /**
   * Pointer lock com raw input (unadjustedMovement): o browser entrega os
   * deltas crus do dispositivo — sem aceleração do SO e SEM o warp do cursor
   * ao centro da janela, que é a origem dos spikes que "teleportavam" a mira.
   * Browsers sem suporte (Safari) caem no pointer lock padrão, onde o filtro
   * anti-spike por continuidade continua protegendo.
   */
  private requestLockRaw(): void {
    try {
      const p = this.canvas.requestPointerLock({ unadjustedMovement: true });
      this.rawInput = true;
      p?.catch?.(() => {
        this.rawInput = false;
        try {
          this.canvas.requestPointerLock();
        } catch {
          /* gesto inválido */
        }
      });
    } catch {
      this.rawInput = false;
      try {
        this.canvas.requestPointerLock();
      } catch {
        /* gesto inválido */
      }
    }
  }

  /** Sai de fullscreen / pointer lock / keyboard lock (voltar ao menu). */
  exitImmersive(): void {
    navigator.keyboard?.unlock?.();
    if (document.pointerLockElement) document.exitPointerLock();
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    }
  }

  /** Solta o mouse e o keyboard lock (pausa / ESC), mantém fullscreen. */
  releasePointerLock(): void {
    navigator.keyboard?.unlock?.();
    if (document.pointerLockElement) document.exitPointerLock();
  }

  get isPointerLocked(): boolean {
    return this.pointerLocked;
  }

  /** Multiplicador de sensibilidade do mouse (menu de configurações). */
  setSensitivity(multiplier: number): void {
    this.sensitivityMultiplier = Scalar.Clamp(multiplier, 0.05, 2);
  }

  /** Velocidade extra da arma (faca +20%). Limitado em stepPlayer. */
  setSpeedMult(mult: number): void {
    this.speedMult = Number.isFinite(mult) ? Math.max(1, mult) : 1;
  }

  getSensitivity(): number {
    return this.sensitivityMultiplier;
  }

  /** Congela o input de movimento (morte / fim de partida). */
  setMovementEnabled(on: boolean): void {
    this.movementEnabled = on;
    if (!on) this.keys.clear();
  }

  /** Bloqueia a rotação da câmera sem interromper a simulação do jogador. */
  setLookEnabled(on: boolean): void {
    this.lookEnabled = on;
  }

  get isSpectating(): boolean {
    return this.cameraMode !== "fps";
  }

  get isFreeFlying(): boolean {
    return this.cameraMode === "freefly";
  }

  /** Visão de cima do mapa (pré-spawn / escolha de kit). */
  enterSpectatorOverview(): void {
    this.cameraMode = "overview";
    this.movementEnabled = false;
    this.lookEnabled = false;
    this.keys.clear();
    this.pendingInputs.length = 0;
    this.camera.fov = 0.92;
    // Leve offset em Z evita look-at degenerado no eixo Y.
    this.camera.position.set(0, 72, 0.05);
    this.camera.setTarget(new Vector3(0, 0, 0));
  }

  /**
   * Espectador invisível: câmera livre (andar + voar), sem física/arma.
   * Posição só local — o servidor mantém o player como não-spawnado.
   */
  enterFreeFlySpectator(start?: { x: number; y: number; z: number }): void {
    this.cameraMode = "freefly";
    this.movementEnabled = false;
    this.lookEnabled = true;
    this.keys.clear();
    this.pendingInputs.length = 0;
    this.recoilOffset = 0;
    this.recoilYawOffset = 0;
    this.camera.fov = 1.15;

    const x = start?.x ?? 0;
    const y = start?.y ?? 16;
    const z = start?.z ?? -22;
    this.sim.x = x;
    this.sim.y = y;
    this.sim.z = z;
    copyBody(this.sim, this.prevSim);
    this.smoothX = 0;
    this.smoothY = 0;
    this.smoothZ = 0;
    this.yaw = 0;
    this.basePitch = 0.4;
    this.camera.position.set(x, y, z);
    this.camera.rotation.set(this.basePitch, this.yaw, 0);
  }

  /** Volta à câmera FPS após o spawn. */
  exitSpectatorOverview(): void {
    if (this.cameraMode === "fps") return;
    this.cameraMode = "fps";
    this.camera.fov = 1.15;
    this.syncVisual();
  }

  /** Chute de recoil visual: levanta a mira enquanto atira. */
  applyRecoil(pitchKick: number, yawKick = 0): void {
    this.recoilOffset = Scalar.Clamp(
      this.recoilOffset - pitchKick,
      -this.maxPitch,
      this.maxPitch
    );
    this.recoilYawOffset += yawKick;
  }

  /** Recupera a mira quando não está atirando. */
  updateRecoil(deltaSeconds: number, shooting: boolean): void {
    if (shooting) return;
    const t = Math.min(1, deltaSeconds * this.recoilRecoverySpeed);
    this.recoilOffset = Scalar.Lerp(this.recoilOffset, 0, t);
    this.recoilYawOffset = Scalar.Lerp(this.recoilYawOffset, 0, t);
    if (Math.abs(this.recoilOffset) < 0.00005) this.recoilOffset = 0;
    if (Math.abs(this.recoilYawOffset) < 0.00005) this.recoilYawOffset = 0;
  }

  /** Teleporta (respawn): adota a posição e descarta inputs pendentes. */
  teleport(feetPosition: Vector3): void {
    this.sim.x = feetPosition.x;
    this.sim.y = feetPosition.y;
    this.sim.z = feetPosition.z;
    this.sim.vy = 0;
    this.sim.grounded = true;
    copyBody(this.sim, this.prevSim);
    this.pendingInputs.length = 0;
    this.recoilOffset = 0;
    this.recoilYawOffset = 0;
    this.smoothX = 0;
    this.smoothY = 0;
    this.smoothZ = 0;
    this.accumulator = 0;
    this.lastReconciledSeq = -1;
    this.syncVisual();
  }

  /**
   * Reconciliação: parte do estado autoritativo do servidor e re-simula os
   * inputs ainda não reconhecidos. Com a física determinística compartilhada,
   * o resultado normalmente é idêntico ao previsto. Divergências pequenas
   * viram uma correção VISUAL que decai suavemente no update (sem solavanco
   * na câmera); só divergências grandes (perda de input, respawn) dão snap.
   */
  reconcile(server: ServerBodyState): void {
    // Nenhum input novo reconhecido desde o último replay — nada mudaria.
    if (server.lastSeq === this.lastReconciledSeq) return;
    this.lastReconciledSeq = server.lastSeq;

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

    const dx = replayed.x - this.sim.x;
    const dy = replayed.y - this.sim.y;
    const dz = replayed.z - this.sim.z;
    const err = Math.hypot(dx, dy, dz);

    if (err > RECONCILE_SNAP_DIST) {
      // Dessincronia real: snap seco e zera a correção visual.
      this.smoothX = 0;
      this.smoothY = 0;
      this.smoothZ = 0;
      copyBody(replayed, this.prevSim);
    } else {
      // Desloca o passo anterior junto (a interpolação não oscila) e empurra
      // o erro para a correção visual, que decai nos próximos frames.
      this.prevSim.x += dx;
      this.prevSim.y += dy;
      this.prevSim.z += dz;
      this.prevSim.vy = replayed.vy;
      this.prevSim.grounded = replayed.grounded;
      this.smoothX -= dx;
      this.smoothY -= dy;
      this.smoothZ -= dz;
      if (
        Math.hypot(this.smoothX, this.smoothY, this.smoothZ) >
        RECONCILE_SMOOTH_CAP
      ) {
        this.smoothX = 0;
        this.smoothY = 0;
        this.smoothZ = 0;
        copyBody(replayed, this.prevSim);
      }
    }
    copyBody(replayed, this.sim);
  }

  /** True quando andando no chão (usado para o som de passos). */
  get isMovingOnGround(): boolean {
    return (
      this.movementEnabled &&
      this.sim.grounded &&
      (this.keys.has("KeyW") ||
        this.keys.has("KeyA") ||
        this.keys.has("KeyS") ||
        this.keys.has("KeyD"))
    );
  }

  get isRunning(): boolean {
    return (
      !this.isCrouching &&
      (this.keys.has("ShiftLeft") || this.keys.has("ShiftRight"))
    );
  }

  get isCrouching(): boolean {
    return (
      this.movementEnabled &&
      (this.keys.has("ControlLeft") || this.keys.has("ControlRight"))
    );
  }

  /** False durante pulo/queda — usado para spread aéreo. */
  get isGrounded(): boolean {
    return this.sim.grounded;
  }

  /** Posição dos pés. */
  getFeet(): Vector3 {
    return new Vector3(this.sim.x, this.sim.y, this.sim.z);
  }

  /** Direção horizontal da câmera (usada pelo minimapa). */
  getYaw(): number {
    return this.yaw;
  }

  /** Posição do olho (origem do hitscan). */
  getHead(): Vector3 {
    return new Vector3(this.sim.x, this.sim.y + this.eyeY, this.sim.z);
  }

  private onPointerLockChange = (): void => {
    this.pointerLocked = document.pointerLockElement === this.canvas;
    if (this.pointerLocked) {
      // Reaplica o lock se o fullscreen já estiver ativo.
      void navigator.keyboard?.lock?.(LOCKED_KEYS).catch(() => {});
    } else {
      navigator.keyboard?.unlock?.();
      // Não aplica movimento suspeito de uma sessão de lock anterior.
      this.heldMouse = null;
      this.recentDeltas.length = 0;
    }
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (this.pointerLocked) {
      const browserChord =
        e.ctrlKey ||
        e.metaKey ||
        e.code === "ControlLeft" ||
        e.code === "ControlRight" ||
        e.key === "F5" ||
        (e.key === "r" && (e.ctrlKey || e.metaKey)) ||
        (e.key === "R" && (e.ctrlKey || e.metaKey));
      if (browserChord) e.preventDefault();
    }

    if (!this.movementEnabled && this.cameraMode !== "freefly") return;
    this.keys.add(e.code);
    if (e.code === "Space") e.preventDefault();
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (
      this.pointerLocked &&
      (e.ctrlKey ||
        e.metaKey ||
        e.code === "ControlLeft" ||
        e.code === "ControlRight")
    ) {
      e.preventDefault();
    }
    this.keys.delete(e.code);
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.pointerLocked || !this.lookEnabled) return;

    // Telemetria de taxa de eventos (janela de 1s).
    const nowMs = performance.now();
    if (nowMs - this.mouseHzWindowStart >= 1000) {
      this.mouseHz = this.mouseEventCount;
      this.mouseEventCount = 0;
      this.mouseHzWindowStart = nowMs;
    }
    this.mouseEventCount++;

    const dx = e.movementX;
    const dy = e.movementY;
    const mag = Math.max(Math.abs(dx), Math.abs(dy));

    // Lixo catastrófico: descarte direto, sem nem segurar.
    if (mag > MOUSE_SPIKE_ABS) {
      this.spikesDropped++;
      if (mag > this.maxSpikeDropped) this.maxSpikeDropped = mag;
      return;
    }

    // Resolve o suspeito anterior à luz do novo evento.
    this.resolveHeldMouse(dx, dy);

    let recentMax = 0;
    for (const m of this.recentDeltas) if (m > recentMax) recentMax = m;
    const limit = Math.max(MOUSE_SPIKE_FLOOR, recentMax * MOUSE_SPIKE_RATIO);

    if (mag > limit) {
      // Suspeito (possível spike de warp): segura até o próximo evento
      // decidir. Flick legítimo só perde 1 evento de latência — nunca movimento.
      this.heldMouse = { dx, dy, at: nowMs };
      this.spikesHeld++;
      return;
    }

    this.applyMouseDelta(dx, dy);
  };

  /**
   * Decide o evento segurado quando o próximo chega: continuidade (mesma
   * direção, magnitude na faixa 0.25–5× — cobre a desaceleração natural da
   * mão) significa flick legítimo → aplica; movimento que voltou ao patamar
   * anterior ou inverteu (par ida+volta do warp) significa spike → descarta.
   */
  private resolveHeldMouse(dx: number, dy: number): void {
    if (!this.heldMouse) return;
    const h = this.heldMouse;
    const hMag = Math.max(Math.abs(h.dx), Math.abs(h.dy));
    const eMag = Math.max(Math.abs(dx), Math.abs(dy));
    const sameDir = h.dx * dx + h.dy * dy > 0;
    const continuous = sameDir && eMag >= hMag * 0.25 && eMag <= hMag * 5;
    if (continuous) {
      this.applyHeldMouse();
    } else {
      this.spikesDropped++;
      if (hMag > this.maxSpikeDropped) this.maxSpikeDropped = hMag;
      this.heldMouse = null;
    }
  }

  /** Aplica o evento segurado (confirmado como legítimo ou expirado). */
  private applyHeldMouse(): void {
    if (!this.heldMouse) return;
    const { dx, dy } = this.heldMouse;
    this.heldMouse = null;
    this.applyMouseDelta(dx, dy);
  }

  private applyMouseDelta(dx: number, dy: number): void {
    this.pushRecentDelta(Math.max(Math.abs(dx), Math.abs(dy)));
    const sens = BASE_SENSITIVITY * this.sensitivityMultiplier;
    this.yaw += dx * sens;
    this.basePitch += dy * sens;
    this.basePitch = Scalar.Clamp(this.basePitch, -this.maxPitch, this.maxPitch);
  }

  private pushRecentDelta(mag: number): void {
    this.recentDeltas.push(mag);
    if (this.recentDeltas.length > 16) this.recentDeltas.shift();
  }

  /** Deve ser chamado a cada frame do render loop. */
  update(deltaSeconds: number): void {
    const dt = Math.min(deltaSeconds, 0.1);

    // Suspeito que ficou sem evento seguinte era legítimo (fim de swipe):
    // aplica com atraso máximo de MOUSE_HOLD_MS.
    if (
      this.heldMouse &&
      performance.now() - this.heldMouse.at > MOUSE_HOLD_MS
    ) {
      this.applyHeldMouse();
    }

    if (this.cameraMode === "overview") return;

    if (this.cameraMode === "freefly") {
      this.updateFreeFly(dt);
      return;
    }

    if (this.movementEnabled) {
      this.accumulator += dt;
      while (this.accumulator >= FIXED_DT) {
        this.accumulator -= FIXED_DT;
        copyBody(this.sim, this.prevSim);
        this.stepOnce();
      }
    }

    // Correção visual da reconciliação decai sem afetar a simulação.
    const smoothDecay = Math.min(1, dt * RECONCILE_SMOOTH_SPEED);
    this.smoothX = Scalar.Lerp(this.smoothX, 0, smoothDecay);
    this.smoothY = Scalar.Lerp(this.smoothY, 0, smoothDecay);
    this.smoothZ = Scalar.Lerp(this.smoothZ, 0, smoothDecay);

    const targetEye = this.isCrouching ? CROUCH_EYE_HEIGHT : EYE_HEIGHT;
    this.eyeY += (targetEye - this.eyeY) * Math.min(1, dt * CROUCH_CAM_SPEED);

    this.syncVisual(this.movementEnabled ? this.accumulator / FIXED_DT : 1);
  }

  /** Voo livre relativo à mira (sem gravidade / colisão). */
  private updateFreeFly(dt: number): void {
    let forward = 0;
    let strafe = 0;
    let up = 0;
    if (this.keys.has("KeyW")) forward += 1;
    if (this.keys.has("KeyS")) forward -= 1;
    if (this.keys.has("KeyD")) strafe += 1;
    if (this.keys.has("KeyA")) strafe -= 1;
    if (this.keys.has("Space") || this.keys.has("KeyE")) up += 1;
    if (
      this.keys.has("ControlLeft") ||
      this.keys.has("ControlRight") ||
      this.keys.has("KeyQ") ||
      this.keys.has("KeyC")
    ) {
      up -= 1;
    }

    const speeding =
      this.keys.has("ShiftLeft") || this.keys.has("ShiftRight");
    const speed = speeding ? 32 : 14;

    const len = Math.hypot(forward, strafe, up);
    if (len > 0) {
      const nF = forward / len;
      const nS = strafe / len;
      const nU = up / len;
      const pitch = this.basePitch;
      const yaw = this.yaw;
      const cosP = Math.cos(pitch);
      const fx = Math.sin(yaw) * cosP;
      const fy = -Math.sin(pitch);
      const fz = Math.cos(yaw) * cosP;
      const rx = Math.cos(yaw);
      const rz = -Math.sin(yaw);

      this.camera.position.x += (fx * nF + rx * nS) * speed * dt;
      this.camera.position.y += (fy * nF + nU) * speed * dt;
      this.camera.position.z += (fz * nF + rz * nS) * speed * dt;
    }

    this.camera.position.y = Math.max(1.2, Math.min(90, this.camera.position.y));
    this.sim.x = this.camera.position.x;
    this.sim.y = this.camera.position.y;
    this.sim.z = this.camera.position.z;
    this.body.position.set(this.sim.x, this.sim.y, this.sim.z);
    this.camera.rotation.set(this.basePitch, this.yaw, 0);
  }

  /** Um passo fixo: monta o input, aplica localmente e envia ao servidor. */
  private stepOnce(): void {
    let forward = 0;
    let strafe = 0;
    if (this.keys.has("KeyW")) forward += 1;
    if (this.keys.has("KeyS")) forward -= 1;
    if (this.keys.has("KeyD")) strafe += 1;
    if (this.keys.has("KeyA")) strafe -= 1;

    const crouch =
      this.keys.has("ControlLeft") || this.keys.has("ControlRight");
    const input: PlayerInput = {
      seq: ++this.inputSeq,
      forward,
      strafe,
      yaw: this.yaw,
      jump: this.keys.has("Space"),
      run:
        !crouch &&
        (this.keys.has("ShiftLeft") || this.keys.has("ShiftRight")),
      crouch,
      speedMult: this.speedMult,
    };

    stepPlayer(this.sim, input);
    this.pendingInputs.push(input);
    if (this.pendingInputs.length > 120) this.pendingInputs.shift();
    this.onInput?.(input);
  }

  /**
   * Câmera/corpo seguem a simulação INTERPOLADA entre o passo anterior e o
   * atual (alpha = fração já decorrida do próximo passo). Sem isso a posição
   * anda em degraus de 60Hz enquanto o render roda solto — judder visível
   * ao andar e virar a câmera ao mesmo tempo. A rotação continua crua
   * (mouse aplicado no mesmo frame) para não adicionar latência à mira.
   */
  private syncVisual(alpha = 1): void {
    const x =
      this.prevSim.x + (this.sim.x - this.prevSim.x) * alpha + this.smoothX;
    const y =
      this.prevSim.y + (this.sim.y - this.prevSim.y) * alpha + this.smoothY;
    const z =
      this.prevSim.z + (this.sim.z - this.prevSim.z) * alpha + this.smoothZ;
    this.body.position.set(x, y, z);
    this.camera.position.set(x, y + this.eyeY, z);
    this.camera.rotation.set(
      Scalar.Clamp(this.basePitch + this.recoilOffset, -this.maxPitch, this.maxPitch),
      this.yaw + this.recoilYawOffset,
      0
    );
  }

  /** Info de debug para o HUD. */
  getDebugInfo(): string {
    return [
      `pos  x:${this.sim.x.toFixed(1)} y:${this.sim.y.toFixed(1)} z:${this.sim.z.toFixed(1)}`,
      `grounded: ${this.sim.grounded}  vVel: ${this.sim.vy.toFixed(2)}`,
      `pending inputs: ${this.pendingInputs.length}`,
      `correção visual: ${Math.hypot(this.smoothX, this.smoothY, this.smoothZ).toFixed(3)}m`,
      `mouse: ${this.mouseHz} Hz ${this.rawInput ? "raw" : "std"} · spikes segurados:${this.spikesHeld} descartados:${this.spikesDropped} (máx ${this.maxSpikeDropped})`,
    ].join("\n");
  }
}
