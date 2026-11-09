import type { CardBlock } from "../cards";
import type { BlockTraitBehavior } from "../block-trait-behaviours";

export type Selection = ReadonlySet<string>;

/** Selection is a hand capability: a placed block no longer carries this trait. */
export function withoutSelectable(block: CardBlock): CardBlock {
  const traits = { ...block.traits };
  delete traits.selectable;
  return { ...block, traits };
}

/** Reattach the trait when a block is drawn back into the hand. */
export function withSelectable(block: CardBlock): CardBlock {
  return { ...block, traits: { ...block.traits, selectable: {} } };
}

export const selectableBehavior: BlockTraitBehavior = {
  toggleSelection: (_config, block, current) => {
    const next = new Set(current);
    if (next.has(block.id)) next.delete(block.id);
    else next.add(block.id);
    return next;
  },
  highlight: (_config, block, selected) => selected.has(block.id),
  cursor: () => "pointer",
};
