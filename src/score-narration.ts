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
import type { RoundOutcome } from "./dealer";
import {
  unitMs,
  visualFallbacks,
  visualHandlers,
  type EffectHandle,
  type ScopeHandle,
  type VisualScheduler,
} from "./visual-events/scheduler";

/**
 * A visual event shown alongside a line (#919): a registered handler and its captured payload,
 * such as an item's activation label. It starts with its line, in a scope of its own, so it never
 * holds up the next line, the next play or the outcome.
 */
export type AlongsideEvent = { handler: string; payload: unknown };

/** One scoring line as committed: its blocks, the rule sources that fired, its points. */
export type NarratedLine = {
  blockIds: string[];
  sourceIds: string[];
  points: number;
  /** Shown with this line, in this order, each lasting as long as its own handler says. */
  alongside?: readonly AlongsideEvent[];
};

/**
 * Where a committed play left the stage, captured when it committed: narration and its
 * fallback show this, never the live model, which a later play may already have changed.
 */
export type NarratedEndpoint = { score: number; outcome: RoundOutcome };

/** A committed play: its lines and its captured endpoint. */
export type NarratedPlay = { lines: readonly NarratedLine[]; endpoint: NarratedEndpoint };

/** What narration shows through: the play presenter supplies it as a scheduler service. */
export type ScoreNarrationSink = {
  /**
   * Show one line: tint its blocks, pulse its sources, play its sound, add its points. `lateMs`
   * is how far past its scheduled time it started, so its visuals keep the scope's clock rather
   * than restarting late (#800 review).
   */
  line(line: NarratedLine, lateMs: number): void;
  /** Show a play's captured score at once, without narrating (the summary fallback). */
  summarise(endpoint: NarratedEndpoint): void;
  /** Announce the captured outcome of the last play narrated. */
  decide(endpoint: NarratedEndpoint): void;
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
  sinkOf(context.services).line(line, Math.max(0, context.nowMs - context.scheduledAtMs));
  const until = context.scheduledAtMs + stepUnits * unitMs;
  const effect: EffectHandle = {
    update: (nowMs) => (nowMs >= until ? "finished" : "running"),
    cancel() {},
    dispose() {},
  };
  return effect;
});

/**
 * A play's tint tail as declared scheduler work (#999): it lasts from the last line's start until
 * that line's tint has settled, in its own hold scope, so only the outcome waits for it.
 */
visualHandlers.register("score.hold", (payload, context) => {
  const { durationUnits } = payload as { durationUnits: number };
  const until = context.scheduledAtMs + durationUnits * unitMs;
  const effect: EffectHandle = {
    update: (nowMs) => (nowMs >= until ? "finished" : "running"),
    cancel() {},
    dispose() {},
  };
  return effect;
});

visualHandlers.register("score.outcome", (payload, context) => {
  sinkOf(context.services).decide(payload as NarratedEndpoint);
  return "done";
});

visualFallbacks.register("score.summary", ({ services, payload }) =>
  sinkOf(services).summarise(payload as NarratedEndpoint),
);

export function createScoreNarration(
  scheduler: Pick<
    VisualScheduler,
    "nowMs" | "createScope" | "scheduleBatch" | "schedule" | "seal" | "observe" | "cancel"
  >,
  sink: ScoreNarrationSink,
  timing: ScoreNarrationTiming,
  /** Narration and its outcome have all settled: whoever shows `presenting` may refresh. */
  idle: () => void = () => undefined,
) {
  /**
   * Plays committed but not yet narrating, in committed order. A slot is reserved when its play
   * commits and filled when the play is ready to narrate, so a play that lands sooner still
   * waits for every play committed before it (#800 review).
   */
  let waiting: NarrationSlot[] = [];
  /** The endpoint of the latest play started: the outcome announced after it. */
  let reached: NarratedEndpoint | null = null;
  let current: ScopeHandle | null = null;
  let outcome: ScopeHandle | null = null;
  /** Scopes of events shown alongside lines (#919), until each settles or a reset cancels it. */
  const besides = new Set<ScopeHandle>();
  /** Bumped by a reset, so a settling scope from before it starts nothing. */
  let epoch = 0;

  /**
   * Hold scopes still running: each scored play's tint tail (#999). Separate from the narration
   * scopes, so the next play's lines keep their pace while the outcome waits for every hold.
   */
  let holds = new Set<ScopeHandle>();

  const nowUnits = () => scheduler.nowMs / unitMs;

  function next(): void {
    const head = waiting[0];
    // The next committed play isn't ready yet: everything after it waits, and so does the outcome.
    if (head && !head.play) return;
    if (head?.play) {
      waiting.shift();
      start(head.play);
    } else gate();
  }

  /** Announce the captured outcome once narration is drained and every hold has settled. */
  function gate(): void {
    if (current || outcome || waiting.length > 0 || holds.size > 0 || !reached) return;
    announce(reached);
  }

  /** Declare a scored play's tint tail, from its last line's start to that tint settling. */
  function hold(lastLineUnits: number): void {
    const mine = epoch;
    const scope = scheduler.createScope(null);
    const admitted = scheduler.schedule(scope, {
      handler: "score.hold",
      payload: { durationUnits: timing.settle },
      dueUnits: lastLineUnits,
    });
    // Not admitted: nothing to wait for, so the outcome isn't held up by it.
    if (!admitted.accepted) {
      scheduler.cancel(scope);
      return;
    }
    holds.add(scope);
    scheduler.seal(scope);
    scheduler.observe(scope, () => {
      if (mine !== epoch || !holds.delete(scope)) return;
      gate();
    });
  }

  function start({ lines, endpoint }: NarratedPlay): void {
    const mine = epoch;
    reached = endpoint;
    const scope = scheduler.createScope(null, {
      fallback: "score.summary",
      fallbackPayload: endpoint,
    });
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
      sink.summarise(endpoint);
      next();
      return;
    }
    showAlongside(lines, at);
    current = scope;
    if (lines.length) hold(at + (lines.length - 1) * timing.lineStep);
    scheduler.seal(scope);
    scheduler.observe(scope, () => {
      if (mine !== epoch || current !== scope) return;
      current = null;
      next();
    });
  }

  /**
   * Each line's accompanying events, due with their line, in one scope of their own that nothing
   * waits for (#919). Optional feedback: a batch that can't be admitted is simply not shown.
   */
  function showAlongside(lines: readonly NarratedLine[], at: number): void {
    const events = lines.flatMap((line, index) =>
      (line.alongside ?? []).map(({ handler, payload }) => ({
        handler,
        payload,
        dueUnits: at + index * timing.lineStep,
      })),
    );
    if (!events.length) return;
    const scope = scheduler.createScope(null);
    if (!scheduler.scheduleBatch(scope, events).accepted) {
      scheduler.cancel(scope);
      return;
    }
    besides.add(scope);
    scheduler.seal(scope);
    scheduler.observe(scope, () => besides.delete(scope));
  }

  function announce(endpoint: NarratedEndpoint): void {
    const mine = epoch;
    const scope = scheduler.createScope(null);
    const admitted = scheduler.schedule(scope, {
      handler: "score.outcome",
      payload: endpoint,
      dueUnits: nowUnits(),
    });
    // Not admitted: the outcome goes straight through the direct sink, so results never wait.
    if (!admitted.accepted) {
      scheduler.cancel(scope);
      sink.decide(endpoint);
      idle();
      return;
    }
    outcome = scope;
    scheduler.seal(scope);
    scheduler.observe(scope, () => {
      if (mine !== epoch || outcome !== scope) return;
      outcome = null;
      idle();
    });
  }

  /** Hold a place in committed order for a play that has just committed. */
  function reserve(): NarrationSlot {
    // A play committed before the outcome showed: the outcome waits for it too.
    if (outcome) {
      const pending = outcome;
      outcome = null;
      scheduler.cancel(pending);
    }
    const slot: NarrationSlot = { play: null, epoch };
    waiting.push(slot);
    return slot;
  }

  /** The reserved play is ready: narrate it in its committed place. */
  function release(slot: NarrationSlot, play: NarratedPlay): void {
    if (slot.epoch !== epoch || slot.play) return;
    slot.play = { lines: [...play.lines], endpoint: play.endpoint };
    if (!current) next();
  }

  return {
    reserve,
    release,
    /** Reserve and release at once: a play that is ready as it commits. */
    narrate(play: NarratedPlay): void {
      release(reserve(), play);
    },
    /** Narration or its outcome is still to come. */
    get presenting(): boolean {
      return current !== null || waiting.length > 0 || outcome !== null || holds.size > 0;
    },
    /** Stop narrating: nothing queued is shown, and nothing settling starts more. */
    reset(): void {
      // Detached before cancelling, under a new epoch, so no reentrant observer can announce.
      epoch++;
      const owned = [current, outcome, ...holds, ...besides];
      besides.clear();
      waiting = [];
      reached = null;
      holds = new Set();
      current = outcome = null;
      for (const scope of owned) if (scope) scheduler.cancel(scope);
    },
  };
}

export type ScoreNarration = ReturnType<typeof createScoreNarration>;

/** A committed play's place in narration order, filled once the play is ready. */
export type NarrationSlot = { play: NarratedPlay | null; readonly epoch: number };
