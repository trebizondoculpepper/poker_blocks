/**
 * Exact cloning (#581; doc/clone-reset.md, "Exact cloning"): a second logical instance of a card in
 * the same current state, with a fresh ID and its own mutable state. It is unplaced: no zone,
 * cell, cost, reward or adoption is implied; a caller that needs clone-and-place validates its
 * destination separately and commits both together.
 *
 * Each card trait registers how it clones (`cloneCodecs`, keyed by trait name):
 *
 * - **shared**: immutable definition data (identity, faces, a material's resolved configuration,
 *   the inspection closure) is kept by reference;
 * - **copied**: instance state (cooking, countdowns, owner, state bonus, modifier registers) is
 *   copied into fresh objects and arrays, so later changes to either card never reach the other.
 *
 * The whole plan is validated before anything is built: a trait with no registered codec rejects
 * the clone (`UnsupportedCloneComponent`) rather than silently dropping its state. The source is
 * never changed, and no random draws are made. Renderer, listener and timer state never lives on
 * a card, so there is nothing of it to copy.
 */
import type { CardBlock } from "./cards";
import { Registry } from "./core/registry";

/**
 * How one trait's value becomes the clone's: return the value the clone should hold. A trait that
 * owns nested instances (a container's payload, #929) validates them first, then allocates their
 * fresh IDs through `context` and records each source → clone ID.
 */
export type CloneCodec = (
  value: unknown,
  context: {
    allocate: () => string;
    ids: Map<string, string>;
    /** The source card's own ID, so a nested instance can be checked against it. */
    sourceId: string;
  },
) => unknown;

export const cloneCodecs = new Registry<CloneCodec>("clone codec");

/** Immutable definition data: the clone shares it. */
const shared: CloneCodec = (value) => value;

/** Plain instance state: a deep copy of plain objects and arrays, so the two never share it. */
const copied: CloneCodec = (value) => copyPlain(value);

function copyPlain(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(copyPlain);
  if (value && typeof value === "object") {
    if (Object.getPrototypeOf(value) !== Object.prototype)
      throw new UnsupportedCloneComponent("a non-plain object in copied state");
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, copyPlain(inner)]));
  }
  if (typeof value === "function")
    throw new UnsupportedCloneComponent("a function in copied state");
  return value;
}

for (const name of [
  "identity",
  "attachable",
  "inspectable",
  "scorable",
  "transparent",
  "destructible",
  "resistant",
  // A definition handle (#894): the clone is another instance of the same definition.
  "active",
  // A rankless block's public name and symbol (#893): definition data, shared.
  "label",
  // A discard behaviour reference (#574): definition data.
  "discardable",
])
  cloneCodecs.register(name, shared);
for (const name of [
  "selectable",
  "material",
  "stateBonus",
  "doneness",
  "owner",
  "countdown",
  "modifiers",
])
  cloneCodecs.register(name, copied);

/** A trait the card holds has no registered clone codec: the clone is refused, nothing changes. */
export class UnsupportedCloneComponent extends Error {
  constructor(component: string) {
    super(`cannot clone ${component}: no registered clone codec`);
    this.name = "UnsupportedCloneComponent";
  }
}

export type CloneResult = {
  clone: CardBlock;
  /** Each ID in the source's subtree and the ID its counterpart in the clone was given. */
  ids: ReadonlyMap<string, string>;
};

/**
 * An exact, unplaced clone of `card`, given a fresh ID by `allocate` (the transaction's
 * allocator). Throws `UnsupportedCloneComponent` before allocating anything if a trait can't be
 * cloned.
 */
export function cloneCard(card: CardBlock, allocate: () => string): CloneResult {
  const plan = Object.entries(card.traits).map(([name, value]) => {
    if (!cloneCodecs.has(name)) throw new UnsupportedCloneComponent(`trait "${name}"`);
    return [name, cloneCodecs.get(name), value] as const;
  });
  const run = (use: () => string) => {
    const ids = new Map<string, string>();
    const traits = Object.fromEntries(
      plan.map(([name, codec, value]) => [
        name,
        codec(value, { allocate: use, ids, sourceId: card.id }),
      ]),
    );
    return { ids, traits };
  };
  // Every codec runs once against a probe first, so any that would throw does so before a real
  // ID is allocated, whatever order the traits come in (#929 review). Codecs are pure.
  run(() => "clone-probe");
  const { ids, traits } = run(allocate);
  const id = allocate();
  ids.set(card.id, id);
  return { clone: { id, traits: traits as CardBlock["traits"] }, ids };
}
