import { MAP_BOXES, PLAY_BOUND } from "./mapData";

/**
 * Simulação de movimento do player — código COMPARTILHADO e determinístico.
 *
 * O cliente roda esta função para prediction; o servidor roda a MESMA função
 * como autoridade. Como ambos usam os mesmos floats (f64) e o mesmo timestep
 * fixo, o replay de inputs no cliente reproduz o resultado do servidor
 * exatamente — a reconciliação só diverge se houver perda/reordenação.
 */

export const PLAYER_RADIUS = 0.5;
export const PLAYER_HEIGHT = 1.8;
export const EYE_HEIGHT = 1.7;
export const WALK_SPEED = 5.5;
export const RUN_MULTIPLIER = 1.5;
/** Strafe lateral é mais lento que andar para frente (CS-like). */
export const STRAFE_MULTIPLIER = 0.75;
export const JUMP_STRENGTH = 7.5;
export const GRAVITY = 22;
/** Timestep fixo da simulação (60Hz). */
export const FIXED_DT = 1 / 60;
/** Altura máxima de degrau que o player sobe andando. */
const STEP_HEIGHT = 0.55;
const EPS = 1e-4;

export interface PlayerInput {
  /** Número de sequência para ack/replay na reconciliação. */
  seq: number;
  /** -1 (trás), 0, 1 (frente). */
  forward: number;
  /** -1 (esquerda), 0, 1 (direita). */
  strafe: number;
  /** Yaw da câmera no momento do input (radianos). */
  yaw: number;
  jump: boolean;
  run: boolean;
}

/** Estado físico do corpo (posição = pés). */
export interface BodyState {
  x: number;
  y: number;
  z: number;
  /** Velocidade vertical. */
  vy: number;
  grounded: boolean;
}

export function createBody(x: number, z: number): BodyState {
  return { x, y: 0, z, vy: 0, grounded: true };
}

export function copyBody(from: BodyState, to: BodyState): void {
  to.x = from.x;
  to.y = from.y;
  to.z = from.z;
  to.vy = from.vy;
  to.grounded = from.grounded;
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/** Avança a simulação em exatamente um passo fixo (FIXED_DT). */
export function stepPlayer(s: BodyState, input: PlayerInput): void {
  const dt = FIXED_DT;
  const prevFeet = s.y;

  // --- Direção desejada no plano XZ, relativa ao yaw ---
  const f = Math.sign(input.forward);
  const st = Math.sign(input.strafe) * STRAFE_MULTIPLIER;
  const sin = Math.sin(input.yaw);
  const cos = Math.cos(input.yaw);
  let wx = sin * f + cos * st;
  let wz = cos * f - sin * st;
  // Só normaliza para baixo: strafe puro fica mais lento que andar.
  const len = Math.hypot(wx, wz);
  if (len > 1) {
    wx /= len;
    wz /= len;
  }
  const speed = WALK_SPEED * (input.run ? RUN_MULTIPLIER : 1);

  // --- Movimento horizontal com push-out contra AABBs ---
  s.x += wx * speed * dt;
  s.z += wz * speed * dt;

  for (const b of MAP_BOXES) {
    const top = b.y + b.h / 2;
    const bottom = b.y - b.h / 2;
    // Caixa baixa o bastante para subir como degrau, ou acima da cabeça.
    if (top <= prevFeet + STEP_HEIGHT) continue;
    if (bottom >= prevFeet + PLAYER_HEIGHT) continue;

    const ex = b.w / 2 + PLAYER_RADIUS;
    const ez = b.d / 2 + PLAYER_RADIUS;
    const rx = s.x - b.x;
    const rz = s.z - b.z;
    if (Math.abs(rx) >= ex || Math.abs(rz) >= ez) continue;

    const penX = ex - Math.abs(rx);
    const penZ = ez - Math.abs(rz);
    if (penX < penZ) {
      s.x = b.x + Math.sign(rx || 1) * ex;
    } else {
      s.z = b.z + Math.sign(rz || 1) * ez;
    }
  }

  s.x = clamp(s.x, -PLAY_BOUND, PLAY_BOUND);
  s.z = clamp(s.z, -PLAY_BOUND, PLAY_BOUND);

  // --- Pulo ---
  if (input.jump && s.grounded) {
    s.vy = JUMP_STRENGTH;
    s.grounded = false;
  }

  // --- Gravidade + movimento vertical ---
  s.vy -= GRAVITY * dt;
  s.y += s.vy * dt;

  if (s.vy <= 0) {
    // Superfície de apoio mais alta que os pés cruzaram neste passo.
    let landing = s.y <= 0 ? 0 : -Infinity;
    for (const b of MAP_BOXES) {
      const top = b.y + b.h / 2;
      const ex = b.w / 2 + PLAYER_RADIUS;
      const ez = b.d / 2 + PLAYER_RADIUS;
      if (Math.abs(s.x - b.x) >= ex || Math.abs(s.z - b.z) >= ez) continue;

      // Andando pode "subir" degraus; caindo só pousa em topo que cruzou.
      const reachable = s.grounded
        ? top <= prevFeet + STEP_HEIGHT
        : top <= prevFeet + EPS;
      if (reachable && s.y <= top && top > landing) landing = top;
    }

    if (landing > -Infinity) {
      s.y = landing;
      s.vy = 0;
      s.grounded = true;
    } else {
      s.grounded = false;
    }
  } else {
    s.grounded = false;
  }
}
