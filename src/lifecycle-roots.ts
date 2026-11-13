/**
 * The named lifecycle parents definitions inherit from (#917; doc/block-lifecycle-declarations.md,
 * "Initial resolved matrix"). Each is a complete declaration a definition names as its `parent`;
 * a definition declares its own `retention` or `reset` only to replace one whole. These are
 * plain configuration, never a policy table keyed by a definition's identity.
 */
import type { LifecycleDeclaration } from "./lifecycle-resolver";

/** Lifecycle parents, by their own name (a namespace separate from definitions'). */
export const lifecycleRoots = {
  /** An ordinary run card: kept for the run, no automatic reversion. */
  ordinaryCard: {
    retention: "run",
    reset: { nonResettable: { reason: "no automatic material reversion" } },
  },
  /** A persistent rack item: kept for the run; activating it is not a reset. */
  rackItem: {
    retention: "run",
    reset: { nonResettable: { reason: "activation is not a boundary reset" } },
  },
  /** A limited-use rack item: depletion consumes it; boundaries never refill its uses. */
  limitedUseItem: {
    retention: "run",
    reset: { nonResettable: { reason: "boundaries do not refill uses" } },
  },
  /** An unopened opaque wrapper: kept for the run; opening is a separate consume/adopt. */
  opaqueWrapper: {
    retention: "run",
    reset: { nonResettable: { reason: "opening is a separate operation" } },
  },
} as const satisfies Record<string, LifecycleDeclaration>;

export type LifecycleRoot = keyof typeof lifecycleRoots;
