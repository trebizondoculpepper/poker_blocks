// Title, settings and game over screens: plain DOM overlays above the scene. They only call back
// into the game; progression rules stay in the run controller.
import { playSfx } from "./audio/sfx";
import type { SoundEffectId } from "./audio/sfx-registry";
import type { PanelLink } from "./game-modes";
import type { RunStats } from "./run-stats";
import type { StageReward } from "./stage-rewards";
import { captureLedger, presentLedger, type LedgerRow, type LedgerSink } from "./reward-ledger";
import type { ScopeHandle, VisualScheduler } from "./visual-events/scheduler";
import type { Settings } from "./settings";
import { createSettingsPanel } from "./settings-panel";

export type Screen = "title" | "game";

/** One menu item as a menu shows it: choosing it dispatches `id` as a named action. */
/** A menu button: its action id, label and sound, and whether it can be chosen now. */
export type MenuChoice = {
  id: string;
  label: string;
  sfx?: SoundEffectId;
  /** Shown greyed out; choosing it plays the denied sound. */
  disabled?: boolean;
  /** Why it's disabled, on hover and for screen readers. */
  disabledHint?: string;
};

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
  /** The always-visible button that opens the pause menu, for the HUD frame to place. */
  readonly menuButton: HTMLElement;
  /** The visible panel surface for scene-composed heading content. */
  panelHeadingHost(): HTMLElement;
  /** Show the title panel; its choices are a block menu shown in `choicesHost` (#529). */
  showTitle(): void;
  /** Where the title's block-menu choices are drawn, under its heading. */
  choicesHost(): HTMLElement;
  /** A choice from a block menu: a title command if one is registered for it, else navigation. */
  choose(action: string): void;
  hideTitle(): void;
  /** The footer of the panel in front: the version, then links out (#129). */
  showPanelFooter(links: readonly PanelLink[], version: string): void;
  hidePanelFooter(): void;
  /** Show a menu screen (the pause menu) over whatever is in front; its choices are a block menu. */
  showMenu(label: string): void;
  hideMenu(): void;
  /** Show or hide the Settings panel, over whatever is in front. */
  showSettings(): void;
  hideSettings(): void;
  /** Close the title and settings screens, back to the game. */
  closeAll(): void;
  /** The run is lost: show how it went, with a button for each choice (#90). */
  showGameOver(stats: RunStats, seed: number | null): void;
  hideGameOver(): void;
  /**
   * A stage is won: show "Stage Won" and count the reward rows in one by one, then the totals.
   * Its choices are a block menu the scene's result menu mounts below, once the ledger has
   * finished (#951). The music is left alone; the seed is the final result screen's alone (#164).
   */
  showStageWon(reward: StageReward): void;
  /**
   * Hear the stage-won ledger finish (#951; doc/result-menus.md): `ready` is called once, when
   * this showing's rows and totals have all been presented (by count-up, reduced motion or the
   * summary fallback), or at once if they already have. Never for a showing closed first.
   * Returns a cancel.
   */
  whenLedgerFinished(ready: () => void): () => void;
  /** The stage-won ledger, for the shared scheduler's `rewardLedger` service (#950). */
  readonly rewardLedger: LedgerSink;
  /** Close the stage-won pop-up, cancelling any rows still counting in. */
  hideStageWon(): void;
  readonly isOpen: boolean;
};

/** What times the stage-won ledger (#950): the shared scheduler and the reduced-motion setting. */
export type MenuPresentation = {
  visualEvents: Pick<
    VisualScheduler,
    "nowMs" | "createScope" | "scheduleBatch" | "seal" | "cancel"
  >;
  reducedMotion(): boolean;
};

export function createMenus(
  host: HTMLElement,
  initial: Settings,
  callbacks: MenuCallbacks,
  presentation?: MenuPresentation,
): Menus {
  const title = overlay("title-screen", "Poker Blocks");
  title.panel.insertAdjacentHTML(
    "beforeend",
    `<p class="menu-subtitle">Poker solitaire in three dimensions</p>
     <div class="block-menu-host" data-menu="items"></div>`,
  );

  // Created before Settings, so Settings opened from it sits on top.
  const pauseMenu = overlay("pause-screen", "Paused");
  pauseMenu.panel.insertAdjacentHTML(
    "beforeend",
    `<div class="block-menu-host" data-menu="items"></div>`,
  );

  const settingsScreen = overlay("settings-screen", "Settings");
  const settingsPanel = createSettingsPanel(settingsScreen.panel, initial, {
    onChange: (next) => callbacks.onSettingsChange(next),
  });

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
     <div class="block-menu-host" data-menu="items"></div>
     <div class="menu-seed" data-menu="game-over-seed" hidden></div>`,
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
     <div class="block-menu-host" data-menu="items"></div>
`,
  );

  const settingsButton = document.createElement("button");
  settingsButton.type = "button";
  settingsButton.className = "settings-button";
  settingsButton.setAttribute("aria-label", "Menu");
  settingsButton.textContent = "⚙";
  host.append(settingsButton);

  const find = <T extends HTMLElement>(root: HTMLElement, name: string) =>
    root.querySelector<T>(`[data-menu="${name}"]`)!;
  /** The footer currently shown, so hiding removes exactly that one. */
  let shownFooter: HTMLElement | null = null;
  const titleItems = find<HTMLDivElement>(title.panel, "items");

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

  function showTitle(): void {
    open(title.root);
    callbacks.onScreen?.("title");
  }

  function hideTitle(): void {
    title.root.hidden = true;
  }

  /**
   * The footer sits in the far bottom-right of the screen while the overlay in front is shown:
   * the build version, then each link out (#129). The scene trait decides when it shows; this
   * only renders it.
   */
  function showPanelFooter(links: readonly PanelLink[], version: string): void {
    const overlay = overlayInFront();
    if (!overlay) return;
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
    hidePanelFooter();
    overlay.append(footer);
    shownFooter = footer;
  }

  /**
   * Remove the footer this service added. It is not a document-wide query, because a covering
   * scene's exit must not take the footer of the scene it uncovers with it.
   */
  function hidePanelFooter(): void {
    shownFooter?.remove();
    shownFooter = null;
  }

  /** The overlay in front (it covers the whole screen), for a footer the scene asked for. */
  function overlayInFront(): HTMLElement | null {
    for (const screen of [gameOver, stageWon, settingsScreen, pauseMenu, title]) {
      if (!screen.root.hidden) return screen.root;
    }
    return null;
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
      if (callbacks.hasSave()) return callbacks.onAction("openNewGameConfirm");
      closeAll();
      callbacks.onNewGame();
    },
    confirmNewGame() {
      closeAll();
      callbacks.onNewGame();
    },
  };

  /** The chosen cube has already played its own sound (click, or denied while disabled). */
  function choose(id: string): void {
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
    settingsPanel.refresh();
    cover(settingsScreen.root);
    settingsScreen.root.hidden = false;
    settingsButton.hidden = true;
    settingsPanel.focus();
  }

  function hideSettings(): void {
    settingsScreen.root.hidden = true;
    uncover(settingsScreen.root);
  }

  /** The pause menu: one button per choice, each dispatching its id as an action. */
  function showMenu(label: string): void {
    pauseMenu.root.setAttribute("aria-label", label);
    if (pauseMenu.root.hidden) cover(pauseMenu.root);
    pauseMenu.root.hidden = false;
    settingsButton.hidden = true;
  }

  function hideMenu(): void {
    pauseMenu.root.hidden = true;
    uncover(pauseMenu.root);
    settingsButton.hidden = !title.root.hidden || !gameOver.root.hidden || !stageWon.root.hidden;
  }

  // The touch-visible button opens the same pause menu as Escape.
  settingsButton.addEventListener("click", () => {
    playSfx("ui.click");
    callbacks.onAction("openPause");
  });
  for (const button of host.querySelectorAll<HTMLButtonElement>(".menu-panel button")) {
    button.addEventListener("pointerenter", () => playSfx("ui.hover", { volume: 0.5 }));
  }
  const gameOverSeed = find<HTMLDivElement>(gameOver.panel, "game-over-seed");

  /** The game over screen: the run's totals, and one button per choice. */
  /**
   * The session's random seed, with a button that copies it (#134). A run can be replayed from
   * this seed with the same software version and the same actions.
   */
  function showSeed(into: HTMLElement, seed: number | null): void {
    if (seed === null) return void (into.hidden = true);
    into.hidden = false;
    into.replaceChildren();
    const label = document.createElement("span");
    label.textContent = `Seed ${seed}`;
    const copy = document.createElement("button");
    copy.type = "button";
    copy.textContent = "Copy";
    copy.addEventListener("click", () => {
      playSfx("ui.click");
      void navigator.clipboard?.writeText(String(seed)).then(
        () => (copy.textContent = "Copied"),
        () => (copy.textContent = "Copy failed"),
      );
    });
    into.append(label, copy);
  }

  /** The game over screen: the run's totals and seed; its choices are a block menu (#949). */
  function showGameOver(stats: RunStats, seed: number | null): void {
    for (const cell of gameOver.panel.querySelectorAll<HTMLElement>("[data-run]")) {
      cell.textContent = String(stats[cell.dataset.run as keyof RunStats]);
    }
    showSeed(gameOverSeed, seed);
    open(gameOver.root);
  }

  function hideGameOver(): void {
    gameOver.root.hidden = true;
    settingsButton.hidden = !title.root.hidden || !stageWon.root.hidden;
  }

  /** The ledger's count-up on the shared scheduler (#950), until it finishes or the screen closes. */
  let ledgerScope: ScopeHandle | null = null;
  /** Whether this showing has offered its next choice: once only, whichever path gets there. */
  let ledgerFinished = true;
  const ledger = find<HTMLElement>(stageWon.panel, "ledger");
  const totals = find<HTMLElement>(stageWon.panel, "totals");
  /** Who is waiting for this showing's ledger to finish (#951): told once, then forgotten. */
  let ledgerListeners = new Set<() => void>();

  function cancelLedger(): void {
    if (ledgerScope) presentation?.visualEvents.cancel(ledgerScope);
    ledgerScope = null;
  }

  function ledgerRow({ label, value }: LedgerRow): HTMLElement {
    const row = document.createElement("div");
    row.className = "reward-row";
    const term = document.createElement("dt");
    term.textContent = label;
    const amount = document.createElement("dd");
    amount.textContent = value;
    row.append(term, amount);
    return row;
  }

  /** The stage-won screen's ledger, as the scheduler's `rewardLedger` service (#950). */
  const rewardLedger: LedgerSink = {
    row(row) {
      if (ledgerFinished) return;
      ledger.append(ledgerRow(row));
      playSfx(row.cue);
    },
    finish({ total, balance }) {
      if (ledgerFinished) return;
      ledgerFinished = true;
      ledgerScope = null;
      find(totals, "total").textContent = total;
      find(totals, "balance").textContent = balance;
      totals.hidden = false;
      const listeners = [...ledgerListeners];
      ledgerListeners = new Set();
      for (const ready of listeners) ready();
    },
    summarise({ rows, totals: captured }) {
      if (ledgerFinished) return;
      ledger.replaceChildren(...rows.map(ledgerRow));
      rewardLedger.finish(captured);
    },
  };

  function hideStageWon(): void {
    // Anyone still waiting is never told: a closed showing offers no choice later.
    ledgerListeners = new Set();
    ledgerFinished = true;
    cancelLedger();
    stageWon.root.hidden = true;
    uncover(stageWon.root);
    settingsButton.hidden = false;
  }

  function whenLedgerFinished(ready: () => void): () => void {
    if (stageWon.root.hidden) return () => {};
    if (ledgerFinished) {
      ready();
      return () => {};
    }
    ledgerListeners.add(ready);
    return () => void ledgerListeners.delete(ready);
  }

  function showStageWon(reward: StageReward): void {
    cancelLedger();
    ledgerListeners = new Set();
    ledger.replaceChildren();
    totals.hidden = true;
    // Not open(): the game screen (and its music) stays as it is behind the pop-up.
    title.root.hidden = settingsScreen.root.hidden = gameOver.root.hidden = true;
    // A pause menu left open under it can't be reached until the dialog closes.
    if (stageWon.root.hidden) cover(stageWon.root);
    stageWon.root.hidden = false;
    settingsButton.hidden = true;
    ledgerFinished = false;
    const captured = captureLedger(reward);
    // Without a scheduler (a host that composes none) the ledger shows at once.
    if (!presentation) return rewardLedger.summarise(captured);
    ledgerScope = presentLedger(presentation.visualEvents, rewardLedger, captured, {
      reduced: presentation.reducedMotion(),
    });
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
    menuButton: settingsButton,
    panelHeadingHost: () => overlayInFront()?.querySelector<HTMLElement>(".menu-panel") ?? host,
    showTitle,
    hideTitle,
    // The block-menu host of the screen in front: its scene's dialog trait draws its choices there.
    choicesHost: () =>
      overlayInFront()?.querySelector<HTMLElement>('[data-menu="items"]') ?? titleItems,
    choose,
    showPanelFooter,
    hidePanelFooter,
    closeAll,
    showGameOver,
    hideGameOver,
    showStageWon,
    whenLedgerFinished,
    hideStageWon,
    rewardLedger,
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
