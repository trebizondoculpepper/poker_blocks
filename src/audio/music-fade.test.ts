import { describe, expect, it } from "vite-plus/test";
import { fadeCurve, fadeGain, fadeKinds, logFadeCurve, type FadeKind } from "./music-fade";

describe("logarithmic fade", () => {
  it("runs from silence to full level and back", () => {
    const up = logFadeCurve(true);
    const down = logFadeCurve(false);
    expect(up[0]).toBe(0);
    expect(up.at(-1)).toBe(1);
    expect(down[0]).toBe(1);
    expect(down.at(-1)).toBe(0);
  });

  it("moves evenly in decibels, not in amplitude", () => {
    const curve = logFadeCurve(true, 5); // 0, -45, -30, -15, 0 dB
    const db = [...curve].slice(1).map((gain) => 20 * Math.log10(gain));
    expect(db[0]).toBeCloseTo(-45);
    expect(db[1]).toBeCloseTo(-30);
    expect(db[2]).toBeCloseTo(-15);
    expect(db[3]).toBeCloseTo(0);
    // Halfway through, the level is -30 dB: far quieter than a linear fade's 0.5.
    expect(curve[2]).toBeLessThan(0.05);
  });
});

describe("fade shapes", () => {
  const kinds = Object.keys(fadeKinds) as FadeKind[];

  it("all run from 0 to 1 and fall as the mirror of their rise", () => {
    for (const kind of kinds) {
      const up = fadeCurve(kind, true, 9);
      const down = fadeCurve(kind, false, 9);
      expect(up[0]).toBe(0);
      expect(up.at(-1)).toBe(1);
      expect([...down]).toEqual([...up].reverse());
    }
  });

  it("have their characteristic midpoints", () => {
    expect(fadeGain("linear", 0.5)).toBeCloseTo(0.5);
    expect(fadeGain("equal-power", 0.5)).toBeCloseTo(Math.SQRT1_2);
    expect(fadeGain("s-curve", 0.5)).toBeCloseTo(0.5);
    expect(fadeGain("exponential", 0.5)).toBeCloseTo(0.25);
    expect(20 * Math.log10(fadeGain("logarithmic", 0.5))).toBeCloseTo(-30);
  });

  it("keeps equal-power fades at constant combined power", () => {
    for (const t of [0.1, 0.3, 0.5, 0.8]) {
      expect(fadeGain("equal-power", t) ** 2 + fadeGain("equal-power", 1 - t) ** 2).toBeCloseTo(1);
    }
  });
});
