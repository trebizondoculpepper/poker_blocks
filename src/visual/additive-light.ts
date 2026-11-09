import * as THREE from "three";

/**
 * How glowing effects (fire) blend (#116, #190). The shaders write premultiplied light, with the
 * glow's brightness as its coverage, and this blends it "over" what is behind. On the table's
 * transparent front canvas that leaves a valid premultiplied pixel: the glow where the flame
 * is, and nothing (fully transparent) where it isn't, so the empty frame never shows as black
 * and the composited canvas lights up whatever is drawn below it.
 */
export const additiveLight = {
  blending: THREE.CustomBlending,
  blendEquation: THREE.AddEquation,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.OneMinusSrcAlphaFactor,
  blendEquationAlpha: THREE.AddEquation,
  blendSrcAlpha: THREE.OneFactor,
  blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
} as const;
