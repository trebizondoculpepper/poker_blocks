/**
 * Nested playable payloads in saves (#927; doc/opaque-actives.md, "Capabilities, payload and
 * identity" and "Persistence and clone compatibility").
 *
 * An opaque container stores exactly one unplaced playable instance descriptor
 * `{ id, definition, components }`. The `opaqueContainer` component codec saves it nested inside
 * the container's own `activeObjects` record, never as a second top-level record, and validates it
 * on load through the registered definitions and component codecs, so a corrupt, unknown,
 * recursive or self-aliased payload rejects the save. It reports the payload's ID as an identity
 * the container owns, so the save can refuse a duplicate.
 *
 * `playableCard` is the run-owned playable instance a payload usually is: rebuilt from its
 * `pokerIdentity` (required) and optional `material` components, not from the standard deck.
 * Nothing here knows which container or payload it handles.
 */
import {
  activeComponentCodecs,
  activeDefinitions,
  restoreActiveObjects,
  type SavedActiveObject,
} from "./active-objects";
import { createCard, ranks, suits, type CardBlock } from "./cards";
import { faces } from "./traits/attachable";
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
  // The initial contract permits one level: a payload whose components own nested instances
  // (by their codecs' own account) is refused, whatever those components are.
  const nested = Object.entries(components).flatMap(([name, value]) =>
    activeComponentCodecs.has(name)
      ? (activeComponentCodecs.get(name).ownedIds?.(value) ?? [])
      : [],
  );
  if (nested.length) return ["a payload cannot own nested instances"];
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

activeComponentCodecs.register("opaqueContainer", {
  ownedIds: (saved) => [(saved as StoredPayload).id],
  save: (block) =>
    [block.traits.opaqueContainer ?? []].flat().map(({ payload }) => structuredClone(payload))[0],
  restore: (block, saved) => {
    // Validated now, through the payload's own codecs, so a corrupt save is rejected on load
    // rather than when the container is finally opened.
    materializePayload(block.id, saved as StoredPayload);
    return {
      ...block,
      traits: {
        ...block.traits,
        opaqueContainer: { payload: structuredClone(saved as StoredPayload) },
      },
    };
  },
});

activeDefinitions.register("playableCard", {
  // A playable card is nothing without its rank and suit.
  requires: ["pokerIdentity"],
  // A revealed payload card: its own ordinary run policy, not its wrapper's.
  lifecycle: { parent: "ordinaryCard" },
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
