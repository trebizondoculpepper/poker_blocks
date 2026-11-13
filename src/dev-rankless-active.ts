/**
 * A test-only rankless active (#892; doc/opaque-actives.md, "Capabilities, payload and
 * identity"): a playable block with placement, selection and inspection, but no rank/suit value
 * provider. Dev-prefixed: tests and dev rooms only, never the normal game.
 */
import type { CardBlock } from "./cards";
import { faces } from "./traits/attachable";
import { inspectable } from "./traits/inspectable";
import { activeDefinitions } from "./active-objects";

export function devRanklessActive(id: string): CardBlock {
  return {
    id,
    traits: {
      active: { definition: "devRanklessActive" },
      selectable: {},
      attachable: { faces },
      inspectable: inspectable("Dev rankless active"),
    },
  };
}

// Its registered definition, so a save can rebuild it (#894).
activeDefinitions.register("devRanklessActive", { create: devRanklessActive });
