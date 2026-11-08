import { easeInOutCubic } from "../easing";

/** Floor of the logarithmic fade: -60 dB is effectively silent. */
const fadeFloorDb = -60;

/** The shape of a crossfade: how each track's level moves over the fade. */
export type FadeKind = "logarithmic" | "linear" | "equal-power" | "s-curve" | "exponential";

export const fadeKinds: Record<FadeKind, string> = {
  logarithmic: "Logarithmic (even in dB)",
  linear: "Linear",
  "equal-power": "Equal-power (constant loudness)",
  "s-curve": "S-curve (ease in-out)",
  exponential: "Exponential (square law)",
};

/** Gain (0 to 1) of the rising track at progress t (0 to 1). The falling track mirrors it. */
export function fadeGain(kind: FadeKind, t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  switch (kind) {
    case "logarithmic":
      // Moves evenly in decibels, which the ear hears as a steady change.
      return 10 ** ((fadeFloorDb * (1 - t)) / 20);
    case "linear":
      return t;
    case "equal-power":
      // sin^2 + cos^2 = 1: the combined power of both tracks stays constant.
      return Math.sin((t * Math.PI) / 2);
    case "s-curve":
      return easeInOutCubic(t);
    case "exponential":
      return t * t;
  }
}

/**
 * Sampled gain curve for Web Audio's setValueCurveAtTime. A falling curve is the rising
 * one played backwards, so both tracks use the same shape.
 */
export function fadeCurve(kind: FadeKind, rising: boolean, steps = 128): Float32Array {
  const curve = new Float32Array(steps);
  for (let i = 0; i < steps; i++) {
    const t = rising ? i / (steps - 1) : 1 - i / (steps - 1);
    curve[i] = fadeGain(kind, t);
  }
  return curve;
}

/** The original logarithmic curve, kept for callers and tests that name it directly. */
export function logFadeCurve(rising: boolean, steps = 128): Float32Array {
  return fadeCurve("logarithmic", rising, steps);
}
