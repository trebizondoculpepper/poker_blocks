/**
 * Source-settled drop outcomes (#1203; doc/drop-settlement.md). A drop target's release answer is
 * a typed outcome dispatched to a handler registered for its protocol operation, with the active
 * source's settlement capability. Collision/hover verdicts stay separate; this is only what a
 * release does.
 *
 * - **Operations** are keyed by protocol operation (`transfer`, `refuse`, `returnThenAct`), never
 *   by source, target, scene or item. The manager dispatches; it interprets no action.
 * - **Settlement.** Each active source supplies a gesture-owned handle: an opaque generation, a
 *   synchronous `returnToOwner()` (the source restores its complete carried group and clears its
 *   carry before reporting success) and an idempotent close. A closed or stale handle fails,
 *   without partial transfer.
 * - **Return then act.** Consumes its one-shot continuation, asks the source to return, then
 *   rechecks the target's registration lease and the action's availability before invoking the
 *   action once. A failed return reports refusal once; an action gone unavailable after a
 *   successful return reports unavailable once. Nothing waits for an animation; no timer.
 * - **Compatibility.** `booleanOutcome` maps an existing boolean target: true is a committed
 *   transfer, false an ordinary refusal. It is transitional, not a source-routing policy.
 */
import { Registry } from "./core/registry";

/** How a release settled: the source's ownership/presentation path follows from this. */
export type DropResult = "transferred" | "refused" | "returned";

/** A gesture-owned settlement capability, supplied by the active source. */
export type SettlementHandle = {
  /** Opaque: which gesture this handle belongs to. */
  readonly generation: number;
  readonly closed: boolean;
  /**
   * Return the complete carried group to its owner, synchronously. True only if the source still
   * owned the whole group and restored it (its carry is cleared); false otherwise, changing nothing.
   * The handle closes either way.
   */
  returnToOwner(): boolean;
  /** End the gesture's settlement capability; later calls do nothing. */
  close(): void;
};

/**
 * A settlement handle over a source's own restoration. `restore` validates the whole captured
 * group before changing anything and reports whether it restored it.
 */
export function createSettlementHandle(
  generation: number,
  restore: () => boolean,
): SettlementHandle {
  let closed = false;
  return {
    generation,
    get closed() {
      return closed;
    },
    returnToOwner() {
      if (closed) return false;
      closed = true;
      return restore();
    },
    close() {
      closed = true;
    },
  };
}

/** A one-shot release continuation: consumed at most once, by the first caller. */
export type Continuation = { consume(): boolean; readonly consumed: boolean };

export function createContinuation(): Continuation {
  let consumed = false;
  return {
    get consumed() {
      return consumed;
    },
    consume() {
      if (consumed) return false;
      consumed = true;
      return true;
    },
  };
}

/** A target's registration lease: live until the target is unregistered or disposed. */
export type TargetLease = { readonly live: boolean; release(): void };

export function createTargetLease(): TargetLease {
  let live = true;
  return {
    get live() {
      return live;
    },
    release() {
      live = false;
    },
  };
}

/** What a target answers at release: an operation, its configuration and a continuation. */
export type DropOutcome = {
  operation: string;
  config?: unknown;
  continuation: Continuation;
};

export type DropOutcomeHandler = (outcome: DropOutcome, settlement: SettlementHandle) => DropResult;

export const dropOutcomeHandlers = new Registry<DropOutcomeHandler>("drop outcome");

/** The target took the carried group: the source's transfer path follows. */
dropOutcomeHandlers.register("transfer", ({ continuation }, settlement) => {
  continuation.consume();
  settlement.close();
  return "transferred";
});

/** The target refused at release: the source's existing refusal path (and its cue) follows. */
dropOutcomeHandlers.register("refuse", ({ continuation }, settlement) => {
  continuation.consume();
  settlement.close();
  return "refused";
});

/** Configuration for `returnThenAct`: the target's action and its owners' responses. */
export type ReturnThenActConfig = {
  /** The target's registration lease, captured when it answered. */
  lease: TargetLease;
  /** Whether the configured action is available now. */
  available(): boolean;
  /** Invoke the configured action; called at most once. */
  invoke(): void;
  /** The source could not return: the configured owner reports refusal (once). */
  refused(): void;
  /** Returned, but the action is no longer available: its owner reports that (once). */
  unavailable(): void;
};

/**
 * Return the carried group to its owner, then invoke the target's action. A successful return is
 * not a refusal: no denial cue, no "refused" trace.
 */
dropOutcomeHandlers.register("returnThenAct", ({ config, continuation }, settlement) => {
  const action = config as ReturnThenActConfig;
  // Consumed before anything runs, so a re-entrant command or source callback can't run it again.
  if (!continuation.consume()) {
    settlement.close();
    return "refused";
  }
  if (!settlement.returnToOwner()) {
    action.refused();
    return "refused";
  }
  // The source's carry is cleared now; the target may have gone during the synchronous return.
  if (!action.lease.live || !action.available()) {
    action.unavailable();
    return "returned";
  }
  action.invoke();
  return "returned";
});

/** Dispatch a release outcome to its registered operation. */
export function dispatchDropOutcome(
  outcome: DropOutcome,
  settlement: SettlementHandle,
): DropResult {
  return dropOutcomeHandlers.get(outcome.operation)(outcome, settlement);
}

/** The transitional adapter for an existing boolean target. */
export function booleanOutcome(accepted: boolean): DropOutcome {
  return { operation: accepted ? "transfer" : "refuse", continuation: createContinuation() };
}

/** A `returnThenAct` outcome for a target's configured action. */
export function returnThenAct(config: ReturnThenActConfig): DropOutcome {
  return { operation: "returnThenAct", config, continuation: createContinuation() };
}
