/**
 * Hitboxes autoritativas do hitscan (servidor) — o debug do cliente
 * deve espelhar estes valores para mostrar onde o tiro realmente conta.
 *
 * Dimensões do modelo `player_dummy.glb`: 1.0 (x) × 2.0 (y) × 0.5 (z),
 * com a base nos pés. O corpo cobre dos pés aos ombros (~1.5) e a esfera
 * da cabeça vai de ~1.44 ao topo (2.0) — a leve sobreposição no pescoço
 * evita buraco sem-hitbox entre corpo e cabeça.
 *
 * Crouch_Idle / Crouch_Walk só inclinam o torso (~24°) e recuam 0.12;
 * a cabeça permanece ~1.66 acima dos pés (não é um squat de cápsula).
 */
export const HITBOX = {
  headCenterY: 1.72,
  headRadius: 0.28,
  bodyCenterY: 0.75,
  bodyHalf: { x: 0.5, y: 0.75, z: 0.3 },
  /** Centro da cabeça na pose Crouch_Idle (pés na origem). */
  crouchHeadCenterY: 1.66,
  /** Avanço da cabeça na inclinação do Crouch_Idle (eixo local Z). */
  crouchHeadForward: 0.18,
  /** Corpo 0–1.44: pés até o ombro na pose inclinada. */
  crouchBodyCenterY: 0.72,
  crouchBodyHalfY: 0.72,
} as const;
