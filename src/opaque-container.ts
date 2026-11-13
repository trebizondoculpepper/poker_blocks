/**
 * Opaque containers and atomic opening (#554; doc/opaque-actives.md, "Capabilities, payload and
 * identity" and "Atomic opening/adoption"; doc/game-events.md, "Resolve opening/replacement").
 *
 * A container instance stores exactly one unplaced playable instance descriptor
 * `{ id, definition, components }`, owned by the container and in no zone. When a play places
 * containers, the `openings` play step resolves each in placement order, before any material
 * phase: the registered `open-container` command removes the wrapper and promotes its payload into
 * the same field cell, in one state update, and reports `block.opened` with both IDs. Opening
 * draws no RNG and performs no new roll; the payload was fixed when the container was made.
 *
 * Nothing here knows what kind of container or payload it handles: the container is a component,
 * the payload rebuilds through the registered active definitions and component codecs.
 */
import {
  activeComponentCodecs,
  activeDefinitions,
  restoreActiveObjects,
  type SavedActiveObject,
} from "./active-objects";
import { createCard, ranks, suits, type CardBlock } from "./cards";
import { playSteps } from "./lifecycle/play-phases";
import { registerRuleCommand, commitCommands } from "./rule-commands";
import { faces } from "./traits/attachable";
import { withoutSelectable } from "./traits/selectable";
import { getMaterialDefinition, materialOf, withMaterial, type BlockMaterial } from "./materials";

/** The one stored playable instance a container holds. */
export type StoredPayload = SavedActiveObject & { id: string };

/** Everything wrong with a stored payload, for a container with this ID (empty when valid). */
export function payloadProblems(containerId: string, payload: unknown): string[] {
  const { id, definition, components } = (payload ?? {}) as Partial<StoredPayload>;
  if (typeof id !== "string" || !id) return ["a payload needs an ID"];
  if (id === containerId) return ["a payload cannot share its container's ID"];
  if (typeof definition !== "string" || !activeDefinitions.has(definition))
    return [`unknown payload definition "${String(definition)}"`];
  if (typeof components !== "object" || components === null || Array.isArray(components))
    return ["a payload needs its components"];
  // The initial contract permits one level: a payload that is itself a container is refused.
  if (Object.hasOwn(components, "opaqueContainer")) return ["a payload cannot be a container"];
  return [];
}

/** The payload rebuilt as a fresh unplaced instance; throws on an invalid descriptor. */
export function materializePayload(containerId: string, payload: StoredPayload): CardBlock {
  const problems = payloadProblems(containerId, payload);
  if (problems.length) throw new Error(problems.join("; "));
  const [block] = restoreActiveObjects({
    [payload.id]: { definition: payload.definition, components: payload.components },
  });
  return block!;
}

// A container's stored payload, saved nested inside it: never also a top-level record.
activeComponentCodecs.register("opaqueContainer", {
  save: (block) =>
    [block.traits.opaqueContainer ?? []].flat().map(({ payload }) => structuredClone(payload))[0],
  restore: (block, saved) => {
    // The payload's own components are validated now, through their codecs, so a corrupt save is
    // rejected on load rather than when the container is finally opened.
    materializePayload(block.id, saved as StoredPayload);
    return {
      ...block,
      traits: { ...block.traits, opaqueContainer: { payload: saved as StoredPayload } },
    };
  },
});

/**
 * A run-owned playable card instance (#554): a revealed payload with a rank and suit, rebuilt
 * from its `pokerIdentity` and `material` components rather than the standard deck.
 */
activeDefinitions.register("playableCard", {
  create: (id) => ({
    id,
    traits: { active: { definition: "playableCard" }, selectable: {}, attachable: { faces } },
  }),
});
activeComponentCodecs.register("pokerIdentity", {
  save: (block) =>
    [block.traits.identity ?? []].flat().map(({ rank, suit }) => ({ rank, suit: suit.name }))[0],
  restore: (block, saved) => {
    const { rank: savedRank, suit: savedSuit } = (saved ?? {}) as {
      rank?: unknown;
      suit?: unknown;
    };
    const rank = ranks.find((candidate) => candidate === savedRank);
    const suit = suits.find(({ name }) => name === savedSuit);
    if (!rank || !suit) throw new Error("bad payload identity");
    const { identity, inspectable, scorable } = createCard({ rank, suit }, block.id).traits;
    return { ...block, traits: { ...block.traits, identity, inspectable, scorable } };
  },
});
activeComponentCodecs.register("material", {
  save: (block) => [block.traits.material ?? []].flat().map(() => materialOf(block))[0],
  restore: (block, saved) => {
    if (typeof saved !== "string") throw new Error("bad payload material");
    return withMaterial(block, getMaterialDefinition(saved as BlockMaterial));
  },
});

/**
 * Open one placed container: the wrapper leaves every zone and its payload takes the same field
 * cell, in a single state update. Nothing happens, and nothing is reported, if the block is not a
 * placed container.
 */
registerRuleCommand<{ blockId: string }>("open-container", ({ blockId }, target) => {
  const { state } = target;
  const index = state.field.findIndex(({ block }) => block.id === blockId);
  const placed = state.field[index];
  const container = [placed?.block.traits.opaqueContainer ?? []].flat()[0];
  if (!placed || !container) return [];
  const payload = withoutSelectable(materializePayload(blockId, container.payload));
  const taken = new Set(
    [
      ...state.field.map(({ block }) => block),
      ...state.hand,
      ...state.deck,
      ...state.discardPile,
    ].map(({ id }) => id),
  );
  if (taken.has(payload.id)) throw new Error(`payload ID ${payload.id} is already in play`);
  target.update({
    ...state,
    field: state.field.map((entry, i) =>
      i === index ? { block: payload, cell: entry.cell } : entry,
    ),
    // The consumed wrapper is retired for the rest of the run: never dealt again, and kept so a
    // save still accounts for it (doc/opaque-actives.md, "A removed wrapper's ID must not
    // reappear").
    removedCards: [...(state.removedCards ?? []), blockId],
    retiredActives: [...(state.retiredActives ?? []), placed.block],
  });
  // The wrapper and the revealed card as they were at opening, for delayed presentation.
  return [
    {
      type: "block.opened",
      blockId,
      blocks: [placed.block, payload],
      opened: { wrapperId: blockId, payloadId: payload.id },
    },
  ];
});

// Openings resolve first, in placement order, before any material phase.
playSteps.register("openings", (context) =>
  commitCommands(
    [...context.placed].map((blockId) => ({ id: "open-container", config: { blockId } })),
    context.target,
  ),
);
