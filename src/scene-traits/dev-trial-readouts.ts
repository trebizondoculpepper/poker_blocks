/**
 * DevTrialReadouts (#904; doc/experiments/passive-test-bench.md, "Measurement, export and
 * lifecycle"): a testing-only panel of live trial measurements. It reads the run's committed
 * state when each action commits, through the pure snapshot-scoped context queries, and the
 * scored lines and activation outcomes that action captured. It never mutates the model, never
 * diffs render state, and shows an unavailable measure as unavailable, never as zero.
 *
 * Two groups are kept apart: the field's current geometry, and the rows the last action scored
 * (its scored-subset diversity and mass, its points and the contributions actually applied).
 * Subscribing through the run service's committed facts follows whichever run is current, so a
 * replaced trial rebinds without a second subscription.
 */
import { query, type QueryResult, type QuerySnapshot } from "../context-queries";
import type { RuleActivation } from "../passive-effects";
import type { EventEnvelope } from "../lifecycle/action";
import type { PassiveScoredLine } from "../passive-effects";
import type { GameState } from "../game-state";
import type { SceneTraitBehaviour } from "../scenes";
import "../packing-density";
import "../field-mass";
import "../material-diversity";

export type DevTrialReadoutsConfig = Record<never, never>;

/** One readout row: a measured value, or why it is unavailable. */
export type ReadoutRow = { label: string; value: string } | { label: string; unavailable: string };

export type TrialReadout = {
  geometry: readonly ReadoutRow[];
  /** The rows the last action scored, newest action only; empty before anything is scored. */
  scored: readonly { label: string; rows: readonly ReadoutRow[] }[];
  score: number;
};

const shown = <T>(
  label: string,
  result: QueryResult<T>,
  format: (value: T) => string,
): ReadoutRow =>
  result.available ? { label, value: format(result.value) } : { label, unavailable: result.reason };

const kg = (value: number) => `${value.toFixed(2)} kg`;

/** The contributions an activation actually applied, as `operation operand`. */
const contributions = (activations: readonly RuleActivation[]) =>
  activations.flatMap(({ outcomes }) =>
    (outcomes ?? []).map(
      ({ operation, operand }) => `${operation}${operand === undefined ? "" : ` ${operand}`}`,
    ),
  );

/** The readout for this committed state and the lines its last action scored. Pure. */
export function trialReadout(
  state: Pick<GameState, "field" | "round">,
  scoredLines: readonly PassiveScoredLine[],
): TrialReadout {
  const snapshot: QuerySnapshot = { field: state.field };
  type Packing = {
    occupied: number;
    extents: { x: number; y: number; z: number };
    capacity: number;
    density: number;
  };
  type Mass = { totalKg: number; meanKg: number; count: number };
  const packing = query<Packing>("packingDensity", snapshot);
  const mass = query<Mass>("fieldMass", snapshot);
  return {
    geometry: [
      { label: "Occupied", value: String(state.field.length) },
      shown("Bounds", packing, ({ extents: { x, y, z } }) => `${x}×${y}×${z}`),
      shown("Capacity", packing, ({ capacity }) => String(capacity)),
      shown("Packing", packing, ({ density }) => `${(density * 100).toFixed(1)}%`),
      shown("Total mass", mass, ({ totalKg }) => kg(totalKg)),
      shown("Mean mass", mass, ({ meanKg }) => kg(meanKg)),
    ],
    scored: scoredLines.map(({ blockIds, points, activations }, index) => {
      const scope = { ids: blockIds };
      const applied = contributions(activations);
      return {
        label: `Row ${index + 1} (${blockIds.length} blocks)`,
        rows: [
          { label: "Points", value: String(points) },
          shown(
            "Families",
            query<{ families: number }>("materialDiversity", snapshot, scope),
            ({ families }) => String(families),
          ),
          shown(
            "Scored mean mass",
            query<Mass>("scoredSubsetMass", snapshot, scope),
            ({ meanKg }) => kg(meanKg),
          ),
          applied.length
            ? { label: "Applied", value: applied.join(", ") }
            : { label: "Applied", unavailable: "no contributions" },
        ],
      };
    }),
    score: state.round.score,
  };
}

const row = (entry: ReadoutRow) =>
  "value" in entry
    ? `<dt>${entry.label}</dt><dd>${entry.value}</dd>`
    : `<dt>${entry.label}</dt><dd class="unavailable" title="${entry.unavailable}">unavailable</dd>`;

/** The readout as the panel's HTML. */
export function readoutHtml(readout: TrialReadout): string {
  const scored = readout.scored.length
    ? readout.scored.map(({ label, rows }) => `<h3>${label}</h3><dl>${rows.map(row).join("")}</dl>`)
    : ["<p>No rows scored yet.</p>"];
  return [
    "<h2>Trial readouts</h2>",
    `<p>Score: ${readout.score}</p>`,
    "<h3>Current field</h3>",
    `<dl>${readout.geometry.map(row).join("")}</dl>`,
    "<h3>Last scored rows</h3>",
    ...scored,
  ].join("");
}

export function devTrialReadouts<
  Context extends {
    host: HTMLElement;
    services: {
      run: {
        committedState(): Pick<GameState, "field" | "round">;
        lastScoredLines(): readonly PassiveScoredLine[];
        onCommitted(listener: (facts: readonly EventEnvelope[]) => void): () => void;
      };
    };
  },
>(): SceneTraitBehaviour<Context, DevTrialReadoutsConfig> {
  let panel: HTMLElement | null = null;
  let stop: (() => void) | null = null;
  return {
    enter({ host, services: { run } }) {
      stop?.();
      panel?.remove();
      panel = document.createElement("aside");
      panel.className = "dev-trial-readouts";
      panel.setAttribute("aria-label", "Trial readouts");
      host.append(panel);
      // The field as it stands; nothing scored yet in this view.
      panel.innerHTML = readoutHtml(trialReadout(run.committedState(), []));
      // Each committed action, read as it commits: its state and the lines it scored.
      stop = run.onCommitted((facts) => {
        if (!panel) return;
        // An action scored lines when one of its facts carries a scored line's context.
        const scoredThisAction = facts.some(
          ({ payload }) => (payload as { score?: unknown }).score !== undefined,
        );
        panel.innerHTML = readoutHtml(
          trialReadout(run.committedState(), scoredThisAction ? run.lastScoredLines() : []),
        );
      });
    },
    exit() {
      stop?.();
      stop = null;
      panel?.remove();
      panel = null;
    },
  };
}
