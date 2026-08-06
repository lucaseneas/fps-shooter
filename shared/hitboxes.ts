import { CROUCH_EYE_HEIGHT } from "./movement";

/**
 * Hitboxes autoritativas do hitscan (servidor) — o debug do cliente
 * deve espelhar estes valores para mostrar onde o tiro realmente conta.
 */
export const HITBOX = {
  headCenterY: 1.7,
  headRadius: 0.225,
  bodyCenterY: 0.75,
  bodyHalf: { x: 0.45, y: 0.65, z: 0.45 },
  crouchHeadCenterY: CROUCH_EYE_HEIGHT,
  crouchBodyCenterY: 0.5,
  crouchBodyHalfY: 0.5,
} as const;
