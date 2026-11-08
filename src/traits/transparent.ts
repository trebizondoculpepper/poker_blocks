import type { CardBlock } from "../cards";

/**
 * A see-through block (fire, ice, crystal): you can see into or through it. Its hand
 * preview and its version on the table differ (refraction and inner effects need the
 * table's scene), so when it lands the preview dissolves into the table's version.
 */
export type TransparentTrait = Record<string, never>;

export function isTransparent(block: CardBlock): boolean {
  return Boolean(block.traits.transparent);
}
