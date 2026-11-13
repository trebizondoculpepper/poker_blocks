import { describe, expect, it } from "vite-plus/test";
import {
  auditionSizingProfile,
  clampedEdge,
  distanceForEdge,
  fitDistance,
  referenceEdge,
} from "./menu-sizing";

describe("menu sizing (#628)", () => {
  it("matches the audition room's own fitted camera for its seven-cube grid", () => {
    const viewport = { width: 1280, height: 800 };
    const canvasHeight = 800 - auditionSizingProfile.canvas.heightInset;
    const distance = fitDistance(auditionSizingProfile.bounds, 1280 / canvasHeight, 50);
    const edge = referenceEdge(auditionSizingProfile, viewport);
    // Drawing at that edge in the same canvas puts the camera where the room's fit does.
    expect(distanceForEdge(edge, canvasHeight, 50)).toBeCloseTo(distance, 6);
  });

  it("projects the same edge into any host height through distanceForEdge", () => {
    const edge = referenceEdge(auditionSizingProfile, { width: 1280, height: 800 });
    const tan = Math.tan((25 * Math.PI) / 180);
    for (const height of [150, 240, 600]) {
      const distance = distanceForEdge(edge, height, 50);
      expect(height / (2 * tan * (distance - 0.5))).toBeCloseTo(edge, 6);
    }
  });

  it("shrinks only when the canvas cannot hold the cubes and their margin", () => {
    expect(clampedEdge(100, { width: 1000, height: 400 }, { width: 3.4, height: 0 })).toBe(100);
    expect(clampedEdge(100, { width: 300, height: 400 }, { width: 3.4, height: 0 })).toBeCloseTo(
      300 / 5.2,
    );
  });
});
