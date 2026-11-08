import { describe, expect, it } from "vite-plus/test";
import { logFadeCurve } from "./fade";

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
