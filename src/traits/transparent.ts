import type { BlockTraitBehavior } from "../block-trait-behaviours";

/**
 * A see-through block (fire, ice, crystal): you can see into or through it. Its hand
 * preview and its version on the table differ (refraction and inner effects need the
 * table's scene), so when it lands the preview dissolves into the table's version.
 */
export type TransparentTrait = Record<string, never>;

export const transparentBehavior: BlockTraitBehavior = { handover: () => true };
