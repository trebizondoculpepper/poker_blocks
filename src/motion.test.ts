import { describe, expect, it } from "vite-plus/test";
import { randomRock, rockAmplitude, rockAngle, rockRateDeviation, rockRateMean } from "./motion";

const radiansPerRevolution = Math.PI * 2;

describe("hand block rock", () => {
  it("sets the mean rate to 6 rpm and the deviation to 1 rpm", () => {
    expect(rockRateMean / radiansPerRevolution).toBeCloseTo(0.1);
    expect(rockRateDeviation / radiansPerRevolution).toBeCloseTo(1 / 60);
    expect(rockAmplitude).toBeCloseTo(20 * (Math.PI / 180));
  });

  it("gives each rock a random direction", () => {
    expect(randomRock(() => 0.9).rate).toBeGreaterThan(0);
    expect(randomRock(() => 0.1).rate).toBeLessThan(0);
  });

  it("never turns a block past twenty degrees from the horizontal plane", () => {
    const rock = { amplitude: rockAmplitude, phase: 0, rate: rockRateMean };
    for (let step = 0; step <= 400; step++) {
      expect(Math.abs(rockAngle(rock, step * 0.05))).toBeLessThanOrEqual(rockAmplitude + 1e-12);
    }
  });

  it("completes one rock cycle per rate-scaled revolution", () => {
    const rock = { amplitude: 1, phase: 0, rate: rockRateMean };
    const period = radiansPerRevolution / rock.rate;
    expect(rockAngle(rock, 0)).toBeCloseTo(0);
    expect(rockAngle(rock, period / 4)).toBeCloseTo(1);
    expect(rockAngle(rock, period / 2)).toBeCloseTo(0);
  });
});
