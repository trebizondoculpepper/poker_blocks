import { describe, expect, it } from "vite-plus/test";
import {
  createPlotSurface,
  createPlotTexture,
  defaultPlotSurfaceConfig,
  toPixel,
  type PlotCanvas,
  type PlotData,
} from "./plot-surface";

/** A canvas whose 2D context records what was drawn. */
function recordingCanvas() {
  const calls: { name: string; args: unknown[] }[] = [];
  const context = new Proxy(
    {},
    {
      get:
        (_target, name) =>
        (...args: unknown[]) =>
          void calls.push({ name: String(name), args }),
      set: (_target, name, value) => (
        calls.push({ name: `set ${String(name)}`, args: [value] }),
        true
      ),
    },
  ) as unknown as CanvasRenderingContext2D;
  const canvas: PlotCanvas = { width: 0, height: 0, getContext: () => context };
  return { canvas, calls };
}

const score: PlotData = {
  x: { min: 0, max: 6, ticks: [0, 3, 6].map((value) => ({ value, label: String(value) })) },
  y: { min: 0, max: 300, ticks: [{ value: 300, label: "300" }] },
  series: [
    {
      points: [
        [0, 0],
        [1, 40],
        [2, 120],
      ],
      style: { colour: "#000", width: 3 },
      markers: true,
    },
  ],
  references: [{ axis: "y", value: 250, style: { colour: "#c00", width: 2 }, label: "Target" }],
  projections: [
    {
      points: [
        [2, 120],
        [6, 360],
      ],
      style: { colour: "#888", width: 2, dash: [6, 4] },
    },
  ],
};

describe("plot surface (#1085; doc/line-goes-up.md)", () => {
  it("maps data to pixels within the plot area, y down, clamping what falls outside", () => {
    const config = {
      width: 200,
      height: 100,
      padding: { left: 20, right: 10, top: 10, bottom: 20 },
    };
    expect(toPixel(config, score, [0, 0])).toEqual([20, 80]);
    expect(toPixel(config, score, [6, 300])).toEqual([190, 10]);
    expect(toPixel(config, score, [3, 150])).toEqual([105, 45]);
    // A projection past the axis stays on the surface.
    expect(toPixel(config, score, [6, 360])).toEqual([190, 10]);
  });

  it("draws axes, ticks, references, projections and the observed series, bumping its revision", () => {
    const { canvas, calls } = recordingCanvas();
    const surface = createPlotSurface(defaultPlotSurfaceConfig, (width, height) =>
      Object.assign(canvas, { width, height }),
    );
    expect(surface.available).toBe(true);
    expect(surface.canvas).toBe(canvas);
    expect(surface.revision).toBe(0);
    surface.update(score);
    expect(surface.revision).toBe(1);
    const texts = calls.filter(({ name }) => name === "fillText").map(({ args }) => args[0]);
    expect(texts).toEqual(["0", "3", "6", "300", "Target"]);
    // The dashed projection is drawn before the solid observed series, which sits on top.
    const dashes = calls.filter(({ name }) => name === "setLineDash").map(({ args }) => args[0]);
    expect(dashes).toContainEqual([6, 4]);
    const lastDash = calls
      .map(({ name, args }) => [name, args[0]] as const)
      .filter(([n]) => n === "setLineDash");
    expect(lastDash.at(-1)![1]).toEqual([]);
    expect(calls.filter(({ name }) => name === "arc")).toHaveLength(3);
  });

  it("clips a line leaving the plot area rather than bending it, and draws axis titles (#1142)", () => {
    const { canvas, calls } = recordingCanvas();
    const config = { ...defaultPlotSurfaceConfig, width: 200, height: 100 };
    config.padding = { left: 20, right: 10, top: 10, bottom: 20 };
    const surface = createPlotSurface(config, () => canvas);
    surface.update({
      x: { min: 0, max: 6, label: "Plays" },
      y: { min: 0, max: 300, label: "Score" },
      series: [],
      projections: [
        {
          points: [
            [0, 0],
            [6, 600],
          ],
          style: { colour: "#888", width: 2 },
        },
      ],
    });
    // The far end lies above the area, unclamped: (6, 600) → x 190, y 80 − 2·70 = −60.
    expect(calls.filter(({ name }) => name === "lineTo").at(-1)!.args).toEqual([190, -60]);
    // Drawn inside a clip to the plot rectangle.
    expect(calls.find(({ name }) => name === "rect")!.args).toEqual([20, 10, 170, 70]);
    expect(calls.some(({ name }) => name === "clip")).toBe(true);
    const texts = calls.filter(({ name }) => name === "fillText").map(({ args }) => args[0]);
    expect(texts).toEqual(expect.arrayContaining(["Plays", "Score"]));
  });

  it("draws reference labels outside the line clip, so a vertical reference's shows (#1144)", () => {
    const { canvas, calls } = recordingCanvas();
    const surface = createPlotSurface(defaultPlotSurfaceConfig, () => canvas);
    surface.update({
      x: { min: 0, max: 6 },
      y: { min: 0, max: 300 },
      series: [],
      references: [{ axis: "x", value: 3, style: { colour: "#c00", width: 1 }, label: "Half" }],
    });
    const names = calls.map(({ name, args }) =>
      name === "fillText" ? `fillText ${args[0]}` : name,
    );
    expect(names.indexOf("fillText Half")).toBeGreaterThan(names.lastIndexOf("restore"));
  });

  it("redraws on new data, and draws any series: it holds no score policy", () => {
    const { canvas, calls } = recordingCanvas();
    const surface = createPlotSurface(defaultPlotSurfaceConfig, () => canvas);
    surface.update(score);
    calls.length = 0;
    surface.update({
      x: { min: -1, max: 1 },
      y: { min: -1, max: 1 },
      series: [
        {
          points: Array.from({ length: 5 }, (_, i) => [i / 2 - 1, Math.sin(i)] as const),
          style: { colour: "#00f", width: 1 },
        },
      ],
    });
    expect(surface.revision).toBe(2);
    expect(calls.filter(({ name }) => name === "lineTo").length).toBeGreaterThanOrEqual(4);
  });

  it("is unavailable, and harmless, when no 2D context can be had", () => {
    const none = createPlotSurface(defaultPlotSurfaceConfig, () => ({
      width: 0,
      height: 0,
      getContext: () => null,
    }));
    const throwing = createPlotSurface(defaultPlotSurfaceConfig, () => {
      throw new Error("no canvas");
    });
    for (const surface of [none, throwing]) {
      expect(surface.available).toBe(false);
      expect(surface.canvas).toBeNull();
      surface.update(score);
      expect(surface.revision).toBe(0);
      surface.dispose();
      expect(createPlotTexture(surface).texture).toBeNull();
    }
  });

  it("releases its canvas on disposal and ignores later updates", () => {
    const { canvas } = recordingCanvas();
    const surface = createPlotSurface(defaultPlotSurfaceConfig, (width, height) =>
      Object.assign(canvas, { width, height }),
    );
    surface.update(score);
    surface.dispose();
    expect(canvas.width).toBe(0);
    expect(surface.available).toBe(false);
    surface.update(score);
    expect(surface.revision).toBe(1);
  });
});

describe("plot texture adapter (#1085)", () => {
  it("refreshes its own texture only when the surface has redrawn, and leaves the surface alone", () => {
    const { canvas } = recordingCanvas();
    const surface = createPlotSurface(defaultPlotSurfaceConfig, () => canvas);
    const adapter = createPlotTexture(surface);
    const texture = adapter.texture!;
    expect(texture).not.toBeNull();
    const initial = texture.version;
    surface.update(score);
    expect(adapter.sync()).toBe(true);
    expect(texture.version).toBe(initial + 1);
    // No redraw since: nothing to do, the same texture.
    expect(adapter.sync()).toBe(false);
    expect(texture.version).toBe(initial + 1);
    surface.update(score);
    expect(adapter.sync()).toBe(true);
    expect(adapter.texture).toBe(texture);
    expect(texture.version).toBe(initial + 2);
    // Two adapters may share one surface; disposing one doesn't touch it.
    const other = createPlotTexture(surface);
    adapter.dispose();
    expect(adapter.texture).toBeNull();
    expect(surface.available).toBe(true);
    expect(other.sync()).toBe(true);
  });
});
