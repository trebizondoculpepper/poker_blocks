import type { CardBlock } from "../cards";

/** Configured base points a block contributes when it counts toward a scored hand. */
export type ScorableTrait = {
  value: number;
};

export function scorable(value: number): ScorableTrait {
  return { value };
}

/** A block's configured base points; blocks without the trait contribute nothing. */
export function scorableValue(block: CardBlock): number {
  return block.traits.scorable?.value ?? 0;
}
