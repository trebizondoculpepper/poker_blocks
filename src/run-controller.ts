/**
 * Run controller: the run being played and the mode (room) it is played in. It owns the
 * `GameSession`, starts, resumes and saves runs, moves between stages and the shop, follows
 * an announced outcome with the stage-won pop-up or game over, applies the player's
 * settings, and answers the other services' questions about the run (`rules` for the
 * input, `menus` for the overlays, `consoleApp` for the developer console).
 *
 * It decides what happens; the other services show it.
 */
import type { AudioService } from "./audio-service";
import { playSfx } from "./audio/sfx";
import type { CameraViewService } from "./camera-view";
import { cardName, standardDeck, type CardBlock } from "./cards";
import type { ConsoleApp } from "./console-host";
import { dealerRegistry, roundOutcome, type RoundOutcome } from "./dealer";
import type { FieldView } from "./field-view";
import { GameSession, type Phase } from "./game-session";
import type { HandView } from "./hand-view";
import type { HudPanels } from "./hud-panels";
import { sampleMaterials } from "./material-sampler";
import { makeDevDeck } from "./materials";
import type { MenuCallbacks } from "./menus";
import type { Overlays, ScreenScenes } from "./overlays";
import type { createPassiveRack } from "./passive-rack";
import type { PlayPresenter } from "./play-presenter";
import type { BlockViews } from "./rendered-blocks";
import {
  fieldPlacementActive,
  overlaysForPhase,
  roomFor,
  roomLink,
  roomSceneId,
  wantsRestart,
  type Room,
  type RoomSceneName,
  type RoomSceneTraits,
  type RoomTraits,
} from "./rooms";
import { loadRun, saveRun, type SaveStorage } from "./save";
import type { SceneManager } from "./scenes";
import { demoSessionConfig, sandboxSessionConfig, type SessionConfig } from "./session-config";
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
  readonly game: GameSession;
  /** The mode being played. */
  readonly room: Room;
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
  /** Put the run the page opened with on the table (before the services draw anything). */
  seedTable(): void;
  /** Configure the services for the current mode and settings, and start listening. */
  begin(): void;
  /**
   * The start screen: rooms that skip the title start straight in play (resuming their run
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
  /** Buy a shop offer into the hand or the rack; false when refused. */
  buy(id: string, destination: Parameters<GameSession["buyShopOffer"]>[1]): boolean;
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

const sceneForPhase: Record<Phase, RoomSceneName> = {
  "stage-1": "stage-1",
  "stage-2": "stage-2",
  boss: "boss",
  shop: "shop",
  over: "game-over",
};

/** The room's session rules: endless sandboxes, and the passive rack's capacity. */
function sessionConfigFor(traits: RoomTraits): SessionConfig {
  return {
    ...(traits.sandbox ? sandboxSessionConfig(demoSessionConfig) : demoSessionConfig),
    ...(traits.passiveRack ? { rackCapacity: traits.passiveRack.capacity } : {}),
  };
}

function newMaterialSeed(): number {
  return Math.floor(Math.random() * 4294967296);
}

export function createRunController<Context>(options: {
  host: HTMLElement;
  storage: SaveStorage | null;
  /** The page's URL parameters (`?room=`, `&restart=true`). */
  params: URLSearchParams;
  scenes: SceneManager<RoomSceneTraits, Context>;
  services: RunServices;
}): RunController {
  const { host, storage, scenes, services } = options;
  /**
   * Rooms (?room=...) are composed from room traits; see src/rooms.ts. dev0 is the normal
   * game with a material on every card, dev1 samples materials, dev2 has the passive rack,
   * and dev3 opens the shop with five coins.
   */
  let thisRoom = roomFor(options.params.get("room"));
  let roomTraits = thisRoom.traits;
  const restartRoom = wantsRestart(thisRoom, options.params);
  let sessionConfig = sessionConfigFor(roomTraits);
  let runSaveKey = roomTraits.save.key;
  let cards: readonly CardBlock[] = roomDeck(false);
  // A fresh run sits behind the title screen until the player chooses Continue or New game.
  let game = new GameSession(dealerRegistry, sessionConfig, cards);
  let settings = loadSettings(storage);
  let reducedMotion = false;
  let stageWonAt: number | null = null;
  let gameOverAt: number | null = null;
  let shopExitPending = false;
  const systemMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
  const onSystemMotion = () => applySettings(settings);

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
    const seed = newMaterialSeed();
    try {
      storage?.setItem(devSeedKey, String(seed));
    } catch {
      /* Storage is optional. */
    }
    return seed;
  }

  /** A deck for a run in this room: plain, or with materials (fresh, or kept by seed). */
  function roomDeck(newGame: boolean): readonly CardBlock[] {
    const materials = roomTraits.materialDeck;
    if (!materials) return standardDeck;
    return makeDevDeck(materials.reshuffle === "each-run" ? newMaterialSeed() : devSeed(newGame));
  }

  function switchScene(name: RoomSceneName): void {
    const id = roomSceneId(thisRoom.id, name);
    if (scenes.current?.id !== id) scenes.switchTo(id);
  }

  function syncSceneToGame(): void {
    // Temporary bridge until scene transitions drive GameSession progression (#37).
    switchScene(sceneForPhase[game.phase]);
  }

  function enterRoom(room: Room, createDeck = true): void {
    thisRoom = room;
    roomTraits = room.traits;
    sessionConfig = sessionConfigFor(roomTraits);
    runSaveKey = roomTraits.save.key;
    if (createDeck) cards = roomDeck(false);
    services.rack.setCapacity(roomTraits.passiveRack?.capacity ?? 0);
    services.rack.element.hidden = !roomTraits.passiveRack;
    services.audio.enterRoom(room.musicMode);
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
      overlays: overlaysForPhase(roomTraits, game.phase),
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
      if ((game.phase as Phase) === "over") {
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

  /** A new run: material samples in dev0/1; dev2 rack is filled in startRun. */
  function newSession(): GameSession {
    cards = roomDeck(true);
    const session = new GameSession(dealerRegistry, sessionConfig, cards);
    if (roomTraits.shopPreview) {
      const snapshot = session.snapshot();
      return GameSession.fromSnapshot(dealerRegistry, sessionConfig, cards, {
        ...snapshot,
        phase: "shop",
        state: shopPreviewState(
          snapshot.state,
          roomTraits.shopPreview.coins,
          Math.random,
          roomTraits.shop,
        ),
      });
    }
    if (!roomTraits.materialSample) return session;
    const { state } = session;
    const sample = sampleMaterials(state.deck);
    return GameSession.fromSnapshot(dealerRegistry, sessionConfig, cards, {
      ...session.snapshot(),
      state: { ...state, field: sample.field, deck: sample.deck },
    });
  }

  /** The shop trait supplies stock when entering, including saves from before offers existed. */
  function stockShopIfNeeded(session: GameSession): GameSession {
    if (!roomTraits.shop || session.phase !== "shop" || session.state.shopStock !== undefined)
      return session;
    const snapshot = session.snapshot();
    return GameSession.fromSnapshot(dealerRegistry, sessionConfig, cards, {
      ...snapshot,
      state: shopPreviewState(snapshot.state, snapshot.state.coins, Math.random, roomTraits.shop),
    });
  }

  /** Swap in a session (new or resumed) and rebuild the scene from its state. */
  function startRun(session: GameSession, fresh = false): void {
    const { rack, shop, cameraView, audio } = services;
    session = stockShopIfNeeded(session);
    game = session;
    const rackTrait = roomTraits.passiveRack;
    rack.element.hidden = !rackTrait;
    if (rackTrait?.startWith)
      game.fillPassiveRack(Math.min(rackTrait.startWith, rackTrait.capacity));
    rack.render(game.state.passiveRack);
    gameOverAt = null;
    // A run resumed on a won stage moves on from its pop-up (paid once; see the session).
    stageWonAt =
      game.inStage && roundOutcome(game.state) === "won" ? performance.now() + 400 : null;
    resetTable();
    for (const { block, cell } of game.state.field) services.field.add(block, cell);
    cameraView.frameToStructure();
    if (game.inStage) services.hand.deal(game.state.hand);
    const enterShop = game.phase === "shop" && fresh && !reducedMotion;
    shop.render(game.state.shopStock ?? [], game.phase === "shop", enterShop);
    syncSceneToGame();
    if (enterShop) cameraView.beginShopEntrance();
    updateHud();
    showSelection();
    autosave();
    playSfx(game.phase === "shop" ? "shop.open" : "round.start");
    if (game.inStage) audio.stageStarted(game.phase);
    audio.runStarted();
  }

  const loadSaved = () => loadRun(storage, cards, dealerRegistry, runSaveKey);
  const resume = (snapshot: NonNullable<ReturnType<typeof loadSaved>>) =>
    GameSession.fromSnapshot(dealerRegistry, sessionConfig, cards, snapshot);

  const rules: TableRules = {
    busy: () => services.presenter.busy,
    fieldActive: () => fieldPlacementActive(roomTraits, game.phase),
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
      startRun(newSession(), true);
    },
    onSettingsChange(next) {
      applySettings(next);
      saveSettings(storage, next);
    },
  };

  const screenScenes: ScreenScenes = {
    push: (name) => scenes.pushIfNotCurrent(roomSceneId(thisRoom.id, name)),
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
      startRun(newSession());
      services.overlays.closeAll();
    },
    home: () => services.overlays.showTitle(),
    room: () => thisRoom,
    openRoom(room) {
      enterRoom(room);
      // startScene is declarative until the scene graph drives session progression (#37).
      switchScene(room.startScene);
      startRun(newSession(), true);
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
    get room() {
      return thisRoom;
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
    seedTable() {
      for (const { block, cell } of game.state.field) services.field.add(block, cell);
      game.state.hand.forEach((block, slot) => (services.hand.add(block).handSlot = slot));
    },
    begin() {
      updateHud();
      // Configure the initial mode through the same path used by the developer room switcher.
      enterRoom(thisRoom, false);
      applySettings(settings);
      systemMotionQuery.addEventListener("change", onSystemMotion);
      // Browsers keep audio silent until the player interacts; start music on the first gesture.
      services.audio.start();
    },
    open() {
      const skipTitle = roomTraits.skipTitle;
      if (skipTitle) {
        const saved = skipTitle.resume && !restartRoom ? loadSaved() : null;
        startRun(saved ? resume(saved) : newSession(), !saved);
        services.overlays.closeAll();
      } else if (restartRoom) {
        startRun(newSession(), true);
        services.overlays.closeAll();
      } else services.overlays.showTitle();
      if (restartRoom) {
        window.history.replaceState(
          window.history.state,
          "",
          roomLink(thisRoom, window.location.href),
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
      offer.kind === "passive" ? game.passivePrices.buy : (sessionConfig.cardPurchasePrice ?? 1),
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
        fieldPlacementActive(roomTraits, game.phase) &&
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
