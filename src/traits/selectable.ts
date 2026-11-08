import type { CardBlock } from "../cards";

export type Selection = ReadonlySet<string>;

/** Selection is a hand capability: a placed block no longer carries this trait. */
export function withoutSelectable(block: CardBlock): CardBlock {
  if (!block.traits.selectable) return block;
  const traits = { ...block.traits };
  delete traits.selectable;
  return { ...block, traits };
}

/** Reattach the trait when a block is drawn back into the hand. */
export function withSelectable(block: CardBlock): CardBlock {
  if (block.traits.selectable) return block;
  return { ...block, traits: { ...block.traits, selectable: {} } };
}

export function toggleBlockSelection(current: Selection, block: CardBlock): Selection {
  if (!block.traits.selectable) return current;
  const next = new Set(current);
  if (next.has(block.id)) next.delete(block.id);
  else next.add(block.id);
  return next;
}
