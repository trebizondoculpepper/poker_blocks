/**
 * Run controller: the run being played and the game mode it is played in. It owns the
 * `GameRun`, starts, resumes and saves runs, moves between stages and the shop, follows
 * an announced outcome with the stage-won pop-up or game over, applies the player's
 * settings, and answers the other services' questions about the run (`rules` for the
 * input, `menus` for the overlays, `consoleApp` for the developer console).
 *
 * It decides what happens; the other services show it.
 */
import type { DestroyCause } from "./traits/destructible";
import type { AudioService } from "./audio-service";
import { menuScreenScenes } from "./overlays";
import { playSfx } from "./audio/sfx";
import type { CameraViewService } from "./camera-view";
import { cardName, standardDeck, type CardBlock } from "./cards";
import type { ConsoleApp } from "./console-host";
import { dealerRegistry, roundOutcome, type RoundOutcome } from "./dealer";
import type { FieldView } from "./field-view";
import { GameRun, type RunPhase } from "./game-run";
import { followFlow } from "./game-flow";
import type { HandView } from "./hand-view";
import type { HudPanels } from "./hud-panels";
import type { MenuCallbacks } from "./menus";
import type { Overlays, ScreenScenes } from "./overlays";
import type { createPassiveRack } from "./passive-rack";
import type { PlayPresenter } from "./play-presenter";
import type { BlockViews } from "./rendered-blocks";
import {
  gameModeFromParams,
  modeLink,
  modeSceneId,
  type NavigationAction,
  wantsRestart,
  type GameMode,
  type OnLoad,
  type SceneName,
  type SceneTraits,
} from "./game-modes";
import { loadRun, saveRun, type SaveStorage } from "./save";
import type { SceneManager } from "./scenes";
import { demoRunRules, type RunRules } from "./run-rules";
import { createRunSetupRegistry } from "./run-setup-behaviours";
import type { RunSetupServices, RunSetupStep } from "./run-setup";
import {
  loadSettings,
  prefersReducedMotion,
  resolveShadowQuality,
  saveSettings,
  type Settings,
} from "./settings";
import { shopPreviewState, type ShopOffer } from "./shop-stock";
import type { createShopView } from "./shop-view";
import type { TableInput, TableRules } from "./table-input";
import type { TableRenderer } from "./table-renderer";
import type { RunStats } from "./run-stats";

type PassiveRackView = ReturnType<typeof createPassiveRack>;
type ShopView = ReturnType<typeof createShopView>;

/** The services the run drives. Reached when needed: some are built after the controller. */
export type RunServices = {
  readonly hud: HudPanels;
  readonly audio: AudioService;
  readonly renderer: TableRenderer;
  readonly cameraView: CameraViewService;
  readonly views: BlockViews;
  readonly field: FieldView;
  readonly hand: HandView;
  readonly presenter: PlayPresenter;
  readonly input: TableInput;
  readonly overlays: Overlays;
  readonly rack: PassiveRackView;
  readonly shop: ShopView;
};

export type RunController = {
  readonly game: GameRun;
  /** The mode being played. */
  readonly mode: GameMode;
  readonly settings: Settings;
  readonly reducedMotion: boolean;
  /** What the input may do to the run. */
  readonly rules: TableRules;
  /** What the menus act on. */
  readonly menus: MenuCallbacks;
  /** How the menus move the scene stack. */
  readonly screenScenes: ScreenScenes;
  /** What the developer console may do. */
  readonly consoleApp: ConsoleApp;
  /**
   * Destroy a table block if its destructible trait allows `cause`; the gap stays. A
   * refusal plays the denied sound. Returns whether it was destroyed.
   */
  destroyBlock(blockId: string, cause: DestroyCause): boolean;
  /** Put the run the page opened with on the table (before the services draw anything). */
  seedTable(): void;
  /** Configure the services for the current mode and settings, and start listening. */
  begin(): void;
  /**
   * The start screen: modes that skip the title start straight in play (resuming their run
   * if they keep one); a restart link starts a fresh run; otherwise the title screen.
   */
  open(): void;
  updateHud(): void;
  /** Refresh the selection highlight and the screen-reader summary. */
  showSelection(): void;
  /** The hand has room again: draw replacements. */
  refillHand(): void;
  /** The passive rack may have changed (a discard can grant passives). */
  rackChanged(): void;
  autosave(): void;
  /** The presenter announced the stage's outcome. */
  decided(outcome: RoundOutcome, now: number): void;
  /** The HUD button: move to the next stage, the shop, the next round, or a new game. */
  takeNextAction(): void;
  /** A shop offer's price. */
  offerPrice(offer: ShopOffer): number;
  /** What the shop is showing while its scene is in front. */
  shopStock(): readonly ShopOffer[];
  /** The run's totals so far, which the game over screen shows. */
  runStats(): RunStats;
  /** Whether a saved run this mode can continue exists (the title's `hasSave` condition). */
  hasSave(): boolean;
  /**
   * Carry out a named action from a menu item or key (#87): a navigation action follows the
   * mode's navigation data; a game action (such as `quitToTitle`) runs its handler.
   */
  dispatch(action: string): void;
  /** Buy a shop offer into the hand or the rack; false when refused. */
  buy(id: string, destination: Parameters<GameRun["buyShopOffer"]>[1]): boolean;
  /** Per frame: once an announced outcome's delay has passed, the pop-up or game over follows. */
  followOutcomes(time: number): void;
  /** Per frame: invite a stage's first play with the pulsing outline of its cell. */
  promptFirstPlay(time: number): void;
  dispose(): void;
};

/** When a won stage's outcome has been announced, the stage-won pop-up follows. */
const stageWonDelayMs = 900;
/** When a lost stage's outcome has been announced, the game over screen follows. */
const gameOverDelayMs = 1400;

/** The run rules a mode starts from, before its run setup steps adjust them. */
function baseRunRules(mode: GameMode): RunRules {
  return mode.traits.passiveRack
    ? { ...demoRunRules, rackCapacity: mode.traits.passiveRack.capacity }
    : demoRunRules;
}

export function createRunController<Context>(options: {
  host: HTMLElement;
  storage: SaveStorage | null;
  /** The page's URL parameters (`?mode=`, `&restart=true`). */
  params: URLSearchParams;
  scenes: SceneManager<SceneTraits, Context>;
  services: RunServices;
}): RunController {
  const { host, storage, scenes, services } = options;
  /**
   * Game modes are composed from mode traits; see src/game-modes.ts. dev0 is the normal
   * game with a material on every card, dev1 samples materials, dev2 has the passive rack,
   * and dev3 opens the shop with five coins.
   */
  let currentMode = gameModeFromParams(options.params);
  let modeTraits = currentMode.traits;
  const restartMode = wantsRestart(currentMode, options.params);
  // Built before anything asks a pass of it; `persistentRules` and `deckForRun` read it.
  const runSetup = createRunSetupRegistry(() => currentMode.traits.shop);
  let runRules = persistentRules(currentMode);
  let runSaveKey = modeTraits.save.key;
  let cards: readonly CardBlock[] = standardDeck;
  // A fresh run sits behind the title screen until the player chooses Continue or New game.
  let game = new GameRun(dealerRegistry, runRules, cards);
  let settings = loadSettings(storage);
  let reducedMotion = false;
  let stageWonAt: number | null = null;
  let gameOverAt: number | null = null;
  let shopExitPending = false;
  const systemMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
  const onSystemMotion = () => applySettings(settings);

  /** Declared, not assigned, so anything above it may call it without an ordering trap. */
  function setupServices(): RunSetupServices {
    return {
      standardDeck,
      newSeed: () => Math.floor(Math.random() * 4294967296),
      random: Math.random,
    };
  }

  /** The rules this mode plays under, new run or resumed: the registry decides, not us. */
  function persistentRules(mode: GameMode): RunRules {
    return runSetup.policy(mode.runSetup, baseRunRules(mode), setupServices());
  }

  /**
   * The deck a run is played with. A saved run passes the seed it was dealt from, so the same
   * steps rebuild the same deck; a new run passes none and the steps that deal a deck choose a
   * fresh seed. Only card ids are saved, so this is also how the testing-only mix returns.
   */
  function deckForRun(seed: number | undefined): readonly CardBlock[] {
    return runSetup.deck(currentMode.runSetup, { deck: standardDeck, seed }, setupServices()).deck;
  }

  /** The cards a saved run's deck is rebuilt from. */
  const cardsForSavedRun = (seed: number | undefined) => deckForRun(seed);

  function switchScene(name: SceneName): void {
    const id = modeSceneId(currentMode.id, name);
    if (scenes.current?.id !== id) scenes.switchTo(id);
  }

  /** Put one of this mode's scenes in front, whether or not it is already there. */
  function showScene(name: SceneName): void {
    scenes.switchTo(modeSceneId(currentMode.id, name));
  }

  function followRunPosition(): void {
    followFlow(currentMode.flow, game.positionOutcome, {
      replace: switchScene,
      push: (name) => scenes.pushIfNotCurrent(modeSceneId(currentMode.id, name)),
      pop: () => {
        void scenes.pop();
      },
    });
  }

  /**
   * Ask the scene in front to re-read the run. A new run can begin without any scene
   * transition, and `refresh` exits and re-enters the same top scene, so it is a no-op after
   * a switch and the work after a same-scene start.
   */
  function refreshScene(): void {
    scenes.refresh();
  }

  function enterMode(mode: GameMode, createDeck = true): void {
    currentMode = mode;
    modeTraits = mode.traits;
    runRules = persistentRules(mode);
    runSaveKey = modeTraits.save.key;
    if (createDeck) cards = deckForRun(undefined);
    services.rack.setCapacity(modeTraits.passiveRack?.capacity ?? 0);
    services.rack.element.hidden = !modeTraits.passiveRack;
    services.audio.enterMode(mode.traits.music.style);
  }

  function applySettings(next: Settings): void {
    settings = next;
    services.audio.applySettings(next);
    reducedMotion = prefersReducedMotion(next.motion, systemMotionQuery.matches);
    services.renderer.setShadowQuality(resolveShadowQuality(next.shadows, coarsePointer));
  }

  function updateHud(): void {
    // The game state updates as soon as a placement is accepted, but the card still
    // has to land before its scoring presentation begins. Keep outcomes hidden across
    // both parts of that sequence.
    const { presenter } = services;
    const presenting = presenter.presenting;
    const { round, deck, coins } = game.state;
    services.hud.render({
      round: game.round,
      phase: game.phase,
      presenting,
      outcome: presenting || !game.inStage ? "playing" : roundOutcome(game.state),
      score: presenter.shownScore,
      targetScore: round.targetScore,
      movesLeft: round.movesLeft,
      discardsLeft: round.discardsLeft,
      coins,
      deckSize: deck.length,
    });
    services.input.refreshDiscardTarget();
  }

  function showSelection(): void {
    const selected = services.input.selection;
    const { views } = services;
    views.highlight(selected);
    const selectedNames = views.all
      .filter(({ block }) => selected.has(block.id))
      .map(({ block }) => cardName(block.traits.identity));
    host.setAttribute(
      "aria-label",
      `${game.state.field.length} blocks in play. Hand: ${game.state.hand.map((block) => cardName(block.traits.identity)).join(", ")}. ${game.state.deck.length} in deck. Selected: ${selectedNames.join(", ") || "none"}.`,
    );
  }

  /** Save at a safe point: never while a placement, discard or score presentation is running. */
  function autosave(): void {
    saveRun(storage, game.snapshot(), runSaveKey, currentMode.flow);
  }

  function refillHand(): void {
    // Drawn left to right, one after another; also closes the gap when the deck has run out.
    services.hand.drawIn(game.refillHand(), game.state.hand);
    updateHud();
  }

  /** Remove every block from the scene and put the board and camera back at the start. */
  function resetTable(): void {
    services.views.disposeAll();
    services.field.clear();
    services.hand.clear();
    services.input.clearSelection();
    services.cameraView.reset();
    services.presenter.reset();
  }

  /**
   * The stage-won pop-up: pays the stage's rewards (once; showing it again pays nothing)
   * and counts the ledger in, then its button moves on to the next stage or the shop.
   */
  function showStageWon(): void {
    const reward = game.claimStageRewards();
    if (!reward) return;
    updateHud();
    autosave();
    services.overlays.showStageWon(reward, "Visit shop", () => void advanceFromStage());
  }

  function takeNextAction(): void {
    if (services.presenter.busy || services.input.dragging) return;
    playSfx("ui.click");
    if (game.phase === "over") {
      followRunPosition();
      return;
    }
    // A won stage moves on through its pop-up, which shows what it paid.
    if (game.inStage && roundOutcome(game.state) === "won") {
      showStageWon();
      return;
    }
    void advanceFromStage();
  }

  /** Leave the current stage or the shop: the next stage, the shop, or game over. */
  async function advanceFromStage(): Promise<void> {
    if (shopExitPending || services.presenter.busy || services.input.dragging) return;
    const { shop, cameraView } = services;
    const leavingShop = game.phase === "shop";
    if (leavingShop) shopExitPending = true;
    try {
      if (leavingShop) {
        const session = game;
        if (session.state.shopStock?.length) playSfx("shop.stock.burn");
        await shop.burnUnsold(reducedMotion);
        // A different run may have been started while the old shop was dissolving.
        if (game !== session) return;
      }
      const moved = leavingShop ? game.leaveShop() : game.advance();
      if (!moved) return;
      // advance() may have ended the run (TypeScript still has the pre-call narrowing).
      if ((game.phase as RunPhase) === "over") {
        endRun();
        return;
      }
      game = stockShopIfNeeded(game);
      followRunPosition();
      resetTable();
      if (game.inStage) {
        services.audio.stageStarted(game.phase);
        services.hand.deal(game.state.hand);
        playSfx("round.start");
      } else if (game.inShop) {
        playSfx("shop.open");
      }
      if (game.inShop && !reducedMotion) cameraView.beginShopEntrance();
      showSelection();
      updateHud();
      autosave();
    } finally {
      if (leavingShop) shopExitPending = false;
    }
  }

  /** The run is lost: the table stays behind the game over screen, which shows the totals. */
  function endRun(): void {
    gameOverAt = null;
    playSfx("run.lost");
    followRunPosition();
    updateHud();
    autosave();
  }

  /**
   * A new game run, with the mode's run setup applied: `policy` decides the rules, `deck` the
   * deck, and `start` the opening snapshot. Continue never comes through here; see `resume`.
   */
  function newRun(): GameRun {
    const steps: readonly RunSetupStep[] = currentMode.runSetup;
    const services = setupServices();
    runRules = runSetup.policy(steps, baseRunRules(currentMode), services);
    const dealt = runSetup.deck(steps, { deck: standardDeck }, services);
    cards = dealt.deck;
    const opening = new GameRun(dealerRegistry, runRules, cards).snapshot();
    // The run records the seed of the deck it was dealt, so Continue rebuilds the same one.
    const snapshot = { ...opening, ...(dealt.seed === undefined ? {} : { seed: dealt.seed }) };
    const started = runSetup.start(steps, { rules: runRules, deck: dealt, snapshot }, services);
    return GameRun.fromSnapshot(dealerRegistry, runRules, cards, started.snapshot);
  }

  /** The shop trait supplies stock when entering, including saves from before offers existed. */
  function stockShopIfNeeded(session: GameRun): GameRun {
    if (!modeTraits.shop || session.phase !== "shop" || session.state.shopStock !== undefined)
      return session;
    const snapshot = session.snapshot();
    return GameRun.fromSnapshot(dealerRegistry, runRules, cards, {
      ...snapshot,
      state: shopPreviewState(snapshot.state, snapshot.state.coins, Math.random, modeTraits.shop),
    });
  }

  /** Swap in a run (new or resumed) and rebuild the scene from its state. */
  function startRun(session: GameRun, fresh = false): void {
    const { rack, cameraView, audio } = services;
    game = stockShopIfNeeded(session);
    const rackTrait = modeTraits.passiveRack;
    rack.element.hidden = !rackTrait;
    rack.render(game.state.passiveRack);
    gameOverAt = null;
    // A run resumed on a won stage moves on from its pop-up (paid once; see the run).
    stageWonAt =
      game.inStage && roundOutcome(game.state) === "won" ? performance.now() + 400 : null;
    resetTable();
    for (const { block, cell } of game.state.field) services.field.add(block, cell);
    cameraView.frameToStructure();
    if (game.inStage) services.hand.deal(game.state.hand);
    // The shop scene's own `shopStock` trait shows the stock. A new run begun in the shop
    // already in front causes no scene transition, so refresh that scene: its traits re-read
    // the run and show the new offers instead of the previous run's.
    followRunPosition();
    refreshScene();
    const enterShop = game.phase === "shop" && fresh && !reducedMotion;
    if (enterShop) cameraView.beginShopEntrance();
    updateHud();
    showSelection();
    autosave();
    playSfx(game.phase === "shop" ? "shop.open" : "round.start");
    if (game.inStage) audio.stageStarted(game.phase);
    audio.runStarted();
  }

  /**
   * The saved run for this mode, if there is one. Its deck is rebuilt from the seed the run
   * itself was dealt from, so Continue matches even if browser storage has moved on.
   */
  const loadSaved = () =>
    loadRun(storage, cardsForSavedRun, dealerRegistry, runSaveKey, currentMode.flow);
  const resume = (snapshot: NonNullable<ReturnType<typeof loadSaved>>) => {
    cards = cardsForSavedRun(snapshot.seed);
    return GameRun.fromSnapshot(dealerRegistry, runRules, cards, snapshot);
  };

  /**
   * What a fresh page load does, keyed by the mode's `onLoad` configuration. The controller
   * reads one value and looks up the handler; it never asks which mode is open.
   */
  const onLoadHandlers: Record<OnLoad, () => void> = {
    title() {
      if (!restartMode) {
        showScene("title");
        return;
      }
      startRun(newRun(), true);
      services.overlays.closeAll();
    },
    newRun() {
      startRun(newRun(), true);
      services.overlays.closeAll();
    },
    resume() {
      const saved = restartMode ? null : loadSaved();
      startRun(saved ? resume(saved) : newRun(), !saved);
      services.overlays.closeAll();
    },
  };

  const rules: TableRules = {
    busy: () => services.presenter.busy,
    inStage: () => game.inStage,
    canPlay: () => game.dealer.canPlay(game.state),
    canDiscard: () => game.dealer.canDiscard(game.state),
    linePlacement: (count, targetId, face) =>
      game.dealer.linePlacementFor(game.state, count, targetId, face),
    hand: () => game.state.hand,
    play: (blocks, candidate) => services.presenter.play(blocks, candidate),
    discard: (blocks) => services.presenter.discard(blocks),
    reorderHand(from, to) {
      game.reorderHand(from, to);
      autosave();
    },
    passiveRack: () => game.state.passiveRack,
    // Not once the run is over, mid-play, or while a won stage's rewards are unpaid.
    canSellPassives: () =>
      game.phase !== "over" && !services.presenter.busy && !game.stageRewardsPending,
    reorderPassive(from, to) {
      if (!game.reorderPassive(from, to)) return false;
      services.rack.render(game.state.passiveRack);
      autosave();
      return true;
    },
    sellPassive(id) {
      if (game.sellPassive(id) === null) return false;
      services.rack.render(game.state.passiveRack);
      updateHud();
      autosave();
      return true;
    },
  };

  /** The game actions a menu can dispatch; navigation is the mode's data, not code. */
  const gameActions: Record<string, () => void> = {
    // From the game over screen: leave it and begin a fresh run.
    newRun() {
      services.overlays.closeAll();
      startRun(newRun(), true);
    },
    // The run is already saved at its last safe point; saving here could record a play
    // whose animation (and hand refill) hasn't finished, so just show the title.
    // Pending outcomes and an animating play are dropped with the run's display, so nothing
    // can change the title or the save afterwards (#124); Continue resumes the last save.
    quitToTitle() {
      stageWonAt = gameOverAt = null;
      services.presenter.reset();
      // The title scene's `titleScreen` trait shows the panel as it enters.
      showScene("title");
    },
  };

  function dispatch(action: string): void {
    if (Object.hasOwn(currentMode.navigation, action)) {
      followFlow(currentMode.navigation, action as NavigationAction, {
        replace: switchScene,
        push: (name) => scenes.pushIfNotCurrent(modeSceneId(currentMode.id, name)),
        pop: () => void scenes.pop(),
      });
      return;
    }
    gameActions[action]?.();
  }

  const hasSave = (): boolean => loadSaved() !== null;

  const menus: MenuCallbacks = {
    hasSave,
    onAction: dispatch,
    onContinue() {
      const snapshot = loadSaved();
      if (snapshot) startRun(resume(snapshot));
    },
    onNewGame() {
      startRun(newRun(), true);
    },
    onSettingsChange(next) {
      applySettings(next);
      saveSettings(storage, next);
    },
  };

  const screenScenes: ScreenScenes = menuScreenScenes({
    current: () => scenes.current?.id,
    push: (id) => scenes.push(id),
    pop: () => scenes.pop(),
    replace: (name) => switchScene(name),
    idFor: (name) => modeSceneId(currentMode.id, name),
  });

  const consoleApp: ConsoleApp = {
    game: () => game,
    screen: () => services.overlays.screen,
    next: takeNextAction,
    newRun() {
      startRun(newRun());
      services.overlays.closeAll();
    },
    home: () => showScene("title"),
    mode: () => currentMode,
    openMode(mode) {
      enterMode(mode);
      // startScene is declarative until game flow drives run progression (#37).
      switchScene(mode.startScene);
      startRun(newRun(), true);
      services.overlays.closeAll();
    },
    forceOutcome(outcome) {
      if (services.presenter.busy || !game.forceOutcome(outcome)) return false;
      services.presenter.reset();
      updateHud();
      autosave();
      // A won stage shows its pop-up, as if the win had been scored.
      if (outcome === "won") stageWonAt = performance.now();
      return true;
    },
    adjustCoins(delta) {
      const balance = game.adjustCoins(delta);
      updateHud();
      autosave();
      return balance;
    },
  };

  return {
    get game() {
      return game;
    },
    get mode() {
      return currentMode;
    },
    get settings() {
      return settings;
    },
    get reducedMotion() {
      return reducedMotion;
    },
    rules,
    menus,
    screenScenes,
    consoleApp,
    destroyBlock(blockId, cause) {
      if (!game.destroyBlock(blockId, cause)) {
        playSfx("action.denied");
        return false;
      }
      services.field.remove(blockId);
      updateHud();
      autosave();
      playSfx("block.destroyed");
      return true;
    },
    seedTable() {
      for (const { block, cell } of game.state.field) services.field.add(block, cell);
      game.state.hand.forEach((block, slot) => (services.hand.add(block).handSlot = slot));
    },
    begin() {
      updateHud();
      // Configure the initial mode through the same path used by the developer mode switcher.
      enterMode(currentMode, false);
      applySettings(settings);
      systemMotionQuery.addEventListener("change", onSystemMotion);
      // Browsers keep audio silent until the player interacts; start music on the first gesture.
      services.audio.start();
    },
    open() {
      switchScene(currentMode.startScene);
      onLoadHandlers[currentMode.traits.onLoad]();
      if (restartMode) {
        window.history.replaceState(
          window.history.state,
          "",
          modeLink(currentMode, window.location.href),
        );
      }
    },
    updateHud,
    showSelection,
    refillHand,
    rackChanged: () => services.rack.render(game.state.passiveRack),
    autosave,
    decided(outcome, now) {
      if (outcome === "won") {
        playSfx("round.cleared");
        stageWonAt = now + stageWonDelayMs;
      }
      if (outcome === "lost") {
        playSfx("round.failed");
        gameOverAt = now + gameOverDelayMs;
      }
    },
    takeNextAction,
    offerPrice: (offer) =>
      offer.kind === "passive" ? game.passivePrices.buy : (runRules.cardPurchasePrice ?? 1),
    shopStock: () => game.state.shopStock ?? [],
    runStats: () => game.stats,
    hasSave,
    dispatch,
    buy(id, destination) {
      const bought = game.buyShopOffer(id, destination);
      if (!bought) {
        playSfx("action.denied");
        return false;
      }
      if (bought.kind === "card") {
        services.hand.add(bought.block);
        services.hand.sync(game.state.hand);
      } else services.rack.render(game.state.passiveRack);
      services.shop.render(game.state.shopStock ?? [], true);
      updateHud();
      autosave();
      playSfx("shop.buy");
      return true;
    },
    followOutcomes(time) {
      const { presenter } = services;
      // A won or lost stage waits while a menu is open over it, and is shown on resuming.
      if (services.overlays.isOpen) return;
      if (stageWonAt !== null && stageWonAt <= time && !presenter.busy) {
        stageWonAt = null;
        showStageWon();
      }
      if (gameOverAt !== null && gameOverAt <= time && !presenter.busy) {
        gameOverAt = null;
        if (game.advance()) endRun();
      }
    },
    promptFirstPlay(time) {
      // The same outline as a valid attachment preview.
      const cell =
        game.inStage &&
        game.state.field.length === 0 &&
        game.state.hand.length > 0 &&
        game.dealer.canPlay(game.state) &&
        roundOutcome(game.state) === "playing"
          ? game.dealer.placementFor(game.state)
          : null;
      const idle = Boolean(cell) && !services.input.dragging && !services.presenter.busy;
      services.field.showPrompt(idle ? cell : null, time, reducedMotion);
    },
    dispose() {
      systemMotionQuery.removeEventListener("change", onSystemMotion);
    },
  };
}
