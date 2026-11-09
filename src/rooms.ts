/**
 * Rooms are composed from traits. A room (the normal game, or a dev room opened with
 * `?room=...`) is plain data: an id and a set of room traits, each with its own
 * configuration. The game reads the traits ("does this room have a passive rack?") rather
 * than asking which room it is, so a feature such as the passive rack can be composed into
 * any room by adding its trait.
 */
import { Registry } from "./core/registry";
import { saveKey } from "./save";

/** The passive rack: shown in the room, holding at most `capacity` passives. */
export type PassiveRackTrait = {
  /** How many passives the rack can hold. */
  capacity: number;
  /** Passives dealt at random into the rack when a run starts (0 by default). */
  startWith?: number;
};

/** The default rack: room for five passives, starting empty. */
export const defaultPassiveRack: PassiveRackTrait = { capacity: 5 };

/** A shop scene contributes stock, purchase targets, and its table presentation. */
export type ShopTrait = { passiveOffers: number; cardOffers: number };
export const defaultShop: ShopTrait = { passiveOffers: 2, cardOffers: 3 };

export type RoomTraits = {
  /** Where the room keeps its saved run. */
  save: { key: string };
  /** The stage scene's interactions. The shop scene does not compose these. */
  stage: { fieldPlacement: Record<string, never> };
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
  /** The music starts wound down (silent until something winds it up). */
  quiet?: Record<string, never>;
};

export type Room = {
  id: string;
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

export const roomRegistry = new Registry<Room>("room");

const rooms: Room[] = [
  {
    id: "game",
    dev: false,
    // The real game has the passive rack, starting empty (passives come from the shop).
    traits: {
      save: { key: saveKey },
      stage: { fieldPlacement: {} },
      passiveRack: { ...defaultPassiveRack },
      shop: { ...defaultShop },
    },
  },
  {
    id: "dev0",
    aliases: ["dev"],
    dev: true,
    traits: {
      save: { key: "poker-blocks.dev-run" },
      stage: { fieldPlacement: {} },
      materialDeck: { reshuffle: "new-game" },
    },
  },
  {
    id: "dev1",
    dev: true,
    traits: {
      save: { key: "poker-blocks.dev1-run" },
      stage: { fieldPlacement: {} },
      sandbox: {},
      materialDeck: { reshuffle: "each-run" },
      materialSample: {},
      skipTitle: { resume: false },
      quiet: {},
    },
  },
  {
    id: "dev2",
    dev: true,
    traits: {
      save: { key: "poker-blocks.dev2-run" },
      stage: { fieldPlacement: {} },
      sandbox: {},
      materialDeck: { reshuffle: "new-game" },
      passiveRack: { ...defaultPassiveRack, startWith: 2 },
      skipTitle: { resume: true },
      quiet: {},
    },
  },
  {
    id: "dev3",
    dev: true,
    traits: {
      save: { key: "poker-blocks.dev3-run" },
      stage: { fieldPlacement: {} },
      passiveRack: { ...defaultPassiveRack },
      shop: { ...defaultShop },
      shopPreview: { coins: 5 },
      skipTitle: { resume: true },
      quiet: {},
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
