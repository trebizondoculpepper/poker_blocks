// Title, settings and game over screens: plain DOM overlays above the scene. They only call back
// into the game; progression rules stay in the run controller.
import { playSfx } from "./audio/sfx";
import type { MenuItem, PanelLink } from "./game-modes";
import type { RunStats } from "./run-stats";
import type { StageReward } from "./stage-rewards";
import type { MotionSetting, Settings, ShadowSetting } from "./settings";

/** Why Continue is greyed out on the title screen. */
export const noGameInProgress = "There is no game in progress.";

export type Screen = "title" | "game" | "over";

/** One menu item as a menu shows it: choosing it dispatches `id` as a named action. */
export type MenuChoice = { id: string; label: string };

export type MenuCallbacks = {
  hasSave(): boolean;
  onContinue(): void;
  onNewGame(): void;
  onSettingsChange(settings: Settings): void;
  /** A named action chosen from a menu or button (open the pause menu, Settings, Back…). */
  onAction(id: string): void;
  /** Which screen is now in front, for music and similar screen-level effects. */
  onScreen?(screen: Screen): void;
};

export type Menus = {
  /** The title's items are the title scene trait's decision, so they are passed in. */
  showTitle(items: readonly MenuItem[]): void;
  hideTitle(): void;
  /** The footer of the panel in front: the version, then links out (#129). */
  showPanelFooter(links: readonly PanelLink[], version: string): void;
  hidePanelFooter(): void;
  /** Show a menu of choices (the pause menu) over whatever is in front. */
  showMenu(label: string, choices: readonly MenuChoice[]): void;
  hideMenu(): void;
  /** Show or hide the Settings panel, over whatever is in front. */
  showSettings(): void;
  hideSettings(): void;
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

  const title = overlay("title-screen", "Poker Blocks");
  title.panel.insertAdjacentHTML(
    "beforeend",
    `<h1 class="menu-title">POKER BLOCKS</h1>
     <p class="menu-subtitle">Poker solitaire in three dimensions</p>
     <div class="menu-buttons" data-menu="items"></div>
     <div class="menu-confirm" data-menu="confirm" hidden>
       <p>Start again? Your saved game will be lost.</p>
       <div class="menu-row">
         <button type="button" data-menu="confirm-yes">Start new game</button>
         <button type="button" data-menu="confirm-no">Keep it</button>
       </div>
     </div>`,
  );

  // Created before Settings, so Settings opened from it sits on top.
  const pauseMenu = overlay("pause-screen", "Paused");
  pauseMenu.panel.insertAdjacentHTML(
    "beforeend",
    `<h2 class="menu-heading">PAUSED</h2><div class="menu-buttons" data-menu="choices"></div>`,
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
     <div class="menu-buttons"><button type="button" data-menu="back">Back</button></div>`,
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
  settingsButton.setAttribute("aria-label", "Menu");
  settingsButton.textContent = "⚙";
  host.append(settingsButton);

  const find = <T extends HTMLElement>(root: HTMLElement, name: string) =>
    root.querySelector<T>(`[data-menu="${name}"]`)!;
  const titleItems = find<HTMLDivElement>(title.panel, "items");
  const confirm = find<HTMLDivElement>(title.panel, "confirm");
  const choices = find<HTMLDivElement>(pauseMenu.panel, "choices");
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
    pauseMenu.root.hidden = screen !== pauseMenu.root;
    gameOver.root.hidden = screen !== gameOver.root;
    stageWon.root.hidden = screen !== stageWon.root;
    settingsButton.hidden = true;
    screen.querySelector<HTMLElement>("button:not([hidden]), input")?.focus();
  }

  function closeAll(): void {
    title.root.hidden =
      settingsScreen.root.hidden =
      pauseMenu.root.hidden =
      gameOver.root.hidden =
      stageWon.root.hidden =
        true;
    settingsButton.hidden = false;
    callbacks.onScreen?.("game");
  }

  function showTitle(items: readonly MenuItem[]): void {
    confirm.hidden = true;
    fillTitleItems(items);
    open(title.root);
    callbacks.onScreen?.("title");
  }

  function hideTitle(): void {
    title.root.hidden = true;
  }

  /**
   * The footer sits in the panel in front: the build version, then each link out (#129). The
   * scene trait decides what a panel shows; this only renders it.
   */
  function showPanelFooter(links: readonly PanelLink[], version: string): void {
    const panel = panelInFront();
    if (!panel) return;
    const footer = document.createElement("div");
    footer.className = "menu-footer";
    footer.dataset.menu = "footer";
    const versionLine = document.createElement("small");
    versionLine.className = "menu-version";
    versionLine.textContent = `v${version}`;
    footer.append(versionLine);
    for (const link of links) {
      if (!link.href) continue;
      const anchor = document.createElement("a");
      anchor.className = "menu-link";
      anchor.href = link.href;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      anchor.textContent = link.label;
      anchor.addEventListener("click", () => playSfx("ui.click"));
      footer.append(anchor);
    }
    panel.append(footer);
  }

  function hidePanelFooter(): void {
    for (const footer of document.querySelectorAll('[data-menu="footer"]')) footer.remove();
  }

  /** The panel belonging to the overlay in front, for a footer the scene asked for there. */
  function panelInFront(): HTMLElement | null {
    for (const screen of [gameOver, stageWon, settingsScreen, pauseMenu, title]) {
      if (!screen.root.hidden) return screen.panel;
    }
    return null;
  }

  /**
   * The title's buttons come from the scene's `titleScreen` trait, so which ones appear (and
   * whether Continue is offered at all) is configuration, not this file's decision.
   */
  function fillTitleItems(items: readonly MenuItem[]): void {
    titleItems.replaceChildren();
    for (const item of items) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = item.label;
      button.dataset.menu = item.id;
      button.addEventListener("click", () => chooseTitleItem(item.id));
      titleItems.append(button);
    }
  }

  /**
   * The title's own commands, keyed by the item id its scene trait declares. An id not in this
   * table is a navigation action, which the run controller's flow data handles.
   */
  const titleCommands: Record<string, () => void> = {
    continue() {
      closeAll();
      callbacks.onContinue();
    },
    new() {
      // Starting again discards a saved run, so it asks first (#10). Focus goes to the
      // non-destructive choice, so a held or repeated Enter cannot overwrite the save.
      if (callbacks.hasSave()) {
        confirm.hidden = false;
        find<HTMLButtonElement>(confirm, "confirm-no").focus();
        return;
      }
      closeAll();
      callbacks.onNewGame();
    },
  };

  function chooseTitleItem(id: string): void {
    playSfx("ui.click");
    const command = Object.hasOwn(titleCommands, id) ? titleCommands[id] : null;
    if (command) return command();
    callbacks.onAction(id);
  }

  /**
   * Panels left showing under one opened over them are made inert, so keyboard focus can't
   * reach a covered control (Quit to title behind Settings, say). Each cover remembers what
   * it covered and gives it back.
   */
  const covered = new Map<HTMLElement, HTMLElement[]>();
  function cover(top: HTMLElement): void {
    const below = [title.root, pauseMenu.root, gameOver.root, stageWon.root].filter(
      (root) => root !== top && !root.hidden && !root.inert,
    );
    below.forEach((root) => (root.inert = true));
    covered.set(top, below);
  }
  function uncover(top: HTMLElement): void {
    (covered.get(top) ?? []).forEach((root) => (root.inert = false));
    covered.delete(top);
  }

  /** Settings is a panel over whatever is in front (the title or the pause menu). */
  function showSettings(): void {
    volume.value = String(Math.round(settings.volume * 100));
    muted.checked = settings.muted;
    sfx.checked = settings.sfx;
    music.checked = settings.music;
    sfx.disabled = music.disabled = settings.muted;
    motionInputs.forEach((input) => (input.checked = input.value === settings.motion));
    shadowInputs.forEach((input) => (input.checked = input.value === settings.shadows));
    cover(settingsScreen.root);
    settingsScreen.root.hidden = false;
    settingsButton.hidden = true;
    settingsScreen.panel.querySelector<HTMLElement>("input")?.focus();
  }

  function hideSettings(): void {
    settingsScreen.root.hidden = true;
    uncover(settingsScreen.root);
  }

  /** The pause menu: one button per choice, each dispatching its id as an action. */
  function showMenu(label: string, menuChoices: readonly MenuChoice[]): void {
    pauseMenu.root.setAttribute("aria-label", label);
    choices.replaceChildren(
      ...menuChoices.map(({ id, label: text }) => {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.menu = id;
        button.textContent = text;
        button.addEventListener("pointerenter", () => playSfx("ui.hover", { volume: 0.5 }));
        button.addEventListener("click", () => {
          playSfx("ui.click");
          callbacks.onAction(id);
        });
        return button;
      }),
    );
    if (pauseMenu.root.hidden) cover(pauseMenu.root);
    pauseMenu.root.hidden = false;
    settingsButton.hidden = true;
    choices.querySelector<HTMLElement>("button")?.focus();
  }

  function hideMenu(): void {
    pauseMenu.root.hidden = true;
    uncover(pauseMenu.root);
    settingsButton.hidden = !title.root.hidden || !gameOver.root.hidden || !stageWon.root.hidden;
  }

  function change(next: Partial<Settings>): void {
    settings = { ...settings, ...next };
    callbacks.onSettingsChange(settings);
  }

  find(confirm, "confirm-yes").addEventListener("click", () => {
    playSfx("ui.click");
    closeAll();
    callbacks.onNewGame();
  });
  find(confirm, "confirm-no").addEventListener("click", () => {
    playSfx("ui.back");
    confirm.hidden = true;
    titleItems.querySelector<HTMLButtonElement>("button")?.focus();
  });
  // The touch-visible button opens the same pause menu as Escape.
  settingsButton.addEventListener("click", () => {
    playSfx("ui.click");
    callbacks.onAction("openPause");
  });
  find(settingsScreen.panel, "back").addEventListener("click", () => {
    playSfx("ui.back");
    callbacks.onAction("back");
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
    callbacks.onAction("quitToTitle");
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
    uncover(stageWon.root);
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
    // A pause menu left open under it can't be reached until the dialog closes.
    if (stageWon.root.hidden) cover(stageWon.root);
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
    hideTitle,
    showPanelFooter,
    hidePanelFooter,
    closeAll,
    showGameOver,
    showStageWon,
    showMenu,
    hideMenu,
    showSettings,
    hideSettings,
    get isOpen() {
      return (
        !title.root.hidden ||
        !settingsScreen.root.hidden ||
        !pauseMenu.root.hidden ||
        !gameOver.root.hidden ||
        !stageWon.root.hidden
      );
    },
  };
}
