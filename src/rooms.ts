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
  /** The stage scene's interactions. The shop scene does not compose these. */
  stage: { fieldPlacement: Record<string, never>; overlays: SceneOverlays };
  passiveRack?: PassiveRackTrait;
  shop?: ShopTrait;
  /** Skip the title screen and go straight into play; `resume` continues the saved run. */
  skipTitle?: { resume: boolean };
  /**
   * Listed by the developer console under this name (`reset dev2`), and linked by it in
   * the URL (`?room=dev2`). Rooms without it are not listed.
   */
  console?: { name: string };
  /** A fresh run is started on load when this URL parameter is "true"; it is then removed. */
  restartable?: { param: string };
};

export type RunTransformer =
  | { type: "sandbox" }
  | { type: "materialDeck"; reshuffle: "each-run" | "new-game" }
  | { type: "materialSample" }
  | { type: "shopPreview"; coins: number };

/** Run setup is ordered data. Scene traits stay on `Room.traits`. */
export type RunConfig = { saveKey: string; transformers: readonly RunTransformer[] };

export type Room = {
  id: string;
  /** Temporary music policy until this becomes a composed music trait (#34). */
  musicMode: RoomMusicMode;
  /** The scenes this mode can enter without reloading the page. */
  scenes: readonly RoomScene[];
  /** Scene entered when this mode starts. */
  startScene: RoomSceneName;
  /** Other names that open this room (old links). */
  aliases?: readonly string[];
  runConfig: RunConfig;
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
    runConfig: { saveKey: saveKey, transformers: [] },
    // The real game has the passive rack, starting empty (passives come from the shop).
    traits: {
      stage: { fieldPlacement: {}, overlays: { ...standardStageOverlays } },
      passiveRack: { ...defaultPassiveRack },
      shop: { ...defaultShop },
    },
  },
  {
    id: "dev0",
    musicMode: "ordinary",
    scenes: scenesForRoom("dev0"),
    startScene: "title",
    aliases: ["dev"],
    runConfig: {
      saveKey: "poker-blocks.dev-run",
      transformers: [{ type: "materialDeck", reshuffle: "new-game" }],
    },
    traits: {
      console: { name: "dev0" },
      restartable: { param: "restart" },
      stage: { fieldPlacement: {}, overlays: { ...standardStageOverlays } },
    },
  },
  {
    id: "dev1",
    musicMode: "quiet",
    scenes: scenesForRoom("dev1"),
    startScene: "stage-1",
    runConfig: {
      saveKey: "poker-blocks.dev1-run",
      transformers: [
        { type: "sandbox" },
        { type: "materialDeck", reshuffle: "each-run" },
        { type: "materialSample" },
      ],
    },
    traits: {
      console: { name: "dev1" },
      restartable: { param: "restart" },
      stage: { fieldPlacement: {}, overlays: { ...standardStageOverlays } },
      skipTitle: { resume: false },
    },
  },
  {
    id: "dev2",
    musicMode: "quiet",
    scenes: scenesForRoom("dev2"),
    startScene: "stage-1",
    runConfig: {
      saveKey: "poker-blocks.dev2-run",
      transformers: [{ type: "sandbox" }, { type: "materialDeck", reshuffle: "new-game" }],
    },
    traits: {
      console: { name: "dev2" },
      restartable: { param: "restart" },
      stage: { fieldPlacement: {}, overlays: { ...standardStageOverlays } },
      passiveRack: { ...defaultPassiveRack, startWith: 2 },
      skipTitle: { resume: true },
    },
  },
  {
    id: "dev3",
    musicMode: "quiet",
    scenes: scenesForRoom("dev3"),
    startScene: "shop",
    runConfig: {
      saveKey: "poker-blocks.dev3-run",
      transformers: [{ type: "shopPreview", coins: 5 }],
    },
    traits: {
      console: { name: "dev3" },
      restartable: { param: "restart" },
      stage: { fieldPlacement: {}, overlays: { ...standardStageOverlays } },
      passiveRack: { ...defaultPassiveRack },
      shop: { ...defaultShop },
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

/** The console's name for a room: none for a room the console does not list. */
export function consoleNames(room: Room): string[] {
  return [room.traits.console?.name ?? []].flat();
}

/** The rooms the developer console lists, by console name, in order. */
export function devRooms(): string[] {
  return roomRegistry.names().flatMap((id) => consoleNames(roomRegistry.get(id)));
}

/** Whether this page load asks the room for a fresh run (`&restart=true`). */
export function wantsRestart(room: Room, params: URLSearchParams): boolean {
  return [room.traits.restartable?.param ?? []].flat().some((p) => params.get(p) === "true");
}

/** A link to the room: `?room=<console name>`, or no parameter for an unlisted room. */
export function roomLink(room: Room, href: string): URL {
  const url = new URL(href);
  url.searchParams.delete("room");
  for (const name of consoleNames(room)) url.searchParams.set("room", name);
  for (const param of [room.traits.restartable?.param ?? []].flat()) url.searchParams.delete(param);
  return url;
}
