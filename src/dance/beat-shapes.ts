/**
 * Beat shapes (#256): how a dance moves through its cycle. Each is a pure function of phase
 * (0 at the start of the cycle, rising to 1 at its end) returning a value from 0 to 1, kept in
 * a registry by name so a dancer's configuration names one and no code asks which it is.
 *
 * - `sine`: a smooth sway, peaking mid-cycle.
 * - `pulse`: a hit on the beat that dies away (exp(−8φ)); it jumps at the cycle's start by design.
 * - `bounce`: a bob that touches down on the beat (|sin πφ|).
 * - `gate`: on for the first quarter of the cycle, then off; for flashes.
 * - `saw`: grows steadily through the cycle and drops back to 0 at its start (the downbeat,
 *   for a bar cycle).
 * - `envelope`: an attack/decay envelope with cosine ends: it eases up from 0 to 1 over the
 *   first `attack` of the cycle and eases back down to 0 over the rest. `attack` (default 0.5,
 *   where it is the same as `sine`) is the only shape setting; other shapes ignore it.
 */
import { Registry } from "../core/registry";

export type BeatShape = (phase: number, attack?: number) => number;

export const beatShapes = new Registry<BeatShape>("beat shape");
beatShapes.register("sine", (phase) => (1 - Math.cos(phase * Math.PI * 2)) / 2);
beatShapes.register("pulse", (phase) => Math.exp(-8 * phase));
beatShapes.register("bounce", (phase) => Math.abs(Math.sin(phase * Math.PI)));
beatShapes.register("gate", (phase) => (phase < 0.25 ? 1 : 0));
beatShapes.register("saw", (phase) => phase);
beatShapes.register("envelope", (phase, attack = 0.5) => {
  const peak = Math.min(0.99, Math.max(0.01, attack));
  return phase < peak
    ? (1 - Math.cos((Math.PI * phase) / peak)) / 2
    : (1 + Math.cos((Math.PI * (phase - peak)) / (1 - peak))) / 2;
});
