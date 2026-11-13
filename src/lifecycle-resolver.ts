/**
 * Inherited lifecycle configuration (#916; doc/block-lifecycle-declarations.md, "Declaration and
 * resolution"; doc/clone-reset.md). Every gameplay definition resolves exactly one retention
 * (`stage`, `round` or `run`) and one reset facet (`resettable` with an ordered recipe, or
 * `nonResettable` with its reason).
 *
 * A declaration may name one parent, which supplies plain defaults; a local `retention` or `reset`
 * replaces that complete value, never merges into it. Resolution is pure: it reads declarations
 * through a lookup, executes nothing and changes no ownership. Missing or unknown parents, cycles,
 * unresolved values, contradictory or unknown facets, bad boundaries and unknown reset handlers
 * are configuration errors, never a guess or a hidden default.
 */
import { Registry } from "./core/registry";
import { getMaterialDefinition, type BlockMaterial } from "./materials";
import {
  resetStateHandlers,
  resolveResetFacet,
  type ResetRequest,
  type ResetStep,
} from "./reset-facet";

export const retentions = ["stage", "round", "run"] as const;
export type Retention = (typeof retentions)[number];

/** What a definition declares: its own values, its parent's for the rest. */
export type LifecycleDeclaration = {
  parent?: string;
  retention?: Retention;
  /** Reset facet declarations, as `resolveResetFacet` reads them: exactly one once resolved. */
  reset?: Readonly<Record<string, unknown>>;
};

export type ResolvedLifecycle = { retention: Retention; reset: ResetRequest };

export class LifecycleConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LifecycleConfigurationError";
  }
}

/** The boundaries a resettable recipe may be scheduled at. */
const boundaries: readonly string[] = ["stage", "round"];

/**
 * How a facet's resolved configuration is validated at resolution time, registered under the
 * facet's own name; it throws a message on a bad configuration. A facet with none needs none.
 */
export const resetFacetValidators = new Registry<(config: unknown) => void>(
  "reset facet validator",
);

/**
 * How one reset step's configuration is validated, registered under its handler's name; it throws
 * a message on a bad configuration (a missing or unknown target). A handler with none takes any.
 */
export const resetStepValidators = new Registry<(config: unknown) => void>("reset step validator");

// A material reversion needs a registered target material.
resetStepValidators.register("material", (config) => {
  const { to } = (config ?? {}) as { to?: unknown };
  // Any installed material, ordinary or experimental, through the same lookup the reset uses.
  const installed = (() => {
    try {
      return typeof to === "string" && !!getMaterialDefinition(to as BlockMaterial);
    } catch {
      return false;
    }
  })();
  if (!installed) throw new Error(`material reset needs a registered target, not "${String(to)}"`);
});

// A resettable reset needs a non-empty recipe of registered handlers and a scheduled boundary.
resetFacetValidators.register("resettable", (config) => {
  const { recipe, boundary } = (config ?? {}) as { recipe?: unknown; boundary?: unknown };
  if (!Array.isArray(recipe) || !recipe.length)
    throw new Error("a resettable reset needs a recipe");
  const unknown = recipe
    .map((step) => (step as { handler?: unknown })?.handler)
    .filter((handler) => typeof handler !== "string" || !resetStateHandlers.has(handler));
  if (unknown.length) throw new Error(`unknown reset handler(s) ${unknown.map(String).join(", ")}`);
  for (const { handler, config: stepConfig } of recipe as ResetStep[])
    if (resetStepValidators.has(handler)) resetStepValidators.get(handler)(stepConfig);
  if (typeof boundary !== "string" || !boundaries.includes(boundary))
    throw new Error(`bad reset boundary "${String(boundary)}"`);
});

/** Resolve one definition's lifecycle through its declared parents. */
export function resolveLifecycle(
  name: string,
  lookup: (name: string) => LifecycleDeclaration | undefined,
): ResolvedLifecycle {
  let retention: Retention | undefined;
  let reset: LifecycleDeclaration["reset"];
  const visited: string[] = [];
  for (let current: string | undefined = name; current !== undefined;) {
    if (visited.includes(current))
      throw new LifecycleConfigurationError(
        `lifecycle parent cycle: ${[...visited, current].join(" → ")}`,
      );
    const declaration = lookup(current);
    if (!declaration)
      throw new LifecycleConfigurationError(
        visited.length
          ? `${visited.at(-1)}: unknown lifecycle parent "${current}"`
          : `no lifecycle declaration for "${current}"`,
      );
    visited.push(current);
    // The nearest declaration wins, whole: a local value is never merged with an inherited one.
    retention ??= declaration.retention;
    reset ??= declaration.reset;
    current = declaration.parent;
  }
  if (retention === undefined)
    throw new LifecycleConfigurationError(`${name}: no retention declared or inherited`);
  if (!retentions.includes(retention))
    throw new LifecycleConfigurationError(`${name}: bad retention "${String(retention)}"`);
  if (reset === undefined)
    throw new LifecycleConfigurationError(`${name}: no reset facet declared or inherited`);
  try {
    const request: ResetRequest = resolveResetFacet(reset);
    if (resetFacetValidators.has(request.facet))
      resetFacetValidators.get(request.facet)(request.config);
    return { retention, reset: request };
  } catch (error) {
    throw new LifecycleConfigurationError(`${name}: ${(error as Error).message}`);
  }
}

/** Resolve every declaration once, as registry validation does; the first error is thrown. */
export function resolveLifecycles(
  declarations: Readonly<Record<string, LifecycleDeclaration>>,
): Record<string, ResolvedLifecycle> {
  const lookup = (name: string) =>
    Object.hasOwn(declarations, name) ? declarations[name] : undefined;
  return Object.fromEntries(
    Object.keys(declarations).map((name) => [name, resolveLifecycle(name, lookup)]),
  );
}
