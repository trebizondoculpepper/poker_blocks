/**
 * A block that resists some kinds of destruction (#437): `resistant: { causes }`. Steel and gold
 * resist `explosion`, so a blast (`destroy-targets`, src/trigger-responses.ts) leaves them
 * standing, cards, bonuses and all. Resistance is scoped to the causes it names: nothing else is
 * affected (the Nothingifier, a block's own self-destruct, manual destruction). It brings its
 * behaviour through the block-trait registry (`resists`); no code names a material.
 */
import type { BlockTraitBehavior } from "../block-trait-behaviours";

export type ResistantTrait = { causes: readonly string[] };

export const resistantBehavior: BlockTraitBehavior = {
  resists: (config, _block, cause) => (config as ResistantTrait).causes.includes(cause),
};
