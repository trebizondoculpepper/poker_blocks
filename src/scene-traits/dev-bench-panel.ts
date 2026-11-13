/**
 * DevBenchPanel (#903; doc/experiments/passive-test-bench.md, "Selecting trials and changing
 * settings", and doc/experiments/trial-session-adoption.md, "Apply, restart and controls"): a
 * testing-only panel that chooses a configured scenario, edits each installed passive's declared
 * parameters, and asks the run host for a new trial.
 *
 * Controls come from each passive's own parameter schema (`effectiveSettings`, #876); edits are
 * validated with the same shared validators before anything is requested. Apply restarts the
 * trial from the SAME scenario and seed with the edited settings; Restart repeats the applied
 * settings; New Seed is a separate explicit action. Typing alone restarts nothing. An invalid
 * edit or a failed request reports its diagnostics and leaves the current trial as it is.
 * Nothing here names a passive, scenario or room: a mode composes the scenarios it offers.
 */
import { playSfx } from "../audio/sfx";
import { Registry } from "../core/registry";
import {
  configurationProblems,
  configurationSchemaVersion,
  configurePassive,
  effectiveSettings,
  type EffectiveSetting,
  type ParameterSchema,
} from "../configurable-passive";
import type { ScenarioDefinition, ScenarioStep } from "../dev-scenario";
import { createPassiveBlock, passiveDefinitions } from "../passives";
import type { SceneTraitBehaviour } from "../scenes";
import type { SessionRequest, SessionResult } from "../session-host";

/** A scenario the panel offers, by label. */
export type BenchScenario = { label: string; scenario: ScenarioDefinition };

export type DevBenchPanelConfig = { scenarios: readonly BenchScenario[] };

type Overrides = Record<string, number | string>;
type PassiveDescriptor = { definitionId: string; overrides?: Overrides };

/** Every installed passive the scenario declares, in order, across its passive steps. */
export function scenarioPassives(scenario: ScenarioDefinition): PassiveDescriptor[] {
  return scenario.steps.flatMap(({ config }) =>
    [((config as { passives?: unknown }) ?? {}).passives ?? []]
      .flat()
      .filter(
        (passive): passive is PassiveDescriptor =>
          typeof (passive as PassiveDescriptor)?.definitionId === "string",
      ),
  );
}

/** One passive's controls: its schema-derived settings with these overrides applied. */
export function passiveSettings(
  descriptor: PassiveDescriptor,
  overrides: Overrides,
): EffectiveSetting[] {
  const block = createPassiveBlock(descriptor.definitionId, "bench-preview");
  return effectiveSettings(configurePassive(block, { ...descriptor.overrides, ...overrides }));
}

/** Everything wrong with these edits, through the shared per-instance validators. */
export function editProblems(scenario: ScenarioDefinition, edits: readonly Overrides[]): string[] {
  return scenarioPassives(scenario).flatMap((descriptor, index) =>
    configurationProblems(passiveDefinitions.get(descriptor.definitionId), {
      schemaVersion: configurationSchemaVersion,
      overrides: { ...descriptor.overrides, ...edits[index] },
    }),
  );
}

/**
 * The scenario with these edits and this seed: each passive descriptor, in declared order, takes
 * its edited overrides. The original definition is never changed.
 */
export function editedScenario(
  scenario: ScenarioDefinition,
  edits: readonly Overrides[],
  seed: number,
): ScenarioDefinition {
  let index = 0;
  const editStep = (step: ScenarioStep): ScenarioStep => {
    const passives = ((step.config as { passives?: unknown }) ?? {}).passives;
    if (!Array.isArray(passives)) return step;
    return {
      ...step,
      config: {
        ...(step.config as object),
        passives: passives.map((passive: PassiveDescriptor) => ({
          ...passive,
          overrides: { ...passive.overrides, ...edits[index++] },
        })),
      },
    };
  };
  return { ...scenario, seed, steps: scenario.steps.map(editStep) };
}

export function devBenchPanel<
  Context extends {
    host: HTMLElement;
    services: {
      run: { requestSession(request: SessionRequest): SessionResult };
    };
  },
>(): SceneTraitBehaviour<Context, DevBenchPanelConfig> {
  let panel: HTMLElement | null = null;
  // Per panel lifetime: request and trial counters, the chosen scenario, applied and pending edits.
  let requestId = 0;
  let trialSerial = 0;
  return {
    enter({ host, services: { run } }, { scenarios }) {
      panel?.remove();
      panel = document.createElement("aside");
      panel.className = "dev-bench-panel";
      panel.setAttribute("aria-label", "Trial bench");
      host.append(panel);
      let chosen = 0;
      let seed = scenarios[0]?.scenario.seed ?? 0;
      let applied: Overrides[] = [];
      let pending: Overrides[] = [];
      let status = "Choose a scenario and settings, then Apply.";

      const request = (edits: readonly Overrides[], nextSeed: number) => {
        const { scenario } = scenarios[chosen]!;
        const problems = editProblems(scenario, edits);
        if (problems.length) {
          status = problems.join("\n");
          playSfx("action.denied");
          return render();
        }
        const result = run.requestSession({
          requestId: ++requestId,
          factory: "devScenario",
          config: {
            scenario: editedScenario(scenario, edits, nextSeed),
            trialId: `bench-trial-${++trialSerial}`,
          },
        });
        if (result.ok) {
          applied = edits.map((edit) => ({ ...edit }));
          seed = nextSeed;
          status = `${result.provenance.trialId} · seed ${nextSeed}`;
          playSfx("ui.click");
        } else {
          status = result.diagnostics.join("\n");
          playSfx("action.denied");
        }
        render();
      };

      const render = () => {
        if (!panel) return;
        panel.replaceChildren();
        const heading = document.createElement("h2");
        heading.textContent = "Trial bench";
        const picker = document.createElement("select");
        picker.setAttribute("aria-label", "Scenario");
        scenarios.forEach(({ label }, index) => {
          const option = document.createElement("option");
          option.value = String(index);
          option.textContent = label;
          option.selected = index === chosen;
          picker.append(option);
        });
        picker.addEventListener("change", () => {
          chosen = Number(picker.value);
          seed = scenarios[chosen]!.scenario.seed;
          applied = [];
          pending = [];
          render();
        });
        panel.append(heading, picker);
        const scenario = scenarios[chosen]?.scenario;
        if (scenario)
          scenarioPassives(scenario).forEach((descriptor, index) => {
            const group = document.createElement("fieldset");
            const legend = document.createElement("legend");
            legend.textContent = passiveDefinitions.get(descriptor.definitionId).name;
            group.append(legend);
            for (const setting of passiveSettings(descriptor, pending[index] ?? {})) {
              const label = document.createElement("label");
              label.textContent = setting.schema.label;
              const control = parameterControls.get(setting.schema.kind);
              const input = control.create(setting);
              // Editing records a pending value only: nothing restarts until Apply.
              input.addEventListener("change", () => {
                pending[index] = {
                  ...pending[index],
                  [setting.name]: control.parse(input.value),
                };
              });
              label.append(input);
              group.append(label);
            }
            panel!.append(group);
          });
        const actions = document.createElement("div");
        actions.className = "dev-bench-actions";
        actions.append(
          button("Apply", () => request(pending, seed)),
          button("Restart", () => request(applied, seed)),
          button("New seed", () =>
            request(applied, crypto.getRandomValues(new Uint32Array(1))[0]!),
          ),
        );
        const output = document.createElement("p");
        output.className = "dev-bench-status";
        output.setAttribute("role", "status");
        output.textContent = status;
        panel.append(actions, output);
      };
      render();
    },
    exit() {
      panel?.remove();
      panel = null;
    },
  };
}

/** How a declared parameter kind becomes a control, and how its value is read back. */
type ParameterControl = {
  create(setting: EffectiveSetting): HTMLInputElement | HTMLSelectElement;
  parse(raw: string): number | string;
};
/** Registered by parameter kind name: the panel dispatches, it never asks which kind. */
export const parameterControls = new Registry<ParameterControl>("parameter control");
parameterControls.register("number", {
  create(setting) {
    const schema = setting.schema as Extract<ParameterSchema, { kind: "number" }>;
    const input = document.createElement("input");
    input.type = "number";
    input.min = String(schema.min);
    input.max = String(schema.max);
    input.step = String(schema.step ?? "any");
    input.value = String(setting.value);
    return input;
  },
  parse: Number,
});
parameterControls.register("choice", {
  create(setting) {
    const schema = setting.schema as Extract<ParameterSchema, { kind: "choice" }>;
    const select = document.createElement("select");
    for (const choice of schema.options) {
      const option = document.createElement("option");
      option.value = choice;
      option.textContent = choice;
      option.selected = choice === setting.value;
      select.append(option);
    }
    return select;
  },
  parse: (raw) => raw,
});

function button(text: string, onClick: () => void): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = text;
  element.addEventListener("click", onClick);
  return element;
}
