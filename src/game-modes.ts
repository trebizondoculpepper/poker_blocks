/**
 * A game mode defines the available scenes and start scene, plus mode-wide traits for a run.
 * `?mode=...` selects a developer mode; `?room=...` remains a backwards-compatible alias.
 */
import { Registry } from "./core/registry";
import { saveKey } from "./save";
import type { Scene } from "./scenes";
import type { DestroyCause, DevDestructibleMix } from "./traits/destructible";

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
  /** Testing only: double-click a block to destroy it with this cause. */
  devManualBlockDestroyer: { cause: DestroyCause };
};
export type ModeScene = Scene<SceneTraits>;
export type ModeMusicStyle = "quiet" | "ordinary";

/**
 * A mode's scenes. `stageTraits` are composed into every play scene (both stages and the
 * boss), for traits that act on the table while a stage is played.
 */
function scenesForMode(
  modeId: string,
  stageTraits: Partial<SceneTraits> = {},
): readonly ModeScene[] {
  const sceneTraits: Record<SceneName, Partial<SceneTraits>> = {
    title: {},
    settings: { pausesBelow: { input: true, update: true } },
    "stage-1": stageTraits,
    "stage-2": stageTraits,
    boss: stageTraits,
    shop: {},
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

/** UI panels composed into a stage or shop scene. Omitted panels are not shown. */
export type SceneOverlays = {
  round?: Record<string, never>;
  deck?: Record<string, never>;
  coins?: Record<string, never>;
  shopExit?: Record<string, never>;
};

const standardStageOverlays: SceneOverlays = { round: {}, deck: {} };

/** A shop scene contributes stock, purchase targets, and its table presentation. */
export type ShopTrait = { passiveOffers: number; cardOffers: number; overlays: SceneOverlays };
export const defaultShop: ShopTrait = {
  passiveOffers: 2,
  cardOffers: 3,
  overlays: { coins: {}, shopExit: {} },
};

export type ModeTraits = {
  /** Save slot used by runs in this mode. */
  save: { key: string };
  /** The stage scene's interactions. The shop scene does not compose these. */
  stage: { fieldPlacement: Record<string, never>; overlays: SceneOverlays };
  passiveRack?: PassiveRackTrait;
  shop?: ShopTrait;
  /** Endless play: unlimited plays and discards, a stage cannot be won or lost by itself. */
  sandbox?: Record<string, never>;
  /**
   * Every card gets a random material. `reshuffle: "each-run"` deals a new mix whenever a run
   * starts; "new-game" keeps the mix (and its seed) until a new game, so Continue matches.
   */
  materialDeck?: { reshuffle: "each-run" | "new-game" };
  /** A run starts on a structure holding one block of every material. */
  materialSample?: Record<string, never>;
  /** Skip the title screen and go straight into play; `resume` continues the saved run. */
  skipTitle?: { resume: boolean };
  /**
   * Listed by the developer console under this name (`reset dev2`), and linked by it in
   * the URL (`?mode=dev2`). Modes without it are not listed.
   */
  console?: { name: string };
  /** A fresh run is started on load when this URL parameter is "true"; it is then removed. */
  restartable?: { param: string };
  /** Testing only: about `share` of the deck is destructible by the given causes. */
  devDestructibleMix?: DevDestructibleMix;
  /** Start a fresh run in the shop with this many coins, for shop development. */
  shopPreview?: { coins: number };
};

export type GameMode = {
  id: string;
  /** Temporary music policy until this becomes a composed music trait (#34). */
  musicStyle: ModeMusicStyle;
  /** The scenes this mode can enter without reloading the page. */
  scenes: readonly ModeScene[];
  /** Scene entered when this mode starts. */
  startScene: SceneName;
  /** Other names that open this mode (old links). */
  aliases?: readonly string[];
  traits: ModeTraits;
};

/** Only the active stage scene composes field placement; a shop cannot offer it. */
export function fieldPlacementActive(traits: ModeTraits, phase: string): boolean {
  return phase !== "shop" && phase !== "over" && Boolean(traits.stage.fieldPlacement);
}

/** The active scene decides which independent HUD panels are composed. */
export function overlaysForPhase(traits: ModeTraits, phase: string): SceneOverlays {
  return phase === "shop" ? (traits.shop?.overlays ?? {}) : traits.stage.overlays;
}

export const gameModeRegistry = new Registry<GameMode>("game mode");

const gameModes: GameMode[] = [
  {
    id: "game",
    musicStyle: "ordinary",
    scenes: scenesForMode("game"),
    startScene: "title",
    // The real game has the passive rack, starting empty (passives come from the shop).
    traits: {
      save: { key: saveKey },
      stage: { fieldPlacement: {}, overlays: { ...standardStageOverlays } },
      passiveRack: { ...defaultPassiveRack },
      shop: { ...defaultShop },
    },
  },
  {
    id: "dev0",
    musicStyle: "ordinary",
    scenes: scenesForMode("dev0"),
    startScene: "title",
    aliases: ["dev"],
    traits: {
      save: { key: "poker-blocks.dev-run" },
      console: { name: "dev0" },
      restartable: { param: "restart" },
      stage: { fieldPlacement: {}, overlays: { ...standardStageOverlays } },
      materialDeck: { reshuffle: "new-game" },
    },
  },
  {
    id: "dev1",
    musicStyle: "quiet",
    scenes: scenesForMode("dev1"),
    startScene: "stage-1",
    traits: {
      save: { key: "poker-blocks.dev1-run" },
      console: { name: "dev1" },
      restartable: { param: "restart" },
      stage: { fieldPlacement: {}, overlays: { ...standardStageOverlays } },
      sandbox: {},
      materialDeck: { reshuffle: "each-run" },
      materialSample: {},
      skipTitle: { resume: false },
    },
  },
  {
    id: "dev2",
    musicStyle: "quiet",
    scenes: scenesForMode("dev2"),
    startScene: "stage-1",
    traits: {
      save: { key: "poker-blocks.dev2-run" },
      console: { name: "dev2" },
      restartable: { param: "restart" },
      stage: { fieldPlacement: {}, overlays: { ...standardStageOverlays } },
      sandbox: {},
      materialDeck: { reshuffle: "new-game" },
      passiveRack: { ...defaultPassiveRack, startWith: 2 },
      skipTitle: { resume: true },
    },
  },
  {
    id: "dev3",
    musicStyle: "quiet",
    scenes: scenesForMode("dev3"),
    startScene: "shop",
    traits: {
      save: { key: "poker-blocks.dev3-run" },
      console: { name: "dev3" },
      restartable: { param: "restart" },
      stage: { fieldPlacement: {}, overlays: { ...standardStageOverlays } },
      passiveRack: { ...defaultPassiveRack },
      shop: { ...defaultShop },
      shopPreview: { coins: 5 },
      skipTitle: { resume: true },
    },
  },
  {
    // Destruction sandbox: a mixed-material structure in which about half the blocks are
    // destructible; double-click one to destroy it. Destroyed blocks leave gaps.
    id: "dev4",
    musicStyle: "quiet",
    scenes: scenesForMode("dev4", { devManualBlockDestroyer: { cause: "manual" } }),
    startScene: "stage-1",
    traits: {
      save: { key: "poker-blocks.dev4-run" },
      console: { name: "dev4" },
      restartable: { param: "restart" },
      stage: { fieldPlacement: {}, overlays: { ...standardStageOverlays } },
      sandbox: {},
      materialDeck: { reshuffle: "new-game" },
      materialSample: {},
      devDestructibleMix: { share: 0.5, by: ["manual"] },
      skipTitle: { resume: true },
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
