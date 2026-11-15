/**
 * The stage score graph (#1064; doc/line-goes-up.md, "Score-specific graph configuration and
 * projection"): the stage scene's composition of the three reusable capabilities. The committed
 * score controller (#1087) decides when the graph grows; `stageGraphPlot` turns its captured
 * series into plain plot data; the plot surface (#1085) draws that into a texture, which a framed
 * picture (#1086) hangs in the room at the transform the scene configures. None of them knows the
 * others' policy, and nothing here reads the live run in a delayed callback.
 *
 * - **Axes.** X spans zero to the stage's whole play allowance from the outset; Y starts with the
 *   target at `targetHeight` (80%) of its height and grows upward to keep the highest observed
 *   total at that height too, never cropping an overshoot. Within a stage it never shrinks, since
 *   totals only accumulate.
 * - **Target.** A dotted horizontal reference at the target, labelled. A target that isn't a
 *   positive finite number draws no reference and says so in the summary; nothing divides by it.
 * - **Growth.** The newest segment is drawn `growth` of the way from its previous point.
 * - **Summary.** A plain sentence of score, target and plays, for a hidden semantic label: colour
 *   and line style are never the only cue.
 *
 * The average-pace projection and its crossing estimate are #1066's.
 */
import type { CommittedMetadata } from "./command-codecs";
import type { EventEnvelope } from "./lifecycle/action";
import type { PlacementPhase } from "./placement-phase";
import {
  createScoreGraphController,
  graphProducer,
  type GraphSeries,
  type ScoreGraphController,
} from "./score-graph-controller";
import type { StageScoreHistory } from "./stage-score-history";
import {
  createFramedPicture,
  type FramedPicture,
  type FramedPictureConfig,
} from "./visual/framed-picture";
import {
  createPlotSurface,
  createPlotTexture,
  defaultPlotSurfaceConfig,
  type PlotData,
  type PlotSurface,
  type PlotSurfaceConfig,
  type PlotTexture,
} from "./visual/plot-surface";
import type * as THREE from "three";

/** How the stage scene composes its graph: where it hangs, and its presentation tuning. */
export type StageScoreGraphConfig = {
  /** The framed picture's room transform, size and frame. */
  picture: FramedPictureConfig;
  /** The plot's pixel size and styling over the surface defaults. */
  plot?: Partial<PlotSurfaceConfig>;
  /** Where the target sits, as a share of the plot's height (default 0.8). */
  targetHeight?: number;
  /** Each new segment's growth, in game-time units (default 4). */
  growthUnits?: number;
};

export const observedStyle = { colour: "#1f5f8b", width: 4 };
export const targetStyle = { colour: "#a23b2a", width: 3, dash: [10, 8] };

const positive = (value: number) => Number.isFinite(value) && value > 0;

/** The series as plot data: axes, the observed line grown so far, and the target. */
export function stageGraphPlot(series: GraphSeries, targetHeight = 0.8): PlotData {
  const plays = Math.max(1, series.plays);
  const highest = Math.max(0, ...series.points.map(({ total }) => total));
  const target = positive(series.targetScore) ? series.targetScore : null;
  const top = Math.max(target ?? 0, highest, 1) / targetHeight;
  const points = series.points.map(({ play, total }) => [play, total] as const);
  // The newest point, drawn as far as its growth has reached.
  const grown =
    points.length > 1 && series.growth < 1
      ? (() => {
          const [x0, y0] = points[points.length - 2]!;
          const [x1, y1] = points[points.length - 1]!;
          const t = Math.max(0, series.growth);
          return [...points.slice(0, -1), [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t] as const];
        })()
      : points;
  return {
    x: {
      min: 0,
      max: plays,
      label: "Plays",
      ticks: Array.from({ length: plays + 1 }, (_, play) => ({ value: play, label: `${play}` })),
    },
    y: {
      min: 0,
      max: top,
      label: "Score",
      ticks: [0, ...(target ? [target] : [])].map((value) => ({ value, label: `${value}` })),
    },
    series: [{ points: grown, style: observedStyle, markers: true }],
    references: target
      ? [{ axis: "y", value: target, style: targetStyle, label: `Target ${target}` }]
      : [],
  };
}

/** A plain sentence of what the graph shows. */
export function stageGraphSummary(series: GraphSeries): string {
  const last = series.points[series.points.length - 1] ?? { play: 0, total: 0 };
  const target = positive(series.targetScore) ? `${series.targetScore}` : "unavailable";
  return `Stage score ${last.total}, target ${target}, after ${last.play} of ${series.plays} plays.`;
}

/** What the stage graph composes: the run's committed actions and history, and the room. */
export type StageScoreGraphHost = {
  source: {
    onCommitted(
      listener: (facts: readonly EventEnvelope[], metadata: CommittedMetadata) => void,
    ): () => void;
  };
  /** The current stage's captured history, to draw at once on entry; absent before a stage. */
  history(): StageScoreHistory | undefined;
  phase: Pick<PlacementPhase, "latest" | "contributionFor">;
  /** Compose the graph's producer into the action phases while shown. */
  compose(producer: string): () => void;
  /** The room-space parent the picture hangs in (never the turning card assembly). */
  room: THREE.Object3D;
  /** Where the hidden semantic summary goes. */
  host: HTMLElement;
};

/** The stage graph service: shown by the scene trait that composes it, hidden when it leaves. */
export function createStageScoreGraph(host: StageScoreGraphHost) {
  type Shown = {
    surface: PlotSurface;
    texture: PlotTexture;
    picture: FramedPicture;
    controller: ScoreGraphController;
    summary: HTMLElement;
    release: () => void;
  };
  let shown: Shown | null = null;

  const hide = () => {
    if (!shown) return;
    const { surface, texture, picture, controller, summary, release } = shown;
    shown = null;
    controller.dispose();
    release();
    host.room.remove(picture.object);
    picture.dispose();
    texture.dispose();
    surface.dispose();
    summary.remove();
  };

  return {
    show(config: StageScoreGraphConfig): void {
      hide();
      const surface = createPlotSurface({ ...defaultPlotSurfaceConfig, ...config.plot });
      const texture = createPlotTexture(surface);
      const picture = createFramedPicture(config.picture, texture.texture);
      host.room.add(picture.object);
      // Scenery, not a control: never focusable, never a target. Its words are for assistive tech.
      const summary = document.createElement("p");
      summary.className = "stage-score-graph-summary";
      // Visually hidden, still read.
      Object.assign(summary.style, {
        position: "absolute",
        width: "1px",
        height: "1px",
        overflow: "hidden",
        clip: "rect(0 0 0 0)",
        whiteSpace: "nowrap",
        margin: "-1px",
      });
      summary.setAttribute("role", "img");
      host.host.append(summary);
      const release = host.compose(graphProducer);
      const controller = createScoreGraphController({
        source: host.source,
        phase: host.phase,
        growthUnits: config.growthUnits,
        sink: {
          draw(series) {
            surface.update(stageGraphPlot(series, config.targetHeight));
            // The image's accessible name is the summary itself (#1311 review): an `img` role
            // makes its text presentational, so the label carries it.
            const words = stageGraphSummary(series);
            summary.textContent = words;
            summary.setAttribute("aria-label", `Stage score graph. ${words}`);
          },
        },
      });
      shown = { surface, texture, picture, controller, summary, release };
      // The stage as it stands, drawn at once: no replay.
      const history = host.history();
      if (history) controller.show(history);
    },
    hide,
    /** Refresh the picture's texture if the plot has redrawn; cheap every frame. */
    frame(): void {
      shown?.texture.sync();
    },
    /** The picture's scenery object while shown (for tests and tools). */
    get picture(): THREE.Object3D | null {
      return shown?.picture.object ?? null;
    },
  };
}

export type StageScoreGraph = ReturnType<typeof createStageScoreGraph>;
