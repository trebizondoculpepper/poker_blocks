/**
 * The discardable capability (#574; doc/ordered-card-ownership.md, "Discardable capability"). A
 * card's discard eligibility comes from its registered behaviour, by name, with configuration:
 * ordinary cards and unopened containers compose the same one. A refusing behaviour returns its
 * reason; nobody checks a marker. Per-action rules (remaining allowance, selection) stay with the
 * dealer: this answers only for one card.
 */
import type { CardBlock } from "./cards";
import { Registry } from "./core/registry";

/** A registered discard behaviour: why this card can't be discarded, or null when it can. */
export type DiscardBehaviour = (block: CardBlock, config: unknown) => string | null;
export const discardBehaviours = new Registry<DiscardBehaviour>("discard behaviour");

// The ordinary behaviour: any hand card may be discarded.
discardBehaviours.register("ordinary", () => null);
// An explicit refusal, with its configured reason.
discardBehaviours.register(
  "refuse",
  (_block, config) => (config as { reason?: string } | undefined)?.reason ?? "cannot be discarded",
);

/** Why this card refuses to be discarded, or null: its declared behaviour, ordinary by default. */
export function discardRefusal(block: CardBlock): string | null {
  const { behaviour = "ordinary", config } = block.traits.discardable ?? {};
  return discardBehaviours.get(behaviour)(block, config);
}
