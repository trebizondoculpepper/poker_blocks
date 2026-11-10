/**
 * The dev-only tuning panel for the title attract sequence (#166).
 *
 * It renders a slider per value — a mean and a deviation for velocity, spin and spawn interval
 * — and reports changes to whoever owns the sequence. It is composed by a dev mode only, so the
 * normal game never builds it (AGENTS.md, "Dev traits").
 */
import type { AttractTuning, MeanSpread } from "./attract-scene";

/** The tuning values that are a mean and a spread; each gets a pair of sliders. */
type SpreadKey = {
  [Key in keyof AttractTuning]: AttractTuning[Key] extends MeanSpread ? Key : never;
}[keyof AttractTuning];

/** One tunable value, and the range its sliders cover. */
type Knob = {
  key: SpreadKey;
  label: string;
  unit: string;
  meanMin: number;
  meanMax: number;
  meanStep: number;
  deviationMax: number;
};

const knobs: readonly Knob[] = [
  {
    key: "velocity",
    label: "Velocity",
    unit: "u/s",
    meanMin: 0.2,
    meanMax: 14,
    meanStep: 0.1,
    deviationMax: 6,
  },
  {
    key: "spin",
    label: "Spin",
    unit: "rad/s",
    meanMin: 0,
    meanMax: 2.5,
    meanStep: 0.01,
    deviationMax: 1.2,
  },
  {
    key: "spawnInterval",
    label: "Spawn interval",
    unit: "s",
    meanMin: 0,
    meanMax: 6,
    meanStep: 0.05,
    deviationMax: 3,
  },
];

export type AttractTuningPanel = {
  readonly element: HTMLElement;
  dispose(): void;
};

export function createAttractTuningPanel(options: {
  tuning: AttractTuning;
  onChange(next: AttractTuning): void;
}): AttractTuningPanel {
  const element = document.createElement("aside");
  element.className = "attract-tuning";
  element.setAttribute("aria-label", "Attract sequence tuning");

  const heading = document.createElement("h2");
  heading.textContent = "ATTRACT";
  element.append(heading);

  let tuning = options.tuning;
  const controls: HTMLInputElement[] = [];

  for (const knob of knobs) {
    const current = tuning[knob.key];
    const row = document.createElement("div");
    row.className = "attract-knob";

    const label = document.createElement("span");
    label.className = "attract-knob-label";
    const readout = document.createElement("output");
    const setReadout = (value: MeanSpread) =>
      (readout.textContent = `${value.mean.toFixed(2)} ${knob.unit} ± ${value.deviation.toFixed(2)}`);
    setReadout(current);
    label.append(document.createTextNode(`${knob.label} `), readout);

    const update = (next: Partial<MeanSpread>) => {
      const merged = { ...tuning[knob.key], ...next };
      tuning = { ...tuning, [knob.key]: merged };
      setReadout(merged);
      options.onChange(tuning);
    };

    const mean = slider(
      `mean ${knob.label}`,
      knob.meanMin,
      knob.meanMax,
      knob.meanStep,
      current.mean,
      (value) => update({ mean: value }),
    );
    const deviation = slider(
      `deviation ${knob.label}`,
      knob.deviationMax === 0 ? 0 : 0,
      knob.deviationMax,
      knob.meanStep,
      current.deviation,
      (value) => update({ deviation: value }),
    );
    controls.push(mean, deviation);
    row.append(label, group("mean", mean), group("std dev", deviation));
    element.append(row);
  }

  const reset = document.createElement("button");
  reset.type = "button";
  reset.textContent = "Copy values";
  reset.addEventListener("click", () => {
    // Paste these into `defaultAttractTuning` when the feel is right.
    const text = JSON.stringify(tuning, null, 2);
    void navigator.clipboard?.writeText(text);
    reset.textContent = "Copied";
    window.setTimeout(() => (reset.textContent = "Copy values"), 1200);
  });
  element.append(reset);

  document.body.append(element);
  return {
    element,
    dispose() {
      for (const control of controls) control.replaceWith(control.cloneNode(true));
      element.remove();
    },
  };
}

/** A labelled range slider that calls back with its numeric value. */
function slider(
  label: string,
  min: number,
  max: number,
  step: number,
  value: number,
  onInput: (value: number) => void,
): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "range";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  input.setAttribute("aria-label", label);
  input.addEventListener("input", () => onInput(Number(input.value)));
  return input;
}

function group(name: string, input: HTMLInputElement): HTMLElement {
  const wrapper = document.createElement("label");
  wrapper.className = "attract-knob-field";
  const caption = document.createElement("span");
  caption.textContent = name;
  wrapper.append(caption, input);
  return wrapper;
}
