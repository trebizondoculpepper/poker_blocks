import type { CardBlock } from "../cards";

export type Selection = ReadonlySet<string>;

export function toggleBlockSelection(current: Selection, block: CardBlock): Selection {
  if (!block.traits.selectable) return current;
  const next = new Set(current);
  if (next.has(block.id)) next.delete(block.id);
  else next.add(block.id);
  return next;
}
