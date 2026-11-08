import type { CardBlock } from "./cards";
import type { Round } from "./round";
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
  round: Readonly<Round>;
};

export type PlayAction = {
  cardId: string;
  targetId: string;
  face: Face;
};
