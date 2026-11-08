/**
 * Tap tempo for loops. Taps are recorded as positions in the loop's own audio time
 * (seconds of the recording, unwrapped across loop restarts), so the estimate is the
 * loop's natural tempo whatever speed it is playing at.
 */

export type TapFit = {
  /** Tempo from the taps alone. */
  bpm: number;
  /** Standard deviation of the taps from the fitted grid, in seconds. */
  jitter: number;
};

/** Least-squares fit of tap positions against beat index; needs at least 4 taps. */
export function fitTaps(positions: readonly number[]): TapFit | null {
  if (positions.length < 4) return null;
  const n = positions.length;
  const meanIndex = (n - 1) / 2;
  const meanPosition = positions.reduce((sum, p) => sum + p, 0) / n;
  let covariance = 0;
  let variance = 0;
  for (let i = 0; i < n; i++) {
    covariance += (i - meanIndex) * (positions[i] - meanPosition);
    variance += (i - meanIndex) ** 2;
  }
  const secondsPerBeat = covariance / variance;
  if (!(secondsPerBeat > 0)) return null;
  const intercept = meanPosition - secondsPerBeat * meanIndex;
  const residuals = positions.map((p, i) => p - (intercept + secondsPerBeat * i));
  const jitter = Math.sqrt(residuals.reduce((sum, r) => sum + r * r, 0) / n);
  return { bpm: 60 / secondsPerBeat, jitter };
}

export type LoopTempo = {
  tempo_bpm: number;
  beats: number;
  /** Where beat 1 falls in the loop, taken from the first tap. */
  first_beat_seconds: number;
};

/**
 * Snap a tapped tempo to a whole number of bars in the loop (so the loop wraps on a bar),
 * and place beat 1 at the first tap. Assumes the first tap was on beat 1.
 */
export function snapToLoop(
  bpm: number,
  loopSeconds: number,
  firstTapPosition: number,
  beatsPerBar = 4,
): LoopTempo {
  const bars = Math.max(1, Math.round((loopSeconds * bpm) / 60 / beatsPerBar));
  const beats = bars * beatsPerBar;
  const tempo = (beats * 60) / loopSeconds;
  const bar = (beatsPerBar * 60) / tempo;
  const within = ((firstTapPosition % loopSeconds) + loopSeconds) % loopSeconds;
  return {
    tempo_bpm: Math.round(tempo * 10000) / 10000,
    beats,
    first_beat_seconds: Math.round((within % bar) * 10000) / 10000,
  };
}
