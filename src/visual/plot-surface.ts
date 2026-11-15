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

/**
 * Where a data point lands on the surface, in pixels (y down), clamped to the plot area. Drawn
 * lines use `toPlotPixel` instead and are clipped, so a segment leaving the area keeps its slope.
 */
export function toPixel(
  config: Pick<PlotSurfaceConfig, "width" | "height" | "padding">,
  data: Pick<PlotData, "x" | "y">,
  point: readonly [number, number],
): [number, number] {
  return toPlotPixel(config, data, point, true);
}

/** Where a data point lands, in pixels (y down): unclamped unless `clamp` is set. */
export function toPlotPixel(
  config: Pick<PlotSurfaceConfig, "width" | "height" | "padding">,
  data: Pick<PlotData, "x" | "y">,
  [x, y]: readonly [number, number],
  clamp = false,
): [number, number] {
  const { left, right, top, bottom } = config.padding;
  const plotWidth = Math.max(1, config.width - left - right);
  const plotHeight = Math.max(1, config.height - top - bottom);
  const along = (value: number, axis: PlotAxis) => {
    const span = axis.max - axis.min;
    const t = span === 0 ? 0 : (value - axis.min) / span;
    return clamp ? Math.min(1, Math.max(0, t)) : t;
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
      const [px, py] = toPlotPixel(config, data, point);
      if (index === 0) context!.moveTo(px, py);
      else context!.lineTo(px, py);
    });
    context!.stroke();
    if (!markers) return;
    context!.fillStyle = style.colour;
    for (const point of points) {
      const [px, py] = toPlotPixel(config, data, point);
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
    // Axis titles in the padding: x centred below its ticks, y turned up the left edge.
    if (data.x.label) {
      c.textAlign = "center";
      c.textBaseline = "bottom";
      c.fillText(
        data.x.label,
        padding.left + (width - padding.left - padding.right) / 2,
        height - 2,
      );
    }
    if (data.y.label) {
      c.save();
      c.translate(4, padding.top + (height - padding.top - padding.bottom) / 2);
      c.rotate(-Math.PI / 2);
      c.textAlign = "center";
      c.textBaseline = "top";
      c.fillText(data.y.label, 0, 0);
      c.restore();
    }
    // Lines are clipped to the plot area: one leaving it keeps its true slope (#1142).
    c.save();
    c.beginPath();
    c.rect(
      padding.left,
      padding.top,
      width - padding.left - padding.right,
      height - padding.top - padding.bottom,
    );
    c.clip();
    // Reference labels wait until the clip is released, so they can sit outside the area (#1144).
    const labels: { text: string; at: [number, number]; colour: string }[] = [];
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
      const start = toPlotPixel(config, data, from);
      const end = toPlotPixel(config, data, to);
      line(start, end, reference.style);
      if (reference.label)
        labels.push({ text: reference.label, at: end, colour: reference.style.colour });
    }
    for (const projection of data.projections ?? []) series(data, projection);
    for (const observed of data.series) series(data, observed);
    c.restore();
    c.setLineDash([]);
    c.textAlign = "right";
    c.textBaseline = "bottom";
    for (const { text, at, colour } of labels) {
      c.fillStyle = colour;
      // Right-aligned at its end, but never past either edge of the canvas (#1325 review): a
      // reference near the left (an early crossing) is shifted right until its text fits.
      const textWidth = c.measureText(text)?.width ?? 0;
      const x = Math.min(width - 2, Math.max(at[0], textWidth + 2));
      c.fillText(text, x, at[1] - 2);
    }
    c.fillStyle = config.textColour;
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
