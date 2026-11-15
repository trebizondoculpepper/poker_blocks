/**
 * The committed-score graph controller (#1087; doc/line-goes-up.md, "Committed-score presentation
 * controller"; doc/action-presentation-phases.md). It consumes the captured stage-history point
 * each scoring commit publishes (`score.totalApplied`'s `stageHistory`, #1063) and grows the plot
 * by that point in the action's **post-scoring** contribution, after its own scoring feedback.
 *
 * - **Reserved, ordered.** The registered `graph` producer reserves each scoring action's
 *   post-score contribution at commit, chained as `plot` so the shared plot updates in committed
 *   order. The controller binds that reservation to a `graph.grow` effect lasting the configured
 *   units (4 by default). A later play stays legal throughout.
 * - **Captured only.** It keeps its own captured series per stage generation; a delayed effect
 *   reads only that, never `GameRun`. A new generation (a new stage) resets the series, and old
 *   generation work draws nothing more.
 * - **Restore without replay.** On entry it draws the current captured history at once.
 * - **No policy here.** A projection turns the series into plot data (#1064/#1066 supply the score
 *   one); the plot surface draws it (#1085). This controller only decides when.
 */
import type { CommittedMetadata } from "./command-codecs";
import type { EventEnvelope } from "./lifecycle/action";
import { factProducer, type PlacementPhase } from "./placement-phase";
import type { StageScoreHistory } from "./stage-score-history";
import { phaseProducers, type ActionKey } from "./visual-events/action-phases";
import { unitMs, visualHandlers, type EffectHandle } from "./visual-events/scheduler";

/** The graph's post-score contribution, in committed plot order. */
export const graphProducer = "graph";
phaseProducers.register(
  graphProducer,
  factProducer({ fact: "score.totalApplied", slot: "postScoring", ordered: "plot" }),
);

/** One observed point: plays used and the stage total after them. */
export type GraphPoint = Readonly<{ play: number; total: number }>;

/** What the graph shows: the stage's allowance and target, and its points so far. */
export type GraphSeries = Readonly<{
  plays: number;
  targetScore: number;
  points: readonly GraphPoint[];
  /** The last point's growth, 0 (just begun) to 1 (drawn). */
  growth: number;
}>;

/** Draws a series: a projection to plot data and the plot surface, composed by its owner. */
export type GraphSink = { draw(series: GraphSeries): void };

type Growing = { sink: GraphSink; series: GraphSeries; durationMs: number; live: () => boolean };
const growing = new Map<string, Growing>();
let nextGrowth = 0;

visualHandlers.register("graph.grow", (payload, context): "done" | EffectHandle => {
  const id = (payload as { growth: string }).growth;
  const job = growing.get(id);
  if (!job) return "done";
  const start = context.scheduledAtMs;
  const step = (nowMs: number) => {
    if (!job.live()) return "finished" as const;
    const growth = job.durationMs <= 0 ? 1 : Math.min(1, (nowMs - start) / job.durationMs);
    job.sink.draw({ ...job.series, growth });
    return growth >= 1 ? ("finished" as const) : ("running" as const);
  };
  if (step(context.nowMs) === "finished") {
    growing.delete(id);
    return "done";
  }
  return {
    update: step,
    cancel: () => void growing.delete(id),
    dispose: () => void growing.delete(id),
  };
});

type Source = {
  onCommitted(
    listener: (facts: readonly EventEnvelope[], metadata: CommittedMetadata) => void,
  ): () => void;
};

export function createScoreGraphController(options: {
  source: Source;
  phase: Pick<PlacementPhase, "latest" | "contributionFor">;
  sink: GraphSink;
  /** Growth of each new segment, in game-time units (doc: 4). */
  growthUnits?: number;
}) {
  const durationMs = (options.growthUnits ?? 4) * unitMs;
  let series: GraphSeries | null = null;
  let generation: number | null = null;

  /** Draw a stage's captured history at once (entry, restore): no growth, no replay. */
  const show = (history: StageScoreHistory) => {
    generation = history.generation;
    series = Object.freeze({
      plays: history.plays,
      targetScore: history.targetScore,
      points: Object.freeze([
        history.start,
        ...history.entries.map(({ play, total }) => ({ play, total })),
      ]),
      growth: 1,
    });
    options.sink.draw(series);
  };

  const stop = options.source.onCommitted((facts) => {
    for (const { type, payload } of facts) {
      const point = (
        payload as { stageHistory?: { generation: number; play: number; total: number } }
      ).stageHistory;
      if (type !== "score.totalApplied" || !point) continue;
      // A new stage: its own series from zero; nothing of the old one draws again.
      if (point.generation !== generation || !series) {
        generation = point.generation;
        series = Object.freeze({
          plays: 0,
          targetScore: 0,
          points: [{ play: 0, total: 0 }],
          growth: 1,
        });
      }
      series = Object.freeze({
        ...series,
        points: Object.freeze([...series.points, { play: point.play, total: point.total }]),
        growth: 0,
      });
      const key: ActionKey | null = options.phase.latest;
      const contribution = key && options.phase.contributionFor(key, graphProducer);
      const captured = series;
      const mine = generation;
      if (!contribution) {
        options.sink.draw({ ...captured, growth: 1 });
        continue;
      }
      const id = `growth-${++nextGrowth}`;
      growing.set(id, {
        sink: options.sink,
        series: captured,
        durationMs,
        live: () => generation === mine,
      });
      if (!contribution.bind({ handler: "graph.grow", payload: { growth: id }, dueUnits: 0 })) {
        growing.delete(id);
        options.sink.draw({ ...captured, growth: 1 });
      }
    }
  });

  return {
    show,
    /** The series as captured now. */
    get series() {
      return series;
    },
    dispose() {
      stop();
      generation = null;
      series = null;
    },
  };
}

export type ScoreGraphController = ReturnType<typeof createScoreGraphController>;
