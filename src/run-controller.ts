/**
 * Run controller: the run being played and the game mode it is played in. It owns the
 * `GameRun`, starts, resumes and saves runs, moves between stages and the shop, follows
 * an announced outcome with the stage-won pop-up or game over, applies the player's
 * settings, and answers the other services' questions about the run (`rules` for the
 * input, `menus` for the overlays, `consoleApp` for the developer console).
 *
 * It decides what happens; the other services show it.
 */
import {
  withDevDestructibleMix,
  type DestroyCause,
  type DevDestructibleMix,
} from "./traits/destructible";
import type { AudioService } from "./audio-service";
import { playSfx } from "./audio/sfx";
import type { CameraViewService } from "./camera-view";
import { cardName, standardDeck, type CardBlock } from "./cards";
import type { ConsoleApp } from "./console-host";
import { dealerRegistry, roundOutcome, type RoundOutcome } from "./dealer";
import type { FieldView } from "./field-view";
import { GameRun, type RunPhase } from "./game-run";
import type { HandView } from "./hand-view";
import type { HudPanels } from "./hud-panels";
import { makeDevDeck } from "./materials";
import type { MenuCallbacks } from "./menus";
import type { Overlays, ScreenScenes } from "./overlays";
import type { createPassiveRack } from "./passive-rack";
import type { PlayPresenter } from "./play-presenter";
import type { BlockViews } from "./rendered-blocks";
import {
  gameModeFromParams,
  modeLink,
  modeSceneId,
  wantsRestart,
  type GameMode,
  type SceneName,
  type SceneTraits,
} from "./game-modes";
import { loadRun, saveRun, type SaveStorage } from "./save";
import type { SceneManager } from "./scenes";
import { demoRunRules, type RunRules } from "./run-rules";
import { createRunSetupRegistry } from "./run-setup-behaviours";
import { rulesForRun, type RunSetupServices, type RunSetupStep } from "./run-setup";
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
  /** Buy a shop offer into the hand or the rack; false when refused. */
  buy(id: string, destination: Parameters<GameRun["buyShopOffer"]>[1]): boolean;
  /** Per frame: once an announced outcome's delay has passed, the pop-up or game over follows. */
  followOutcomes(time: number): void;
  /** Per frame: invite a stage's first play with the pulsing outline of its cell. */
  promptFirstPlay(time: number): void;
  dispose(): void;
};

const devSeedKey = "poker-blocks.dev-material-seed";
/** When a won stage's outcome has been announced, the stage-won pop-up follows. */
const stageWonDelayMs = 900;
/** When a lost stage's outcome has been announced, the game over screen follows. */
const gameOverDelayMs = 1400;

const sceneForPhase: Record<RunPhase, SceneName> = {
  "stage-1": "stage-1",
  "stage-2": "stage-2",
  boss: "boss",
  shop: "shop",
  over: "game-over",
};

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

  /** The seed a deck that is kept until a new game is dealt from; kept in browser storage. */
  function devSeed(fresh = false): number {
    try {
      const raw = storage?.getItem(devSeedKey);
      const stored = Number(raw);
      if (
        !fresh &&
        raw !== null &&
        raw !== undefined &&
        Number.isInteger(stored) &&
        stored >= 0 &&
        stored < 4294967296
      )
        return stored;
    } catch {
      // A dev run still works when browser storage is unavailable.
    }
    const seed = Math.floor(Math.random() * 4294967296);
    try {
      storage?.setItem(devSeedKey, String(seed));
    } catch {
      /* Storage is optional. */
    }
    return seed;
  }

  const runSetup = createRunSetupRegistry(() => currentMode.traits.shop);
  const setupServices = (): RunSetupServices => ({
    standardDeck,
    keptSeed: () => devSeed(true),
    random: Math.random,
  });

  /** The mode's plain deck, with the testing-only mix its run setup declares, if any. */
  function plainDeck(): readonly CardBlock[] {
    return withDevDestructibleMix(
      standardDeck,
      declaredMix(currentMode.runSetup) ?? { share: 0, by: [] },
    );
  }

  /** The rules this mode always plays under, including a sandbox, on a new or resumed run. */
  function persistentRules(mode: GameMode): RunRules {
    return rulesForRun(mode.runSetup, baseRunRules(mode));
  }

  /** The `destructibleMix` this mode's run setup declares, if it declares one. */
  function declaredMix(steps: readonly RunSetupStep[]): DevDestructibleMix | undefined {
    return steps.flatMap((step) => (step.step === "destructibleMix" ? [step] : []))[0];
  }

  /**
   * The cards a saved run's deck is rebuilt from. A run setup step records the seed it dealt,
   * and old saves have none, so a material mode falls back to the seed kept for it in browser
   * storage. Only card ids are saved, so the testing-only mix is re-applied from the mode's
   * own run setup rather than persisted.
   */
  function cardsForSavedRun(seed: number | undefined): readonly CardBlock[] {
    const material = currentMode.runSetup.some((step) => step.step === "materialDeck");
    const deck = material ? makeDevDeck(seed ?? devSeed()) : standardDeck;
    return withDevDestructibleMix(deck, declaredMix(currentMode.runSetup) ?? { share: 0, by: [] });
  }

  function switchScene(name: SceneName): void {
    const id = modeSceneId(currentMode.id, name);
    if (scenes.current?.id !== id) scenes.switchTo(id);
  }

  function syncSceneToGame(): void {
    // Temporary bridge until scene transitions drive GameRun progression (#37).
    switchScene(sceneForPhase[game.phase]);
  }

  function enterMode(mode: GameMode, createDeck = true): void {
    currentMode = mode;
    modeTraits = mode.traits;
    runRules = persistentRules(mode);
    runSaveKey = modeTraits.save.key;
    if (createDeck) cards = plainDeck();
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
      .filter(({ block }) => block.traits.selectable && selected.has(block.id))
      .map(({ block }) => cardName(block.traits.identity));
    host.setAttribute(
      "aria-label",
      `${game.state.field.length} blocks in play. Hand: ${game.state.hand.map((block) => cardName(block.traits.identity)).join(", ")}. ${game.state.deck.length} in deck. Selected: ${selectedNames.join(", ") || "none"}.`,
    );
  }

  /** Save at a safe point: never while a placement, discard or score presentation is running. */
  function autosave(): void {
    saveRun(storage, game.snapshot(), runSaveKey);
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
      services.overlays.showGameOver(game.stats);
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
      syncSceneToGame();
      resetTable();
      if (game.inStage) {
        services.audio.stageStarted(game.phase);
        services.hand.deal(game.state.hand);
        playSfx("round.start");
      } else if (game.phase === "shop") {
        playSfx("shop.open");
      }
      const enterShop = game.phase === "shop" && !reducedMotion;
      shop.render(game.state.shopStock ?? [], game.phase === "shop", enterShop);
      if (enterShop) cameraView.beginShopEntrance();
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
    updateHud();
    autosave();
    services.overlays.showGameOver(game.stats);
  }

  /**
   * A new game run, with the mode's run setup applied: `prepare` decides the rules and the
   * deck before the deal, `start` adjusts the opening snapshot after it. Continue never
   * comes through here; see `resume`.
   */
  function newRun(): GameRun {
    const steps: readonly RunSetupStep[] = currentMode.runSetup;
    const services = setupServices();
    const prepared = runSetup.prepare(
      steps,
      { rules: baseRunRules(currentMode), deck: standardDeck },
      services,
    );
    runRules = prepared.rules;
    cards = prepared.deck;
    const opening = new GameRun(dealerRegistry, runRules, cards).snapshot();
    const started = runSetup.start(steps, { prepare: prepared, snapshot: opening }, services);
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
    const { rack, shop, cameraView, audio } = services;
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
    // The shop scene's own `shopStock` trait shows or hides the stock as the scene changes.
    syncSceneToGame();
    // A new run in the shop already in front re-enters no scene, so the stock is pushed to
    // the view here too; otherwise the previous run's offers would stay on screen.
    const inShop = game.phase === "shop";
    const enterShop = inShop && fresh && !reducedMotion;
    if (inShop) shop.render(game.state.shopStock ?? [], true, enterShop);
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
  const loadSaved = () => loadRun(storage, cardsForSavedRun, dealerRegistry, runSaveKey);
  const resume = (snapshot: NonNullable<ReturnType<typeof loadSaved>>) => {
    cards = cardsForSavedRun(snapshot.seed);
    return GameRun.fromSnapshot(dealerRegistry, runRules, cards, snapshot);
  };

  /** Straight into play: continue the saved run, or deal a new one (a restart always deals). */
  function openInPlay(): void {
    const saved = !restartMode && currentMode.resumeSavedRun ? loadSaved() : null;
    startRun(saved ? resume(saved) : newRun(), !saved);
    services.overlays.closeAll();
  }

  /** The title screen, or a fresh run when the page asked to restart. */
  function openOnTitle(): void {
    if (!restartMode) return services.overlays.showTitle();
    startRun(newRun(), true);
    services.overlays.closeAll();
  }

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

  const menus: MenuCallbacks = {
    hasSave: () => loadSaved() !== null,
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

  const screenScenes: ScreenScenes = {
    push: (name) => scenes.pushIfNotCurrent(modeSceneId(currentMode.id, name)),
    replace: switchScene,
    resumeGame() {
      scenes.pop();
      syncSceneToGame();
    },
  };

  const consoleApp: ConsoleApp = {
    game: () => game,
    screen: () => services.overlays.screen,
    next: takeNextAction,
    newRun() {
      startRun(newRun());
      services.overlays.closeAll();
    },
    home: () => services.overlays.showTitle(),
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
      // A mode that composes `opensInPlay` skips the title screen. Whether that play continues
      // a saved run is the separate `resumeSavedRun` trait, decided in openInPlay.
      if (currentMode.opensInPlay) openInPlay();
      else openOnTitle();
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
