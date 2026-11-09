import * as THREE from "three";

/**
 * Additive blending for glowing effects (fire), adding colour but not alpha. On the table's
 * transparent front canvas (#116) plain additive blending would raise the alpha of empty pixels
 * and show them as black; this keeps them clear, and the premultiplied canvas adds the glow
 * over the layers below when composited.
 */
export const additiveLight = {
  blending: THREE.CustomBlending,
  blendEquation: THREE.AddEquation,
  blendSrc: THREE.SrcAlphaFactor,
  blendDst: THREE.OneFactor,
  blendEquationAlpha: THREE.AddEquation,
  blendSrcAlpha: THREE.ZeroFactor,
  blendDstAlpha: THREE.OneFactor,
} as const;
