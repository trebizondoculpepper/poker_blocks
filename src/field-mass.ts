/**
 * Mass queries over the run's committed state (#816; doc/playfield-rocking.md): pure, and scoped
 * to the placed field, or to any explicit set of cards such as a scored subset. Hand, deck,
 * discard and shop cards contribute nothing to the field's mass. Each card's mass is its current
 * material definition's authored recipe, so a material change is reflected at the next query,
 * and a wrapped Present weighs its stored contents (#1068).
 */
import type { CardBlock } from "./cards";
import type { GameState } from "./game-state";
import { cardMassReading } from "./materials";
import { aggregateMass, type MassAggregate } from "./physical-mass";
import { contextQueries } from "./context-queries";

/**
 * Total, count and mean mass of the given cards, each resolved for its instance (a Present
 * weighs its stored contents, #1068), or why one could not be resolved.
 */
export function cardsMass(cards: readonly CardBlock[]): MassAggregate | { unavailable: string } {
  return aggregateMass(cards, cardMassReading);
}

/** Total, count and mean mass of the blocks placed on the field now. */
export function fieldMass(state: GameState): MassAggregate | { unavailable: string } {
  return cardsMass(state.field.map(({ block }) => block));
}

/** A mass aggregate as a query result: an empty scope is unavailable, never a zero mass. */
const massResult = (cards: readonly CardBlock[]) => {
  const mass = cardsMass(cards);
  if ("unavailable" in mass) return { available: false, reason: mass.unavailable } as const;
  return mass.count
    ? ({
        available: true,
        value: { totalKg: mass.totalKg, meanKg: mass.meanKg!, count: mass.count },
      } as const)
    : ({ available: false, reason: "no blocks in the mass scope" } as const);
};

// A row's scored subset (#818): `{ ids }`, the default scope for mass trials.
contextQueries.register("scoredSubsetMass", {
  cost: "O(n) in placed blocks",
  limit: 1_000_000,
  size: (snapshot) => snapshot.field.length,
  run: (snapshot, raw) => {
    const wanted = new Set(((raw ?? {}) as { ids?: readonly string[] }).ids ?? []);
    return massResult(snapshot.field.map(({ block }) => block).filter(({ id }) => wanted.has(id)));
  },
});

// The whole field: a separately labelled trial variant, still one factor per scored row.
contextQueries.register("fieldMass", {
  cost: "O(n) in placed blocks",
  limit: 1_000_000,
  size: (snapshot) => snapshot.field.length,
  run: (snapshot) => massResult(snapshot.field.map(({ block }) => block)),
});
