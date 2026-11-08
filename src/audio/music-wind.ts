/**
 * Record-player wind-down and wind-up: the curves shared by the game's music player and
 * the music room, so what is prototyped in the room is what the game plays.
 */

export type WindShape = {
  /** How long a wind-down takes, in seconds. */
  downSeconds: number;
  /** How the speed falls: 1 is a steady slowdown; higher drops faster at first, then coasts. */
  slowdown: number;
  /** The last part of the wind-down (0 to 1) over which the level fades to silence. */
  silentTail: number;
  /** How long a wind-up from a standstill takes, in seconds. */
  upSeconds: number;
};

export const defaultWind: WindShape = {
  downSeconds: 3,
  slowdown: 1.6,
  silentTail: 0.15,
  upSeconds: 2,
};

/** Tempo a wound-up loop starts from, as a fraction: nearly stopped (a beat clock needs > 0). */
export const standstill = 0.02;

/**
 * Freeze a parameter at its current value, dropping later automation, so new automation
 * can start now even if a curve is mid-flight (overlapping a curve would throw).
 */
export function holdAt(param: AudioParam, now: number): number {
  const value = param.value;
  if (typeof param.cancelAndHoldAtTime === "function") {
    // Truncates a curve in progress and holds its value; adding a setValueAtTime here
    // would count as overlapping that curve and throw.
    param.cancelAndHoldAtTime(now);
  } else {
    param.cancelScheduledValues(0);
    param.setValueAtTime(value, now);
  }
  return value;
}

/** Playback rate during a wind-down, from `from` to (almost) stopped. */
export function spinDownCurve(from: number, slowdown: number, steps = 128): Float32Array {
  const curve = new Float32Array(steps);
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    // Never quite 0: some engines reject a zero playback rate.
    curve[i] = Math.max(0.0001, from * (1 - t) ** slowdown);
  }
  return curve;
}

/** Level during a wind-down: full until the silent tail, then down to nothing. */
export function spinDownGain(from: number, silentTail: number, steps = 128): Float32Array {
  const curve = new Float32Array(steps);
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    curve[i] =
      silentTail <= 0 ? (i === steps - 1 ? 0 : from) : from * Math.min(1, (1 - t) / silentTail);
  }
  return curve;
}

/**
 * Schedule a wind-down on a sounding source: speed and level follow the shape, and the
 * source stops when the platter does. Returns when it ends (in context time).
 */
export function scheduleWindDown(
  source: AudioBufferSourceNode,
  gain: GainNode,
  now: number,
  shape: WindShape,
): number {
  const start = now + 0.01;
  const rate = holdAt(source.playbackRate, now);
  const level = holdAt(gain.gain, now);
  source.playbackRate.setValueCurveAtTime(
    spinDownCurve(rate, shape.slowdown),
    start,
    shape.downSeconds,
  );
  gain.gain.setValueCurveAtTime(spinDownGain(level, shape.silentTail), start, shape.downSeconds);
  source.stop(start + shape.downSeconds);
  return start + shape.downSeconds;
}
