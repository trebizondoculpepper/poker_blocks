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

/**
 * What one instance of a case is (#711; doc/automatic-profiling.md, "Automatic discovery and
 * coverage"): a single block, a group of blocks (a word, a menu) with its block count, or one
 * complete configured emitter (an exit or particle effect, not one particle). Every result row
 * records it, so a large object can't pass as one block.
 */
export type ProfilingUnit = { kind: "block" | "group" | "emitter"; size: number };

/** One block, the default unit. */
export const oneBlock: ProfilingUnit = { kind: "block", size: 1 };

/**
 * A phase of a transient effect and how it is sampled (#711): `steady` (it looks the same on
 * every frame) or `restarting` (each instance restarts from seeded state as soon as it ends, so
 * no sampled frame shows an effect that has already finished).
 */
export type ProfilingPhase = { name: string; sampling: "steady" | "restarting" };

export type ProfilingCase = {
  /** Which kind of visual it is, for grouping and coverage (material, rack item, ...). */
  family: string;
  /** What the case shows, for the results table. */
  label: string;
  /** The registered host it is drawn in (#712); the board when omitted. */
  host?: string;
  /** What one instance is; one block when omitted. */
  unit?: ProfilingUnit;
  /** The representative configuration chosen, for the results table (a word, a card). */
  variant?: string;
  /** The collection size used unless the run overrides it. */
  defaultCount?: number;
  /** Phases of a transient effect (idle, active, pulse, exit), each with its sampling; one steady
   *  phase when omitted. */
  phases?: readonly ProfilingPhase[];
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

/**
 * Appearances a family declares it cannot profile yet, each with its reason (#710;
 * doc/automatic-profiling.md, "Automatic discovery and coverage"). An unsupported entry is
 * reported and counted, never measured: the runner only enumerates `profilingCases`.
 */
export const profilingUnsupported = new Registry<{ family: string; reason: string }>(
  "unsupported profiling case",
);

/** One expected catalog's coverage: whether its provider is installed, and what it lacks. */
export type CatalogCoverage = {
  catalog: string;
  /** False when no provider is installed for it: a coverage failure, never an empty pass. */
  installed: boolean;
  expected: number;
  available: number;
  unsupported: { id: string; reason: string }[];
  uncovered: string[];
};

export type CoverageReport = {
  catalogs: CatalogCoverage[];
  totals: { expected: number; available: number; unsupported: number; uncovered: number };
  /** Every expected catalog's provider is installed and every expected case has a case. */
  complete: boolean;
};

/**
 * Coverage against the composed set of expected catalogs (#710): each expected catalog names its
 * provider (a `profilingCoverage` entry). A missing provider, an expected case with no registered
 * case, and an unsupported entry are each reported. An empty composition is never complete.
 */
export function catalogCoverage(
  expected: readonly string[],
  cases: Pick<Registry<ProfilingCase>, "has"> = profilingCases,
  coverage: Pick<Registry<() => readonly string[]>, "has" | "get"> = profilingCoverage,
  unsupported: Pick<
    Registry<{ family: string; reason: string }>,
    "has" | "get"
  > = profilingUnsupported,
): CoverageReport {
  const catalogs = expected.map((catalog): CatalogCoverage => {
    const ids = coverage.has(catalog) ? coverage.get(catalog)() : [];
    const declared = ids.flatMap((id) =>
      !cases.has(id) && unsupported.has(id) ? [{ id, reason: unsupported.get(id).reason }] : [],
    );
    return {
      catalog,
      installed: coverage.has(catalog),
      expected: ids.length,
      available: ids.filter((id) => cases.has(id)).length,
      unsupported: declared,
      uncovered: ids.filter((id) => !cases.has(id) && !unsupported.has(id)),
    };
  });
  const sum = (pick: (entry: CatalogCoverage) => number) =>
    catalogs.reduce((total, entry) => total + pick(entry), 0);
  const totals = {
    expected: sum(({ expected }) => expected),
    available: sum(({ available }) => available),
    unsupported: sum(({ unsupported }) => unsupported.length),
    uncovered: sum(({ uncovered }) => uncovered.length),
  };
  return {
    catalogs,
    totals,
    complete:
      catalogs.length > 0 &&
      catalogs.every(({ installed, uncovered }) => installed && uncovered.length === 0),
  };
}

/** One line for a person: the totals, then each problem by catalog. */
export function describeCoverage(report: CoverageReport): string {
  const { expected, available, unsupported, uncovered } = report.totals;
  const problems = report.catalogs.flatMap(
    ({ catalog, installed, uncovered: missing, unsupported: declared }) => [
      ...(installed ? [] : [`${catalog}: no provider installed`]),
      ...(missing.length ? [`${catalog}: no case for ${missing.join(", ")}`] : []),
      ...declared.map(({ id, reason }) => `${catalog}: ${id} unsupported (${reason})`),
    ],
  );
  const verdict = report.complete ? "Complete" : "Incomplete";
  return [
    `${verdict}: ${available} of ${expected} expected available, ${unsupported} unsupported, ${uncovered} uncovered`,
    ...problems,
  ].join("; ");
}

/** What a host is given to prepare: the run's scene, and reflections its own renderer made. */
export type ProfilingHostSetup = { scene: THREE.Scene; reflections: THREE.Texture | null };

/**
 * A representative host (#712; doc/automatic-profiling.md, "Sweep and representative host"): it
 * sets up the scene as a production path draws its objects (lights, reflection environment) and
 * returns how to undo that. A case names its host; the runner dispatches to it and never asks
 * what the case is.
 */
export type ProfilingHost = {
  label: string;
  prepare(setup: ProfilingHostSetup): () => void;
};

export const profilingHosts = new Registry<ProfilingHost>("profiling host");

/** The host a case gets when it names none: blocks as they are lit on the board. */
export const defaultProfilingHost = "board";
