/** Floor of the logarithmic fade: -60 dB is effectively silent. */
const fadeFloorDb = -60;

/**
 * A logarithmic (decibel-linear) fade: the level moves evenly in dB, which the ear hears
 * as a steady change, instead of evenly in amplitude. Ends exactly at 0 or 1.
 */
export function logFadeCurve(rising: boolean, steps = 128): Float32Array {
  const curve = new Float32Array(steps);
  for (let i = 0; i < steps; i++) {
    const t = rising ? i / (steps - 1) : 1 - i / (steps - 1);
    curve[i] = t <= 0 ? 0 : 10 ** ((fadeFloorDb * (1 - t)) / 20);
  }
  return curve;
}
