import type { DragSourceConfig, DropTargetConfig } from "./drag-drop";
import type { DevDropInspectorConfig } from "./scene-traits/dev-drop-inspector";
import type { ActionHistoryConfig } from "./scene-traits/action-history";
import type { FirstPlayPromptConfig } from "./scene-traits/first-play-prompt";
import type { DevHudStyleAuditionConfig, HudStyleConfig } from "./scene-traits/hud-style";
/**
 * A game mode defines the available scenes and start scene, plus mode-wide traits for a run.
 * `?mode=...` selects a developer mode; `?room=...` remains a backwards-compatible alias.
 */
import { Registry } from "./core/registry";
import type { RoundPanelConfig, ShopExitConfig } from "./hud-panels";
import type { GameFlow } from "./game-flow";
import type { MusicFilter } from "./audio/music-controller";
import type { MusicCue, StageMusicPool } from "./audio-service";
import type { SoundEffectId } from "./audio/sfx-registry";
import type { RunFlowOutcome } from "./game-run";
import type { RunSetupStep } from "./run-setup";
import { saveKey } from "./save";
import type { Scene } from "./scenes";
import type { DestroyCause } from "./traits/destructible";
import { standardGameFlow } from "./standard-game-flow";

export { standardGameFlow };

export type SceneTraits = {
  screen: { kind: string };
  pausesBelow: { input: boolean; update: boolean };
  /**
   * A HUD panel this scene shows while it is in front, with its config (see
   * src/hud-panels.ts): the round panel names the stage and its next-action labels; the shop
   * exit names its button.
   */
  roundPanel: RoundPanelConfig;
  /** The deck counter; selecting it dispatches `opens` (the deck view, #175). */
  deckPanel: { opens?: string };
  /** The run's deck is listed, read-only, while this scene is in front (#175). */
  deckView: Record<never, never>;
  coinsPanel: Record<never, never>;
  shopExit: ShopExitConfig;
  /** The hand is laid out and drawn while this scene is on the stack (#183). */
  handView: Record<never, never>;
  /** The discard bin (also the passives' sell target) is shown while this scene is on the stack. */
  discardBin: Record<never, never>;
  /** The shared lower-left target presents Sell, and accepts installed passives only. */
  sellBin: Record<never, never>;
  /** The pulsing outline inviting a stage's first play is shown while this scene is on the stack. */
  /**
   * Drop targets in this scene (#273): places dragged blocks can be dropped, each a registered
   * drop target kind with a priority (higher is hit-tested first). The target owns its own
   * decision and hover feedback.
   */
  dropTarget: { targets: readonly DropTargetConfig[] };
  /**
   * Drag sources in this scene (#282): things that can be picked up, each a registered drag
   * source kind. dnd-kit starts a drag where one picks something up.
   */
  dragSource: { sources: readonly DragSourceConfig[] };
  /**
   * The board's own gestures while this scene shows (#275): dragging the structure turns it, a
   * pinch zooms and a two-finger twist turns it, the wheel zooms.
   */
  boardGestures: Record<never, never>;
  /** The ghost cube that invites a stage's first play, and how it looks and responds. */
  firstPlayPrompt: FirstPlayPromptConfig;
  /** The passive rack is shown while this scene is on the stack (#187). */
  passiveRackView: Record<never, never>;
  /** The shop's stock is on show, and its offers may be bought, while this scene is in front. */
  shopStock: Record<never, never>;
  /**
   * The blurred card attract sequence is the background while this scene is in front (#147).
   * It is cosmetic: it draws no game state and its randomness is not the session's.
   */
  attractBackground: Record<never, never>;
  /**
   * The room and table are drawn while this scene is in front. The title does not compose it,
   * so no table appears there (#147); every scene played on the table does.
   */
  tableBackground: Record<never, never>;
  /** Testing only: live sliders for the attract sequence's velocity, spin and spawn rate. */
  devAttractTuning: Record<never, never>;
  /** Developer-only shop balance draft editor, mounted only by a mode composing it. */
  devShopBalanceEditor: { backTo: string };
  /** Developer tool: the object browser, every game object by category (dev9). */
  devObjectBrowser: { backTo: string };
  /** Developer tool: a live panel of drag-and-drop state and input decisions (dev10). */
  devDropInspector: DevDropInspectorConfig;
  /**
   * Record interaction events and the game's callbacks while the scene shows, with a button that
   * copies the last 30 seconds of them with timestamps (dev10 for now; any mode can compose it).
   */
  actionHistory: ActionHistoryConfig;
  /** The HUD wears this registered style (src/hud-styles.ts) while the scene is on the stack. */
  hudStyle: HudStyleConfig;
  /** Testing only: a selector that switches the HUD between these styles (#121). */
  devHudStyleAudition: DevHudStyleAuditionConfig;
  /** Testing only: double-click a block to destroy it with this cause. */
  devManualBlockDestroyer: { cause: DestroyCause };
  /**
   * A menu of items shown while this scene is in front. Choosing one dispatches its `id` as a
   * named action; `when` names a menu condition (src/scene-behaviours.ts) the item needs.
   */
  menu: { label: string; items: readonly MenuItem[] };
  /**
   * The game over screen is shown while this scene is in front: the run's totals, and one
   * button per item, each dispatching its id as a named action (#90).
   */
  gameOverScreen: { items: readonly MenuItem[] };
  /** Entering this scene plays a music cue (src/audio-service.ts, `musicCues`). */
  musicCue: { cue: MusicCue };
  /**
   * Entering this play scene starts a fresh track from its pool: a random stage vibe or the
   * boss loop (#92). Quiet modes keep their stages silent.
   */
  musicTrack: { pool: StageMusicPool };
  /** Entering this scene plays a sound: a stage's start, the shop opening (#93). */
  enterSound: { sfx: SoundEffectId };
  /** Leaving this scene plays a sound: the title or settings screen closing. */
  exitSound: { sfx: SoundEffectId };
  /** Entering the shop runs its camera entrance, unless motion is reduced (#93). */
  shopEntrance: Record<never, never>;
  /**
   * The title screen is shown while this scene is in front: its panel, and its items whose
   * conditions hold (Continue needs a save). Choosing an item dispatches its action.
   */
  titleScreen: { items: readonly MenuItem[] };
  /**
   * The stage-won pop-up is shown while this scene is in front: the won stage's reward rows
   * counting in, then a button for `next`, which dispatches its id as a named action (#91).
   */
  stageWonScreen: { next: MenuItem };
  /**
   * Small text lines in the corner of the panel: the build version and links out to the
   * project. The scene shows them while it is in front.
   */
  panelFooter: { links: readonly PanelLink[] };
  /** The Settings panel is shown while this scene is in front. */
  settingsPanel: Record<never, never>;
  /** The music is filtered while this scene is in front (low-pass muffles, high-pass thins). */
  musicFilter: { kind: MusicFilter };
  /** Pressing `key` dispatches the named action, with the sound a button for it would play. */
  keyAction: { key: string; action: string; sfx?: SoundEffectId };
  /** A run is being played while this scene is on the stack (the `inRun` menu condition). */
  runInPlay: Record<never, never>;
};

/**
 * One menu item: its action id, its label, an optional condition it needs, and the sound
 * choosing it plays (`ui.click` when left out).
 */
export type MenuItem = {
  id: string;
  label: string;
  when?: MenuCondition;
  sfx?: SoundEffectId;
  /**
   * Shown but disabled unless this condition holds, with `disabledHint` explaining why (on hover
   * and to screen readers); choosing it while disabled plays the denied sound (#10, #148).
   */
  enabledWhen?: MenuCondition;
  disabledHint?: string;
};

/**
 * A link shown in a panel's footer. `href` is the destination; a link without one shows the
 * build version, which is data rather than a destination.
 */
export type PanelLink = { label: string; href?: string };
/** A condition a menu item can require; its test lives in the menu traits' registry. */
export type MenuCondition = "inRun" | "hasSave";
export type ModeScene = Scene<SceneTraits>;
export type ModeMusicStyle = "quiet" | "ordinary";

/** What a fresh page load does in a mode (see ModeTraits.onLoad). */
export type OnLoad = "title" | "newRun" | "resume" | "scene";

/** A shared scene definition: a name and the traits every mode's copy of it composes. */
export type SceneDefinition = {
  readonly name: string;
  readonly traits: Partial<SceneTraits>;
};

/** Escape opens the pause menu from the title and from play (#87). */
const escapeOpensPause: Partial<SceneTraits> = {
  keyAction: { key: "Escape", action: "openPause", sfx: "ui.click" },
};

/** What every play scene shows and allows: the round and deck panels, and field placement. */
const playSceneTraits: Partial<SceneTraits> = {
  tableBackground: {},
  // The bin takes discards dropped on it; asked before the grid, since it sits over the table.
  dropTarget: {
    targets: [
      { target: "discard", priority: 10 },
      // The grid takes plays (#274): a single block, a selected group's line, the first play.
      { target: "grid", priority: 0 },
    ],
  },
  // Hand blocks can be picked up and dragged to play, discard or reorder them.
  dragSource: { sources: [{ source: "hand" }] },
  // The board can be turned and zoomed.
  boardGestures: {},
  firstPlayPrompt: {
    colour: 0x65f4dd,
    pulseSeconds: 1.8,
    armed: { beatSeconds: 0.52, scale: [1.04, 1.09], opacity: [0.3, 0.42] },
    // The first dancer (#256): it grows through each bar and drops back to its base size on
    // the downbeat (the owner's sawtooth).
    dance: { cycle: "bar", shape: "saw", offset: 0, swell: 0.12 },
    release: { seconds: 0.55, growth: 0.6 },
  },
  handView: {},
  discardBin: {},
  deckPanel: { opens: "openDeck" },
  runInPlay: {},
  ...escapeOpensPause,
};

/** A lost stage can be ended from the HUD; a won one moves on from its Stage Won pop-up. */
const stageActions: RoundPanelConfig["actions"] = { lost: "End game" };

/** The pause menu: the same menu from the title and from play (#87). */
const pauseMenu: SceneTraits["menu"] = {
  label: "Paused",
  items: [
    { id: "resume", label: "Resume" },
    { id: "openSettings", label: "Settings" },
    { id: "quitToTitle", label: "Quit to title", when: "inRun" },
  ],
};

/** Where the project lives. Links to it come from here, so the URL is configured once. */
export const projectHome = "https://github.com/trebizondoculpepper/poker_blocks";

/** The footer links: where the version comes from, the source, and where to report a bug (#129). */
export const projectLinks: readonly PanelLink[] = [
  { label: "Get source code", href: projectHome },
  { label: "Report a bug", href: `${projectHome}/issues/new` },
];

/**
 * The scene definitions every mode composes by reference (see doc/game-architecture.md,
 * "Scene definitions"). A scene is configured here once; a mode adds traits to the scenes it
 * names, and never keeps its own copy of the catalogue.
 */
export const sceneDefinitions = [
  {
    name: "title",
    traits: {
      titleScreen: {
        items: [
          {
            id: "continue",
            label: "Continue",
            enabledWhen: "hasSave",
            disabledHint: "There is no game in progress.",
          },
          { id: "new", label: "New game" },
          { id: "openSettings", label: "Settings" },
        ],
      },
      // After `titleScreen`, so the panel is already showing when the footer is added to it.
      panelFooter: { links: projectLinks },
      attractBackground: {},
      musicCue: { cue: "title" },
      enterSound: { sfx: "ui.title.enter" },
      exitSound: { sfx: "ui.title.exit" },
      ...escapeOpensPause,
    },
  },
  {
    name: "pause",
    traits: {
      tableBackground: {},
      menu: pauseMenu,
      panelFooter: { links: projectLinks },
      pausesBelow: { input: true, update: true },
      musicFilter: { kind: "lowpass" },
      keyAction: { key: "Escape", action: "resume", sfx: "ui.back" },
    },
  },
  {
    // The in-run deck view (#175), pushed over play from the deck counter.
    name: "deck",
    traits: {
      tableBackground: {},
      deckView: {},
      enterSound: { sfx: "ui.click" },
      pausesBelow: { input: true, update: true },
      keyAction: { key: "Escape", action: "back", sfx: "ui.back" },
    },
  },
  {
    name: "settings",
    traits: {
      tableBackground: {},
      settingsPanel: {},
      pausesBelow: { input: true, update: true },
      musicFilter: { kind: "highpass" },
      enterSound: { sfx: "ui.settings.enter" },
      // Leaving plays `ui.settings.exit`, so Escape and Back add no sound of their own.
      exitSound: { sfx: "ui.settings.exit" },
      keyAction: { key: "Escape", action: "back" },
    },
  },
  ...(import.meta.env.DEV
    ? ([
        { name: "balance-editor", traits: {} },
        { name: "object-browser", traits: {} },
      ] as const)
    : []),
  {
    name: "stage-1",
    traits: {
      ...playSceneTraits,
      roundPanel: { stage: "STAGE 1", actions: stageActions },
      musicTrack: { pool: "stage" },
      enterSound: { sfx: "round.start" },
    },
  },
  {
    name: "stage-2",
    traits: {
      ...playSceneTraits,
      roundPanel: { stage: "STAGE 2", actions: stageActions },
      musicTrack: { pool: "stage" },
      enterSound: { sfx: "round.start" },
    },
  },
  {
    name: "boss",
    traits: {
      ...playSceneTraits,
      roundPanel: { stage: "BOSS STAGE", actions: stageActions },
      musicTrack: { pool: "boss" },
      enterSound: { sfx: "round.start" },
    },
  },
  {
    name: "shop",
    traits: {
      tableBackground: {},
      // The shop keeps the hand in view; its own drop targets handle purchases and sales.
      handView: {},
      sellBin: {},
      coinsPanel: {},
      shopExit: { label: "Continue" },
      shopStock: {},
      runInPlay: {},
      enterSound: { sfx: "shop.open" },
      shopEntrance: {},
      // A shop entered from the title (Continue) brings the table's music back.
      musicCue: { cue: "resumeTable" },
      ...escapeOpensPause,
    },
  },
  {
    name: "stage-won",
    traits: {
      tableBackground: {},
      stageWonScreen: { next: { id: "leaveStage", label: "Visit shop" } },
      pausesBelow: { input: true, update: true },
    },
  },
  {
    name: "game-over",
    traits: {
      tableBackground: {},
      gameOverScreen: {
        items: [
          { id: "newRun", label: "New Run" },
          { id: "quitToTitle", label: "Main menu", sfx: "ui.back" },
        ],
      },
      musicCue: { cue: "windDown" },
    },
  },
] as const satisfies readonly SceneDefinition[];

export type SceneName = (typeof sceneDefinitions)[number]["name"];
export const sceneNames: readonly SceneName[] = sceneDefinitions.map(({ name }) => name);

/** The scenes a run is played in, which a mode may give extra traits as a group. */
export const playScenes: readonly SceneName[] = ["stage-1", "stage-2", "boss"];

/** Traits a mode adds to some of the shared scenes. */
export type SceneAdditions = {
  readonly scenes: readonly SceneName[];
  readonly traits: Partial<SceneTraits>;
};

/** A mode with a passive rack shows it in play and in the shop, never on the title (#187). */
const rackScenes: SceneAdditions = {
  scenes: [...playScenes, "shop"],
  traits: { passiveRackView: {} },
};

/**
 * A mode's scenes: every shared definition, under the mode's own scene ids, with each scene's
 * `screen` trait first and then its definition's traits, plus any traits the mode adds to it.
 */
export function composeScenes(
  modeId: string,
  additions: readonly SceneAdditions[] = [],
): readonly ModeScene[] {
  return sceneDefinitions.map(({ name, traits }) => ({
    id: modeSceneId(modeId, name),
    traits: Object.assign(
      { screen: { kind: name } },
      traits,
      ...additions.filter(({ scenes }) => scenes.includes(name)).map((added) => added.traits),
    ),
  }));
}

/**
 * A scene's id: `<mode id>/<scene name>`. Modes share one scene manager, so the mode is part of
 * the id; a save records only the scene name, because its save key already names the mode.
 */
export function modeSceneId(modeId: string, scene: SceneName): string {
  return `${modeId}/${scene}`;
}

/** The passive rack: shown in modes that compose it, holding at most `capacity` passives. */
export type PassiveRackTrait = {
  /** How many passives the rack can hold. */
  capacity: number;
  /** Passives dealt at random into the rack when a run starts (0 by default). */
  startWith?: number;
};

/** The default rack: capacity for five passives, starting empty. */
export const defaultPassiveRack: PassiveRackTrait = { capacity: 5 };

/**
 * How many offers a shop holds: a number from `minOffers` to `maxOffers`, drawn each visit
 * (#145). What it actually stocks is game-run state, chosen by run setup.
 */
export type ShopTrait = {
  minOffers: number;
  maxOffers: number;
  /** Minimum offers of each kind, when eligible. Omitted legacy configs use one each. */
  guaranteedPassives?: number;
  guaranteedCards?: number;
};
export const defaultShop: ShopTrait = {
  minOffers: 5,
  maxOffers: 9,
  guaranteedPassives: 1,
  guaranteedCards: 1,
};

export type ModeTraits = {
  /** Save slot used by runs in this mode. */
  save: { key: string };
  passiveRack?: PassiveRackTrait;
  shop?: ShopTrait;
  /**
   * Listed by the developer console under this name (`reset dev2`), and linked by it in
   * the URL (`?mode=dev2`). Modes without it are not listed.
   */
  console?: { name: string };
  /** A fresh run is started on load when this URL parameter is "true"; it is then removed. */
  restartable?: { param: string };
  /**
   * What a fresh page load does: show the `title` screen, deal a `newRun`, or `resume` the
   * mode's saved run when it has one. Configuration, not a flag: `onLoadHandlers` in
   * src/run-controller.ts dispatches it through a table, so no code asks which mode it is.
   */
  onLoad: OnLoad;
  /** The music this mode plays, through the behaviour in src/mode-music.ts. */
  music: { style: ModeMusicStyle };
};

export type GameMode = {
  id: string;
  /** The scenes this mode can enter without reloading the page. */
  scenes: readonly ModeScene[];
  /**
   * The scene a fresh page opens on. `title` shows the title screen; any other scene starts
   * play straight away.
   */
  startScene: SceneName;
  /** Outcome-keyed scene transitions; scene names are never inferred from run phases. */
  flow: GameFlow<RunFlowOutcome, SceneName>;
  /** Menu navigation: each navigation action's stack operation (open a menu, go back). */
  navigation: GameFlow<NavigationAction, SceneName>;
  /** Other names that open this mode (old links). */
  aliases?: readonly string[];
  /** Ordered steps applied when a new game run is created; never applied on Continue. */
  runSetup: readonly RunSetupStep[];
  traits: ModeTraits;
};

/** The menu actions that only move between scenes; the flow data says how. */
export type NavigationAction = "openPause" | "openSettings" | "openDeck" | "back" | "resume";

/** Shared default navigation: menus push over what is in front and pop back to it. */
export const standardNavigation: GameFlow<NavigationAction, SceneName> = {
  openPause: { operation: "push", scene: "pause" },
  openSettings: { operation: "push", scene: "settings" },
  openDeck: { operation: "push", scene: "deck" },
  back: { operation: "pop" },
  resume: { operation: "pop" },
};

export const gameModeRegistry = new Registry<GameMode>("game mode");

const gameModes: GameMode[] = [
  {
    id: "game",
    scenes: composeScenes("game", [rackScenes]),
    startScene: "title",
    flow: standardGameFlow,
    navigation: standardNavigation,
    runSetup: [],
    // The real game has the passive rack, starting empty (passives come from the shop).
    traits: {
      onLoad: "title",
      save: { key: saveKey },
      passiveRack: { ...defaultPassiveRack },
      shop: { ...defaultShop },
      music: { style: "ordinary" },
    },
  },
  {
    id: "dev0",
    scenes: composeScenes("dev0"),
    startScene: "title",
    flow: standardGameFlow,
    navigation: standardNavigation,
    aliases: ["dev"],
    // Every registered material on a random card, visual experiments included: dev0 is for
    // seeing how all the materials look and meet.
    runSetup: [{ step: "materialDeck", pool: "registered" }],
    traits: {
      onLoad: "title",
      save: { key: "poker-blocks.dev-run" },
      console: { name: "dev0" },
      restartable: { param: "restart" },
      music: { style: "ordinary" },
    },
  },
  {
    id: "dev1",
    scenes: composeScenes("dev1"),
    startScene: "stage-1",
    flow: standardGameFlow,
    navigation: standardNavigation,
    // Every registered material, visual experiments included, like dev0.
    runSetup: [
      { step: "sandbox" },
      { step: "materialDeck", pool: "registered" },
      { step: "materialSample" },
    ],
    traits: {
      onLoad: "newRun",
      save: { key: "poker-blocks.dev1-run" },
      console: { name: "dev1" },
      restartable: { param: "restart" },
      music: { style: "quiet" },
    },
  },
  {
    id: "dev2",
    scenes: composeScenes("dev2", [rackScenes]),
    startScene: "stage-1",
    flow: standardGameFlow,
    navigation: standardNavigation,
    runSetup: [
      { step: "sandbox" },
      { step: "materialDeck" },
      { step: "startingPassives", count: 2 },
    ],
    traits: {
      onLoad: "resume",
      save: { key: "poker-blocks.dev2-run" },
      console: { name: "dev2" },
      restartable: { param: "restart" },
      passiveRack: { ...defaultPassiveRack },
      music: { style: "quiet" },
    },
  },
  {
    id: "dev3",
    scenes: composeScenes("dev3", [rackScenes]),
    startScene: "shop",
    flow: standardGameFlow,
    navigation: standardNavigation,
    runSetup: [{ step: "shopPreview", coins: 5 }],
    traits: {
      onLoad: "resume",
      save: { key: "poker-blocks.dev3-run" },
      console: { name: "dev3" },
      restartable: { param: "restart" },
      passiveRack: { ...defaultPassiveRack },
      shop: { ...defaultShop },
      music: { style: "quiet" },
    },
  },
  {
    // Destruction sandbox: a mixed-material structure in which about half the blocks are
    // destructible; double-click one to destroy it. Destroyed blocks leave gaps.
    id: "dev4",
    scenes: composeScenes("dev4", [
      { scenes: playScenes, traits: { devManualBlockDestroyer: { cause: "manual" } } },
    ]),
    startScene: "stage-1",
    flow: standardGameFlow,
    navigation: standardNavigation,
    runSetup: [
      { step: "sandbox" },
      { step: "materialDeck" },
      { step: "destructibleMix", share: 0.5, by: ["manual"] },
      { step: "materialSample" },
    ],
    traits: {
      onLoad: "resume",
      save: { key: "poker-blocks.dev4-run" },
      console: { name: "dev4" },
      restartable: { param: "restart" },
      music: { style: "quiet" },
    },
  },
  {
    // HUD style audition (#121): the shop, then sandbox play, with a selector that switches the
    // gameplay and shop overlays between the candidate styles. Continue leaves the shop for play.
    id: "dev5",
    // Renumbered from "dev-style"; the old name still works.
    aliases: ["dev-style"],
    scenes: composeScenes("dev5", [
      rackScenes,
      {
        scenes: [...playScenes, "shop"],
        traits: { devHudStyleAudition: { styles: ["artDeco", "preCad"] } },
      },
    ]),
    startScene: "shop",
    flow: standardGameFlow,
    navigation: standardNavigation,
    runSetup: [{ step: "sandbox" }, { step: "materialDeck" }, { step: "shopPreview", coins: 30 }],
    traits: {
      onLoad: "resume",
      save: { key: "poker-blocks.dev5-run" },
      console: { name: "dev5" },
      restartable: { param: "restart" },
      passiveRack: { ...defaultPassiveRack },
      shop: { ...defaultShop },
      music: { style: "quiet" },
    },
  },
  {
    // Visual experiment (#227): sandbox play with every card made of custard, a clear plastic
    // vessel of slow-settling custard. Turn the structure to watch it level and leave a trace.
    id: "dev6",
    // Renumbered from "dev-custard"; the old name still works.
    aliases: ["dev-custard"],
    scenes: composeScenes("dev6"),
    startScene: "stage-1",
    flow: standardGameFlow,
    navigation: standardNavigation,
    runSetup: [{ step: "sandbox" }, { step: "uniformMaterialDeck", material: "custard" }],
    traits: {
      onLoad: "newRun",
      save: { key: "poker-blocks.dev6-run" },
      console: { name: "dev6" },
      restartable: { param: "restart" },
      music: { style: "quiet" },
    },
  },
  {
    // Attract-sequence sandbox (#166): the title's background with live tuning sliders, so its
    // feel can be dialled in without editing constants. It opens straight on the title scene.
    id: "dev7",
    // Renumbered from "dev-attract"; the old name still works.
    aliases: ["dev-attract"],
    scenes: composeScenes("dev7", [{ scenes: ["title"], traits: { devAttractTuning: {} } }]),
    startScene: "title",
    flow: standardGameFlow,
    navigation: standardNavigation,
    runSetup: [],
    traits: {
      onLoad: "title",
      save: { key: "poker-blocks.dev7-run" },
      console: { name: "dev7" },
      music: { style: "quiet" },
    },
  },
  ...(import.meta.env.DEV
    ? [
        {
          id: "dev8",
          // Renumbered from "dev-balance"; the old name still works.
          aliases: ["dev-balance"],
          scenes: composeScenes("dev8", [
            { scenes: ["balance-editor"], traits: { devShopBalanceEditor: { backTo: "game" } } },
          ]),
          startScene: "balance-editor",
          flow: standardGameFlow,
          navigation: standardNavigation,
          runSetup: [],
          traits: {
            onLoad: "scene",
            save: { key: "poker-blocks.dev8-run" },
            console: { name: "dev8" },
            music: { style: "quiet" },
          },
        } satisfies GameMode,
        {
          // Every game object by category, one page each, with a preview and its properties.
          id: "dev9",
          scenes: composeScenes("dev9", [
            { scenes: ["object-browser"], traits: { devObjectBrowser: { backTo: "game" } } },
          ]),
          startScene: "object-browser",
          flow: standardGameFlow,
          navigation: standardNavigation,
          runSetup: [],
          traits: {
            onLoad: "scene",
            save: { key: "poker-blocks.dev9-run" },
            console: { name: "dev9" },
            music: { style: "quiet" },
          },
        } satisfies GameMode,
        {
          // Drag-and-drop debugging (dev10): ordinary sandbox play that records an action history
          // (the last 30 seconds of interaction events and callbacks, copied with a button) and
          // shows a live panel of when an animation holds drops back and whether the model and the
          // drawn field agree.
          id: "dev10",
          scenes: composeScenes("dev10", [
            { scenes: playScenes, traits: { actionHistory: {}, devDropInspector: {} } },
          ]),
          startScene: "stage-1",
          flow: standardGameFlow,
          navigation: standardNavigation,
          runSetup: [{ step: "sandbox" }],
          traits: {
            onLoad: "newRun",
            save: { key: "poker-blocks.dev10-run" },
            console: { name: "dev10" },
            restartable: { param: "restart" },
            music: { style: "quiet" },
          },
        } satisfies GameMode,
      ]
    : []),
];
for (const mode of gameModes) gameModeRegistry.register(mode.id, mode);

/** Resolve a mode id or alias; unknown values open the normal game. */
export function gameModeFor(name: string | null): GameMode {
  if (!name) return gameModeRegistry.get("game");
  if (gameModeRegistry.has(name)) return gameModeRegistry.get(name);
  const aliased = gameModeRegistry
    .names()
    .find((id) => gameModeRegistry.get(id).aliases?.includes(name));
  return gameModeRegistry.get(aliased ?? "game");
}

/** The mode a page URL opens: `?mode=`, or the legacy `?room=` alias when `mode` is absent. */
export function gameModeFromParams(params: URLSearchParams): GameMode {
  return gameModeFor(params.get("mode") ?? params.get("room"));
}

/** The console's name for a mode: none for a mode the console does not list. */
export function modeConsoleNames(mode: GameMode): string[] {
  return [mode.traits.console?.name ?? []].flat();
}

/** The modes the developer console lists, by console name, in order. */
export function developerModes(): string[] {
  return gameModeRegistry.names().flatMap((id) => modeConsoleNames(gameModeRegistry.get(id)));
}

/** Whether this page load asks the mode for a fresh run (`&restart=true`). */
export function wantsRestart(mode: GameMode, params: URLSearchParams): boolean {
  return [mode.traits.restartable?.param ?? []].flat().some((p) => params.get(p) === "true");
}

/** A canonical `?mode=` link, or no mode parameter for an unlisted mode. */
export function modeLink(mode: GameMode, href: string): URL {
  const url = new URL(href);
  url.searchParams.delete("mode");
  url.searchParams.delete("room");
  for (const name of modeConsoleNames(mode)) url.searchParams.set("mode", name);
  for (const param of [mode.traits.restartable?.param ?? []].flat()) url.searchParams.delete(param);
  return url;
}
