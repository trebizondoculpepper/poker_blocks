import type { EventEnvelope } from "./lifecycle/action";
/**
 * Run controller: the run being played and the game mode it is played in. It owns the
 * `GameRun`, starts, resumes and saves runs, moves between stages and the shop, follows
 * an announced outcome with the stage-won pop-up or game over, applies the player's
 * settings, and answers the other services' questions about the run (`rules` for the
 * input, `menus` for the overlays, `consoleApp` for the developer console).
 *
 * It decides what happens; the other services show it.
 */
import type { SelectionBadge } from "./selection-badge";
import type { Cell } from "./traits/attachable";
import type { HudFrame } from "./hud-frame";
import type { DestroyCause } from "./traits/destructible";
import type { AudioService } from "./audio-service";
import { menuScreenScenes } from "./overlays";
import { refusalSound } from "./purchase-refusals";
import { playSfx } from "./audio/sfx";
import type { CameraViewService } from "./camera-view";
import { cardName, standardDeck, type CardBlock } from "./cards";
import type { ConsoleApp } from "./console-host";
import { dealerRegistry, roundOutcome, type RoundOutcome } from "./dealer";
import type { FieldView } from "./field-view";
import { GameRun, type RunFlowOutcome, type RunPhase } from "./game-run";
import type { StageReward } from "./stage-rewards";
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
import { clearRun, loadRun, saveRun, type SaveStorage } from "./save";
import type { SceneManager } from "./scenes";
import { Randomizer, newSeed } from "./random";
import type { RunRules } from "./run-rules";
import { createRunSetupRegistry } from "./run-setup-behaviours";
import type { RunSetupServices, RunSetupStep } from "./run-setup";
import {
  loadSettings,
  prefersReducedMotion,
  resolveLayout,
  resolveShadowQuality,
  saveSettings,
  type Settings,
} from "./settings";
import type { ShopOffer } from "./shop-stock";
import { baseRunRules } from "./mode-trait-rules";
import { offerKind } from "./offer-kinds";
import type { createShopView } from "./shop-view";
import type { TableInput, TableRules } from "./table-input";
import type { TableRenderer } from "./table-renderer";
import type { RunStats } from "./run-stats";

type PassiveRackView = ReturnType<typeof createPassiveRack>;
type ShopView = ReturnType<typeof createShopView>;

/** The services the run drives. Reached when needed: some are built after the controller. */
export type RunServices = {
  /** "N selected" over the hand (#305); its count follows the selection. */
  readonly selectionBadge: Pick<SelectionBadge, "count">;
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
  /** The shared HUD frame, laid out from the Layout setting (#119). */
  readonly frame: Pick<HudFrame, "layout" | "setLayout">;
};

export type GameRunController = {
  readonly game: GameRun;
  /**
   * Hear each committed action's facts, from whichever run is current (#755). Presentation
   * controller traits subscribe here; returns a function that stops listening.
   */
  onCommitted(listener: (facts: readonly EventEnvelope[]) => void): () => void;
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
  /**
   * Draw replacements into the model's hand now, without showing them (#775): the caller reveals
   * them later with the hand view. Returns the cards drawn.
   */
  drawReplacements(): readonly CardBlock[];
  /** The passive rack may have changed (a discard can grant passives). */
  rackChanged(): void;
  autosave(): void;
  /** The presenter announced the stage's outcome. */
  decided(outcome: RoundOutcome, now: number): void;
  /** The HUD button: move to the next stage, the shop, the next round, or a new game. */
  takeNextAction(): void;
  /** A shop offer's price. */
  offerPrice(offer: ShopOffer): number;
  /** How many slots the rack shows: the run's rack capacity (#187). */
  rackCapacity(): number;
  /** What the shop is showing while its scene is in front. */
  shopStock(): readonly ShopOffer[];
  /** The run's deck, for the read-only deck view (#175). */
  deckBlocks(): readonly CardBlock[];
  /** The won stage's paid rewards, which the stage-won pop-up shows; null before payment. */
  stageReward(): StageReward | null;
  /** The run's totals so far, which the game over screen shows. */
  runStats(): RunStats;
  /** Whether a saved run this mode can continue exists (the title's `hasSave` condition). */
  hasSave(): boolean;
  /** The session's random seed, shown on the win and lose screens so a run can be replayed. */
  seed(): number;
  /**
   * Carry out a named action from a menu item or key (#87): a navigation action follows the
   * mode's navigation data; a game action (such as `quitToTitle`) runs its handler.
   */
  dispatch(action: string): void;
  /** Buy a shop offer into the hand or the rack; false when refused. */
  buy(id: string, destination: Parameters<GameRun["buyShopOffer"]>[1]): boolean;
  /** Per frame: once an announced outcome's delay has passed, the pop-up or game over follows. */
  followOutcomes(time: number): void;
  /**
   * Where a stage's first play would go: the cell, while the field is empty and a play can be
   * made; otherwise null. The `firstPlayPrompt` trait draws its ghost there.
   */
  firstPlayCell(): Cell | null;
  /** How many blocks are on the field. */
  fieldCount(): number;
  dispose(): void;
};

/** When a won stage's outcome has been announced, the stage-won pop-up follows. */
const stageWonDelayMs = 900;
/** When a lost stage's outcome has been announced, the game over screen follows. */
const gameOverDelayMs = 1400;

export function createGameRunController<Context>(options: {
  host: HTMLElement;
  storage: SaveStorage | null;
  /** The page's URL parameters (`?mode=`, `&restart=true`). */
  params: URLSearchParams;
  scenes: SceneManager<SceneTraits, Context>;
  services: RunServices;
}): GameRunController {
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
  // One reproducible sequence for the session (#134). A new run reseeds it; Continue restores
  // the saved seed and position, so the same requests replay.
  let randomizer = new Randomizer(newSeed());
  // An action that rolls back rewinds whichever stream is the session's now (#657).
  const randomCheckpoints = {
    checkpoint: () => randomizer.checkpoint(),
    restore: (mark: { state: number; draws: number }) => randomizer.restore(mark),
  };
  // Every run this controller holds publishes its committed facts to the same listeners (#755).
  const committedListeners = new Set<(facts: readonly EventEnvelope[]) => void>();
  const adopt = (run: GameRun): GameRun => {
    run.onCommitted((facts) => {
      // A replaced run is no longer the one on screen: its facts present nothing.
      if (run !== game) return;
      for (const listener of Array.from(committedListeners)) listener(facts);
    });
    return run;
  };
  let game = adopt(new GameRun(dealerRegistry, runRules, cards, () => randomizer.next()));
  game.attachRandomCheckpoints(randomCheckpoints);
  let settings = loadSettings(storage);
  let reducedMotion = false;
  let stageWonAt: number | null = null;
  let gameOverAt: number | null = null;
  let shopExitPending = false;
  const systemMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
  const onSystemMotion = () => applySettings(settings);
  // Automatic layout follows the viewport's shape as it resizes or turns (#120).
  const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });
  const onViewportChange = () =>
    services.frame.setLayout(resolveLayout(settings.layout, viewport(), services.frame.layout));

  /** Declared, not assigned, so anything above it may call it without an ordering trap. */
  function setupServices(): RunSetupServices {
    return {
      standardDeck,
      newSeed: () => randomizer.int("run.setup.seed", 0, 4294967295),
      random: () => randomizer.next(),
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
    follow(game.positionOutcome);
  }

  /** Place the scene the mode's game flow names for a run outcome. */
  function follow(outcome: RunFlowOutcome): void {
    followFlow(currentMode.flow, outcome, {
      replace: switchScene,
      push: (name) => scenes.pushIfNotCurrent(modeSceneId(currentMode.id, name)),
      pop: () => {
        void scenes.pop();
      },
    });
  }

  /** Ask the scene in front to re-read the run, by exiting and re-entering it. */
  function refreshScene(): void {
    scenes.refresh();
  }

  function enterMode(mode: GameMode, createDeck = true): void {
    currentMode = mode;
    modeTraits = mode.traits;
    runRules = persistentRules(mode);
    runSaveKey = modeTraits.save.key;
    if (createDeck) cards = deckForRun(undefined);
    services.audio.enterMode(mode.traits.music.style);
  }

  function applySettings(next: Settings): void {
    settings = next;
    services.audio.applySettings(next);
    reducedMotion = prefersReducedMotion(next.motion, systemMotionQuery.matches);
    services.renderer.setShadowQuality(resolveShadowQuality(next.shadows, coarsePointer));
    services.frame.setLayout(resolveLayout(next.layout, viewport(), services.frame.layout));
  }

  /** A card the run holds now, wherever it is, by id: what a visible inspection re-describes. */
  function currentCard(id: string): CardBlock | undefined {
    const { hand, deck, discardPile, field } = game.state;
    return (
      field.find(({ block }) => block.id === id)?.block ??
      [...hand, ...deck, ...discardPile].find((card) => card.id === id)
    );
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
    // Every model change refreshes the HUD: an open inspection follows the card's new state.
    services.input.refreshInspection(currentCard);
  }

  function showSelection(): void {
    const selected = services.input.selection;
    const { views } = services;
    views.highlight(selected);
    const selectedNames = views.all
      .filter(({ block }) => selected.has(block.id))
      .map(({ block }) => cardName(block.traits.identity));
    // With two or more hand blocks selected, a badge over the hand says how many (#305), so a
    // drag that will carry the whole selection is never a surprise.
    const inHand = game.state.hand.filter((block) => selected.has(block.id)).length;
    services.selectionBadge.count(inHand);
    host.setAttribute(
      "aria-label",
      `${game.state.field.length} blocks in play. Hand: ${game.state.hand.map((block) => cardName(block.traits.identity)).join(", ")}. ${game.state.deck.length} in deck. Selected: ${selectedNames.join(", ") || "none"}.`,
    );
  }

  /** Save at a safe point: never while a placement, discard or score presentation is running. */
  function autosave(): void {
    game.setRandomCursor({ seed: randomizer.seed, position: randomizer.cursor });
    saveRun(storage, game.snapshot(), runSaveKey, currentMode.flow);
  }

  function drawReplacements(): readonly CardBlock[] {
    const drawn = game.refillHand();
    updateHud();
    return drawn;
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
    // The stage-won scene shows what was paid; its button dispatches `leaveStage`.
    follow("run.stage.won");
  }

  function takeNextAction(): void {
    if (services.presenter.busy || services.input.dragging) return;
    playSfx("ui.click");
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
    const { shop } = services;
    const leavingShop = game.inShop;
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
      if (leavingShop) playSfx("shop.leave");
      // advance() may have ended the run (TypeScript still has the pre-call narrowing).
      if ((game.phase as RunPhase) === "over") {
        endRun();
        return;
      }
      // The table is cleared first, so the scene that comes in front (its sound, the shop's
      // camera entrance) starts on a clean table rather than being reset straight after.
      resetTable();
      if (game.inStage) services.hand.deal(game.state.hand);
      followRunPosition();
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
    // A new run gets a new sequence, before anything draws from it. Otherwise a New game after
    // a run continues the old sequence: the same seed is shown but the position differs, so the
    // displayed seed could not reproduce the run (#134).
    randomizer = new Randomizer(newSeed());
    const steps: readonly RunSetupStep[] = currentMode.runSetup;
    const services = setupServices();
    runRules = runSetup.policy(steps, baseRunRules(currentMode), services);
    const dealt = runSetup.deck(steps, { deck: standardDeck }, services);
    cards = dealt.deck;
    const opening = new GameRun(dealerRegistry, runRules, cards, () =>
      randomizer.next(),
    ).snapshot();
    // The run records the seed of the deck it was dealt, so Continue rebuilds the same one.
    const snapshot = { ...opening, ...(dealt.seed === undefined ? {} : { seed: dealt.seed }) };
    const started = runSetup.start(steps, { rules: runRules, deck: dealt, snapshot }, services);
    return GameRun.fromSnapshot(dealerRegistry, runRules, cards, started.snapshot, () =>
      randomizer.next(),
    );
  }

  /**
   * Show one card as the run's state has it, where it is: redrawn after its material changes
   * (#389), or taken off the table or out of the hand when it has left play (#156).
   */
  function redrawCard(cardId: string): void {
    const placed = game.state.field.find(({ block }) => block.id === cardId);
    // A card still landing is redrawn when it lands, from the state then (play presenter).
    const shownOnTable = services.field.blocks().some(({ block }) => block.id === cardId);
    if (shownOnTable) {
      services.field.remove(cardId);
      if (placed) services.field.add(placed.block, placed.cell);
    }
    // A card that left play while still landing loses its stand-in now; its flight lands to
    // nothing (the play presenter reconciles with the model).
    if (!placed && !shownOnTable) services.field.remove(cardId);
    const held = game.state.hand.find(({ id }) => id === cardId);
    const shown = services.hand.blocks.find(({ block }) => block.id === cardId);
    if (shown) {
      services.hand.remove([shown]);
      services.views.dispose(shown);
      if (held) services.hand.add(held);
      services.hand.sync(game.state.hand);
    }
  }

  /** Swap in a run (new or resumed) and rebuild the scene from its state. */
  function startRun(session: GameRun): void {
    const { rack, cameraView, audio } = services;
    game = adopt(session);
    game.attachRandomCheckpoints(randomCheckpoints);
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
    // A new run that changes the scene enters it fresh; one that begins in the scene already in
    // front (a restart in the shop, say) refreshes it, so its traits re-read the run. Never
    // both, so a scene's enter work (such as choosing a track) runs once (#92).
    const inFront = scenes.current;
    followRunPosition();
    if (scenes.current === inFront) refreshScene();
    updateHud();
    showSelection();
    autosave();
    audio.runStarted();
  }

  /**
   * The saved run for this mode, if there is one. Its deck is rebuilt from the seed the run
   * itself was dealt from, so Continue matches even if browser storage has moved on.
   */
  const loadSaved = () =>
    loadRun(
      storage,
      cardsForSavedRun,
      dealerRegistry,
      runSaveKey,
      currentMode.flow,
      runSetup.requiresSavedSeed(currentMode.runSetup),
    );
  const resume = (snapshot: NonNullable<ReturnType<typeof loadSaved>>) => {
    cards = cardsForSavedRun(snapshot.seed);
    // Continue resumes the session's random sequence where it left off, so the run replays
    // rather than drawing fresh (#134). A save without a cursor keeps the seeded default.
    if (snapshot.random)
      randomizer = new Randomizer(snapshot.random.seed, snapshot.random.position);
    return GameRun.fromSnapshot(dealerRegistry, runRules, cards, snapshot, () => randomizer.next());
  };

  /**
   * What a fresh page load does, keyed by the mode's `onLoad` configuration. The controller
   * reads one value and looks up the handler; it never asks which mode is open.
   */
  const onLoadHandlers: Record<OnLoad, () => void> = {
    scene() {
      showScene(currentMode.startScene);
    },
    title() {
      if (!restartMode) {
        showScene("title");
        return;
      }
      startRun(newRun());
      services.overlays.closeAll();
    },
    newRun() {
      startRun(newRun());
      services.overlays.closeAll();
    },
    resume() {
      const saved = restartMode ? null : loadSaved();
      startRun(saved ? resume(saved) : newRun());
      services.overlays.closeAll();
    },
  };

  /** Console reset always starts fresh; scene-only tools re-enter their own start scene. */
  const freshRun = () => startRun(newRun());
  const consoleStartHandlers: Record<OnLoad, () => void> = {
    title: freshRun,
    newRun: freshRun,
    resume: freshRun,
    scene() {
      // A previous mode can have an outcome timer or an animated play in flight. Replace
      // its run before changing scenes so neither can resume into this scene-only tool.
      stageWonAt = gameOverAt = null;
      game = adopt(new GameRun(dealerRegistry, runRules, cards, () => randomizer.next()));
      game.attachRandomCheckpoints(randomCheckpoints);
      resetTable();
      showScene(currentMode.startScene);
    },
  };
  function startFromConsole(): void {
    consoleStartHandlers[currentMode.traits.onLoad]();
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
    // Not mid-play, nor when the run's rules refuse a sale (run over, rewards unpaid).
    // Model first (#272): selling commits at once, even while a play is still being shown.
    canSellPassives: () => game.canSellPassives,
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
    // Model first (#272): the change commits at once, then the card is redrawn in its place.
    applyRackItem(itemId, cardId) {
      if (!game.applyRackItem(itemId, cardId)) return false;
      redrawCard(cardId);
      showSelection();
      services.rack.render(game.state.passiveRack);
      autosave();
      return true;
    },
  };

  /**
   * Show what a purchase changed, read from the run's state rather than from the offer: any
   * new hand cards join the hand, and the rack is redrawn. A kind that adds neither (one that
   * pays coins, say) needs nothing here (#67).
   */
  function showPurchase(): void {
    const shown = new Set(services.hand.blocks.map(({ block }) => block.id));
    for (const block of game.state.hand) if (!shown.has(block.id)) services.hand.add(block);
    services.hand.sync(game.state.hand);
    services.rack.render(game.state.passiveRack);
  }

  /** The game actions a menu can dispatch; navigation is the mode's data, not code. */
  const gameActions: Record<string, () => void> = {
    // From the stage-won pop-up: on to the shop (or wherever the run goes next).
    leaveStage() {
      void advanceFromStage();
    },
    // From the game over screen: leave it and begin a fresh run.
    newRun() {
      services.overlays.closeAll();
      startRun(newRun());
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
      startRun(newRun());
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
      startFromConsole();
    },
    home: () => showScene("title"),
    hardReset() {
      // The active mode's own save slot, never a named mode.
      clearRun(storage, runSaveKey);
      // The run on screen is gone too, so the table returns to its empty start.
      game = adopt(new GameRun(dealerRegistry, runRules, cards, () => randomizer.next()));
      game.attachRandomCheckpoints(randomCheckpoints);
      stageWonAt = gameOverAt = null;
      services.presenter.reset();
      resetTable();
      showScene("title");
    },
    mode: () => currentMode,
    openMode(mode) {
      enterMode(mode, false);
      startFromConsole();
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
    onCommitted(listener) {
      committedListeners.add(listener);
      return () => committedListeners.delete(listener);
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
      window.addEventListener("resize", onViewportChange);
      // Browsers keep audio silent until the player interacts; start music on the first gesture.
      services.audio.start();
    },
    open() {
      // Each load handler puts its own scene in front (the title, or the run's scene through
      // the flow), so the first scene enters once, with its run ready.
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
    drawReplacements,
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
    offerPrice: (offer) => offerKind(offer).price(offer.block, game.offerRun),
    shopStock: () => game.state.shopStock ?? [],
    deckBlocks: () => game.state.deck,
    runStats: () => game.stats,
    // A run with no rack limit shows exactly the passives it holds.
    rackCapacity: () =>
      Number.isFinite(game.rackCapacity) ? game.rackCapacity : game.state.passiveRack.length,
    stageReward: () => game.stageReward,
    hasSave,
    seed: () => randomizer.seed,
    dispatch,
    buy(id, destination) {
      // A refusal sounds like its reason (#481): not enough coins, a full rack, or any other "no".
      const refusal = game.purchaseVerdict(id, destination);
      if (refusal || !game.buyShopOffer(id, destination)) {
        playSfx(refusalSound(refusal?.reason ?? "refused"));
        return false;
      }
      showPurchase();
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
    firstPlayCell() {
      return game.inStage &&
        game.state.field.length === 0 &&
        game.state.hand.length > 0 &&
        game.dealer.canPlay(game.state) &&
        roundOutcome(game.state) === "playing"
        ? game.dealer.placementFor(game.state)
        : null;
    },
    fieldCount() {
      return game.state.field.length;
    },
    dispose() {
      systemMotionQuery.removeEventListener("change", onSystemMotion);
      window.removeEventListener("resize", onViewportChange);
    },
  };
}
