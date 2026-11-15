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
import {
  createPictureReleaseController,
  pictureReleaseProducer,
} from "./picture-release-controller";
import type { AttachmentReleaseConfig } from "./visual/attachment-release";
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
  /**
   * The picture drops from its nails when the stage is lost (#1065): the release effect's
   * configuration. Left out, it stays hung.
   */
  release?: AttachmentReleaseConfig;
};

export const observedStyle = { colour: "#1f5f8b", width: 4 };
export const targetStyle = { colour: "#a23b2a", width: 3, dash: [10, 8] };

export const projectionStyle = { colour: "#4f7a3a", width: 3, dash: [3, 7] };

const positive = (value: number) => Number.isFinite(value) && value > 0;

/**
 * The average-pace projection (#1066; doc/line-goes-up.md, "Score-specific graph configuration and
 * projection"): from the latest observed point, the pace across every play so far
 * (`total / playsUsed`, never the latest delta) and where it would first reach the target. Null
 * before the first play or with nothing scored: no slope, no invented crossing.
 */
export function averagePace(
  series: Pick<GraphSeries, "points" | "targetScore" | "plays">,
): { slope: number; crossing: number | null; crossingPlay: number | null; beyond: boolean } | null {
  const last = series.points[series.points.length - 1];
  if (!last || last.play < 1 || !(last.total > 0)) return null;
  const slope = last.total / last.play;
  if (!positive(series.targetScore))
    return { slope, crossing: null, crossingPlay: null, beyond: false };
  const crossing = series.targetScore / slope;
  return { slope, crossing, crossingPlay: Math.ceil(crossing), beyond: crossing > series.plays };
}

/** The series as plot data: axes, the observed line grown so far, and the target. */
export function stageGraphPlot(series: GraphSeries, targetHeight = 0.8): PlotData {
  const plays = Math.max(1, series.plays);
  const highest = Math.max(0, ...series.points.map(({ total }) => total));
  const target = positive(series.targetScore) ? series.targetScore : null;
  const top = Math.max(target ?? 0, highest, 1) / targetHeight;
  const points = series.points.map(({ play, total }) => [play, total] as const);
  const pace = averagePace(series);
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
    references: [
      ...(target
        ? [{ axis: "y" as const, value: target, style: targetStyle, label: `Target ${target}` }]
        : []),
      // Where the pace reaches the target, or a note at the edge when it would after the last play:
      // the play axis keeps the stage's allowance, never stretched to fit a prediction.
      ...(pace?.crossing != null
        ? [
            pace.beyond
              ? {
                  axis: "x" as const,
                  value: plays,
                  style: projectionStyle,
                  label: "Target beyond available plays",
                }
              : {
                  axis: "x" as const,
                  value: pace.crossing,
                  style: projectionStyle,
                  label: `Target ≈ play ${pace.crossingPlay}`,
                },
          ]
        : []),
    ],
    // The pace line from the origin through the latest point to the end of the allowance; the
    // surface clips it to the plot, so a steep pace never stretches Y (observed totals do that).
    projections: pace
      ? [
          {
            points: [
              [0, 0],
              [plays, pace.slope * plays],
            ] as const,
            style: projectionStyle,
          },
        ]
      : [],
  };
}

const round = (value: number) => Math.round(value * 10) / 10;

/** A plain sentence of what the graph shows. */
export function stageGraphSummary(series: GraphSeries): string {
  const last = series.points[series.points.length - 1] ?? { play: 0, total: 0 };
  const target = positive(series.targetScore) ? `${series.targetScore}` : "unavailable";
  const pace = averagePace(series);
  const projected = !pace
    ? ""
    : pace.crossing === null
      ? ` Averaging ${round(pace.slope)} a play.`
      : pace.beyond
        ? ` Averaging ${round(pace.slope)} a play: the target would come after the last play.`
        : ` Averaging ${round(pace.slope)} a play: the target by about play ${pace.crossingPlay}.`;
  return `Stage score ${last.total}, target ${target}, after ${last.play} of ${series.plays} plays.${projected}`;
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
  /** The shared scheduler, where a loss release's fall runs in its own scope (#1065). */
  scheduler: Parameters<typeof createPictureReleaseController>[0]["scheduler"];
  /** Resolved reduced motion, read when a release starts. */
  reducedMotion?: () => boolean;
  /** The picture's impact cue as it lands, for a sound controller (#1080). */
  impact?: (cue: string) => void;
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
    /** The loss release, while one is configured (#1065). */
    fall: { dispose(): void } | null;
  };
  let shown: Shown | null = null;

  const hide = () => {
    if (!shown) return;
    const { surface, texture, picture, controller, summary, release, fall } = shown;
    shown = null;
    fall?.dispose();
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
      // Composed after the graph's producer, so a failure's release follows its plot (#1065).
      const fall = config.release
        ? (() => {
            const releaseProducer = host.compose(pictureReleaseProducer);
            const made = createPictureReleaseController({
              source: host.source,
              phase: host.phase,
              scheduler: host.scheduler,
              target: { object: picture.object, attachments: picture.attachments },
              config: config.release,
              reducedMotion: host.reducedMotion ?? (() => false),
              impact: host.impact,
            });
            return {
              dispose() {
                made.dispose();
                releaseProducer();
              },
            };
          })()
        : null;
      shown = { surface, texture, picture, controller, summary, release, fall };
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
