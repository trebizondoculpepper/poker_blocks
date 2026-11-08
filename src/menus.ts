// Title and settings screens: plain DOM overlays above the scene. They only call back
// into the game; progression rules stay in the session controller.
import { playSfx } from "./audio/sfx";
import type { MotionSetting, Settings } from "./settings";

export type MenuCallbacks = {
  hasSave(): boolean;
  onContinue(): void;
  onNewGame(): void;
  onSettingsChange(settings: Settings): void;
};

export type Menus = {
  showTitle(): void;
  showSettings(): void;
  readonly isOpen: boolean;
};

const motionLabels: Record<MotionSetting, string> = {
  system: "Follow system",
  reduced: "Reduced",
  full: "Full",
};

export function createMenus(host: HTMLElement, initial: Settings, callbacks: MenuCallbacks): Menus {
  let settings = { ...initial };
  /** Where Back from settings returns to. */
  let settingsFrom: "title" | "game" = "game";

  const title = overlay("title-screen", "Poker Blocks");
  title.panel.insertAdjacentHTML(
    "beforeend",
    `<h1 class="menu-title">POKER BLOCKS</h1>
     <p class="menu-subtitle">Poker solitaire in three dimensions</p>
     <div class="menu-buttons">
       <button type="button" data-menu="continue">Continue</button>
       <button type="button" data-menu="new">New game</button>
       <div class="menu-confirm" data-menu="confirm" hidden>
         <p>Start again? Your saved game will be lost.</p>
         <div class="menu-row">
           <button type="button" data-menu="confirm-yes">Start new game</button>
           <button type="button" data-menu="confirm-no">Keep it</button>
         </div>
       </div>
       <button type="button" data-menu="settings">Settings</button>
     </div>`,
  );

  const settingsScreen = overlay("settings-screen", "Settings");
  settingsScreen.panel.insertAdjacentHTML(
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
     <fieldset class="menu-field">
       <legend>Motion</legend>
       ${(Object.keys(motionLabels) as MotionSetting[])
         .map(
           (value) =>
             `<label class="menu-check"><input type="radio" name="motion" value="${value}" /> <span>${motionLabels[value]}</span></label>`,
         )
         .join("")}
     </fieldset>
     <div class="menu-buttons"><button type="button" data-menu="back">Back</button></div>`,
  );

  const settingsButton = document.createElement("button");
  settingsButton.type = "button";
  settingsButton.className = "settings-button";
  settingsButton.setAttribute("aria-label", "Settings");
  settingsButton.textContent = "⚙";
  host.append(settingsButton);

  const find = <T extends HTMLElement>(root: HTMLElement, name: string) =>
    root.querySelector<T>(`[data-menu="${name}"]`)!;
  const continueButton = find<HTMLButtonElement>(title.panel, "continue");
  const newButton = find<HTMLButtonElement>(title.panel, "new");
  const confirm = find<HTMLDivElement>(title.panel, "confirm");
  const volume = find<HTMLInputElement>(settingsScreen.panel, "volume");
  const muted = find<HTMLInputElement>(settingsScreen.panel, "muted");
  const motionInputs = [
    ...settingsScreen.panel.querySelectorAll<HTMLInputElement>('input[name="motion"]'),
  ];

  function open(screen: HTMLElement): void {
    title.root.hidden = screen !== title.root;
    settingsScreen.root.hidden = screen !== settingsScreen.root;
    settingsButton.hidden = true;
    screen.querySelector<HTMLElement>("button:not([hidden]), input")?.focus();
  }

  function closeAll(): void {
    title.root.hidden = settingsScreen.root.hidden = true;
    settingsButton.hidden = false;
  }

  function showTitle(): void {
    continueButton.hidden = !callbacks.hasSave();
    confirm.hidden = true;
    newButton.hidden = false;
    open(title.root);
  }

  function showSettings(): void {
    volume.value = String(Math.round(settings.volume * 100));
    muted.checked = settings.muted;
    motionInputs.forEach((input) => (input.checked = input.value === settings.motion));
    open(settingsScreen.root);
  }

  function change(next: Partial<Settings>): void {
    settings = { ...settings, ...next };
    callbacks.onSettingsChange(settings);
  }

  function back(): void {
    playSfx("ui.back");
    if (settingsFrom === "title") showTitle();
    else closeAll();
  }

  continueButton.addEventListener("click", () => {
    playSfx("ui.click");
    closeAll();
    callbacks.onContinue();
  });
  newButton.addEventListener("click", () => {
    playSfx("ui.click");
    if (callbacks.hasSave()) {
      newButton.hidden = true;
      confirm.hidden = false;
      find<HTMLButtonElement>(confirm, "confirm-no").focus();
      return;
    }
    closeAll();
    callbacks.onNewGame();
  });
  find(confirm, "confirm-yes").addEventListener("click", () => {
    playSfx("ui.click");
    closeAll();
    callbacks.onNewGame();
  });
  find(confirm, "confirm-no").addEventListener("click", () => {
    playSfx("ui.back");
    confirm.hidden = true;
    newButton.hidden = false;
    newButton.focus();
  });
  find(title.panel, "settings").addEventListener("click", () => {
    playSfx("ui.click");
    settingsFrom = "title";
    showSettings();
  });
  settingsButton.addEventListener("click", () => {
    playSfx("ui.click");
    settingsFrom = "game";
    showSettings();
  });
  find(settingsScreen.panel, "back").addEventListener("click", back);
  // Preview the new volume once the slider is released, so dragging is not noisy.
  volume.addEventListener("input", () => change({ volume: Number(volume.value) / 100 }));
  volume.addEventListener("change", () => playSfx("ui.click"));
  muted.addEventListener("change", () => {
    change({ muted: muted.checked });
    playSfx("ui.click");
  });
  motionInputs.forEach((input) =>
    input.addEventListener("change", () => {
      change({ motion: input.value as MotionSetting });
      playSfx("ui.click");
    }),
  );
  for (const button of host.querySelectorAll<HTMLButtonElement>(".menu-panel button")) {
    button.addEventListener("pointerenter", () => playSfx("ui.hover", { volume: 0.5 }));
  }
  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!settingsScreen.root.hidden) back();
    else if (title.root.hidden) {
      settingsFrom = "game";
      showSettings();
    }
  });

  function overlay(className: string, label: string): { root: HTMLElement; panel: HTMLElement } {
    const root = document.createElement("div");
    root.className = `menu-overlay ${className}`;
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", label);
    root.hidden = true;
    const panel = document.createElement("div");
    panel.className = "menu-panel";
    root.append(panel);
    host.append(root);
    return { root, panel };
  }

  return {
    showTitle,
    showSettings() {
      settingsFrom = "game";
      showSettings();
    },
    get isOpen() {
      return !title.root.hidden || !settingsScreen.root.hidden;
    },
  };
}
