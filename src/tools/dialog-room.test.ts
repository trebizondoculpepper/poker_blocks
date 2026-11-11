import { describe, expect, it } from "vite-plus/test";
import { cycleBegan, rowPositions } from "./dialog-room";

describe("dialog room (#347)", () => {
  it("lines the buttons up side by side, centred on the middle", () => {
    const positions = rowPositions(3);
    expect(positions.map(({ y }) => y)).toEqual([0, 0, 0]);
    expect(positions[0]!.x).toBeCloseTo(-positions[2]!.x);
    expect(positions[1]!.x).toBeCloseTo(0);
    expect(rowPositions(1)[0]!.x).toBe(0);
  });

  it("kicks once each cycle, as its phase wraps round", () => {
    expect(cycleBegan(0.97, 0.02)).toBe(true);
    expect(cycleBegan(0.2, 0.35)).toBe(false);
  });
});
