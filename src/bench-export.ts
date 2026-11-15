/**
 * Bench exports (#937; doc/experiments/spatial-modifiers.md, "Room controls and exports", and
 * doc/experiments/passive-test-bench.md, "Measurement, export and lifecycle"): the bench's two
 * local artifacts, composed from the merged capabilities and nothing new.
 *
 * - **Configuration** (`exportConfiguration`, #934): the applied scenario under this build's rules,
 *   for authoring and import.
 * - **Trial replay** (`exportReplay`, #936): that configuration plus the trial's command-bearing
 *   record (#1247), for replay and comparison. It can disclose future draws, so the bench says so.
 *
 * Each is serialized and written to the clipboard on the user's gesture. Success is reported only
 * after the write resolves; a failure, or an artifact the capability marks unreplayable, reports
 * its diagnostics. Nothing here changes the trial, its scenario or the run.
 */
import {
  exportConfiguration,
  serializeConfiguration,
  type ExperimentConfiguration,
} from "./experiment-config";
import type { ExperimentRecord } from "./experiment-recorder";
import { exportReplay } from "./experiment-replay";
import type { ScenarioDefinition, ScenarioRuntime } from "./dev-scenario";

/** What the bench shows after an export attempt. */
export type ExportOutcome = { ok: boolean; message: string };

/** The warning shown beside the replay control: it carries the trial's future draws. */
export const replayDisclosure =
  "A trial replay records the whole trial, including cards not yet drawn: share it knowingly.";

export type BenchExportSource = {
  /** The applied scenario, or null before any trial was applied. */
  scenario(): ScenarioDefinition | null;
  runtime(): ScenarioRuntime;
  /** The current trial's record so far, or null when no recorder runs. */
  record(): ExperimentRecord | null;
  /** This build's exact identity. */
  build: string;
};

/** One artifact the bench offers: its control's label, what it reports, and how it is made. */
export type BenchArtifact = {
  label: string;
  copied: string;
  make(
    configuration: ExperimentConfiguration,
    source: BenchExportSource,
  ): { ok: true; text: string; notes: readonly string[] } | { ok: false; message: string };
};

/** The configuration alone, for authoring and import. */
export const configurationArtifact: BenchArtifact = {
  label: "Copy configuration",
  copied: "Configuration copied.",
  make: (configuration) => ({ ok: true, text: serializeConfiguration(configuration), notes: [] }),
};

/** The configuration with the trial's record, for replay and comparison. */
export const replayArtifact: BenchArtifact = {
  label: "Copy trial replay",
  copied: "Trial replay copied.",
  make(configuration, source) {
    const record = source.record();
    if (!record) return { ok: false, message: "No trial is being recorded yet." };
    const replay = exportReplay({ build: source.build, configuration, record });
    return {
      ok: true,
      text: JSON.stringify(replay, null, 2),
      notes: replay.replayable
        ? []
        : ["Exported, but it can't be replayed:", ...replay.diagnostics],
    };
  },
};

function configurationOf(source: BenchExportSource): ExperimentConfiguration | string {
  const scenario = source.scenario();
  if (!scenario) return "Apply a trial before exporting it.";
  try {
    return exportConfiguration(scenario, source.runtime(), source.build);
  } catch (error) {
    return `The configuration can't be exported: ${(error as Error).message}`;
  }
}

/** Copy one artifact on the user's gesture; report only what actually happened. */
export async function copyBenchArtifact(
  artifact: BenchArtifact,
  source: BenchExportSource,
  clipboard: Pick<Clipboard, "writeText">,
): Promise<ExportOutcome> {
  const configuration = configurationOf(source);
  if (typeof configuration === "string") return { ok: false, message: configuration };
  const made = artifact.make(configuration, source);
  if (!made.ok) return { ok: false, message: made.message };
  try {
    await clipboard.writeText(made.text);
  } catch (error) {
    return {
      ok: false,
      message: `Couldn't copy: ${(error as Error).message || "the clipboard refused"}`,
    };
  }
  return { ok: made.notes.length === 0, message: [artifact.copied, ...made.notes].join("\n") };
}

/**
 * Whether a copy's result may still be shown (#1355): only if the panel it was asked from is
 * still the panel, and no newer trial has been requested since.
 */
export function copyStillCurrent<P>(
  asked: { panel: P; trial: number },
  now: { panel: P; trial: number },
): boolean {
  return asked.panel === now.panel && asked.trial === now.trial;
}
