const radiansPerDegree = Math.PI / 180;
const radiansPerRevolution = Math.PI * 2;

export const rockAmplitude = 20 * radiansPerDegree;
export const rockRateMean = 0.1 * radiansPerRevolution;
export const rockRateDeviation = radiansPerRevolution / 60;

export const boardPitchRock: Rock = {
  amplitude: 8 * radiansPerDegree,
  phase: 0,
  rate: 0.065 * radiansPerRevolution,
};

export const boardYawRock: Rock = {
  amplitude: 12 * radiansPerDegree,
  phase: Math.PI / 2,
  rate: 0.08 * radiansPerRevolution,
};

export type Rock = {
  readonly amplitude: number;
  readonly phase: number;
  readonly rate: number;
};

function standardNormal(random: () => number): number {
  const uniform = Math.max(random(), Number.EPSILON);
  return Math.sqrt(-2 * Math.log(uniform)) * Math.cos(radiansPerRevolution * random());
}

export function randomRock(random: () => number = Math.random): Rock {
  const rate = rockRateMean + standardNormal(random) * rockRateDeviation;
  const direction = random() < 0.5 ? -1 : 1;
  return {
    amplitude: rockAmplitude,
    phase: random() * radiansPerRevolution,
    rate: direction * Math.abs(rate),
  };
}

export function rockAngle(rock: Rock, elapsedSeconds: number): number {
  return rock.amplitude * Math.sin(rock.phase + rock.rate * elapsedSeconds);
}

/** How much faster, and how much smaller, a selected block's rock becomes: a vibration. */
export const selectedRockFactor = 3;
/** Seconds to ease most of the way into, or out of, the selected vibration. */
export const selectedEaseSeconds = 0.35;

/** A rocking block's running state: how far through its swing, and how excited it is. */
export type RockState = {
  /** Swing progress in radians, accumulated so changes of speed never jump. */
  angle: number;
  /** 0 is the calm rock; 1 is the full selected vibration. */
  excitement: number;
};

/**
 * Advance a rock by `delta` seconds. Selected blocks ease toward vibrating
 * `selectedRockFactor` times faster with `selectedRockFactor` times less swing; deselected
 * ones ease back. Returns the new state and the angle to show.
 */
export function stepRock(
  rock: Rock,
  state: RockState,
  selected: boolean,
  delta: number,
): { state: RockState; angle: number } {
  const target = selected ? 1 : 0;
  const ease = 1 - Math.exp(-delta / (selectedEaseSeconds / 3));
  const excitement = state.excitement + (target - state.excitement) * ease;
  const factor = 1 + (selectedRockFactor - 1) * excitement;
  const angle = state.angle + rock.rate * factor * delta;
  return {
    state: { angle, excitement },
    angle: (rock.amplitude / factor) * Math.sin(rock.phase + angle),
  };
}
