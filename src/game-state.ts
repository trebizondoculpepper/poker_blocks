import type { BlockMaterial } from "./materials";
import type { CardBlock } from "./cards";
import type { Round } from "./round";
import type { PassiveBlock } from "./passives";
import type { Cell, Face } from "./traits/attachable";
import type { ShopOffer } from "./shop-stock";

export type PlacedBlock = {
  block: CardBlock;
  cell: Cell;
};

/** The facts of a run. Rules and Three.js objects live outside this value. */
export type GameState = {
  field: readonly PlacedBlock[];
  hand: readonly CardBlock[];
  deck: readonly CardBlock[];
  discardPile: readonly CardBlock[];
  passiveRack: readonly PassiveBlock[];
  /** Offers at rest in the shop; absent in older runs. */
  shopStock?: readonly ShopOffer[];
  /**
   * Every card bought this run, newest last (#143). They are also in the deck, hand, field or
   * discard pile like any card; this ledger lets a save rebuild cards that aren't in the
   * starting deck.
   */
  boughtCards?: readonly CardBlock[];
  /**
   * Cards whose material changed this run (#387), by id: saved so Continue rebuilds them with
   * it (src/card-material.ts). Absent when nothing changed.
   */
  cardStates?: Readonly<
    Record<string, { material?: BlockMaterial; stateBonus?: string; doneness?: number }>
  >;
  /** Run currency; unlike stage score, this carries across stages and the shop. */
  coins: number;
  round: Readonly<Round>;
};

/** Play a hand card. On an empty field the first play needs no target: it becomes the centre. */
export type PlayAction = {
  cardId: string;
  /**
   * Several hand cards placed as one play, in this order: a line running out from the
   * target face (east from the centre on an empty field). Starts with `cardId`.
   */
  cardIds?: readonly string[];
  targetId?: string;
  face?: Face;
};

/** The numbers a dealer sets at the start of each stage. */
export type StageRules = {
  targetScore: number;
  plays: number;
  discards: number;
};
