import { CROUCH_EYE_HEIGHT } from "./movement";

/**
 * Hitboxes autoritativas do hitscan (servidor) — o debug do cliente
 * deve espelhar estes valores para mostrar onde o tiro realmente conta.
 *
 * Dimensões do modelo `player_dummy.glb`: 1.0 (x) × 2.0 (y) × 0.5 (z),
 * com a base nos pés. O corpo cobre dos pés aos ombros (~1.5) e a esfera
 * da cabeça vai de ~1.44 ao topo (2.0) — a leve sobreposição no pescoço
 * evita buraco sem-hitbox entre corpo e cabeça.
 */
export const HITBOX = {
  headCenterY: 1.72,
  headRadius: 0.28,
  bodyCenterY: 0.75,
  bodyHalf: { x: 0.5, y: 0.75, z: 0.3 },
  crouchHeadCenterY: CROUCH_EYE_HEIGHT,
  crouchBodyCenterY: 0.5,
  crouchBodyHalfY: 0.5,
} as const;
