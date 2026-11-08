import type { CardBlock } from "./cards";
import type { Round } from "./round";
import type { PassiveBlock } from "./passives";
import type { Cell, Face } from "./traits/attachable";

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
  /** Run currency; unlike stage score, this carries across stages and the shop. */
  coins: number;
  round: Readonly<Round>;
};

/** Play a hand card. On an empty field the first play needs no target: it becomes the centre. */
export type PlayAction = {
  cardId: string;
  targetId?: string;
  face?: Face;
};

/** The numbers a dealer sets at the start of each stage. */
export type StageRules = {
  targetScore: number;
  plays: number;
  discards: number;
};
