import { describe, expect, it } from "vite-plus/test";
import { soundEffects } from "./audio/sfx-registry";
import { magnitudeSfx, magnitudeSfxFor } from "./score-presentation";

describe("magnitudeSfxFor", () => {
  it.each([
    [0, null],
    [-5, null],
    [1, "score.magnitude.ones"],
    [9, "score.magnitude.ones"],
    [10, "score.magnitude.tens"],
    [99, "score.magnitude.tens"],
    [100, "score.magnitude.hundreds"],
    [999, "score.magnitude.hundreds"],
    [1000, "score.magnitude.thousands"],
    [9999, "score.magnitude.thousands"],
    [10_000, "score.magnitude.ten_thousands"],
    [100_000, "score.magnitude.hundred_thousands"],
    [999_999, "score.magnitude.hundred_thousands"],
    [1_000_000, "score.magnitude.millions"],
    [5_000_000_000, "score.magnitude.millions"],
  ])("maps %d points to %s", (points, expected) => {
    expect(magnitudeSfxFor(points)).toBe(expected);
  });

  it("uses registered sounds", () => {
    const ids = new Set(soundEffects.map(({ id }) => id));
    for (const id of magnitudeSfx) expect(ids.has(id)).toBe(true);
  });
});
