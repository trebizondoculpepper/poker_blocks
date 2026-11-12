/**
 * Registered profiling cases (#527, #618): one per appearance the profiler measures. A case is
 * data plus a factory that builds the object through the production path; the runner only
 * enumerates this registry and calls the handlers, never asking what a case is.
 */
import type * as THREE from "three";
import { Registry } from "../../core/registry";

/** One built object in the profiler's scene. */
export type ProfiledObject = {
  object: THREE.Object3D;
  /** Advance its normal ambient animation. */
  update?(dt: number): void;
  /** Free only what this object made; shared resources stay. */
  dispose(): void;
};

export type ProfilingCase = {
  /** Which kind of visual it is, for grouping and coverage (material, rack item, ...). */
  family: string;
  /** What the case shows, for the results table. */
  label: string;
  /** The collection size used unless the run overrides it. */
  defaultCount?: number;
  /** Named phases of a transient effect (idle, active, pulse, exit); one when omitted. */
  phases?: readonly string[];
  /** Build one object through the production factory, with a fixed seed. */
  create(context: { seed: number; phase?: string }): ProfiledObject | Promise<ProfiledObject>;
};

export const profilingCases = new Registry<ProfilingCase>("profiling case");

/**
 * Each family that can be profiled lists its registered appearances, so the coverage report can
 * name any that has no case (never skipped silently). Returns the case ids it expects.
 */
export const profilingCoverage = new Registry<() => readonly string[]>("profiling coverage");

/** The expected case ids with no registered case, by family. */
export function uncoveredCases(
  cases: Pick<Registry<ProfilingCase>, "has"> = profilingCases,
  coverage: Pick<Registry<() => readonly string[]>, "names" | "get"> = profilingCoverage,
): { family: string; missing: string[] }[] {
  return coverage
    .names()
    .map((family) => ({
      family,
      missing: coverage
        .get(family)()
        .filter((id) => !cases.has(id)),
    }))
    .filter(({ missing }) => missing.length > 0);
}
