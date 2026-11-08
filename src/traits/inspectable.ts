import type { CardBlock } from "../cards";

export type InspectableTrait = {
  inspect(): string;
};

export function inspectable(description: string): InspectableTrait {
  return { inspect: () => description };
}

export function inspectBlock(block: CardBlock): string | null {
  return block.traits.inspectable?.inspect() ?? null;
}
