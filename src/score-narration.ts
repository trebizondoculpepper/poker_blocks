/**
 * Score narration on the shared visual-event scheduler (#547; doc/visual-event-interface.md,
 * "Migration order and acceptance", step 2, and doc/game-architecture.md, "Visual-event scheduler
 * and game-time units"). Presentation timing only: the scores, the rule order and the stage
 * outcome were all committed by the model before anything here runs.
 *
 * - **One scope per committed play,** holding its captured lines, lowest first, one step apart.
 *   Each line is an effect lasting one step, so the scope settles a step after its last line.
 * - **Committed-play order:** a later play's narration starts when the earlier play's scope has
 *   settled. Its lines were captured when it committed, so it never reads a later play's state.
 * - **The outcome** is announced once every queued play's narration has settled and the last
 *   line's tint has had time to settle; a play committed meanwhile cancels that pending
 *   announcement and goes first.
 * - **Fallback:** a narration scope that fails (or can't be admitted) jumps the shown score to the
 *   model's through a direct sink, and the outcome still follows: nothing waits forever.
 */
import {
  unitMs,
  visualFallbacks,
  visualHandlers,
  type EffectHandle,
  type ScopeHandle,
  type VisualScheduler,
} from "./visual-events/scheduler";

/** One scoring line as committed: its blocks, the rule sources that fired, its points. */
export type NarratedLine = { blockIds: string[]; sourceIds: string[]; points: number };

/** What narration shows through: the play presenter supplies it as a scheduler service. */
export type ScoreNarrationSink = {
  /** Show one line: tint its blocks, pulse its sources, play its sound, add its points. */
  line(line: NarratedLine): void;
  /** Show the shown score as the model has it, without narrating (the summary fallback). */
  summarise(): void;
  /** Announce the stage's outcome, as the model has it now. */
  decide(): void;
};

export type ScoreNarrationServices = { scoreNarration: ScoreNarrationSink };

/** Narration timing, in game-time units (1/15 s). */
export type ScoreNarrationTiming = {
  /** Between one line and the next: 4.8 units is the 320 ms lines have always had. */
  lineStep: number;
  /** How long a line's tint takes to settle before the outcome is announced. */
  settle: number;
};

const sinkOf = (services: unknown) => (services as ScoreNarrationServices).scoreNarration;

/** A line: shown when it starts, then held for one step so the next play waits its turn. */
visualHandlers.register("score.line", (payload, context) => {
  const { line, stepUnits } = payload as { line: NarratedLine; stepUnits: number };
  sinkOf(context.services).line(line);
  const until = context.scheduledAtMs + stepUnits * unitMs;
  const effect: EffectHandle = {
    update: (nowMs) => (nowMs >= until ? "finished" : "running"),
    cancel() {},
    dispose() {},
  };
  return effect;
});

visualHandlers.register("score.outcome", (_payload, context) => {
  sinkOf(context.services).decide();
  return "done";
});

visualFallbacks.register("score.summary", ({ services }) => sinkOf(services).summarise());

export function createScoreNarration(
  scheduler: Pick<
    VisualScheduler,
    "nowMs" | "createScope" | "scheduleBatch" | "schedule" | "seal" | "observe" | "cancel"
  >,
  sink: ScoreNarrationSink,
  timing: ScoreNarrationTiming,
) {
  /** Plays committed but not yet narrating, in committed order. */
  let waiting: NarratedLine[][] = [];
  let current: ScopeHandle | null = null;
  let outcome: ScopeHandle | null = null;
  /** Bumped by a reset, so a settling scope from before it starts nothing. */
  let epoch = 0;

  const nowUnits = () => scheduler.nowMs / unitMs;

  function next(lastLines: number): void {
    const play = waiting.shift();
    if (play) start(play);
    else announce(lastLines > 0 ? Math.max(0, timing.settle - timing.lineStep) : 0);
  }

  function start(lines: NarratedLine[]): void {
    const mine = epoch;
    const scope = scheduler.createScope(null, { fallback: "score.summary" });
    const at = nowUnits();
    const admitted = scheduler.scheduleBatch(
      scope,
      lines.map((line, index) => ({
        handler: "score.line",
        payload: { line, stepUnits: timing.lineStep },
        dueUnits: at + index * timing.lineStep,
      })),
    );
    // Not admitted: the model's score shows at once, and the outcome still follows.
    if (!admitted.accepted) {
      scheduler.cancel(scope);
      sink.summarise();
      next(0);
      return;
    }
    current = scope;
    scheduler.seal(scope);
    scheduler.observe(scope, () => {
      if (mine !== epoch || current !== scope) return;
      current = null;
      next(lines.length);
    });
  }

  function announce(delayUnits: number): void {
    const mine = epoch;
    const scope = scheduler.createScope(null);
    outcome = scope;
    scheduler.schedule(scope, { handler: "score.outcome", dueUnits: nowUnits() + delayUnits });
    scheduler.seal(scope);
    scheduler.observe(scope, () => {
      if (mine === epoch && outcome === scope) outcome = null;
    });
  }

  return {
    /** Narrate a committed play's lines, after any play still narrating. */
    narrate(lines: readonly NarratedLine[]): void {
      // A play committed before the outcome showed: the outcome waits for it too.
      if (outcome) {
        const pending = outcome;
        outcome = null;
        scheduler.cancel(pending);
      }
      waiting.push([...lines]);
      if (!current) next(0);
    },
    /** Narration or its outcome is still to come. */
    get presenting(): boolean {
      return current !== null || waiting.length > 0 || outcome !== null;
    },
    /** Stop narrating: nothing queued is shown, and nothing settling starts more. */
    reset(): void {
      epoch++;
      waiting = [];
      for (const scope of [current, outcome]) if (scope) scheduler.cancel(scope);
      current = outcome = null;
    },
  };
}

export type ScoreNarration = ReturnType<typeof createScoreNarration>;
