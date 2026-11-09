/**
 * Rooms are composed from traits. A room (the normal game, or a dev room opened with
 * `?room=...`) is plain data: an id and a set of room traits, each with its own
 * configuration. The game reads the traits ("does this room have a passive rack?") rather
 * than asking which room it is, so a feature such as the passive rack can be composed into
 * any room by adding its trait.
 */
import { Registry } from "./core/registry";
import { saveKey } from "./save";
import type { Scene } from "./scenes";

export const roomSceneNames = [
  "title",
  "settings",
  "stage-1",
  "stage-2",
  "boss",
  "shop",
  "stage-won",
  "game-over",
] as const;
export type RoomSceneName = (typeof roomSceneNames)[number];
export type RoomSceneTraits = {
  screen: { kind: RoomSceneName };
  pausesBelow: { input: boolean; update: boolean };
};
export type RoomScene = Scene<RoomSceneTraits>;
export type RoomMusicMode = "quiet" | "ordinary";

function scenesForRoom(roomId: string): readonly RoomScene[] {
  const sceneTraits: Record<RoomSceneName, Partial<RoomSceneTraits>> = {
    title: {},
    settings: { pausesBelow: { input: true, update: true } },
    "stage-1": {},
    "stage-2": {},
    boss: {},
    shop: {},
    "stage-won": { pausesBelow: { input: true, update: true } },
    "game-over": {},
  };
  return roomSceneNames.map((kind) => ({
    id: roomSceneId(roomId, kind),
    traits: {
      screen: { kind },
      ...sceneTraits[kind],
    },
  }));
}

export function roomSceneId(roomId: string, scene: RoomSceneName): string {
  return `${roomId}/${scene}`;
}

/** The passive rack: shown in the room, holding at most `capacity` passives. */
export type PassiveRackTrait = {
  /** How many passives the rack can hold. */
  capacity: number;
  /** Passives dealt at random into the rack when a run starts (0 by default). */
  startWith?: number;
};

/** The default rack: room for five passives, starting empty. */
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

export type RoomTraits = {
  /** Where the room keeps its saved run. */
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
  /** Start a fresh run in the shop with this many coins, for shop development. */
  shopPreview?: { coins: number };
};

export type Room = {
  id: string;
  /** Temporary music policy until this becomes a composed music trait (#34). */
  musicMode: RoomMusicMode;
  /** Console-visible room name and URL value; omitted for the default game. */
  consoleName?: string;
  /** The scenes this mode can enter without reloading the page. */
  scenes: readonly RoomScene[];
  /** Scene entered when this mode starts. */
  startScene: RoomSceneName;
  /** Other names that open this room (old links). */
  aliases?: readonly string[];
  /** A developer room: listed by the console's `reset`. */
  dev: boolean;
  traits: RoomTraits;
};

/** Only the active stage scene composes field placement; a shop cannot offer it. */
export function fieldPlacementActive(traits: RoomTraits, phase: string): boolean {
  return phase !== "shop" && phase !== "over" && Boolean(traits.stage.fieldPlacement);
}

/** The active scene decides which independent HUD panels are composed. */
export function overlaysForPhase(traits: RoomTraits, phase: string): SceneOverlays {
  return phase === "shop" ? (traits.shop?.overlays ?? {}) : traits.stage.overlays;
}

export const roomRegistry = new Registry<Room>("room");

const rooms: Room[] = [
  {
    id: "game",
    musicMode: "ordinary",
    scenes: scenesForRoom("game"),
    startScene: "title",
    dev: false,
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
    musicMode: "ordinary",
    consoleName: "dev0",
    scenes: scenesForRoom("dev0"),
    startScene: "title",
    aliases: ["dev"],
    dev: true,
    traits: {
      save: { key: "poker-blocks.dev-run" },
      stage: { fieldPlacement: {}, overlays: { ...standardStageOverlays } },
      materialDeck: { reshuffle: "new-game" },
    },
  },
  {
    id: "dev1",
    musicMode: "quiet",
    consoleName: "dev1",
    scenes: scenesForRoom("dev1"),
    startScene: "stage-1",
    dev: true,
    traits: {
      save: { key: "poker-blocks.dev1-run" },
      stage: { fieldPlacement: {}, overlays: { ...standardStageOverlays } },
      sandbox: {},
      materialDeck: { reshuffle: "each-run" },
      materialSample: {},
      skipTitle: { resume: false },
    },
  },
  {
    id: "dev2",
    musicMode: "quiet",
    consoleName: "dev2",
    scenes: scenesForRoom("dev2"),
    startScene: "stage-1",
    dev: true,
    traits: {
      save: { key: "poker-blocks.dev2-run" },
      stage: { fieldPlacement: {}, overlays: { ...standardStageOverlays } },
      sandbox: {},
      materialDeck: { reshuffle: "new-game" },
      passiveRack: { ...defaultPassiveRack, startWith: 2 },
      skipTitle: { resume: true },
    },
  },
  {
    id: "dev3",
    musicMode: "quiet",
    consoleName: "dev3",
    scenes: scenesForRoom("dev3"),
    startScene: "shop",
    dev: true,
    traits: {
      save: { key: "poker-blocks.dev3-run" },
      stage: { fieldPlacement: {}, overlays: { ...standardStageOverlays } },
      passiveRack: { ...defaultPassiveRack },
      shop: { ...defaultShop },
      shopPreview: { coins: 5 },
      skipTitle: { resume: true },
    },
  },
];
for (const room of rooms) roomRegistry.register(room.id, room);

/** The room a `?room=` value opens: by id or alias; anything else is the normal game. */
export function roomFor(name: string | null): Room {
  if (!name) return roomRegistry.get("game");
  if (roomRegistry.has(name)) return roomRegistry.get(name);
  const aliased = roomRegistry.names().find((id) => roomRegistry.get(id).aliases?.includes(name));
  return roomRegistry.get(aliased ?? "game");
}

/** The developer rooms, in order. */
export function devRooms(): string[] {
  return roomRegistry.names().filter((id) => roomRegistry.get(id).dev);
}
