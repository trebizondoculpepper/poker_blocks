import { describe, expect, it } from "vite-plus/test";
import { soundEffects } from "./audio/sfx-registry";
import { magnitudeSfx, magnitudeSfxFor, presentationOrder } from "./score-presentation";
import type { LineScore } from "./scoring";

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

describe("presentationOrder", () => {
  const line = (score: number, axis: "x" | "y" | "z" = "x") =>
    ({ line: { axis, blocks: [] }, hand: "pair", score }) as LineScore;

  it("drops zero-point lines and sorts lowest first, keeping ties stable", () => {
    const a = line(10, "x");
    const b = line(0, "y");
    const c = line(4, "z");
    const d = line(10, "y");
    expect(presentationOrder([a, b, c, d])).toEqual([c, a, d]);
  });
});
