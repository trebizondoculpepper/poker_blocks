// Title, settings and game over screens: plain DOM overlays above the scene. They only call back
// into the game; progression rules stay in the run controller.
import { playSfx } from "./audio/sfx";
import type { RunStats } from "./run-stats";
import type { StageReward } from "./stage-rewards";
import type { MotionSetting, Settings, ShadowSetting } from "./settings";

/** Why Continue is greyed out on the title screen. */
export const noGameInProgress = "There is no game in progress.";

export type Screen = "title" | "settings" | "game" | "over";

export type MenuCallbacks = {
  hasSave(): boolean;
  onContinue(): void;
  onNewGame(): void;
  onSettingsChange(settings: Settings): void;
  /** Which screen is now in front, for music and similar screen-level effects. */
  onScreen?(screen: Screen): void;
};

export type Menus = {
  showTitle(): void;
  showSettings(): void;
  /** Close the title and settings screens, back to the game. */
  closeAll(): void;
  /** The run is lost: show how it went, with New Run and Main menu. */
  showGameOver(stats: RunStats): void;
  /**
   * A stage is won: show "Stage Won" and count the reward rows in one by one, then offer
   * `action` (Visit shop), which calls `onContinue`. The music is
   * left alone.
   */
  showStageWon(reward: StageReward, action: string, onContinue: () => void): void;
  readonly isOpen: boolean;
};

const shadowLabels: Record<ShadowSetting, string> = {
  auto: "Automatic",
  high: "High",
  low: "Low",
  off: "Off",
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
       ${(Object.keys(motionLabels) as MotionSetting[])
         .map(
           (value) =>
             `<label class="menu-check"><input type="radio" name="motion" value="${value}" /> <span>${motionLabels[value]}</span></label>`,
         )
         .join("")}
     </fieldset>
     <fieldset class="menu-field">
       <legend>Shadows</legend>
       ${(Object.keys(shadowLabels) as ShadowSetting[])
         .map(
           (value) =>
             `<label class="menu-check"><input type="radio" name="shadows" value="${value}" /> <span>${shadowLabels[value]}</span></label>`,
         )
         .join("")}
     </fieldset>
     <div class="menu-buttons"><button type="button" data-menu="back">Back</button><button type="button" data-menu="quit">Quit to title screen</button></div>`,
  );

  const gameOver = overlay("game-over-screen", "Game over");
  gameOver.panel.insertAdjacentHTML(
    "beforeend",
    `<h2 class="menu-title game-over-title">GAME OVER</h2>
     <dl class="run-stats">
       <div><dt>Rounds completed</dt><dd data-run="roundsCompleted"></dd></div>
       <div><dt>Total score</dt><dd data-run="totalScore"></dd></div>
       <div><dt>Highest scoring round</dt><dd data-run="bestRoundScore"></dd></div>
       <div><dt>Blocks played</dt><dd data-run="blocksPlayed"></dd></div>
     </dl>
     <div class="menu-buttons">
       <button type="button" data-menu="new-run">New Run</button>
       <button type="button" data-menu="main-menu">Main menu</button>
     </div>`,
  );

  const stageWon = overlay("stage-won-screen", "Stage won");
  stageWon.panel.insertAdjacentHTML(
    "beforeend",
    `<h2 class="menu-title stage-won-title">STAGE WON</h2>
     <dl class="run-stats reward-ledger" data-menu="ledger"></dl>
     <dl class="run-stats reward-totals" data-menu="totals" hidden>
       <div><dt>Total earned</dt><dd data-menu="total"></dd></div>
       <div><dt>Coins</dt><dd data-menu="balance"></dd></div>
     </dl>
     <div class="menu-buttons"><button type="button" data-menu="stage-next" hidden></button></div>`,
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
  const quit = find<HTMLButtonElement>(settingsScreen.panel, "quit");
  const volume = find<HTMLInputElement>(settingsScreen.panel, "volume");
  const muted = find<HTMLInputElement>(settingsScreen.panel, "muted");
  const sfx = find<HTMLInputElement>(settingsScreen.panel, "sfx");
  const music = find<HTMLInputElement>(settingsScreen.panel, "music");
  const motionInputs = [
    ...settingsScreen.panel.querySelectorAll<HTMLInputElement>('input[name="motion"]'),
  ];
  const shadowInputs = [
    ...settingsScreen.panel.querySelectorAll<HTMLInputElement>('input[name="shadows"]'),
  ];

  function open(screen: HTMLElement): void {
    title.root.hidden = screen !== title.root;
    settingsScreen.root.hidden = screen !== settingsScreen.root;
    gameOver.root.hidden = screen !== gameOver.root;
    stageWon.root.hidden = screen !== stageWon.root;
    settingsButton.hidden = true;
    screen.querySelector<HTMLElement>("button:not([hidden]), input")?.focus();
  }

  function closeAll(): void {
    title.root.hidden =
      settingsScreen.root.hidden =
      gameOver.root.hidden =
      stageWon.root.hidden =
        true;
    settingsButton.hidden = false;
    callbacks.onScreen?.("game");
  }

  function showTitle(): void {
    // With no save, Continue stays visible but greyed out, and says why on hover (#10).
    const canContinue = callbacks.hasSave();
    continueButton.setAttribute("aria-disabled", String(!canContinue));
    continueButton.title = canContinue ? "" : noGameInProgress;
    confirm.hidden = true;
    newButton.hidden = false;
    open(title.root);
    callbacks.onScreen?.("title");
  }

  function showSettings(): void {
    volume.value = String(Math.round(settings.volume * 100));
    muted.checked = settings.muted;
    sfx.checked = settings.sfx;
    music.checked = settings.music;
    sfx.disabled = music.disabled = settings.muted;
    motionInputs.forEach((input) => (input.checked = input.value === settings.motion));
    shadowInputs.forEach((input) => (input.checked = input.value === settings.shadows));
    // Only offered mid-game: from the title screen, Back already goes there.
    quit.hidden = settingsFrom !== "game";
    open(settingsScreen.root);
    callbacks.onScreen?.("settings");
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
    if (continueButton.getAttribute("aria-disabled") === "true") {
      playSfx("action.denied");
      return;
    }
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
  // The run is autosaved at every safe point, so the title screen offers Continue.
  quit.addEventListener("click", () => {
    playSfx("ui.back");
    showTitle();
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
  for (const button of host.querySelectorAll<HTMLButtonElement>(".menu-panel button")) {
    button.addEventListener("pointerenter", () => playSfx("ui.hover", { volume: 0.5 }));
  }
  find(gameOver.panel, "new-run").addEventListener("click", () => {
    playSfx("ui.click");
    closeAll();
    callbacks.onNewGame();
  });
  find(gameOver.panel, "main-menu").addEventListener("click", () => {
    playSfx("ui.back");
    showTitle();
  });

  function showGameOver(stats: RunStats): void {
    for (const cell of gameOver.panel.querySelectorAll<HTMLElement>("[data-run]")) {
      cell.textContent = String(stats[cell.dataset.run as keyof RunStats]);
    }
    open(gameOver.root);
    callbacks.onScreen?.("over");
  }

  /** Seconds between reward rows as they count in. */
  const rowSeconds = 0.25;
  let rowTimers: number[] = [];
  let stageNextAction: (() => void) | null = null;
  const ledger = find<HTMLElement>(stageWon.panel, "ledger");
  const totals = find<HTMLElement>(stageWon.panel, "totals");
  const stageNext = find<HTMLButtonElement>(stageWon.panel, "stage-next");
  stageNext.addEventListener("click", () => {
    const next = stageNextAction;
    stageNextAction = null;
    rowTimers.forEach((timer) => window.clearTimeout(timer));
    rowTimers = [];
    stageWon.root.hidden = true;
    settingsButton.hidden = false;
    next?.();
  });

  function showStageWon(reward: StageReward, action: string, onContinue: () => void): void {
    rowTimers.forEach((timer) => window.clearTimeout(timer));
    ledger.replaceChildren();
    totals.hidden = true;
    stageNext.hidden = true;
    stageNext.textContent = action;
    stageNextAction = onContinue;
    // Not open(): the game screen (and its music) stays as it is behind the pop-up.
    title.root.hidden = settingsScreen.root.hidden = gameOver.root.hidden = true;
    stageWon.root.hidden = false;
    settingsButton.hidden = true;
    const reveal = (index: number) => {
      const entry = reward.entries[index];
      const row = document.createElement("div");
      row.className = "reward-row";
      const label = document.createElement("dt");
      label.textContent = entry.label;
      const coins = document.createElement("dd");
      coins.textContent = `+${entry.coins} coin${entry.coins === 1 ? "" : "s"}`;
      row.append(label, coins);
      ledger.append(row);
      playSfx("reward.coin");
    };
    rowTimers = reward.entries.map((_, index) =>
      window.setTimeout(() => reveal(index), (index + 1) * rowSeconds * 1000),
    );
    rowTimers.push(
      window.setTimeout(
        () => {
          find(totals, "total").textContent = `+${reward.balance - reward.balanceBefore}`;
          find(totals, "balance").textContent = String(reward.balance);
          totals.hidden = false;
          stageNext.hidden = false;
          stageNext.focus();
        },
        (reward.entries.length + 1) * rowSeconds * 1000,
      ),
    );
  }

  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!settingsScreen.root.hidden) back();
    else if (title.root.hidden && gameOver.root.hidden && stageWon.root.hidden) {
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
    closeAll,
    showGameOver,
    showStageWon,
    showSettings() {
      settingsFrom = "game";
      showSettings();
    },
    get isOpen() {
      return (
        !title.root.hidden ||
        !settingsScreen.root.hidden ||
        !gameOver.root.hidden ||
        !stageWon.root.hidden
      );
    },
  };
}
