/**
 * The Settings panel (#89): its controls, kept in step with the player's settings. It is a custom
 * panel rather than a menu of items, shown by the Settings scene's `settingsPanel` trait. Back
 * calls `onBack`, which the menus dispatch as the `back` navigation action (a stack pop), so the
 * panel never decides where Back goes.
 */
import { playSfx } from "./audio/sfx";
import type { LayoutSetting, MotionSetting, Settings, ShadowSetting } from "./settings";

const shadowLabels: Record<ShadowSetting, string> = {
  auto: "Automatic",
  high: "High",
  low: "Low",
  off: "Off",
};

const layoutLabels: Record<LayoutSetting, string> = {
  auto: "Automatic",
  landscape: "Landscape",
  portrait: "Portrait",
};

const motionLabels: Record<MotionSetting, string> = {
  system: "Follow system",
  reduced: "Reduced",
  full: "Full",
};

export type SettingsPanel = {
  /** Show the current settings in the controls (before the panel opens). */
  refresh(): void;
  /** Focus the first control. */
  focus(): void;
};

export function createSettingsPanel(
  panel: HTMLElement,
  initial: Settings,
  options: { onChange(settings: Settings): void; onBack(): void },
): SettingsPanel {
  let settings = { ...initial };
  panel.insertAdjacentHTML(
    "beforeend",
    `<h2 class="menu-heading">SETTINGS</h2>
     <label class="menu-field">
       <span>Sound volume</span>
       <input type="range" min="0" max="100" step="5" data-menu="volume" />
     </label>
     <label class="menu-field menu-check">
       <input type="checkbox" data-menu="muted" />
       <span>Mute sound</span>
     </label>
     <label class="menu-field menu-check">
       <input type="checkbox" data-menu="sfx" />
       <span>Sound effects</span>
     </label>
     <label class="menu-field menu-check">
       <input type="checkbox" data-menu="music" />
       <span>Music</span>
     </label>
     <fieldset class="menu-field">
       <legend>Motion</legend>
       ${radios("motion", motionLabels)}
     </fieldset>
     <fieldset class="menu-field">
       <legend>Shadows</legend>
       ${radios("shadows", shadowLabels)}
     </fieldset>
     <fieldset class="menu-field">
       <legend>Layout</legend>
       ${radios("layout", layoutLabels)}
     </fieldset>
     <div class="menu-buttons"><button type="button" data-menu="back">Back</button></div>`,
  );
  const find = <T extends HTMLElement>(name: string) =>
    panel.querySelector<T>(`[data-menu="${name}"]`)!;
  const volume = find<HTMLInputElement>("volume");
  const muted = find<HTMLInputElement>("muted");
  const sfx = find<HTMLInputElement>("sfx");
  const music = find<HTMLInputElement>("music");
  const motionInputs = [...panel.querySelectorAll<HTMLInputElement>('input[name="motion"]')];
  const shadowInputs = [...panel.querySelectorAll<HTMLInputElement>('input[name="shadows"]')];
  const layoutInputs = [...panel.querySelectorAll<HTMLInputElement>('input[name="layout"]')];

  function change(next: Partial<Settings>): void {
    settings = { ...settings, ...next };
    options.onChange(settings);
  }

  find("back").addEventListener("click", () => {
    options.onBack();
  });
  // Preview the new volume once the slider is released, so dragging is not noisy.
  volume.addEventListener("input", () => change({ volume: Number(volume.value) / 100 }));
  volume.addEventListener("change", () => playSfx("ui.click"));
  muted.addEventListener("change", () => {
    change({ muted: muted.checked });
    // The channel toggles sit under the master mute, so they read as off while it is on.
    sfx.disabled = music.disabled = muted.checked;
    playSfx("ui.click");
  });
  sfx.addEventListener("change", () => {
    change({ sfx: sfx.checked });
    playSfx("ui.click");
  });
  music.addEventListener("change", () => {
    change({ music: music.checked });
    playSfx("ui.click");
  });
  motionInputs.forEach((input) =>
    input.addEventListener("change", () => {
      change({ motion: input.value as MotionSetting });
      playSfx("ui.click");
    }),
  );
  shadowInputs.forEach((input) =>
    input.addEventListener("change", () => {
      change({ shadows: input.value as ShadowSetting });
      playSfx("ui.click");
    }),
  );
  layoutInputs.forEach((input) =>
    input.addEventListener("change", () => {
      change({ layout: input.value as LayoutSetting });
      playSfx("ui.click");
    }),
  );

  return {
    refresh() {
      volume.value = String(Math.round(settings.volume * 100));
      muted.checked = settings.muted;
      sfx.checked = settings.sfx;
      music.checked = settings.music;
      sfx.disabled = music.disabled = settings.muted;
      motionInputs.forEach((input) => (input.checked = input.value === settings.motion));
      shadowInputs.forEach((input) => (input.checked = input.value === settings.shadows));
      layoutInputs.forEach((input) => (input.checked = input.value === settings.layout));
    },
    focus() {
      panel.querySelector<HTMLElement>("input")?.focus();
    },
  };
}

/** A radio button per option, labelled from its table. */
function radios(name: string, labels: Record<string, string>): string {
  return Object.entries(labels)
    .map(
      ([value, label]) =>
        `<label class="menu-check"><input type="radio" name="${name}" value="${value}" /> <span>${label}</span></label>`,
    )
    .join("");
}
