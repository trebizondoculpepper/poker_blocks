import { describe, expect, it } from "vite-plus/test";
import {
  boardPitchRock,
  boardYawRock,
  randomRock,
  rockAmplitude,
  rockAngle,
  rockRateDeviation,
  rockRateMean,
  stepRock,
} from "./motion";

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

describe("structure wobble", () => {
  it("oscillates on two axes without accumulating rotation", () => {
    expect(boardPitchRock.rate).not.toBe(boardYawRock.rate);
    for (let step = 0; step <= 1000; step++) {
      const time = step * 0.1;
      expect(Math.abs(rockAngle(boardPitchRock, time))).toBeLessThanOrEqual(
        boardPitchRock.amplitude + 1e-12,
      );
      expect(Math.abs(rockAngle(boardYawRock, time))).toBeLessThanOrEqual(
        boardYawRock.amplitude + 1e-12,
      );
    }
    expect(rockAngle(boardPitchRock, 1 / 0.065)).toBeCloseTo(rockAngle(boardPitchRock, 0));
    expect(rockAngle(boardYawRock, 1 / 0.08)).toBeCloseTo(rockAngle(boardYawRock, 0));
  });
});

describe("selected vibration", () => {
  const rock = { amplitude: 0.3, phase: 0, rate: 1 };
  const run = (selected: boolean, seconds: number, from = { angle: 0, excitement: 0 }) => {
    let state = from;
    for (let t = 0; t < seconds; t += 0.01) state = stepRock(rock, state, selected, 0.01).state;
    return state;
  };

  it("eases in to three times the speed and a third of the swing", () => {
    const half = run(true, 0.05);
    expect(half.excitement).toBeGreaterThan(0);
    expect(half.excitement).toBeLessThan(0.9);
    const full = run(true, 2);
    expect(full.excitement).toBeCloseTo(1, 3);
    const before = full.angle;
    const after = stepRock(rock, full, true, 0.1).state.angle;
    expect(after - before).toBeCloseTo(0.3, 2);
    const shown = stepRock(rock, { angle: Math.PI / 2, excitement: 1 }, true, 0).angle;
    expect(shown).toBeCloseTo(0.1, 3);
  });

  it("eases back out when deselected, without jumping", () => {
    const excited = run(true, 2);
    const a = stepRock(rock, excited, false, 0.01);
    expect(Math.abs(a.state.excitement - excited.excitement)).toBeLessThan(0.1);
    expect(run(false, 2, excited).excitement).toBeCloseTo(0, 3);
  });
});
