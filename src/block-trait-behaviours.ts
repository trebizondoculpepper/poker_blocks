import type { CardBlock } from "./cards";
import { countOperation } from "./lifecycle/operations";
import { attachableBehavior, type Cell, type Face } from "./traits/attachable";
import { destructibleBehavior, type DestroyCause } from "./traits/destructible";
import { selectableBehavior, type Selection } from "./traits/selectable";
import { transparentBehavior } from "./traits/transparent";
import { resistantBehavior } from "./traits/resistant";

/** A configured trait contributes any of these capabilities; callers never inspect its name. */
export type BlockTraitBehavior = {
  toggleSelection?: (config: unknown, block: CardBlock, current: Selection) => Selection;
  highlight?: (config: unknown, block: CardBlock, selected: Selection) => boolean;
  cursor?: (config: unknown, block: CardBlock) => string;
  handover?: (config: unknown, block: CardBlock) => boolean;
  canDestroy?: (config: unknown, block: CardBlock, cause: DestroyCause) => boolean;
  canDrag?: (config: unknown, block: CardBlock) => boolean;
  /** Whether this trait protects the block from destruction by `cause` (#437). */
  resists?: (config: unknown, block: CardBlock, cause: string) => boolean;
  attachment?: (
    config: unknown,
    block: CardBlock,
    target: Cell,
    face: Face,
    occupied: ReadonlySet<string>,
  ) => Cell | null;
};

const blockTraitRegistry = new Map<string, BlockTraitBehavior>();

export function registerBlockTrait(name: string, behavior: BlockTraitBehavior): () => void {
  if (blockTraitRegistry.has(name)) throw new Error(`Block trait already registered: ${name}`);
  blockTraitRegistry.set(name, behavior);
  return () => blockTraitRegistry.delete(name);
}

function eachBehavior(
  block: CardBlock,
  apply: (behavior: BlockTraitBehavior, config: unknown) => void,
): void {
  for (const [name, config] of Object.entries(block.traits)) {
    const behavior = blockTraitRegistry.get(name);
    if (!behavior) continue;
    // Inside a committed action each trait callback is charged to its budget (#661 review), like
    // any registered handler; selection and highlighting run outside actions and cost nothing.
    countOperation(`block trait ${name}`);
    apply(behavior, config);
  }
}

export function toggleBlockSelection(current: Selection, block: CardBlock): Selection {
  let next = current;
  eachBehavior(block, (behavior, config) => {
    next = behavior.toggleSelection?.(config, block, next) ?? next;
  });
  return next;
}

export function blockHighlighted(block: CardBlock, selected: Selection): boolean {
  let highlighted = false;
  eachBehavior(block, (behavior, config) => {
    highlighted = behavior.highlight?.(config, block, selected) || highlighted;
  });
  return highlighted;
}

export function blockCursor(block: CardBlock | undefined): string {
  let cursor = "default";
  if (block)
    eachBehavior(block, (behavior, config) => {
      cursor = behavior.cursor?.(config, block) ?? cursor;
    });
  return cursor;
}

export function needsLandingHandover(block: CardBlock): boolean {
  let needed = false;
  eachBehavior(block, (behavior, config) => {
    needed = behavior.handover?.(config, block) || needed;
  });
  return needed;
}

export function blockCanDestroy(block: CardBlock, cause: DestroyCause): boolean {
  let allowed = false;
  eachBehavior(block, (behavior, config) => {
    allowed = behavior.canDestroy?.(config, block, cause) || allowed;
  });
  return allowed;
}

/** Whether any of the block's traits protects it from destruction by `cause` (#437). */
export function blockResists(block: CardBlock, cause: string): boolean {
  let resisted = false;
  eachBehavior(block, (behavior, config) => {
    resisted = behavior.resists?.(config, block, cause) || resisted;
  });
  return resisted;
}

export function blockCanDrag(block: CardBlock): boolean {
  let allowed = false;
  eachBehavior(block, (behavior, config) => {
    allowed = behavior.canDrag?.(config, block) || allowed;
  });
  return allowed;
}

export function blockAttachmentCell(
  block: CardBlock,
  target: Cell,
  face: Face,
  occupied: ReadonlySet<string>,
): Cell | null {
  let cell: Cell | null = null;
  eachBehavior(block, (behavior, config) => {
    cell = behavior.attachment?.(config, block, target, face, occupied) ?? cell;
  });
  return cell;
}

registerBlockTrait("selectable", selectableBehavior);
registerBlockTrait("transparent", transparentBehavior);
registerBlockTrait("destructible", destructibleBehavior);
registerBlockTrait("attachable", attachableBehavior);
registerBlockTrait("resistant", resistantBehavior);
