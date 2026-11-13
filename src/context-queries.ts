/**
 * Registered context queries (doc/game-events.md, "Registered context queries"): pure providers
 * over an explicit immutable snapshot, requested by name. A query returns a value or a typed
 * `unavailable` result, never a stand-in zero; it cannot change state, draw random numbers or emit
 * events. The same snapshot and configuration give the same result, cached for that snapshot
 * object only, so a new snapshot (any occupancy change) is computed afresh.
 */
import { Registry } from "./core/registry";
import type { GameState } from "./game-state";

export type QueryResult<T> = { available: true; value: T } | { available: false; reason: string };

export type ContextQuery<T = unknown> = {
  /** How its cost grows: stated so a caller can tell a cheap query from an expensive one. */
  cost: string;
  /** The largest input it accepts, in its own units: beyond it, the result is unavailable. */
  limit: number;
  /** How big this snapshot's input is, in the same units as `limit`; cheap to compute. */
  size(snapshot: GameState): number;
  run(snapshot: GameState, config: unknown): QueryResult<T>;
};

export const contextQueries = new Registry<ContextQuery>("context query");

const cache = new WeakMap<GameState, Map<string, QueryResult<unknown>>>();

/** Run a registered query on a snapshot, reusing its result for that same snapshot. */
export function query<T>(name: string, snapshot: GameState, config?: unknown): QueryResult<T> {
  // Omitted and null configuration are different keys: a provider may treat them differently.
  const key = `${name}:${config === undefined ? "default" : JSON.stringify(config)}`;
  let results = cache.get(snapshot);
  if (!results) cache.set(snapshot, (results = new Map()));
  if (!results.has(key)) {
    const provider = contextQueries.get(name);
    // A deterministic input limit, checked before any scan: never a machine-speed decision.
    const size = provider.size(snapshot);
    results.set(
      key,
      size > provider.limit
        ? {
            available: false,
            reason: `input of ${size} exceeds the query's limit of ${provider.limit}`,
          }
        : provider.run(snapshot, config),
    );
  }
  return results.get(key) as QueryResult<T>;
}
