/**
 * Lookup ripple (#674; doc/refractive-water-prototypes.md, "Subtle cyclic distortion"): a slow,
 * low, spatially smooth perturbation of a fake-refraction lookup offset. It never moves a vertex
 * or the block's outline; it only shifts where the captured background is sampled.
 *
 * Two waves, one and two cycles per period, so a full period loops seamlessly. Their phases vary
 * across the block (from its local position) so the background drifts gently rather than the
 * whole cube zooming. The wave constants are fixed cosmetic seeds: no gameplay RNG and no
 * per-frame noise.
 *
 * Each appearance preset owns its own ripple (settings and clock), so tuning one never moves
 * another. The clock advances by the presentation time a tool passes each frame (its elapsed
 * seconds, not a frame count), so irregular frame rates keep the same cycle. Under reduced motion
 * it holds its phase. Zero amplitude adds nothing: the static baseline.
 */

/**
 * The bounds a ripple's settings are kept within (and that controls offer). The period bounds
 * here are the default; a preset may own its own (#795; doc/calm-water-refinements.md).
 */
export const rippleBounds = {
  amplitude: { min: 0, max: 0.03 },
  period: { min: 8, max: 12 },
  scale: { min: 0.5, max: 4 },
  /** Highlight ripple strength: the rings' height, in block units (#797). */
  surface: { min: 0, max: 0.08 },
} as const;

export type PeriodBounds = { min: number; max: number; step: number };

/** The default period bounds, for a preset that declares none. */
export const defaultPeriodBounds: PeriodBounds = { ...rippleBounds.period, step: 0.5 };

export type RippleSettings = {
  amplitude: number;
  period: number;
  scale: number;
  /** This preset's own period bounds; `defaultPeriodBounds` when left out. */
  periodBounds?: PeriodBounds;
  /**
   * Highlight ripple strength (#797; doc/calm-water-refinements.md), where the preset owns one:
   * the height of the concentric rings a turn sets off on each face (src/visual/face-ripple.ts).
   * Zero keeps flat highlights.
   */
  surfaceStrength?: number;
};

export type LookupRipple = {
  /** Shift size, as a share of the screen: bounded by `rippleBounds.amplitude.max`. */
  amplitude: { value: number };
  /** Seconds for one seamless loop. */
  period: { value: number };
  /** The period bounds this ripple owns: its controls, import and clock all read these. */
  periodBounds: PeriodBounds;
  /** Waves across one block: higher is finer, still smooth. */
  scale: { value: number };
  /** Surface-normal strength, where the preset owns one (#797). */
  surface?: { value: number };
  /** Where in its loop the ripple is, from 0 up to 1: derived, never configured or saved. */
  phase: { value: number };
  /**
   * The host's presentation clock as this preset has seen it: seconds advanced so far, and
   * whether the last frame asked for reduced motion. Per-object surface ripples (#797) step on
   * it; derived, never configured or saved.
   */
  clock: { seconds: number; reducedMotion: boolean };
  /** Advance by `delta` seconds of presentation time; held still under reduced motion. */
  advance(time: { delta: number; reducedMotion: boolean }): void;
};

export function createLookupRipple(settings: RippleSettings): LookupRipple {
  const periodBounds = settings.periodBounds ?? defaultPeriodBounds;
  const ripple: LookupRipple = {
    amplitude: { value: settings.amplitude },
    period: { value: settings.period },
    periodBounds,
    scale: { value: settings.scale },
    ...(settings.surfaceStrength !== undefined
      ? { surface: { value: settings.surfaceStrength } }
      : {}),
    phase: { value: 0 },
    clock: { seconds: 0, reducedMotion: false },
    advance({ delta, reducedMotion }) {
      ripple.clock.seconds += Math.max(0, delta);
      ripple.clock.reducedMotion = reducedMotion;
      const step = reducedMotion ? 0 : Math.max(0, delta);
      // The clock runs at the period the controls show: within this ripple's own bounds.
      const period = Math.min(periodBounds.max, Math.max(periodBounds.min, ripple.period.value));
      ripple.phase.value = (ripple.phase.value + step / period) % 1;
    },
  };
  return ripple;
}

/** The uniforms a shader reads, named for the GLSL below. */
export function rippleUniforms(ripple: LookupRipple) {
  return {
    rippleAmplitude: ripple.amplitude,
    rippleScale: ripple.scale,
    ripplePhase: ripple.phase,
    // A preset without one keeps the flat-facet baseline: strength zero.
    rippleSurface: ripple.surface ?? { value: 0 },
  };
}

/** Wave directions and phase seeds: fixed, so the same settings always look the same. */
const waves = [
  { direction: [1.7, 0.9, 1.3], seed: 0.4, cycles: 1, weight: 1 },
  { direction: [-1.1, 2.3, 0.7], seed: 2.1, cycles: 2, weight: 0.5 },
  { direction: [-0.8, 1.4, -1.9], seed: 1.3, cycles: 1, weight: 1 },
  { direction: [2.1, -0.6, 1.2], seed: 4.2, cycles: 2, weight: 0.5 },
] as const;
const weightPerAxis = 1.5;

const glslWave = ({ direction, seed, cycles, weight }: (typeof waves)[number]) =>
  `${weight.toFixed(2)} * sin(${cycles.toFixed(1)} * t + dot(q, vec3(${direction.map((d) => d.toFixed(2)).join(", ")})) + ${seed.toFixed(2)})`;

/**
 * GLSL declaring the uniforms and `vec2 rippleShift(vec3 local)`: the lookup shift at a point in
 * the block's own space. Each axis is at most `rippleAmplitude`.
 */
export const rippleShiftGlsl = /* glsl */ `
  uniform float rippleAmplitude;
  uniform float rippleScale;
  uniform float ripplePhase;
  vec2 rippleShift(vec3 local) {
    float t = 6.283185307179586 * ripplePhase;
    vec3 q = local * rippleScale;
    float x = ${glslWave(waves[0])} + ${glslWave(waves[1])};
    float y = ${glslWave(waves[2])} + ${glslWave(waves[3])};
    return rippleAmplitude * vec2(x, y) / ${weightPerAxis.toFixed(1)};
  }
`;

/** The same shift on the CPU, for tests and tools: matches `rippleShift` in the GLSL. */
export function rippleShift(
  local: readonly [number, number, number],
  ripple: Pick<LookupRipple, "amplitude" | "scale" | "phase">,
): [number, number] {
  const t = 2 * Math.PI * ripple.phase.value;
  const wave = ({ direction, seed, cycles, weight }: (typeof waves)[number]) =>
    weight *
    Math.sin(
      cycles * t +
        direction.reduce((sum, d, axis) => sum + d * local[axis]! * ripple.scale.value, 0) +
        seed,
    );
  const scale = ripple.amplitude.value / weightPerAxis;
  return [(wave(waves[0]) + wave(waves[1])) * scale, (wave(waves[2]) + wave(waves[3])) * scale];
}
