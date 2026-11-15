/**
 * Plot surface (#1085; doc/line-goes-up.md, "Plot surface"): a reusable 2D canvas plot. It draws
 * plain plot data (explicit axis bounds and ticks, observed series, reference lines and optional
 * projection series) with the styling and pixel resolution it is configured with, and exposes its
 * canvas, a revision that changes on every redraw, an update operation and disposal.
 *
 * It knows no `GameRun`, frame, background, target policy or mode: whoever composes it supplies
 * the data (a score adapter, or anything else). If a 2D context can't be had, the surface is
 * unavailable and every operation is a harmless no-op, so nothing that composes it can fail.
 *
 * `createPlotTexture` adapts a surface to a texture it owns: it refreshes only when the surface's
 * revision has moved on, never allocating a texture per frame, and disposing it leaves the
 * surface (which another consumer may share) alone.
 */
import * as THREE from "three";

export type PlotAxis = {
  min: number;
  max: number;
  /** Tick marks with their labels, in data units. */
  ticks?: readonly { value: number; label: string }[];
  /** Shown along the axis. */
  label?: string;
};

export type LineStyle = {
  colour: string;
  /** In surface pixels. */
  width: number;
  /** Dash pattern in pixels; solid when absent. */
  dash?: readonly number[];
};

export type PlotSeries = {
  points: readonly (readonly [number, number])[];
  style: LineStyle;
  /** Draw a dot at each point. */
  markers?: boolean;
};

export type ReferenceLine = {
  /** A horizontal line at y = value, or a vertical one at x = value. */
  axis: "x" | "y";
  value: number;
  style: LineStyle;
  label?: string;
};

/** Everything one plot shows: plain data, supplied by whoever composes the surface. */
export type PlotData = {
  x: PlotAxis;
  y: PlotAxis;
  /** Observed series, drawn over the reference lines. */
  series: readonly PlotSeries[];
  references?: readonly ReferenceLine[];
  /** Projected (not observed) continuations, drawn beneath the observed series. */
  projections?: readonly PlotSeries[];
};

export type PlotSurfaceConfig = {
  /** Pixel resolution of the canvas. */
  width: number;
  height: number;
  /** Space around the plot area for ticks and labels, in pixels. */
  padding: { left: number; right: number; top: number; bottom: number };
  background: string;
  axisStyle: LineStyle;
  /** CSS font for tick and axis labels. */
  font: string;
  textColour: string;
};

export const defaultPlotSurfaceConfig: PlotSurfaceConfig = {
  width: 512,
  height: 320,
  padding: { left: 56, right: 16, top: 16, bottom: 40 },
  background: "#f4efe3",
  axisStyle: { colour: "#3a3326", width: 2 },
  font: "16px sans-serif",
  textColour: "#3a3326",
};

/** A canvas, or something shaped like one, for tests and hosts without a DOM. */
export type PlotCanvas = {
  width: number;
  height: number;
  getContext(kind: "2d"): CanvasRenderingContext2D | null;
};

export type PlotSurface = {
  /** False when no 2D context could be had: nothing is drawn, nothing fails. */
  readonly available: boolean;
  /** The render surface, or null when unavailable. */
  readonly canvas: PlotCanvas | null;
  /** Bumped on every redraw, so consumers refresh only on change. */
  readonly revision: number;
  /** Redraw with new data. */
  update(data: PlotData): void;
  /** Release the canvas; later updates do nothing. */
  dispose(): void;
};

/** Where a data point lands on the surface, in pixels (y down), clamped to the plot area. */
export function toPixel(
  config: Pick<PlotSurfaceConfig, "width" | "height" | "padding">,
  data: Pick<PlotData, "x" | "y">,
  [x, y]: readonly [number, number],
): [number, number] {
  const { left, right, top, bottom } = config.padding;
  const plotWidth = Math.max(1, config.width - left - right);
  const plotHeight = Math.max(1, config.height - top - bottom);
  const along = (value: number, axis: PlotAxis) => {
    const span = axis.max - axis.min;
    const t = span === 0 ? 0 : (value - axis.min) / span;
    return Math.min(1, Math.max(0, t));
  };
  return [left + along(x, data.x) * plotWidth, top + (1 - along(y, data.y)) * plotHeight];
}

const defaultCanvas = (width: number, height: number): PlotCanvas | null => {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

export function createPlotSurface(
  config: PlotSurfaceConfig = defaultPlotSurfaceConfig,
  createCanvas: (width: number, height: number) => PlotCanvas | null = defaultCanvas,
): PlotSurface {
  let canvas: PlotCanvas | null = null;
  let context: CanvasRenderingContext2D | null = null;
  try {
    canvas = createCanvas(config.width, config.height);
    context = canvas?.getContext("2d") ?? null;
  } catch {
    context = null;
  }
  if (!context) canvas = null;
  let revision = 0;

  const stroke = (style: LineStyle) => {
    context!.strokeStyle = style.colour;
    context!.lineWidth = style.width;
    context!.setLineDash([...(style.dash ?? [])]);
  };
  const line = (from: [number, number], to: [number, number], style: LineStyle) => {
    stroke(style);
    context!.beginPath();
    context!.moveTo(...from);
    context!.lineTo(...to);
    context!.stroke();
  };
  const series = (data: PlotData, { points, style, markers }: PlotSeries) => {
    if (!points.length) return;
    stroke(style);
    context!.beginPath();
    points.forEach((point, index) => {
      const [px, py] = toPixel(config, data, point);
      if (index === 0) context!.moveTo(px, py);
      else context!.lineTo(px, py);
    });
    context!.stroke();
    if (!markers) return;
    context!.fillStyle = style.colour;
    for (const point of points) {
      const [px, py] = toPixel(config, data, point);
      context!.beginPath();
      context!.arc(px, py, style.width * 1.5, 0, 2 * Math.PI);
      context!.fill();
    }
  };

  const draw = (data: PlotData) => {
    const c = context!;
    const { width, height, padding } = config;
    c.setLineDash([]);
    c.fillStyle = config.background;
    c.fillRect(0, 0, width, height);
    c.font = config.font;
    c.fillStyle = config.textColour;
    // Axes along the plot area's left and bottom edges.
    const origin: [number, number] = [padding.left, height - padding.bottom];
    line(origin, [width - padding.right, origin[1]], config.axisStyle);
    line(origin, [padding.left, padding.top], config.axisStyle);
    c.textAlign = "center";
    c.textBaseline = "top";
    for (const { value, label } of data.x.ticks ?? []) {
      const [px] = toPixel(config, data, [value, data.y.min]);
      line([px, origin[1]], [px, origin[1] + 5], config.axisStyle);
      c.fillText(label, px, origin[1] + 7);
    }
    c.textAlign = "right";
    c.textBaseline = "middle";
    for (const { value, label } of data.y.ticks ?? []) {
      const [, py] = toPixel(config, data, [data.x.min, value]);
      line([padding.left - 5, py], [padding.left, py], config.axisStyle);
      c.fillText(label, padding.left - 7, py);
    }
    // Reference lines, then projections, then what was observed, on top.
    for (const reference of data.references ?? []) {
      const [from, to]: [readonly [number, number], readonly [number, number]] =
        reference.axis === "y"
          ? [
              [data.x.min, reference.value],
              [data.x.max, reference.value],
            ]
          : [
              [reference.value, data.y.min],
              [reference.value, data.y.max],
            ];
      const start = toPixel(config, data, from);
      const end = toPixel(config, data, to);
      line(start, end, reference.style);
      if (reference.label) {
        c.fillStyle = reference.style.colour;
        c.textAlign = "right";
        c.textBaseline = "bottom";
        c.fillText(reference.label, end[0], end[1] - 2);
        c.fillStyle = config.textColour;
      }
    }
    for (const projection of data.projections ?? []) series(data, projection);
    for (const observed of data.series) series(data, observed);
    c.setLineDash([]);
  };

  return {
    get available() {
      return context !== null;
    },
    get canvas() {
      return canvas;
    },
    get revision() {
      return revision;
    },
    update(data) {
      if (!context) return;
      draw(data);
      revision++;
    },
    dispose() {
      if (canvas) {
        // Shrinking the canvas releases its backing store.
        canvas.width = canvas.height = 0;
      }
      canvas = null;
      context = null;
    },
  };
}

export type PlotTexture = {
  /** The texture this adapter owns, or null when the surface is unavailable. */
  readonly texture: THREE.CanvasTexture | null;
  /** Refresh the texture if the surface has redrawn since; cheap to call every frame. */
  sync(): boolean;
  /** Dispose of this adapter's texture only: the surface belongs to whoever made it. */
  dispose(): void;
};

/** Adapt a plot surface to a texture this adapter owns (doc/line-goes-up.md, "Plot surface"). */
export function createPlotTexture(surface: PlotSurface): PlotTexture {
  let texture =
    surface.available && surface.canvas
      ? new THREE.CanvasTexture(surface.canvas as unknown as HTMLCanvasElement)
      : null;
  if (texture) texture.colorSpace = THREE.SRGBColorSpace;
  let seen = -1;
  return {
    get texture() {
      return texture;
    },
    sync() {
      if (!texture || !surface.available || surface.revision === seen) return false;
      seen = surface.revision;
      texture.needsUpdate = true;
      return true;
    },
    dispose() {
      texture?.dispose();
      texture = null;
    },
  };
}
