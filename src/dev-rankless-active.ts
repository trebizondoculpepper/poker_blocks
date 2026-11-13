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
      label: { name: "Dev rankless active", symbol: "◇" },
      selectable: {},
      attachable: { faces },
      inspectable: inspectable("Dev rankless active"),
    },
  };
}

// Its registered definition, so a save can rebuild it (#894).
activeDefinitions.register("devRanklessActive", {
  create: devRanklessActive,
  lifecycle: { parent: "ordinaryCard" },
});

/** A test-only opaque container (#927): a rankless active holding one stored payload descriptor. */
export function devOpaqueContainer(
  id: string,
  payload: { id: string; definition: string; components: Record<string, unknown> },
): CardBlock {
  const base = devRanklessActive(id);
  return {
    ...base,
    traits: {
      ...base.traits,
      active: { definition: "devOpaqueContainer" },
      // A run-owned active (#928): retired in full when it is consumed.
      owner: { id: "runActive" },
      opaqueContainer: { payload },
    },
  };
}
activeDefinitions.register("devOpaqueContainer", {
  // A container is nothing without its payload: a record lacking it is corrupt.
  requires: ["opaqueContainer"],
  lifecycle: { parent: "opaqueWrapper" },
  create: (id) => {
    const base = devRanklessActive(id);
    return {
      ...base,
      traits: {
        ...base.traits,
        active: { definition: "devOpaqueContainer" },
        owner: { id: "runActive" },
      },
    };
  },
});
