/**
 * How a mode's traits shape the rules its runs play under (#36). Each entry is keyed by the
 * trait that brings it; a mode composes the trait and gets the contribution, and no code asks
 * whether a mode has a rack or a shop. Traits with no entry add nothing to the rules.
 */
import type { GameMode, ModeTraits } from "./game-modes";
import { demoRunRules, type RunRules } from "./run-rules";
import { shopPreviewState } from "./shop-stock";

type TraitRules = {
  [Name in keyof ModeTraits]?: (rules: RunRules, config: NonNullable<ModeTraits[Name]>) => RunRules;
};

export const modeTraitRules: TraitRules = {
  /** The rack holds as many passives as the trait's capacity. */
  passiveRack: (rules, { capacity }) => ({ ...rules, rackCapacity: capacity }),
  /** A shop entered with no stock is stocked from the trait's offer counts. */
  shop: (rules, shop) => ({
    ...rules,
    stockShop: (state, random, round) => shopPreviewState(state, state.coins, random, shop, round),
  }),
};

/** The rules a mode's runs start from: the demo rules, shaped by each of the mode's traits. */
export function baseRunRules(mode: Pick<GameMode, "traits">): RunRules {
  return (Object.keys(mode.traits) as (keyof ModeTraits)[]).reduce((rules, name) => {
    const contribute = modeTraitRules[name] as
      | ((rules: RunRules, config: unknown) => RunRules)
      | undefined;
    return contribute ? contribute(rules, mode.traits[name]) : rules;
  }, demoRunRules);
}
