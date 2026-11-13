/**
 * The terminal-field burn presenter (#945; doc/loss-field-burn.md). Burns the captured outgoing
 * field ghosts of a finished run, in a cosmetic order, on the one shared visual-event scheduler,
 * and reports a result gate once ceil(80%) of the burns have finished, while the rest finish
 * behind the next screen.
 *
 * - **Plan.** The order is a shuffle drawn once from a cosmetic random source (never the session
 *   RNG). Card i starts at i * min(1, spread / max(1, N − 1)) units, so starts stay within the
 *   spread however many cards burn; each burn lasts its configured duration.
 * - **Scopes.** One outgoing root owns two sibling scopes: the **gate** holds the first
 *   ceil(share · N) burns in order, the **tail** the rest. The gate settles when its burns have
 *   finished (completions, not starts); the tail never holds it up. Cancelling the root (a new
 *   run, the main menu, teardown) cancels every scheduled and running burn, once.
 * - **Rendering** is the renderer service's: `burn(ghostId, { startMs, durationMs })` returns the
 *   running effect, timed from its *scheduled* start so late or batched starts keep their stagger.
 *   `summary(ghostId)` shows a ghost's captured end state at once: used under reduced motion, for
 *   a burn that fails to start, and for one the scheduler refused to admit. A running effect's own
 *   cancellation is the renderer's to summarize.
 *
 * It reads no model, changes nothing, draws no session randomness and plays no sound.
 */
import {
  unitsToMs,
  unitMs,
  visualFallbacks,
  visualHandlers,
  type EffectHandle,
  type ScopeHandle,
  type ScopeStatus,
  type VisualScheduler,
} from "../visual-events/scheduler";

export type TerminalBurnConfig = {
  /** Each card's burn, in game-time units. */
  durationUnits: number;
  /** The most the starts may spread over, in units. */
  spreadUnits: number;
  /** The share of finished burns that opens the result gate. */
  gateShare: number;
};

/** The initial, reversible audition defaults (doc/loss-field-burn.md). */
export const defaultTerminalBurn: TerminalBurnConfig = {
  durationUnits: 6,
  spreadUnits: 12,
  gateShare: 0.8,
};

export type BurnPlan = {
  /** Ghost IDs in burn order. */
  order: string[];
  /** Each one's start, in units after the sequence begins. */
  starts: number[];
  /** How many of the first in order the gate waits for. */
  required: number;
};

/** The burn order, starts and gate size, from a cosmetic random source. */
export function burnPlan(
  ghostIds: readonly string[],
  random: () => number,
  config: TerminalBurnConfig = defaultTerminalBurn,
): BurnPlan {
  const order = [...ghostIds];
  for (let index = order.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [order[index], order[other]] = [order[other]!, order[index]!];
  }
  const step = Math.min(1, config.spreadUnits / Math.max(1, order.length - 1));
  return {
    order,
    starts: order.map((_, index) => index * step),
    required: Math.ceil(config.gateShare * order.length),
  };
}

/** What draws the ghosts' burns. */
export type TerminalBurnRenderer = {
  /** One ghost's running burn, from its scheduled start, lasting `durationMs`. */
  burn(ghostId: string, timing: { startMs: number; durationMs: number }): EffectHandle;
  /** Show one ghost's captured end state at once (bounded summary completion). */
  summary(ghostId: string): void;
};

/** The services the burn handler reads. */
export type TerminalBurnServices = { terminalFieldBurn?: TerminalBurnRenderer };

type BurnPayload = { ghostId: string; durationUnits: number; reducedMotion: boolean };

visualHandlers.register("terminalFieldBurn", (raw, context) => {
  const { ghostId, durationUnits, reducedMotion } = raw as BurnPayload;
  const renderer = (context.services as TerminalBurnServices | undefined)?.terminalFieldBurn;
  // Never a silent success: with no renderer the burn fails, and its gate settles as failed.
  if (!renderer) throw new Error("terminalFieldBurn: no renderer service");
  // Reduced motion: the captured summary, settled at once.
  if (reducedMotion) {
    renderer.summary(ghostId);
    return "done";
  }
  try {
    return renderer.burn(ghostId, {
      startMs: context.scheduledAtMs,
      durationMs: unitsToMs(durationUnits),
    });
  } catch {
    // A burn that can't start: its summary instead, never a gate left waiting (#945 review).
    renderer.summary(ghostId);
    return "done";
  }
});

// A failed burn scope settles as failed with nothing more to show: never left pending.
visualFallbacks.register("terminalFieldBurnSummary", () => {});

export type TerminalBurn = {
  plan: BurnPlan;
  /** Ghosts the scheduler refused to admit: each was shown as its summary at once. */
  summarized: string[];
  /** The outgoing root: cancel it to cancel everything. */
  root: ScopeHandle;
  /** Settles once the required burns have finished (or failed, or been cancelled). */
  gate: ScopeHandle;
  /** The optional tail, finishing behind the next screen. */
  tail: ScopeHandle;
  /** Called once with the gate's settled status. */
  onGate(listener: (status: ScopeStatus) => void): () => void;
  cancel(): void;
};

/** Start burning the captured ghosts now, on `scheduler`, under `parent` if given. */
export function startTerminalFieldBurn(
  scheduler: VisualScheduler,
  options: {
    ghostIds: readonly string[];
    random: () => number;
    reducedMotion: boolean;
    config?: TerminalBurnConfig;
    parent?: ScopeHandle | null;
    /** The renderer, for summarizing burns the scheduler refuses for capacity. */
    renderer: TerminalBurnRenderer;
  },
): TerminalBurn {
  const config = options.config ?? defaultTerminalBurn;
  const plan = burnPlan(options.ghostIds, options.random, config);
  const root = scheduler.createScope(options.parent ?? null);
  const gate = scheduler.createScope(root, { fallback: "terminalFieldBurnSummary" });
  const tail = scheduler.createScope(root, { fallback: "terminalFieldBurnSummary" });
  const begin = scheduler.nowMs / unitMs;
  const summarized: string[] = [];
  plan.order.forEach((ghostId, index) => {
    const admission = scheduler.schedule(index < plan.required ? gate : tail, {
      handler: "terminalFieldBurn",
      payload: {
        ghostId,
        durationUnits: config.durationUnits,
        reducedMotion: options.reducedMotion,
      },
      dueUnits: begin + plan.starts[index]!,
      originUnits: begin,
    });
    // Refused (a full queue): shown as its summary now, and reported, rather than silently
    // missing from the gate's count (#945 review).
    // A cancelled or stale root emits nothing more, so only a live root summarizes.
    if (!admission.accepted && scheduler.status(root).state === "pending") {
      try {
        options.renderer.summary(ghostId);
      } catch (error) {
        // The scopes must still reach a terminal state, and the caller gets no handle.
        scheduler.cancel(root);
        throw error;
      }
      summarized.push(ghostId);
    }
  });
  for (const scope of [gate, tail, root]) scheduler.seal(scope);
  return {
    plan,
    summarized,
    root,
    gate,
    tail,
    onGate(listener) {
      const status = scheduler.status(gate);
      if (status.state !== "pending") {
        listener(status);
        return () => {};
      }
      return scheduler.observe(gate, listener);
    },
    cancel: () => scheduler.cancel(root),
  };
}
