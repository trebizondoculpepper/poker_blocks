/**
 * A game mode defines the available scenes and start scene, plus mode-wide traits for a run.
 * `?mode=...` selects a developer mode; `?room=...` remains a backwards-compatible alias.
 */
import { Registry } from "./core/registry";
import type { GameFlow } from "./game-flow";
import type { RunPositionOutcome } from "./game-run";
import type { RunSetupStep } from "./run-setup";
import { saveKey } from "./save";
import type { Scene } from "./scenes";
import type { DestroyCause } from "./traits/destructible";
import { standardGameFlow } from "./standard-game-flow";

export { standardGameFlow };

export type SceneTraits = {
  screen: { kind: string };
  pausesBelow: { input: boolean; update: boolean };
  /** A HUD panel this scene shows while it is in front (see src/hud-panels.ts). */
  roundPanel: Record<never, never>;
  deckPanel: Record<never, never>;
  coinsPanel: Record<never, never>;
  shopExit: Record<never, never>;
  /** Blocks may be played onto the field while this scene is in front. */
  fieldPlacement: Record<never, never>;
  /** The shop's stock is on show, and its offers may be bought, while this scene is in front. */
  shopStock: Record<never, never>;
  /** Testing only: double-click a block to destroy it with this cause. */
  devManualBlockDestroyer: { cause: DestroyCause };
};
export type ModeScene = Scene<SceneTraits>;
export type ModeMusicStyle = "quiet" | "ordinary";

/** What a fresh page load does in a mode (see ModeTraits.onLoad). */
export type OnLoad = "title" | "newRun" | "resume";

/** A shared scene definition: a name and the traits every mode's copy of it composes. */
export type SceneDefinition = {
  readonly name: string;
  readonly traits: Partial<SceneTraits>;
};

/** What every play scene shows and allows: the round and deck panels, and field placement. */
const playSceneTraits: Partial<SceneTraits> = {
  roundPanel: {},
  deckPanel: {},
  fieldPlacement: {},
};

/**
 * The scene definitions every mode composes by reference (see doc/game-architecture.md,
 * "Scene definitions"). A scene is configured here once; a mode adds traits to the scenes it
 * names, and never keeps its own copy of the catalogue.
 */
export const sceneDefinitions = [
  { name: "title", traits: {} },
  { name: "settings", traits: { pausesBelow: { input: true, update: true } } },
  { name: "stage-1", traits: playSceneTraits },
  { name: "stage-2", traits: playSceneTraits },
  { name: "boss", traits: playSceneTraits },
  { name: "shop", traits: { coinsPanel: {}, shopExit: {}, shopStock: {} } },
  { name: "stage-won", traits: { pausesBelow: { input: true, update: true } } },
  { name: "game-over", traits: {} },
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

/** How much a shop offers. What it actually stocks is game-run state, chosen by run setup. */
export type ShopTrait = { passiveOffers: number; cardOffers: number };
export const defaultShop: ShopTrait = { passiveOffers: 2, cardOffers: 3 };

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
  flow: GameFlow<RunPositionOutcome, SceneName>;
  /** Other names that open this mode (old links). */
  aliases?: readonly string[];
  /** Ordered steps applied when a new game run is created; never applied on Continue. */
  runSetup: readonly RunSetupStep[];
  traits: ModeTraits;
};

export const gameModeRegistry = new Registry<GameMode>("game mode");

const gameModes: GameMode[] = [
  {
    id: "game",
    scenes: composeScenes("game"),
    startScene: "title",
    flow: standardGameFlow,
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
    aliases: ["dev"],
    runSetup: [{ step: "materialDeck" }],
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
    runSetup: [{ step: "sandbox" }, { step: "materialDeck" }, { step: "materialSample" }],
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
    scenes: composeScenes("dev2"),
    startScene: "stage-1",
    flow: standardGameFlow,
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
    scenes: composeScenes("dev3"),
    startScene: "shop",
    flow: standardGameFlow,
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
