const radiansPerDegree = Math.PI / 180;
const radiansPerRevolution = Math.PI * 2;

export const rockAmplitude = 20 * radiansPerDegree;
export const rockRateMean = 0.1 * radiansPerRevolution;
export const rockRateDeviation = radiansPerRevolution / 60;

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
