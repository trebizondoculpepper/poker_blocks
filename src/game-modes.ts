/**
 * A game mode defines the available scenes and start scene, plus mode-wide traits for a run.
 * `?mode=...` selects a developer mode; `?room=...` remains a backwards-compatible alias.
 */
import { Registry } from "./core/registry";
import type { RunSetupStep } from "./run-setup";
import { saveKey } from "./save";
import type { Scene } from "./scenes";
import type { DestroyCause } from "./traits/destructible";

export const sceneNames = [
  "title",
  "settings",
  "stage-1",
  "stage-2",
  "boss",
  "shop",
  "stage-won",
  "game-over",
] as const;
export type SceneName = (typeof sceneNames)[number];
export type SceneTraits = {
  screen: { kind: SceneName };
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

/**
 * A mode's scenes. Each scene composes only the traits whose behaviour it wants: the play
 * scenes take field placement and the round and deck panels, the shop takes the coin panel
 * and its exit. `stageTraits` are composed into every play scene on top of those.
 */
function scenesForMode(
  modeId: string,
  stageTraits: Partial<SceneTraits> = {},
): readonly ModeScene[] {
  const sceneTraits: Record<SceneName, Partial<SceneTraits>> = {
    title: {},
    settings: { pausesBelow: { input: true, update: true } },
    "stage-1": { ...playSceneTraits, ...stageTraits },
    "stage-2": { ...playSceneTraits, ...stageTraits },
    boss: { ...playSceneTraits, ...stageTraits },
    shop: { coinsPanel: {}, shopExit: {}, shopStock: {} },
    "stage-won": { pausesBelow: { input: true, update: true } },
    "game-over": {},
  };
  return sceneNames.map((kind) => ({
    id: modeSceneId(modeId, kind),
    traits: {
      screen: { kind },
      ...sceneTraits[kind],
    },
  }));
}

/** What every play scene shows and allows: the round and deck panels, and field placement. */
const playSceneTraits: Partial<SceneTraits> = {
  roundPanel: {},
  deckPanel: {},
  fieldPlacement: {},
};

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
  /**
   * A page that opens straight in play continues this mode's saved run. Without it the mode
   * always deals a new run on load, deliberately discarding the save (dev1's sandbox).
   */
  resumeSavedRun?: Record<never, never>;
  /**
   * A fresh page opens straight into play instead of on the title screen. Whether that play
   * continues a saved run is the separate `resumeSavedRun` decision.
   */
  opensInPlay?: Record<never, never>;
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
    scenes: scenesForMode("game"),
    startScene: "title",
    runSetup: [],
    // The real game has the passive rack, starting empty (passives come from the shop).
    traits: {
      save: { key: saveKey },
      passiveRack: { ...defaultPassiveRack },
      shop: { ...defaultShop },
      music: { style: "ordinary" },
    },
  },
  {
    id: "dev0",
    scenes: scenesForMode("dev0"),
    startScene: "title",
    resumeSavedRun: {},
    aliases: ["dev"],
    runSetup: [{ step: "materialDeck", reshuffle: "new-game" }],
    traits: {
      save: { key: "poker-blocks.dev-run" },
      console: { name: "dev0" },
      restartable: { param: "restart" },
      music: { style: "ordinary" },
    },
  },
  {
    id: "dev1",
    scenes: scenesForMode("dev1"),
    startScene: "stage-1",
    opensInPlay: {},
    runSetup: [
      { step: "sandbox" },
      { step: "materialDeck", reshuffle: "each-run" },
      { step: "materialSample" },
    ],
    traits: {
      save: { key: "poker-blocks.dev1-run" },
      console: { name: "dev1" },
      restartable: { param: "restart" },
      music: { style: "quiet" },
    },
  },
  {
    id: "dev2",
    scenes: scenesForMode("dev2"),
    startScene: "stage-1",
    opensInPlay: {},
    resumeSavedRun: {},
    runSetup: [
      { step: "sandbox" },
      { step: "materialDeck", reshuffle: "new-game" },
      { step: "startingPassives", count: 2 },
    ],
    traits: {
      save: { key: "poker-blocks.dev2-run" },
      console: { name: "dev2" },
      restartable: { param: "restart" },
      passiveRack: { ...defaultPassiveRack },
      music: { style: "quiet" },
    },
  },
  {
    id: "dev3",
    scenes: scenesForMode("dev3"),
    startScene: "shop",
    opensInPlay: {},
    resumeSavedRun: {},
    runSetup: [{ step: "shopPreview", coins: 5 }],
    traits: {
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
    scenes: scenesForMode("dev4", { devManualBlockDestroyer: { cause: "manual" } }),
    startScene: "stage-1",
    opensInPlay: {},
    resumeSavedRun: {},
    runSetup: [
      { step: "sandbox" },
      { step: "materialDeck", reshuffle: "new-game" },
      { step: "destructibleMix", share: 0.5, by: ["manual"] },
      { step: "materialSample" },
    ],
    traits: {
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
